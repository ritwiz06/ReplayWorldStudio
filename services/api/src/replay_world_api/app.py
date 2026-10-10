"""FastAPI application: health, fixture delivery, project validation and upgrades."""

from __future__ import annotations

import logging
from typing import Annotated, Any, Final

from fastapi import Body, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import ValidationError
from replay_world_contracts import (
    SCHEMA_VERSION,
    HealthResponse,
    KnownParameter,
    Project,
    UpgradeReport,
    ValidationErrorResponse,
    ValidationIssue,
    ValidationReport,
)
from replay_world_contracts.migrations import (
    LEGACY_SCHEMA_VERSIONS,
    MigrationError,
    upgrade_document,
)

from . import __version__
from .catalog_files import CatalogFileError, check_model_files, resolve_catalog_file
from .settings import Settings

logger = logging.getLogger(__name__)

# Fixture names map to fixed files; request paths are never joined onto the filesystem.
FIXTURES: Final = {
    "foundation": "scenes/foundation-scene.json",
    "industrial-demo": "scenes/industrial-demo.json",
}

MIGRATE_COMMAND: Final = "uv run python -m replay_world_contracts.migrate FILE -o UPGRADED.json"

# The body is read as plain JSON so an older schema version gets one precise answer instead
# of a cascade of field errors; OpenAPI still documents the expected Project shape.
_PROJECT_BODY_DOC: Final[dict[str, Any]] = {
    "requestBody": {
        "required": True,
        "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Project"}}},
    }
}
# The upgrade endpoint takes a project document of any supported schema version.
_ANY_PROJECT_BODY_DOC: Final[dict[str, Any]] = {
    "requestBody": {
        "required": True,
        "description": "A project document of any supported schema version.",
        "content": {"application/json": {"schema": {"type": "object"}}},
    }
}


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    app = FastAPI(
        title="Replay World Studio API",
        version=__version__,
        summary="Local API for editable, evidence-aware worlds.",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )

    @app.exception_handler(RequestValidationError)
    async def _request_validation_error(
        _request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        body = ValidationErrorResponse(detail=[_issue(e) for e in exc.errors()])
        return JSONResponse(status_code=422, content=body.model_dump(mode="json"))

    @app.get("/health")
    def health() -> HealthResponse:
        return HealthResponse(
            status="ok",
            service="replay-world-api",
            api_version=__version__,
            schema_version=SCHEMA_VERSION,
        )

    @app.get("/api/v1/fixtures/{name}")
    def get_fixture(name: str) -> Project:
        relative = FIXTURES.get(name)
        if relative is None:
            raise HTTPException(status_code=404, detail=f"Unknown fixture '{name}'")
        path = settings.fixtures_dir / relative
        try:
            return Project.model_validate_json(path.read_bytes())
        except FileNotFoundError:
            logger.error("Fixture file missing: %s", path)
            raise HTTPException(status_code=500, detail=f"Fixture '{name}' is missing") from None
        except ValidationError as exc:
            logger.error("Fixture %s failed contract validation:\n%s", path, exc)
            raise HTTPException(
                status_code=500, detail=f"Fixture '{name}' failed contract validation"
            ) from None

    @app.get("/api/v1/catalog/files/{uri:path}", response_class=FileResponse)
    def get_catalog_file(uri: str) -> FileResponse:
        try:
            path = resolve_catalog_file(settings.catalog_dir, uri)
        except CatalogFileError as exc:
            raise HTTPException(
                status_code=404 if exc.kind == "missing" else 400, detail=exc.message
            ) from None
        return FileResponse(
            path, media_type="model/gltf-binary", headers={"Cache-Control": "no-cache"}
        )

    @app.post("/api/v1/projects/validate", openapi_extra=_PROJECT_BODY_DOC)
    def validate_project(document: Annotated[Any, Body()]) -> ValidationReport:
        version = document.get("schema_version") if isinstance(document, dict) else None
        if version in LEGACY_SCHEMA_VERSIONS:
            raise RequestValidationError(
                [
                    {
                        "type": "schema_version_outdated",
                        "loc": ("body", "schema_version"),
                        "msg": (
                            f"Schema {version} is an older contract; this API accepts "
                            f"{SCHEMA_VERSION}. Open the file in the editor to review the "
                            f"upgrade, or upgrade it with `{MIGRATE_COMMAND}`."
                        ),
                    }
                ]
            )
        project = _validated(document)
        return _report(project, _checked_model_files(project))

    @app.post("/api/v1/projects/upgrade", openapi_extra=_ANY_PROJECT_BODY_DOC)
    def upgrade_project(document: Annotated[Any, Body()]) -> UpgradeReport:
        """Upgrade an older document through the migration chain and validate the result.

        Nothing is stored. The notes describe every change so the client can show them before
        the user decides to open or save the upgraded project.
        """
        if not isinstance(document, dict):
            raise RequestValidationError(
                [
                    {
                        "type": "document_not_object",
                        "loc": ("body",),
                        "msg": "A project document must be a JSON object.",
                    }
                ]
            )
        version = document.get("schema_version")
        try:
            upgrade = upgrade_document(document)
        except MigrationError as exc:
            known = version in (*LEGACY_SCHEMA_VERSIONS, SCHEMA_VERSION)
            raise RequestValidationError(
                [
                    {
                        "type": "upgrade_failed",
                        "loc": ("body",) if known else ("body", "schema_version"),
                        "msg": f"The document could not be upgraded: {exc}",
                    }
                ]
            ) from None
        project = _validated(upgrade.document, upgraded_from=upgrade.from_version)
        return UpgradeReport(
            from_version=upgrade.from_version,
            to_version=SCHEMA_VERSION,
            notes=upgrade.notes,
            project=project,
            validation=_report(project, _checked_model_files(project)),
        )

    def _checked_model_files(project: Project) -> int:
        model_files, file_issues = check_model_files(project, settings.catalog_dir)
        if file_issues:
            raise RequestValidationError(file_issues)
        return model_files

    return app


def _validated(document: Any, upgraded_from: str | None = None) -> Project:
    """Validate a current-version document, reporting errors as paths into ``document``."""
    try:
        return Project.model_validate(document)
    except ValidationError as exc:
        prefix = "" if upgraded_from is None else f"After upgrading from {upgraded_from}: "
        raise RequestValidationError(
            [
                {
                    **e,
                    "loc": ("body", *document_path(document, e["loc"])),
                    "msg": prefix + e["msg"],
                }
                for e in exc.errors()
            ]
        ) from None


def _report(project: Project, model_files: int) -> ValidationReport:
    params = [p for o in project.scene.objects for p in o.parameters]
    known = sum(isinstance(p, KnownParameter) for p in params)
    return ValidationReport(
        valid=True,
        schema_version=SCHEMA_VERSION,
        project_id=project.id,
        object_count=len(project.scene.objects),
        asset_count=len(project.catalog),
        model_file_count=model_files,
        known_parameter_count=known,
        unknown_parameter_count=len(params) - known,
        edit_record_count=len(project.scene.edit_log),
    )


def document_path(document: Any, loc: tuple[str | int, ...]) -> list[str | int]:
    """Turn a Pydantic error location into a path through the submitted document.

    For tagged unions Pydantic inserts the variant tag (for example ``gltf`` or ``known``) as
    if it were a key; such a step is dropped when the document has no key of that name and the
    node's ``type`` or ``state`` field holds that tag, so the UI can show a real JSON Pointer.
    """
    node: Any = document
    path: list[str | int] = []
    for part in loc:
        if (
            isinstance(node, dict)
            and isinstance(part, str)
            and part not in node
            and part in (node.get("type"), node.get("state"))
        ):
            continue
        path.append(part)
        if isinstance(node, dict) and isinstance(part, str):
            node = node.get(part)
        elif isinstance(node, list) and isinstance(part, int) and 0 <= part < len(node):
            node = node[part]
        else:
            node = None
    return path


def _issue(error: Any) -> ValidationIssue:
    """Summarise one validation error without echoing the rejected input back."""
    if error["type"] == "json_invalid":
        # FastAPI reports the character offset as a location; keep it in the message instead.
        position = error["loc"][1] if len(error["loc"]) > 1 else "?"
        reason = error.get("ctx", {}).get("error", "malformed document")
        return ValidationIssue(
            loc=["body"], msg=f"Invalid JSON at character {position}: {reason}", type="json_invalid"
        )
    return ValidationIssue(loc=list(error["loc"]), msg=error["msg"], type=error["type"])


app = create_app()
