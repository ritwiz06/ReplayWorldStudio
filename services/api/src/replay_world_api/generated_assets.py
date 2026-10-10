"""Generated catalog assets: from a reviewed proposal to a stored, hash-pinned model.

The browser sends the reviewed specification and how each dimension was settled; the API
builds the model with its own generator, stores it in the catalog library under
``generated/<sha256>.glb`` and returns a complete, validated :class:`CatalogAsset`. Evidence
rules live here, in one place:

* a dimension the description stated becomes ``user_supplied`` and cites the user's words;
* an estimate stays ``inferred`` and must have been confirmed by the user before placement;
* a value the user typed becomes ``user_supplied``;
* mass, strength, chemical composition and operating behaviour stay unknown.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Final, Literal

from replay_world_contracts import (
    GENERATOR_VERSION,
    AssetGeneration,
    CatalogAsset,
    GeneratedAssetRequest,
    GeneratedModelRestoreReport,
    Length,
    Project,
    RestoredModel,
    ReviewedLength,
)
from replay_world_contracts.models import GltfVisual

from .assist.proposals import AssistError, unknown_properties
from .catalog_files import sha256_of
from .objects import build_model, fit_to_envelope, gltf_visual, store_model

GENERATED_AUTHOR: Final = f"Replay World Studio object generator ({GENERATOR_VERSION})"
DESCRIPTION_SUFFIX: Final = " from the description"
GENERATED_TERMS: Final = (
    "Original provisional model built by this project's own generator from the recorded "
    "geometry specification; no third-party content. The project owner has not chosen a license."
)


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:48].strip("-") or "object"


def _length(axis: str, value: float, review: ReviewedLength, source: str) -> Length:
    origin: Literal["user_supplied", "inferred"]
    if review.basis == "stated":
        origin = "user_supplied"
        ref = (
            f"Stated in the description: “{review.quote}”"
            if review.quote
            else "Stated in the description"
        )
    elif review.basis == "inferred":
        if not review.confirmed:
            raise AssistError(
                422, f"Confirm the estimated {axis} before placing the object (nothing was saved)."
            )
        origin = "inferred"
        ref = f"Estimated by {source}; confirmed by the user before placement"
    else:
        origin = "user_supplied"
        ref = "Entered by the user while reviewing the generated object"
    return Length.model_validate(
        {
            "value_m": value,
            "origin": origin,
            "source_ref": ref[:500],
            "review_status": "confirmed" if review.confirmed else "unreviewed",
            "uncertainty_m": None,
        }
    )


def create_generated_asset(request: GeneratedAssetRequest, catalog_dir: Path) -> CatalogAsset:
    """Build, store and describe the model for a reviewed request. Raises AssistError on refusal."""
    if request.method == "described" and (
        request.language_model is None or not request.description
    ):
        raise AssistError(422, "A described object must record its description and language model.")
    spec, _scale, _notes = fit_to_envelope(request.spec)
    model = build_model(spec)
    store_model(model, catalog_dir)
    visual = gltf_visual(model)

    source = (
        f"{request.language_model.service} {request.language_model.model} from the description"
        if request.language_model is not None and request.method == "described"
        else "the object builder"
    )
    envelope = spec.envelope_m
    reviewed = request.dimensions
    dimensions = {
        "width": _length("width", envelope.x, reviewed.width, source),
        "height": _length("height", envelope.y, reviewed.height, source),
        "depth": _length("depth", envelope.z, reviewed.depth, source),
    }
    described = request.method == "described"
    generation = AssetGeneration.model_validate(
        {
            "method": request.method,
            "description": request.description if described else None,
            "language_model": request.language_model.model_dump()
            if described and request.language_model
            else None,
            "generator": GENERATOR_VERSION,
            "spec": spec.model_dump(),
            "stated_facts": request.stated_facts,
            "inferred_facts": request.inferred_facts,
            "not_modelled": request.not_modelled,
            "unknown_properties": [u.model_dump() for u in unknown_properties()],
        }
    )
    return CatalogAsset.model_validate(
        {
            "id": f"asset-gen-{_slug(request.name)}-{model.sha256[:8]}",
            "name": request.name,
            "kind": request.kind,
            "visual": visual.model_dump(),
            "nominal_dimensions": {
                axis: length.model_dump() for axis, length in dimensions.items()
            },
            "source": {
                "kind": "generated",
                "author": GENERATED_AUTHOR,
                "reference": (
                    f"Described by the user; proposal by {source.removesuffix(DESCRIPTION_SUFFIX)}"
                    if described
                    else "Built by the user in the object builder"
                ),
            },
            "rights": {
                "license": "NOASSERTION",
                "redistribution": "unknown",
                "attribution": None,
                "terms_ref": GENERATED_TERMS,
            },
            "generation": generation.model_dump(),
        }
    )


def restore_generated_models(project: Project, catalog_dir: Path) -> GeneratedModelRestoreReport:
    """Rebuild missing or damaged generated models; keep a file only if its hash matches."""
    results: list[RestoredModel] = []
    for asset in project.catalog:
        if asset.generation is None or not isinstance(asset.visual, GltfVisual):
            continue
        visual = asset.visual
        path = catalog_dir / visual.uri
        if path.is_file() and sha256_of(path) == visual.sha256:
            status: Literal["present", "restored", "mismatch"] = "present"
            message = "The model file is present and matches its recorded sha256."
        else:
            model = build_model(asset.generation.spec)
            if model.sha256 == visual.sha256:
                if path.is_file():
                    path.unlink()  # damaged: named by a hash its bytes do not have
                store_model(model, catalog_dir)
                status = "restored"
                message = "Rebuilt from its recorded specification; the sha256 matches."
            else:
                status = "mismatch"
                message = (
                    "Rebuilding from the recorded specification gave different bytes "
                    f"(sha256 {model.sha256[:12]}…), so nothing was written. The generator may "
                    "have changed since the project was saved."
                )
        results.append(
            RestoredModel(asset_id=asset.id, uri=visual.uri, status=status, message=message)
        )
    return GeneratedModelRestoreReport(results=results)
