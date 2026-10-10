"""FastAPI application: health, fixture delivery and project validation."""

from __future__ import annotations

import logging
from typing import Annotated, Any, Final

from fastapi import Body, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from replay_world_contracts import (
    SCHEMA_VERSION,
    HealthResponse,
    KnownParameter,
    Project,
    ValidationErrorResponse,
    ValidationIssue,
    ValidationReport,
)
from replay_world_contracts.migrations import LEGACY_SCHEMA_VERSIONS

from . import __version__
from .settings import Settings

logger = logging.getLogger(__name__)

# Fixture names map to fixed files; request paths are never joined onto the filesystem.
FIXTURES: Final = {"foundation": "scenes/foundation-scene.json"}

MIGRATE_COMMAND: Final = "uv run python -m replay_world_contracts.migrate FILE -o UPGRADED.json"

# The body is read as plain JSON so an older schema version gets one precise answer instead
# of a cascade of field errors; OpenAPI still documents the expected Project shape.
_PROJECT_BODY_DOC: Final[dict[str, Any]] = {
    "requestBody": {
        "required": True,
        "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Project"}}},
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
                            f"{SCHEMA_VERSION}. Upgrade the file with `{MIGRATE_COMMAND}`, "
                            "then open the upgraded file."
                        ),
                    }
                ]
            )
        try:
            project = Project.model_validate(document)
        except ValidationError as exc:
            raise RequestValidationError(
                [{**e, "loc": ("body", *e["loc"])} for e in exc.errors()]
            ) from None
        params = [p for o in project.scene.objects for p in o.parameters]
        known = sum(isinstance(p, KnownParameter) for p in params)
        return ValidationReport(
            valid=True,
            schema_version=SCHEMA_VERSION,
            project_id=project.id,
            object_count=len(project.scene.objects),
            asset_count=len(project.catalog),
            known_parameter_count=known,
            unknown_parameter_count=len(params) - known,
        )

    return app


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
