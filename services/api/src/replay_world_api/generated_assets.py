"""Generated catalog assets: from a reviewed proposal to a stored, hash-pinned model.

The browser sends the reviewed specification and how each dimension was settled; the API
builds the model with its own generator, stores it in the catalog library under
``generated/<sha256>.glb`` and returns a complete, validated :class:`CatalogAsset`. Evidence
rules live here, in one place:

* a dimension the description stated becomes ``user_supplied`` and cites the user's words;
* an estimate stays ``inferred`` and must have been confirmed by the user before placement;
* a value the user typed becomes ``user_supplied``;
* mass, strength, chemical composition and operating behaviour stay unknown.

A revision (GEN-02) is a new asset with its own model file; the previous asset and its file are
never changed. An unchanged dimension keeps its value and evidence exactly, so changing parts or
colours never turns an estimate into a measurement.
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
    GeneratedAssetRevisionRequest,
    GeneratedModelRestoreReport,
    Length,
    Project,
    ReferenceAssetRequest,
    RestoredModel,
    ReviewedLength,
    RevisedLength,
)
from replay_world_contracts.models import MAX_REVISION_VERSION, GltfVisual

from .assist.proposals import AssistError, unknown_properties
from .catalog_files import sha256_of
from .objects import build_model, fit_to_envelope, gltf_visual, store_model

GENERATED_AUTHOR: Final = f"Replay World Studio object generator ({GENERATOR_VERSION})"
DESCRIPTION_SUFFIX: Final = " from the description"
GENERATED_TERMS: Final = (
    "Original provisional model built by this project's own generator from the recorded "
    "geometry specification; no third-party content. The project owner has not chosen a license."
)
NAME_MAX_CHARS: Final = 80
"""As for a new generated asset's name (``ShortText``)."""
KEPT_TOLERANCE_M: Final = 1e-6
_VERSION_SUFFIX: Final = re.compile(r" \(v\d+\)$")
_REVISION_REFERENCE: Final = re.compile(r"; revision \d+ by the user$")


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
    elif review.basis == "photo":
        # Derived from the photo with the user's scale reference: approximate, and only as
        # good as the floor reference and the object's outline.
        origin = "inferred"
        ref = review.source_ref or "Derived from the photo"
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
    if request.method == "photo" and not request.description:
        raise AssistError(422, "An object from a photo must record what was seen.")
    spec, _scale, _notes = fit_to_envelope(request.spec)
    model = build_model(spec)
    store_model(model, catalog_dir)
    visual = gltf_visual(model)

    lm = request.language_model
    source = (
        f"{lm.service} {lm.model} from the description"
        if lm is not None and request.method == "described"
        else f"{lm.service} {lm.model} from the photo"
        if lm is not None and request.method == "photo"
        else "the photo"
        if request.method == "photo"
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
    keeps_words = request.method in ("described", "photo")
    generation = AssetGeneration.model_validate(
        {
            "method": request.method,
            "description": request.description if keeps_words else None,
            "language_model": request.language_model.model_dump()
            if keeps_words and request.language_model
            else None,
            "generator": GENERATOR_VERSION,
            "spec": spec.model_dump(),
            "stated_facts": request.stated_facts,
            "inferred_facts": request.inferred_facts,
            "not_modelled": request.not_modelled,
            "unknown_properties": [u.model_dump() for u in unknown_properties()],
            "revision": None,
            "reference": None,
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
                    else f"Seen in a photo ({request.description}); provisional shape"
                    if request.method == "photo"
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
            "upload": None,
        }
    )


def create_reference_asset(request: ReferenceAssetRequest, catalog_dir: Path) -> CatalogAsset:
    """Build and store a reviewed appearance made from a reference photo (ENR-01) as a new
    generated asset. Raises AssistError on refusal; nothing is written then.

    The specification's envelope is the object's recorded size: the asset's nominal sizes are
    that envelope, recorded as ``inferred`` with where it came from, so a photo never becomes
    evidence of a size. The object keeps its own dimensions and evidence.
    """
    reference = request.reference
    if (request.language_model is None) != (reference.prompt is None):
        raise AssistError(
            422,
            "An appearance proposed by a vision model records the model and its prompt; one "
            "built by hand records neither.",
        )
    spec, _scale, _notes = fit_to_envelope(request.spec)
    if spec.envelope_m != request.spec.envelope_m:
        raise AssistError(422, "An appearance from a photo keeps the object's recorded size.")
    model = build_model(spec)
    lm = request.language_model
    by = f"proposed by {lm.service} {lm.model}" if lm else "built by the user"
    size_ref = (
        f"The recorded size of {request.object_name} when this appearance was made (its "
        "envelope); not measured from the photo"
    )[:500]
    envelope = spec.envelope_m
    nominal = {
        axis: {
            "value_m": value,
            "origin": "inferred",
            "source_ref": size_ref,
            "review_status": "unreviewed",
            "uncertainty_m": None,
        }
        for axis, value in (("width", envelope.x), ("height", envelope.y), ("depth", envelope.z))
    }
    generation = AssetGeneration.model_validate(
        {
            "method": "reference_photo",
            "description": request.summary,
            "language_model": lm.model_dump() if lm else None,
            "generator": GENERATOR_VERSION,
            "spec": spec.model_dump(),
            "stated_facts": [],
            "inferred_facts": list(dict.fromkeys([*reference.estimated, *request.changes]))[:40],
            "not_modelled": request.not_represented,
            "unknown_properties": [u.model_dump() for u in unknown_properties()],
            "revision": None,
            "reference": reference.model_dump(),
        }
    )
    asset = CatalogAsset.model_validate(
        {
            "id": f"asset-ref-{_slug(request.name)}-{model.sha256[:8]}",
            "name": request.name,
            "kind": request.kind,
            "visual": gltf_visual(model).model_dump(),
            "nominal_dimensions": nominal,
            "source": {
                "kind": "generated",
                "author": GENERATED_AUTHOR,
                "reference": (
                    f"Appearance from a reference photo of {request.object_name} (sha256 "
                    f"{reference.photo_sha256[:12]}…), {by}; a simplified, provisional shape"
                )[:500],
            },
            "rights": {
                "license": "NOASSERTION",
                "redistribution": "unknown",
                "attribution": None,
                "terms_ref": GENERATED_TERMS,
            },
            "generation": generation.model_dump(),
            "upload": None,
        }
    )
    store_model(model, catalog_dir)  # never replaces an existing file
    return asset


def _revised_length(
    axis: str,
    value: float,
    previous: Length,
    review: RevisedLength,
    request: GeneratedAssetRevisionRequest,
) -> Length:
    changed = abs(value - previous.value_m) > KEPT_TOLERANCE_M
    if review.basis == "kept":
        if changed:
            raise AssistError(
                422,
                f"The {axis} changed from {previous.value_m:g} m to {value:g} m; mark it as "
                "entered or proposed (nothing was saved).",
            )
        # Value and evidence carry over exactly: a change of parts or colours is not a
        # measurement, so an estimate stays an estimate.
        return previous
    before = f"previously {previous.value_m:.3f} m, {previous.origin}"
    origin: Literal["user_supplied", "inferred"]
    if review.basis == "entered":
        origin = "user_supplied"
        ref = f"Entered by the user while improving the model ({before})"
    else:
        if not changed:
            raise AssistError(
                422, f"The {axis} did not change; keep it or enter it (nothing was saved)."
            )
        if not review.confirmed:
            raise AssistError(
                422, f"Confirm the proposed {axis} before applying the change (nothing was saved)."
            )
        lm, instruction = request.language_model, request.instruction
        if lm is None or instruction is None:
            raise AssistError(
                422,
                f"A proposed {axis} must record the instruction and the language model that "
                "proposed it.",
            )
        origin = "inferred"
        ref = (
            f"Proposed by {lm.service} {lm.model} from the instruction “{instruction}”; "
            f"confirmed by the user ({before})"
        )
    return Length.model_validate(
        {
            "value_m": value,
            "origin": origin,
            "source_ref": ref[:500],
            "review_status": "confirmed",
            "uncertainty_m": None,
        }
    )


def create_asset_revision(
    request: GeneratedAssetRevisionRequest, catalog_dir: Path
) -> CatalogAsset:
    """Build, store and describe a revision of a generated asset. Raises AssistError on refusal.

    The revision is a new asset with its own ID and model file; the previous asset and its file
    are left as they are, so every version stays identifiable. Nothing is written on refusal.
    """
    previous = request.previous
    earlier = previous.generation
    if (
        previous.source.kind != "generated"
        or earlier is None
        or not isinstance(previous.visual, GltfVisual)
    ):
        raise AssistError(
            422,
            "Only a generated object can be improved; this asset was not made by the generator.",
        )
    if request.language_model is not None and request.instruction is None:
        raise AssistError(422, "A change proposed by a language model must record the instruction.")
    version = (earlier.revision.version if earlier.revision else 1) + 1
    if version > MAX_REVISION_VERSION:
        raise AssistError(422, f"An object can have at most {MAX_REVISION_VERSION} versions.")
    spec, _scale, _notes = fit_to_envelope(request.spec)
    model = build_model(spec)
    if model.sha256 == previous.visual.sha256:
        raise AssistError(
            422, "The revised model is identical to the current one; nothing to apply."
        )

    envelope = spec.envelope_m
    nominal = previous.nominal_dimensions
    revised = request.dimensions
    dimensions = {
        "width": _revised_length("width", envelope.x, nominal.width, revised.width, request),
        "height": _revised_length("height", envelope.y, nominal.height, revised.height, request),
        "depth": _revised_length("depth", envelope.z, nominal.depth, revised.depth, request),
    }
    generation = AssetGeneration.model_validate(
        {
            # The original description, drafting model and facts stay; the correction is added.
            **earlier.model_dump(),
            "spec": spec.model_dump(),
            "not_modelled": list(dict.fromkeys(earlier.not_modelled)),
            "revision": {
                "revises": previous.id,
                "version": version,
                "instruction": request.instruction,
                "language_model": request.language_model.model_dump()
                if request.language_model
                else None,
                "changes": request.changes,
                "not_represented": request.not_represented,
            },
        }
    )
    base = _VERSION_SUFFIX.sub("", previous.name)
    suffix = f" (v{version})"
    reference = _REVISION_REFERENCE.sub("", previous.source.reference or "")
    note = f"; revision {version} by the user" if reference else f"Revision {version} by the user"
    asset = CatalogAsset.model_validate(
        {
            "id": f"asset-gen-{_slug(base)}-{model.sha256[:8]}",
            "name": base[: NAME_MAX_CHARS - len(suffix)].rstrip() + suffix,
            "kind": previous.kind,
            "visual": gltf_visual(model).model_dump(),
            "nominal_dimensions": {
                axis: length.model_dump() for axis, length in dimensions.items()
            },
            "source": {
                "kind": "generated",
                "author": GENERATED_AUTHOR,
                "reference": reference[: 500 - len(note)] + note,
            },
            "rights": previous.rights.model_dump(),
            "generation": generation.model_dump(),
            "upload": None,
        }
    )
    store_model(model, catalog_dir)  # never replaces an existing file
    return asset


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
            model = build_model(asset.generation.spec, generator=asset.generation.generator)
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
