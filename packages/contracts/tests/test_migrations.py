"""0.1.0 documents are upgraded explicitly and losslessly, never accepted as they are."""

from __future__ import annotations

import copy
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError
from replay_world_contracts import SCHEMA_VERSION, Project
from replay_world_contracts.migrations import MigrationError, upgrade_document

from .conftest import FIXTURES

LEGACY = FIXTURES / "legacy" / "foundation-scene-0.1.0.json"


@pytest.fixture
def legacy() -> dict[str, Any]:
    data: dict[str, Any] = json.loads(LEGACY.read_text())
    return data


def test_current_model_refuses_the_legacy_document(legacy: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        Project.model_validate(legacy)


def test_legacy_document_upgrades_to_a_valid_project(legacy: dict[str, Any]) -> None:
    upgrade = upgrade_document(legacy)
    project = Project.model_validate(upgrade.document)
    assert (upgrade.from_version, project.schema_version) == ("0.1.0", SCHEMA_VERSION)
    assert upgrade.changed
    assert project.catalog == []
    assert any(
        "box origin 'inferred' applied to width, height and depth" in n for n in upgrade.notes
    )


def test_upgrade_preserves_every_value_and_never_strengthens_evidence(
    legacy: dict[str, Any],
) -> None:
    project = Project.model_validate(upgrade_document(legacy).document)
    for old, new in zip(legacy["scene"]["objects"], project.scene.objects, strict=True):
        assert new.id == old["id"] and new.kind == old["kind"]
        assert new.asset_id is None
        assert new.transform.model_dump() == old["transform"]
        assert [p.model_dump() for p in new.parameters] == old["parameters"]
        for axis in ("width", "height", "depth"):
            length = getattr(new.dimensions, axis)
            assert length.value_m == old["dimensions"][f"{axis}_m"]
            assert length.origin == old["dimensions"]["origin"]
            assert length.source_ref == old["dimensions"]["source_ref"]
            assert length.review_status == old["dimensions"]["review_status"]
            assert length.uncertainty_m is None
    assert [s.model_dump() for s in project.sources] == [
        {**source, "image": None, "photo_import": None, "drawing": None}
        for source in legacy["sources"]
    ]


def test_upgrade_does_not_modify_its_input(legacy: dict[str, Any]) -> None:
    before = copy.deepcopy(legacy)
    upgrade_document(legacy)
    assert legacy == before


def as_version(current: dict[str, Any], version: str) -> dict[str, Any]:
    """An older document with the same content: before 0.4.0 there was no edit log, before
    0.5.0 catalog assets had no generation record, before 0.6.0 sources had no image or photo
    import, before 0.7.0 generated assets had no revision and scale references no size basis,
    before 0.8.0 photo observations had no visibility or corrections, and before 0.9.0 sources
    had no drawing reading."""
    unread = [{k: v for k, v in s.items() if k != "drawing"} for s in current["sources"]]
    if version == "0.8.0":
        sources = unread
    elif version == "0.7.0":
        sources = [without_corrections(s) for s in unread]
    elif version == "0.6.0":
        sources = [without_size_basis(without_corrections(s)) for s in unread]
    else:
        photo_keys = ("image", "photo_import")
        sources = [{k: v for k, v in s.items() if k not in photo_keys} for s in unread]
    if version in ("0.7.0", "0.8.0"):
        catalog = current["catalog"]
    elif version in ("0.5.0", "0.6.0"):
        catalog = [without_revision(a) for a in current["catalog"]]
    else:
        catalog = [{k: v for k, v in a.items() if k != "generation"} for a in current["catalog"]]
    scene = current["scene"]
    if version not in ("0.4.0", "0.5.0", "0.6.0", "0.7.0", "0.8.0"):
        scene = {k: v for k, v in scene.items() if k != "edit_log"}
    return {
        **current,
        "schema_version": version,
        "sources": sources,
        "catalog": catalog,
        "scene": scene,
    }


def without_revision(asset: dict[str, Any]) -> dict[str, Any]:
    generation = asset["generation"]
    if generation is None:
        return asset
    return {**asset, "generation": {k: v for k, v in generation.items() if k != "revision"}}


def without_size_basis(source: dict[str, Any]) -> dict[str, Any]:
    if source["photo_import"] is None:
        return source
    old = copy.deepcopy(source)
    del old["photo_import"]["calibration"]["reference"]["size_basis"]
    return old


def without_corrections(source: dict[str, Any]) -> dict[str, Any]:
    if source["photo_import"] is None:
        return source
    old = copy.deepcopy(source)
    added = ("visibility", "derived_from", "replaced_by", "corrections")
    old["photo_import"]["observations"] = [
        {k: v for k, v in o.items() if k not in added} for o in old["photo_import"]["observations"]
    ]
    return old


NOTE_0_3_0: str = (
    "schema_version 0.2.0 -> 0.3.0 (additive: glTF visuals, walkway/keep_clear kinds, "
    "demonstration fixtures; no values changed)"
)
NOTE_0_4_0: str = (
    "schema_version 0.3.0 -> 0.4.0 (adds an empty scene edit log; no values or evidence changed)"
)


def note_0_5_0(assets: int) -> str:
    plural = "" if assets == 1 else "s"
    return (
        f"schema_version 0.4.0 -> 0.5.0 (adds 'generation: null' to {assets} catalog "
        f"asset{plural}; no values or evidence changed)"
    )


def note_0_6_0(sources: int) -> str:
    plural = "" if sources == 1 else "s"
    return (
        f"schema_version 0.5.0 -> 0.6.0 (adds 'image: null' and 'photo_import: null' to "
        f"{sources} source{plural}; no values or evidence changed)"
    )


def note_0_7_0(assets: int, scales: int) -> str:
    return (
        f"schema_version 0.6.0 -> 0.7.0 (adds 'revision: null' to {assets} generated "
        f"asset{'' if assets == 1 else 's'} and 'size_basis: not_stated' to {scales} photo scale "
        f"reference{'' if scales == 1 else 's'}; no values or evidence changed)"
    )


def note_0_8_0(observations: int) -> str:
    return (
        f"schema_version 0.7.0 -> 0.8.0 (adds 'visibility: not_recorded' and empty corrections "
        f"to {observations} photo observation{'' if observations == 1 else 's'}; no values or "
        "evidence changed)"
    )


def note_0_9_0(sources: int) -> str:
    return (
        f"schema_version 0.8.0 -> 0.9.0 (adds 'drawing: null' to {sources} "
        f"source{'' if sources == 1 else 's'}; no values or evidence changed)"
    )


def note_0_10_0(reviews: int = 0, fits: int = 0, weakened: int = 0) -> str:
    return (
        f"schema_version 0.9.0 -> 0.10.0 (adds an unchecked review to {reviews} drawing "
        f"source{'' if reviews == 1 else 's'} and footprint_fit to {fits} drawn "
        f"object{'' if fits == 1 else 's'}; {weakened} drawn footprint "
        f"value{'' if weakened == 1 else 's'} recorded as measured become drawn (a design "
        "drawing, not a site measurement); nothing is strengthened)"
    )


def note_0_11_0(readings: int = 0) -> str:
    return (
        f"schema_version 0.10.0 -> 0.11.0 (adds 'omitted: null' to {readings} drawing "
        f"reading{'' if readings == 1 else 's'}: where their left-out shapes lie was not "
        "recorded, so checks treat them as possibly anywhere)"
    )


def test_0_8_0_documents_gain_a_null_drawing_on_each_source(
    fixture_data: dict[str, Any],
) -> None:
    old = as_version(fixture_data, "0.8.0")
    upgrade = upgrade_document(old)
    assert upgrade.document == fixture_data
    assert [s["drawing"] for s in upgrade.document["sources"]] == [None]
    assert (upgrade.from_version, upgrade.notes) == (
        "0.8.0",
        [note_0_9_0(1), note_0_10_0(), note_0_11_0()],
    )
    assert all("drawing" not in source for source in old["sources"])  # input untouched


def test_a_0_8_0_document_claiming_a_drawing_reading_is_refused(
    fixture_data: dict[str, Any],
) -> None:
    old = as_version(fixture_data, "0.8.0")
    old["sources"][0]["drawing"] = None
    with pytest.raises(MigrationError, match=r"drawing readings only exist from 0\.9\.0"):
        upgrade_document(old)


def test_a_0_8_0_document_with_a_confirmed_default_is_reported_not_changed(
    fixture_data: dict[str, Any],
) -> None:
    old = as_version(fixture_data, "0.8.0")
    height = old["scene"]["objects"][0]["dimensions"]["height"]
    height.update(origin="default", review_status="confirmed")
    upgrade = upgrade_document(old)
    assert upgrade.document["scene"]["objects"][0]["dimensions"]["height"] == height
    with pytest.raises(ValidationError, match="cannot be confirmed"):
        Project.model_validate(upgrade.document)


def test_0_2_0_documents_gain_only_the_version_and_an_empty_edit_log(
    fixture_data: dict[str, Any],
) -> None:
    upgrade = upgrade_document(as_version(fixture_data, "0.2.0"))
    assert upgrade.document == fixture_data
    assert upgrade.from_version == "0.2.0"
    assert upgrade.notes == [
        NOTE_0_3_0,
        NOTE_0_4_0,
        note_0_5_0(3),
        note_0_6_0(1),
        note_0_7_0(0, 0),
        note_0_8_0(0),
        note_0_9_0(1),
        note_0_10_0(),
        note_0_11_0(),
    ]


def test_0_3_0_documents_gain_an_empty_edit_log(fixture_data: dict[str, Any]) -> None:
    old = as_version(fixture_data, "0.3.0")
    upgrade = upgrade_document(old)
    assert upgrade.document == fixture_data
    assert upgrade.document["scene"]["edit_log"] == []
    assert (upgrade.from_version, upgrade.notes) == (
        "0.3.0",
        [
            NOTE_0_4_0,
            note_0_5_0(3),
            note_0_6_0(1),
            note_0_7_0(0, 0),
            note_0_8_0(0),
            note_0_9_0(1),
            note_0_10_0(),
            note_0_11_0(),
        ],
    )
    assert "edit_log" not in old["scene"]  # input untouched


def test_0_4_0_documents_gain_a_null_generation_on_each_asset(
    fixture_data: dict[str, Any],
) -> None:
    old = as_version(fixture_data, "0.4.0")
    upgrade = upgrade_document(old)
    assert upgrade.document == fixture_data
    assert all(asset["generation"] is None for asset in upgrade.document["catalog"])
    assert (upgrade.from_version, upgrade.notes) == (
        "0.4.0",
        [
            note_0_5_0(3),
            note_0_6_0(1),
            note_0_7_0(0, 0),
            note_0_8_0(0),
            note_0_9_0(1),
            note_0_10_0(),
            note_0_11_0(),
        ],
    )
    assert all("generation" not in asset for asset in old["catalog"])  # input untouched


def test_0_5_0_documents_gain_a_null_image_and_photo_import_on_each_source(
    fixture_data: dict[str, Any],
) -> None:
    old = as_version(fixture_data, "0.5.0")
    upgrade = upgrade_document(old)
    assert upgrade.document == fixture_data
    assert [(s["image"], s["photo_import"]) for s in upgrade.document["sources"]] == [(None, None)]
    assert (upgrade.from_version, upgrade.notes) == (
        "0.5.0",
        [
            note_0_6_0(1),
            note_0_7_0(0, 0),
            note_0_8_0(0),
            note_0_9_0(1),
            note_0_10_0(),
            note_0_11_0(),
        ],
    )
    assert all("image" not in source for source in old["sources"])  # input untouched


@pytest.mark.parametrize("key", ["image", "photo_import"])
def test_a_0_5_0_document_claiming_a_photo_source_is_refused(
    fixture_data: dict[str, Any], key: str
) -> None:
    old = as_version(fixture_data, "0.5.0")
    old["sources"][0][key] = None
    with pytest.raises(MigrationError, match=r"photo sources only exist from 0\.6\.0"):
        upgrade_document(old)


def test_a_0_4_0_document_claiming_a_generation_record_is_refused(
    fixture_data: dict[str, Any],
) -> None:
    with pytest.raises(MigrationError, match=r"generation records only exist from 0\.5\.0"):
        upgrade_document({**fixture_data, "schema_version": "0.4.0"})


def test_a_0_3_0_document_claiming_an_edit_log_is_refused(fixture_data: dict[str, Any]) -> None:
    with pytest.raises(MigrationError, match=r"edit_log only exists from 0\.4\.0"):
        upgrade_document({**fixture_data, "schema_version": "0.3.0"})


def test_legacy_upgrade_runs_every_step_in_order(legacy: dict[str, Any]) -> None:
    notes = upgrade_document(legacy).notes
    assert notes[0] == "schema_version 0.1.0 -> 0.2.0"
    assert notes[-9:] == [
        NOTE_0_3_0,
        NOTE_0_4_0,
        note_0_5_0(0),
        note_0_6_0(1),
        note_0_7_0(0, 0),
        note_0_8_0(0),
        note_0_9_0(1),
        note_0_10_0(),
        note_0_11_0(),
    ]
    upgraded = Project.model_validate(upgrade_document(legacy).document)
    assert upgraded.scene.edit_log == []


def test_current_documents_pass_through_unchanged(fixture_data: dict[str, Any]) -> None:
    upgrade = upgrade_document(fixture_data)
    assert (upgrade.document, upgrade.changed, upgrade.notes) == (fixture_data, False, [])


@pytest.mark.parametrize("version", ["0.0.1", "0.12.0", "1.0.0", None])
def test_unknown_versions_are_refused(legacy: dict[str, Any], version: str | None) -> None:
    legacy["schema_version"] = version
    with pytest.raises(MigrationError, match="unsupported schema_version"):
        upgrade_document(legacy)


def test_malformed_legacy_documents_are_refused(legacy: dict[str, Any]) -> None:
    del legacy["scene"]["objects"][0]["dimensions"]["width_m"]
    with pytest.raises(MigrationError, match=r"malformed 0\.1\.0 document"):
        upgrade_document(legacy)


def _migrate(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "replay_world_contracts.migrate", *args],
        capture_output=True,
        text=True,
        check=False,
    )


def test_migrate_command_writes_a_validated_upgrade(tmp_path: Path) -> None:
    out = tmp_path / "upgraded.json"
    result = _migrate(str(LEGACY), "-o", str(out))
    assert result.returncode == 0, result.stderr
    assert "note: schema_version 0.1.0 -> 0.2.0" in result.stderr
    project = Project.model_validate_json(out.read_text())
    assert project.schema_version == "0.11.0"
    assert "note: schema_version 0.2.0 -> 0.3.0" in result.stderr
    assert "note: schema_version 0.3.0 -> 0.4.0" in result.stderr
    assert "note: schema_version 0.4.0 -> 0.5.0" in result.stderr
    assert "note: schema_version 0.5.0 -> 0.6.0" in result.stderr
    assert "note: schema_version 0.6.0 -> 0.7.0" in result.stderr
    assert "note: schema_version 0.7.0 -> 0.8.0" in result.stderr
    assert "note: schema_version 0.8.0 -> 0.9.0" in result.stderr
    assert "note: schema_version 0.9.0 -> 0.10.0" in result.stderr
    assert "note: schema_version 0.10.0 -> 0.11.0" in result.stderr
    assert LEGACY.read_text().startswith('{\n  "schema_version": "0.1.0"')  # input untouched


def test_migrate_command_refuses_invalid_input(tmp_path: Path) -> None:
    bad = tmp_path / "bad.json"
    bad.write_text(LEGACY.read_text().replace('"width_m": 20.0', '"width_m": -20.0'))
    result = _migrate(str(bad))
    assert result.returncode == 1
    assert "greater than 0" in result.stderr
    assert result.stdout == ""


def photo_source(observations: list[dict[str, Any]]) -> dict[str, Any]:
    """A photo source with a calibrated floor rectangle and the given observations."""
    side = {"origin": "user_supplied", "source_ref": "rug", "review_status": "unreviewed"}
    corners = [{"u": u, "v": v} for u, v in ((0.3, 0.8), (0.7, 0.8), (0.65, 0.6), (0.35, 0.6))]
    return {
        "id": "src-photo-room",
        "kind": "photo",
        "filename": "room.jpg",
        "sha256": "a" * 64,
        "source_to_world": None,
        "import_warnings": [],
        "image": {
            "uri": f"photos/{'a' * 64}.jpg",
            "media_type": "image/jpeg",
            "width_px": 1024,
            "height_px": 768,
            "bytes": 1000,
        },
        "photo_import": {
            "vision_model": None,
            "calibration": {
                "reference": {
                    "feature": "rug",
                    "corners": corners,
                    "width": {"value_m": 2.0, **side, "uncertainty_m": None},
                    "depth": {"value_m": 1.4, **side, "uncertainty_m": None},
                    "size_basis": "measured",
                },
                "image_to_floor": [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0],
                "camera": {
                    "vertical_fov_deg": 55.0,
                    "fov_basis": "assumed",
                    "position_m": {"x": 0.0, "y": 1.6, "z": 4.0},
                },
                "notes": [],
            },
            "observations": observations,
            "visible_text": [],
        },
        "drawing": None,
    }


def observation(oid: str, **fields: Any) -> dict[str, Any]:
    return {
        "id": oid,
        "label": "chair",
        "box": {"left": 0.1, "top": 0.2, "right": 0.3, "bottom": 0.5},
        "floor_contact": None,
        "contact_basis": None,
        "found_by": "model",
        "decision": "rejected",
        "object_id": None,
        "visibility": "visible",
        "derived_from": None,
        "replaced_by": None,
        "corrections": [],
        "notes": [],
    } | fields


def test_0_7_0_photo_observations_gain_not_recorded_visibility_and_no_corrections(
    fixture_data: dict[str, Any],
) -> None:
    current = {
        **fixture_data,
        "sources": [*fixture_data["sources"], photo_source([observation("obs-1")])],
    }
    old = as_version(current, "0.7.0")
    assert "visibility" not in old["sources"][-1]["photo_import"]["observations"][0]
    upgrade = upgrade_document(old)
    [upgraded] = upgrade.document["sources"][-1]["photo_import"]["observations"]
    assert (upgraded["visibility"], upgraded["derived_from"], upgraded["replaced_by"]) == (
        "not_recorded",
        None,
        None,
    )
    assert upgraded["corrections"] == [] and upgrade.notes == [
        note_0_8_0(1),
        note_0_9_0(2),
        note_0_10_0(),
        note_0_11_0(),
    ]
    Project.model_validate(upgrade.document)
    claimed = copy.deepcopy(old)
    claimed["sources"][-1]["photo_import"]["observations"][0]["visibility"] = "visible"
    with pytest.raises(MigrationError, match=r"only exist from 0\.8\.0"):
        upgrade_document(claimed)


SPLIT = [
    observation(
        "obs-1",
        label="table with chairs",
        decision="split",
        corrections=["Split by you into “table” (obs-1-a), “chair” (obs-1-b)."],
    ),
    observation("obs-1-a", label="table", derived_from="obs-1", corrections=["Split by you."]),
    observation("obs-1-b", derived_from="obs-1", corrections=["Split by you."]),
    observation("obs-2", decision="merged", replaced_by="obs-1-b", corrections=["Merged by you."]),
    observation("obs-3", found_by="user", visibility="added"),
]


def test_split_merged_and_added_observations_are_kept_and_linked(
    fixture_data: dict[str, Any],
) -> None:
    project = {**fixture_data, "sources": [*fixture_data["sources"], photo_source(SPLIT)]}
    Project.model_validate(project)


@pytest.mark.parametrize(
    ("index", "change", "message"),
    [
        (1, {"derived_from": "obs-9"}, "no split observation has that id"),
        (3, {"replaced_by": "obs-1"}, "not an observation still in use"),
        (3, {"replaced_by": None}, "names the observation it was merged into"),
        (0, {"corrections": []}, "a split observation says why"),
        (4, {"found_by": "model"}, "only the user can add an object that is not seen"),
        (0, {"object_id": "obj-1"}, "any other names none"),
    ],
)
def test_broken_corrections_are_refused(
    fixture_data: dict[str, Any], index: int, change: dict[str, Any], message: str
) -> None:
    observations = copy.deepcopy(SPLIT)
    observations[index] |= change
    project = {**fixture_data, "sources": [*fixture_data["sources"], photo_source(observations)]}
    with pytest.raises(ValidationError, match=message):
        Project.model_validate(project)


def test_a_split_observation_needs_its_pieces(fixture_data: dict[str, Any]) -> None:
    lonely = [SPLIT[0], observation("obs-2")]
    project = {**fixture_data, "sources": [*fixture_data["sources"], photo_source(lonely)]}
    with pytest.raises(ValidationError, match="split observation 'obs-1' has no pieces"):
        Project.model_validate(project)
