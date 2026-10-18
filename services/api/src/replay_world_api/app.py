"""FastAPI application: health, fixtures, project validation and upgrades, generated objects and
language-assisted proposals."""

from __future__ import annotations

import base64
import logging
import threading
from typing import Annotated, Any, Final, Literal, NoReturn

import anyio
import anyio.to_thread
from fastapi import Body, FastAPI, HTTPException, Path, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import ValidationError
from replay_world_contracts import (
    MAX_DRAWING_BYTES,
    SCHEMA_VERSION,
    AssistStatus,
    CatalogAsset,
    DrawingAnalysis,
    EditProposalRequest,
    EditProposalResult,
    GeneratedAssetRequest,
    GeneratedAssetRevisionRequest,
    GeneratedModel,
    GeneratedModelRequest,
    GeneratedModelRestoreReport,
    HealthResponse,
    ImageAnalysisRequest,
    ImageProposalResult,
    KnownParameter,
    ModelRevisionProposalRequest,
    ModelRevisionProposalResult,
    ObjectProposalRequest,
    ObjectProposalResult,
    PlanProposalResult,
    PlanUpload,
    Project,
    StoredPhoto,
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
from .assist.edits import propose_edit
from .assist.images import propose_image
from .assist.plans import propose_plan
from .assist.proposals import AssistError, propose_object
from .assist.provider import (
    Provider,
    ProviderError,
    provider_from_settings,
    vision_provider_from_settings,
)
from .assist.revisions import propose_revision
from .catalog_files import CatalogFileError, check_model_files, resolve_catalog_file
from .drawings import DrawingError, analyse_drawing, check_drawing_files
from .generated_assets import (
    create_asset_revision,
    create_generated_asset,
    restore_generated_models,
)
from .objects import GeneratorError, build_model, fit_to_envelope, gltf_visual, store_model
from .photos import (
    MAX_PHOTO_BYTES,
    PhotoError,
    check_source_files,
    resolve_source_file,
    store_photo,
)
from .plans import PlanError, library_file, read_pdf_page, store_plan
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


def _plan_status(exc: PlanError) -> int:
    return {"too_large": 413, "unsupported": 415, "missing": 404}.get(exc.kind, 422)


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
    def validate_project(
        document: Annotated[Any, Body()],
        missing_sources: Annotated[Literal["refuse", "allow"], Query()] = "refuse",
    ) -> ValidationReport:
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
        models = _checked_model_files(project)
        photos, missing = _checked_source_files(project, allow_missing=missing_sources == "allow")
        return _report(project, models, photos, missing)

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
            validation=_report(
                project, _checked_model_files(project), *_checked_source_files(project, False)
            ),
        )

    provider = provider_from_settings(settings.assist)
    vision = vision_provider_from_settings(settings.assist)

    @app.get("/api/v1/assist/status")
    def assist_status() -> AssistStatus:
        """Whether language proposals are available and where they would be sent. No secrets."""
        if provider is None:
            return AssistStatus(
                available=False,
                mode="off",
                service=None,
                base_url=None,
                model=None,
                vision_model=None,
                message=(
                    "Language proposals are off: no provider is configured. Set VOYAGER_API_KEY "
                    "in the repository's .env and restart the API, or use the object builder."
                ),
            )
        recorded = provider.mode == "recorded"
        return AssistStatus(
            available=True,
            mode=provider.mode,
            service=provider.service,
            base_url=provider.base_url,
            model=provider.model,
            vision_model=vision.model if vision is not None else None,
            message=(
                "Offline test provider: replays recorded answers. Not live AI."
                if recorded
                else f"Descriptions and edit requests are sent to {provider.service} "
                f"({provider.base_url}, model {provider.model}) to draft proposals."
            ),
        )

    def _provider() -> Provider:
        if provider is None:
            raise HTTPException(
                status_code=503,
                detail="Language proposals are off (no provider configured). Use the object "
                "builder, or set VOYAGER_API_KEY in .env and restart the API.",
            )
        return provider

    def _assist_failure(exc: ProviderError | AssistError) -> NoReturn:
        if isinstance(exc, AssistError):
            raise HTTPException(status_code=exc.status, detail=exc.message) from None
        status = {"timeout": 504, "unavailable": 503, "not_recorded": 503}.get(exc.kind, 502)
        raise HTTPException(status_code=status, detail=exc.message) from None

    @app.post("/api/v1/assist/object-proposals")
    def object_proposals(body: ObjectProposalRequest) -> ObjectProposalResult:
        """Draft a typed proposal for a described object. Nothing is created or stored."""
        try:
            return propose_object(_provider(), body.description)
        except (ProviderError, AssistError) as exc:
            _assist_failure(exc)

    @app.post("/api/v1/assist/edit-proposals")
    def edit_proposals(body: EditProposalRequest) -> EditProposalResult:
        """Interpret one edit request against the described scene. Nothing is changed."""
        try:
            return propose_edit(_provider(), body)
        except (ProviderError, AssistError) as exc:
            _assist_failure(exc)

    @app.post("/api/v1/assist/model-revisions")
    async def model_revisions(
        body: ModelRevisionProposalRequest, request: Request
    ) -> ModelRevisionProposalResult:
        """Propose a bounded change to a generated model's specification. Nothing is built.

        The whole request, retry included, has one budget (the provider timeout). If the client
        goes away (Cancel, a closed page), no further provider call is made and a late answer
        is discarded; a call already in flight ends within the budget.
        """
        chosen = _provider()
        cancelled = threading.Event()

        async def watch() -> None:
            while not cancelled.is_set():
                if await request.is_disconnected():
                    cancelled.set()
                    return
                await anyio.sleep(0.25)

        def run() -> ModelRevisionProposalResult:
            return propose_revision(
                chosen, body, budget_s=settings.assist.timeout_s, cancelled=cancelled
            )

        failure: ProviderError | AssistError | None = None
        result: ModelRevisionProposalResult | None = None
        async with anyio.create_task_group() as group:
            group.start_soon(watch)
            try:
                result = await anyio.to_thread.run_sync(run)
            except (ProviderError, AssistError) as exc:
                failure = exc
            finally:
                group.cancel_scope.cancel()
        if failure is not None or result is None:
            _assist_failure(failure or AssistError(502, "No revision was produced."))
        return result

    @app.post("/api/v1/assist/image-proposals")
    def image_proposals(body: ImageAnalysisRequest) -> ImageProposalResult:
        """Propose the objects standing on the floor of a photo. Nothing is stored or logged."""
        if vision is None:
            raise HTTPException(
                status_code=503,
                detail="Photo analysis is off (no provider configured). Mark the objects "
                "yourself, or set VOYAGER_API_KEY in .env and restart the API.",
            )
        try:
            return propose_image(vision, body)
        except (ProviderError, AssistError) as exc:
            _assist_failure(exc)

    @app.post("/api/v1/assist/plan-proposals")
    def plan_proposals(body: ImageAnalysisRequest) -> PlanProposalResult:
        """Draft the floor, walls and objects of a plan image. Nothing is stored or logged."""
        if vision is None:
            raise HTTPException(
                status_code=503,
                detail="Plan proposals are off (no provider configured). Mark the floor and "
                "objects yourself, or set VOYAGER_API_KEY in .env and restart the API.",
            )
        try:
            return propose_plan(vision, body)
        except (ProviderError, AssistError) as exc:
            _assist_failure(exc)

    @app.post(
        "/api/v1/sources/plans",
        openapi_extra={
            "requestBody": {
                "required": True,
                "content": {
                    media: {"schema": {"type": "string", "format": "binary"}}
                    for media in ("application/pdf", "image/png", "image/jpeg")
                },
            }
        },
    )
    async def upload_plan(
        request: Request,
        filename: Annotated[str, Query(min_length=1, max_length=255)],
    ) -> PlanUpload:
        """Store a floor-plan PDF, PNG or JPEG by its sha256 (IMP-03). An image or a one-page
        PDF comes back read as a picture in pixels; a longer PDF lists its pages. No language
        model is called and nothing is added to a project."""
        chunks: list[bytes] = []
        size = 0
        async for chunk in request.stream():
            size += len(chunk)
            if size > MAX_DRAWING_BYTES:
                raise HTTPException(
                    status_code=413,
                    detail=f"The plan is larger than {MAX_DRAWING_BYTES // 1048576} MB.",
                )
            chunks.append(chunk)
        data = b"".join(chunks)
        try:
            return await anyio.to_thread.run_sync(
                lambda: store_plan(data, filename, settings.sources_dir)
            )
        except PlanError as exc:
            raise HTTPException(status_code=_plan_status(exc), detail=exc.message) from None
        except PhotoError as exc:
            raise HTTPException(status_code=400, detail=exc.message) from None

    @app.post("/api/v1/sources/plans/{sha256}/pages/{page}")
    async def read_plan_page(
        sha256: Annotated[str, Path(pattern=r"^[0-9a-f]{64}$")],
        page: Annotated[int, Path(ge=1, le=50)],
        filename: Annotated[str, Query(min_length=1, max_length=255)],
    ) -> DrawingAnalysis:
        """Render the chosen page of a stored PDF and read it as a picture in pixels."""
        try:
            return await anyio.to_thread.run_sync(
                lambda: read_pdf_page(sha256, page, filename, settings.sources_dir)
            )
        except PlanError as exc:
            raise HTTPException(status_code=_plan_status(exc), detail=exc.message) from None
        except PhotoError as exc:
            raise HTTPException(status_code=400, detail=exc.message) from None

    @app.post(
        "/api/v1/sources/photos",
        openapi_extra={
            "requestBody": {
                "required": True,
                "content": {
                    media: {"schema": {"type": "string", "format": "binary"}}
                    for media in ("image/jpeg", "image/png", "image/webp")
                },
            }
        },
    )
    async def upload_photo(
        request: Request,
        filename: Annotated[str, Query(min_length=1, max_length=255)],
        expected_sha256: Annotated[str | None, Query(pattern=r"^[0-9a-f]{64}$")] = None,
    ) -> StoredPhoto:
        """Store an original photo in the local source library, named by its sha256.

        With ``expected_sha256`` (re-attaching a project's missing photo), a different file is
        refused and nothing is written.
        """
        # Read at most one byte more than the limit, whatever Content-Length claims.
        chunks: list[bytes] = []
        size = 0
        async for chunk in request.stream():
            size += len(chunk)
            if size > MAX_PHOTO_BYTES:
                raise HTTPException(status_code=413, detail="The photo is larger than 15 MB.")
            chunks.append(chunk)
        data = b"".join(chunks)
        try:
            return store_photo(data, filename, settings.sources_dir, expected_sha256)
        except PhotoError as exc:
            status = {"too_large": 413, "hash_mismatch": 409, "unsafe": 400}.get(exc.kind, 422)
            raise HTTPException(status_code=status, detail=exc.message) from None

    @app.post(
        "/api/v1/sources/drawings",
        openapi_extra={
            "requestBody": {
                "required": True,
                "content": {
                    media: {"schema": {"type": "string", "format": "binary"}}
                    for media in ("application/dxf", "application/octet-stream", "text/plain")
                },
            }
        },
    )
    async def upload_drawing(
        request: Request,
        filename: Annotated[str, Query(min_length=1, max_length=255)],
    ) -> DrawingAnalysis:
        """Read a DXF drawing deterministically (IMP-01) and store it by its sha256.

        Nothing is added to a project. A DWG, binary DXF, damaged, empty, too large or too
        complex file is refused with the reason and is not stored. No language model is called.
        """
        chunks: list[bytes] = []
        size = 0
        async for chunk in request.stream():
            size += len(chunk)
            if size > MAX_DRAWING_BYTES:
                raise HTTPException(
                    status_code=413,
                    detail=f"The drawing is larger than {MAX_DRAWING_BYTES // 1048576} MB. "
                    "Export only the floor-layout layers.",
                )
            chunks.append(chunk)
        data = b"".join(chunks)
        try:
            return await anyio.to_thread.run_sync(
                lambda: analyse_drawing(data, filename, settings.sources_dir)
            )
        except DrawingError as exc:
            status = {
                "too_large": 413,
                "dwg": 415,
                "binary": 415,
                "not_dxf": 415,
                "unsafe": 400,
            }.get(exc.kind, 422)
            raise HTTPException(status_code=status, detail=exc.message) from None

    @app.get("/api/v1/sources/files/{uri:path}", response_class=FileResponse)
    def get_source_file(uri: str) -> FileResponse:
        if uri.startswith("drawings/"):
            # A plan image's picture (the image itself, or a rendered PDF page).
            plan = library_file(settings.sources_dir, uri)
            if plan is None or plan.suffix not in (".png", ".jpg"):
                raise HTTPException(status_code=404, detail="That plan picture is not here.")
            media = "image/png" if plan.suffix == ".png" else "image/jpeg"
            return FileResponse(plan, media_type=media, headers={"Cache-Control": "no-cache"})
        try:
            path = resolve_source_file(settings.sources_dir, uri)
        except PhotoError as exc:
            raise HTTPException(
                status_code=404 if exc.kind == "missing" else 400, detail=exc.message
            ) from None
        media = {"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp"}[
            uri.rsplit(".", 1)[1]
        ]
        return FileResponse(path, media_type=media, headers={"Cache-Control": "no-cache"})

    def _generated_model(body: GeneratedModelRequest, store: bool) -> GeneratedModel:
        try:
            spec, scale, notes = fit_to_envelope(body.spec)
            model = build_model(spec)
            if store:
                store_model(model, settings.catalog_dir)
        except GeneratorError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from None
        return GeneratedModel(
            spec=spec,
            visual=gltf_visual(model),
            scale_applied=scale,
            triangles=model.triangles,
            bytes=len(model.glb),
            materials=list(model.materials),
            notes=notes,
            stored=store,
            glb_base64=None if store else base64.b64encode(model.glb).decode("ascii"),
        )

    @app.post("/api/v1/catalog/generated-models/preview")
    def preview_generated_model(body: GeneratedModelRequest) -> GeneratedModel:
        """Build a model from a geometry draft and return its bytes; nothing is stored."""
        return _generated_model(body, store=False)

    @app.post("/api/v1/catalog/generated-models")
    def store_generated_model(body: GeneratedModelRequest) -> GeneratedModel:
        """Build a model and store it in the catalog library under generated/<sha256>.glb."""
        return _generated_model(body, store=True)

    @app.post("/api/v1/catalog/generated-assets")
    def generated_asset(body: GeneratedAssetRequest) -> CatalogAsset:
        """Turn a reviewed proposal into a catalog asset whose model file is stored and pinned."""
        try:
            return create_generated_asset(body, settings.catalog_dir)
        except AssistError as exc:
            _assist_failure(exc)
        except GeneratorError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from None

    @app.post("/api/v1/catalog/generated-assets/revisions")
    def generated_asset_revision(body: GeneratedAssetRevisionRequest) -> CatalogAsset:
        """Store a revision of a generated asset as a new asset; the previous one is unchanged."""
        try:
            return create_asset_revision(body, settings.catalog_dir)
        except AssistError as exc:
            _assist_failure(exc)
        except GeneratorError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from None

    @app.post("/api/v1/catalog/generated-models/restore", openapi_extra=_PROJECT_BODY_DOC)
    def restore_models(document: Annotated[Any, Body()]) -> GeneratedModelRestoreReport:
        """Rebuild a project's missing generated models from their recorded specifications.

        A document in an older contract is upgraded first, losslessly: upgrades never change a
        recorded specification or generator version, so the rebuilt files are the same.
        """
        upgraded_from = None
        if isinstance(document, dict) and document.get("schema_version") in LEGACY_SCHEMA_VERSIONS:
            try:
                upgrade = upgrade_document(document)
            except MigrationError as exc:
                raise RequestValidationError(
                    [
                        {
                            "type": "upgrade_failed",
                            "loc": ("body",),
                            "msg": f"The document could not be upgraded: {exc}",
                        }
                    ]
                ) from None
            document, upgraded_from = upgrade.document, upgrade.from_version
        project = _validated(document, upgraded_from=upgraded_from)
        try:
            return restore_generated_models(project, settings.catalog_dir)
        except GeneratorError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from None

    def _checked_source_files(project: Project, allow_missing: bool) -> tuple[int, list[str]]:
        verified, issues, missing = check_source_files(project, settings.sources_dir, allow_missing)
        drawing_issues, missing_drawings = check_drawing_files(project, settings.sources_dir)
        issues += drawing_issues
        missing += missing_drawings
        if issues:
            raise RequestValidationError(issues)
        return verified, missing

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


def _report(
    project: Project, model_files: int, photo_files: int, missing_sources: list[str]
) -> ValidationReport:
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
        photo_file_count=photo_files,
        missing_source_files=missing_sources,
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
