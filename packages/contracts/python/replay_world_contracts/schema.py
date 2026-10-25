"""Export the JSON Schema bundle that TypeScript types and browser validation are generated from.

Usage: ``uv run python -m replay_world_contracts.schema`` (writes the bundle to stdout).
"""

from __future__ import annotations

import json
import sys
from typing import Any, Final, Literal

from pydantic import BaseModel
from pydantic.json_schema import GenerateJsonSchema, models_json_schema
from pydantic_core import CoreSchema

from .assist import (
    AssistStatus,
    ChatRequest,
    ChatResult,
    DrawingAnalysis,
    EditProposalRequest,
    EditProposalResult,
    GeneratedAssetRequest,
    GeneratedAssetRevisionRequest,
    GeneratedModel,
    GeneratedModelRequest,
    GeneratedModelRestoreReport,
    ImageAnalysisRequest,
    ImageProposalResult,
    ModelRevisionProposalRequest,
    ModelRevisionProposalResult,
    ObjectProposalRequest,
    ObjectProposalResult,
    PlanProposalResult,
    PlanUpload,
    ProcessSuggestionRequest,
    ProcessSuggestionResult,
    StoredPhoto,
)
from .evidence import (
    EvidenceBundleOpened,
    EvidenceBundleRequest,
    EvidenceInventory,
)
from .models import (
    SCHEMA_VERSION,
    CatalogAsset,
    HealthResponse,
    Project,
    UpgradeReport,
    ValidationErrorResponse,
    ValidationReport,
)
from .uploads import UploadedAssetRequest, UploadedModelReport

ROOT_MODELS: Final[tuple[type[BaseModel], ...]] = (
    Project,
    HealthResponse,
    ValidationReport,
    UpgradeReport,
    ValidationErrorResponse,
    CatalogAsset,
    AssistStatus,
    ObjectProposalRequest,
    ObjectProposalResult,
    EditProposalRequest,
    EditProposalResult,
    ChatRequest,
    ChatResult,
    GeneratedModelRequest,
    GeneratedModel,
    GeneratedAssetRequest,
    GeneratedModelRestoreReport,
    ImageAnalysisRequest,
    ImageProposalResult,
    StoredPhoto,
    GeneratedAssetRevisionRequest,
    ModelRevisionProposalRequest,
    ModelRevisionProposalResult,
    DrawingAnalysis,
    PlanUpload,
    PlanProposalResult,
    ProcessSuggestionRequest,
    ProcessSuggestionResult,
    EvidenceBundleRequest,
    EvidenceBundleOpened,
    EvidenceInventory,
    UploadedModelReport,
    UploadedAssetRequest,
)
BUNDLE_ID: Final = f"urn:replay-world:contracts:{SCHEMA_VERSION}"


class _ContractSchemaGenerator(GenerateJsonSchema):
    # Field titles would become one TypeScript alias per property; model titles are kept.
    def field_title_should_be_set(self, schema: CoreSchema | Any) -> bool:
        return False


def _portable_discriminators(node: Any) -> Any:
    """Reduce Pydantic's OpenAPI-style ``discriminator`` to the subset Ajv supports.

    Ajv needs ``type: object`` beside the keyword and rejects ``mapping``; the mapping is
    redundant because every ``oneOf`` branch pins the property with ``const``.
    """
    if isinstance(node, list):
        return [_portable_discriminators(item) for item in node]
    if not isinstance(node, dict):
        return node
    out = {key: _portable_discriminators(value) for key, value in node.items()}
    if "discriminator" in out:
        out["discriminator"] = {"propertyName": out["discriminator"]["propertyName"]}
        out.setdefault("type", "object")
    return out


def build_schema_bundle(
    mode: Literal["validation", "serialization"] = "validation",
) -> dict[str, Any]:
    """Return one JSON Schema (2020-12) whose ``$defs`` hold every root contract model."""
    _, top = models_json_schema(
        [(model, mode) for model in ROOT_MODELS],
        ref_template="#/$defs/{model}",
        schema_generator=_ContractSchemaGenerator,
    )
    names = [model.__name__ for model in ROOT_MODELS]
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": BUNDLE_ID,
        "title": "ReplayWorldContracts",
        "description": (
            f"Replay World Studio contracts, schema version {SCHEMA_VERSION}. "
            "Generated from packages/contracts/python - do not edit by hand."
        ),
        "type": "object",
        "properties": {name: {"$ref": f"#/$defs/{name}"} for name in names},
        "required": names,
        "additionalProperties": False,
        "$defs": _portable_discriminators(top["$defs"]),
    }


def render_schema_bundle() -> str:
    return json.dumps(build_schema_bundle(), indent=2, ensure_ascii=False) + "\n"


if __name__ == "__main__":
    sys.stdout.write(render_schema_bundle())
