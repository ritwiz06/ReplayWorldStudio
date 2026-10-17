"""Asset revisions (0.7.0): a revised generated asset is a new asset, recorded as one log step.

The scene's edit log follows each object's asset through every revision; the 0.6.0 -> 0.7.0
upgrade adds only the new nullable fields; an assumed scale size is never "confirmed".
"""

from __future__ import annotations

import copy
import json
from typing import Any

import pytest
from pydantic import ValidationError
from replay_world_contracts import FloorRectangle, Project, Scene
from replay_world_contracts.migrations import MigrationError, upgrade_document

from .conftest import FIXTURES

SAMPLE = FIXTURES / "edited" / "foundation-edited.json"
ADDED = "obj-generic-processing-station"  # added at revision 4 from the asset below
ASSET = "asset-generic-processing-station"
SHA = "ab" * 32


@pytest.fixture
def sample() -> dict[str, Any]:
    data: dict[str, Any] = json.loads(SAMPLE.read_text())
    return data


def _object(data: dict[str, Any], object_id: str) -> dict[str, Any]:
    obj: dict[str, Any] = next(o for o in data["scene"]["objects"] if o["id"] == object_id)
    return obj


def revise(data: dict[str, Any], after: str = "asset-revised-v2", **record: Any) -> dict[str, Any]:
    """Append an asset_revised record switching the added object to ``after``."""
    scene = data["scene"]
    scene["revision"] += 1
    scene["edit_log"].append(
        {
            "type": "asset_revised",
            "revision": scene["revision"],
            "asset_before": ASSET,
            "asset_after": after,
            "objects": [{"object_id": ADDED, "dimensions": []}],
        }
        | record
    )
    _object(data, ADDED)["asset_id"] = after
    return data


def test_a_revision_switching_an_object_describes_the_scene(sample: dict[str, Any]) -> None:
    scene = Scene.model_validate(revise(sample)["scene"])
    assert scene.edit_log[-1].type == "asset_revised"
    # Revised again: the log follows the asset through both revisions.
    twice = revise(sample, after="asset-revised-v3", asset_before="asset-revised-v2")
    assert Scene.model_validate(twice["scene"]).edit_log[-1].type == "asset_revised"


def test_an_object_still_referencing_the_earlier_asset_is_refused(sample: dict[str, Any]) -> None:
    data = revise(sample)
    _object(data, ADDED)["asset_id"] = ASSET
    with pytest.raises(ValidationError, match=f"leaves object '{ADDED}' referencing asset"):
        Scene.model_validate(data["scene"])


def test_revising_an_asset_the_object_did_not_reference_is_refused(
    sample: dict[str, Any],
) -> None:
    data = revise(sample, asset_before="asset-something-else")
    with pytest.raises(ValidationError, match="which then referenced 'asset-generic-processing"):
        Scene.model_validate(data["scene"])


def test_an_asset_revised_into_itself_is_refused(sample: dict[str, Any]) -> None:
    data = revise(sample, after=ASSET)
    with pytest.raises(ValidationError, match="revises an asset into itself"):
        Scene.model_validate(data["scene"])


def test_an_unchanged_axis_is_not_recorded(sample: dict[str, Any]) -> None:
    width = _object(sample, ADDED)["dimensions"]["width"]
    change = {"axis": "width", "before": width, "after": copy.deepcopy(width)}
    data = revise(sample, objects=[{"object_id": ADDED, "dimensions": [change]}])
    with pytest.raises(ValidationError, match=f"records an unchanged width for '{ADDED}'"):
        Scene.model_validate(data["scene"])


def test_a_changed_axis_must_match_the_scene(sample: dict[str, Any]) -> None:
    width = _object(sample, ADDED)["dimensions"]["width"]
    after = {**width, "value_m": width["value_m"] + 0.2, "origin": "inferred"}
    data = revise(sample, objects=[{"object_id": ADDED, "dimensions": [change(width, after)]}])
    with pytest.raises(ValidationError, match="the log no longer describes the scene"):
        Scene.model_validate(data["scene"])
    _object(data, ADDED)["dimensions"]["width"] = after
    Scene.model_validate(data["scene"])  # an inferred size stays inferred after a revision


def change(before: dict[str, Any], after: dict[str, Any]) -> dict[str, Any]:
    return {"axis": "width", "before": before, "after": after}


def test_both_assets_of_a_revision_must_be_in_the_catalog(sample: dict[str, Any]) -> None:
    # The conveyor was in the scene before the log began, so only the catalog can be checked.
    scene = sample["scene"]
    scene["revision"] += 1
    scene["edit_log"].append(
        {
            "type": "asset_revised",
            "revision": scene["revision"],
            "asset_before": "asset-gone",
            "asset_after": "asset-generic-belt-conveyor",
            "objects": [{"object_id": "obj-infeed-conveyor", "dimensions": []}],
        }
    )
    Scene.model_validate(scene)
    with pytest.raises(ValidationError, match="names asset 'asset-gone', which is not in"):
        Project.model_validate(sample)


# --- Upgrading 0.6.0 documents -----------------------------------------------------------------


def generated_asset() -> dict[str, Any]:
    """A minimal valid generated asset: one box filling a 1 x 2 x 0.5 m envelope."""

    def length(value: float) -> dict[str, Any]:
        return {
            "value_m": value,
            "origin": "inferred",
            "source_ref": "Estimated; confirmed by the user before placement",
            "review_status": "confirmed",
            "uncertainty_m": None,
        }

    return {
        "id": "asset-gen-box-abababab",
        "name": "Box",
        "kind": "equipment",
        "visual": {
            "type": "gltf",
            "uri": f"generated/{SHA}.glb",
            "sha256": SHA,
            "metres_per_model_unit": 1.0,
            "up_axis": "+Y",
            "front_axis": "+Z",
            "origin": "bottom_centre",
            "model_bounds_m": {
                "min": {"x": -0.5, "y": 0.0, "z": -0.25},
                "max": {"x": 0.5, "y": 2.0, "z": 0.25},
            },
            "fit": "scale_to_dimensions",
            "max_fit_distortion": 0.05,
        },
        "nominal_dimensions": {"width": length(1.0), "height": length(2.0), "depth": length(0.5)},
        "source": {"kind": "generated", "author": "Test generator", "reference": None},
        "rights": {
            "license": "NOASSERTION",
            "redistribution": "unknown",
            "attribution": None,
            "terms_ref": None,
        },
        "generation": {
            "method": "builder",
            "description": None,
            "language_model": None,
            "generator": "rws-object-generator/1",
            "spec": {
                "format": "rws-geometry/1",
                "envelope_m": {"x": 1.0, "y": 2.0, "z": 0.5},
                "parts": [
                    {
                        "id": "body",
                        "label": "body",
                        "shape": "box",
                        "material": "wood",
                        "center_m": {"x": 0.0, "y": 1.0, "z": 0.0},
                        "size_m": {"x": 1.0, "y": 2.0, "z": 0.5},
                        "axis": None,
                        "taper": None,
                        "narrow_end": None,
                        "basis": "entered",
                    }
                ],
            },
            "stated_facts": [],
            "inferred_facts": [],
            "not_modelled": [],
            "unknown_properties": [
                {"property": p, "reason": "Not established."}
                for p in ("mass", "strength", "chemical_composition", "operating_behaviour")
            ],
            "revision": None,
        },
    }


def scale_reference(size_basis: str, review_status: str = "unreviewed") -> dict[str, Any]:
    side = {
        "origin": "user_supplied",
        "source_ref": "rug size",
        "review_status": review_status,
        "uncertainty_m": None,
    }
    return {
        "feature": "rug",
        "corners": [
            {"u": u, "v": v} for u, v in ((0.3, 0.8), (0.7, 0.8), (0.65, 0.6), (0.35, 0.6))
        ],
        "width": {"value_m": 2.0, **side},
        "depth": {"value_m": 1.4, **side},
        "size_basis": size_basis,
    }


def photo_source() -> dict[str, Any]:
    return {
        "id": "src-photo",
        "kind": "photo",
        "filename": "room.jpg",
        "sha256": SHA,
        "source_to_world": None,
        "import_warnings": [],
        "image": {
            "uri": f"photos/{SHA}.jpg",
            "media_type": "image/jpeg",
            "width_px": 800,
            "height_px": 600,
            "bytes": 1000,
        },
        "photo_import": {
            "vision_model": None,
            "calibration": {
                "reference": scale_reference("not_stated"),
                "image_to_floor": [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0],
                "camera": {
                    "vertical_fov_deg": 55.0,
                    "fov_basis": "assumed",
                    "position_m": {"x": 0.0, "y": 1.6, "z": 4.0},
                },
                "notes": [],
            },
            "observations": [],
            "visible_text": [],
        },
    }


@pytest.fixture
def current(fixture_data: dict[str, Any]) -> dict[str, Any]:
    """The foundation fixture with a generated asset and a photo source, as 0.7.0 writes it."""
    fixture_data["catalog"].append(generated_asset())
    fixture_data["sources"].append({**photo_source(), "drawing": None})
    Project.model_validate(fixture_data)
    return fixture_data


def as_0_6_0(current: dict[str, Any]) -> dict[str, Any]:
    old = copy.deepcopy(current)
    old["schema_version"] = "0.6.0"
    for source in old["sources"]:
        del source["drawing"]
    for asset in old["catalog"]:
        if asset["generation"] is not None:
            del asset["generation"]["revision"]
    for source in old["sources"]:
        if source["photo_import"] is not None:
            del source["photo_import"]["calibration"]["reference"]["size_basis"]
    return old


def test_0_6_0_documents_gain_a_null_revision_and_an_unstated_size_basis(
    current: dict[str, Any],
) -> None:
    old = as_0_6_0(current)
    upgrade = upgrade_document(old)
    assert upgrade.document == current
    assert upgrade.notes == [
        "schema_version 0.6.0 -> 0.7.0 (adds 'revision: null' to 1 generated asset and "
        "'size_basis: not_stated' to 1 photo scale reference; no values or evidence changed)",
        "schema_version 0.7.0 -> 0.8.0 (adds 'visibility: not_recorded' and empty corrections to "
        "0 photo observations; no values or evidence changed)",
        "schema_version 0.8.0 -> 0.9.0 (adds 'drawing: null' to 2 sources; no values or evidence "
        "changed)",
        "schema_version 0.9.0 -> 0.10.0 (adds an unchecked review to 0 drawing sources and "
        "footprint_fit to 0 drawn objects; 0 drawn footprint values recorded as measured become "
        "drawn (a design drawing, not a site measurement); nothing is strengthened)",
    ]
    assert "revision" not in old["catalog"][-1]["generation"]  # input untouched
    Project.model_validate(upgrade.document)


def test_a_0_6_0_document_claiming_a_revision_is_refused(current: dict[str, Any]) -> None:
    old = as_0_6_0(current)
    old["catalog"][-1]["generation"]["revision"] = None
    with pytest.raises(MigrationError, match=r"asset revision records only exist from 0\.7\.0"):
        upgrade_document(old)


def test_a_0_6_0_document_claiming_a_size_basis_is_refused(current: dict[str, Any]) -> None:
    old = as_0_6_0(current)
    old["sources"][-1]["photo_import"]["calibration"]["reference"]["size_basis"] = "measured"
    with pytest.raises(MigrationError, match=r"scale size bases only exist from 0\.7\.0"):
        upgrade_document(old)


# --- Scale size basis ----------------------------------------------------------------------------


def test_an_assumed_scale_size_cannot_be_confirmed() -> None:
    with pytest.raises(ValidationError, match="an assumed scale size cannot be marked confirmed"):
        FloorRectangle.model_validate(scale_reference("assumed", "confirmed"))
    FloorRectangle.model_validate(scale_reference("assumed"))
    FloorRectangle.model_validate(scale_reference("measured", "confirmed"))
