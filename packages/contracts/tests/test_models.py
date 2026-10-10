"""Contract invariants: units, finiteness, provenance, identity and references are enforced."""

from __future__ import annotations

import copy
import json
import math
from typing import Any

import pytest
from pydantic import ValidationError
from replay_world_contracts import (
    SCHEMA_VERSION,
    KnownParameter,
    Project,
    UnknownParameter,
)

from .conftest import FIXTURES

AXES = ("width", "height", "depth")


def _errors(data: dict[str, Any]) -> list[tuple[tuple[str | int, ...], str]]:
    with pytest.raises(ValidationError) as info:
        Project.model_validate(data)
    return [(tuple(e["loc"]), e["msg"]) for e in info.value.errors()]


def _only_error(data: dict[str, Any]) -> tuple[tuple[str | int, ...], str]:
    errors = _errors(data)
    assert len(errors) == 1, errors
    return errors[0]


def _object(data: dict[str, Any], object_id: str) -> dict[str, Any]:
    obj: dict[str, Any] = next(o for o in data["scene"]["objects"] if o["id"] == object_id)
    return obj


def _asset(data: dict[str, Any], asset_id: str) -> dict[str, Any]:
    asset: dict[str, Any] = next(a for a in data["catalog"] if a["id"] == asset_id)
    return asset


# --- round trips ---------------------------------------------------------------------------


def test_fixture_round_trips_exactly(fixture_text: str) -> None:
    project = Project.model_validate_json(fixture_text)
    assert json.loads(project.model_dump_json()) == json.loads(fixture_text)
    assert Project.model_validate_json(project.model_dump_json()) == project


def test_awkward_floats_and_ids_survive_a_round_trip(fixture_data: dict[str, Any]) -> None:
    # Values that are not exactly representable, tiny and large magnitudes, and an
    # irrational angle must come back bit-for-bit (shortest round-trip float repr).
    awkward = [0.1 + 0.2, 1e-9, 123456.789012345, -0.0, math.pi / 7]
    floor = _object(fixture_data, "obj-floor")
    pos = floor["transform"]["position_m"]
    pos["x"], pos["y"], pos["z"] = awkward[0], awkward[3], awkward[2]
    floor["transform"]["rotation_rad"]["y"] = awkward[4]
    floor["dimensions"]["height"]["value_m"] = awkward[1]
    floor["id"] = "obj-floor.v2:a_b-c"
    again = json.loads(Project.model_validate(fixture_data).model_dump_json())
    pos_again = again["scene"]["objects"][0]["transform"]["position_m"]
    assert [pos_again["x"], pos_again["y"], pos_again["z"]] == [awkward[0], 0.0, awkward[2]]
    assert math.copysign(1.0, pos_again["y"]) == -1.0, "the sign of -0.0 is preserved"
    assert again["scene"]["objects"][0]["transform"]["rotation_rad"]["y"] == awkward[4]
    assert again["scene"]["objects"][0]["dimensions"]["height"]["value_m"] == awkward[1]
    assert again["scene"]["objects"][0]["id"] == "obj-floor.v2:a_b-c"


def test_fixture_declares_si_units_frame_and_label(fixture_text: str) -> None:
    project = Project.model_validate_json(fixture_text)
    assert project.schema_version == SCHEMA_VERSION == "0.5.0"
    assert project.units.model_dump() == {"length": "m", "time": "s", "mass": "kg", "angle": "rad"}
    assert project.world_frame.up_axis == "+Y"
    assert project.fixture is not None and project.fixture.kind == "foundation"
    assert "synthetic" in project.fixture.note.lower()


# --- per-axis dimension evidence -----------------------------------------------------------


def test_measured_footprint_and_inferred_height_stay_distinct(fixture_text: str) -> None:
    project = Project.model_validate_json(fixture_text)
    packing = next(o for o in project.scene.objects if o.id == "obj-packing-station")
    d = packing.dimensions
    assert (d.width.origin, d.height.origin, d.depth.origin) == ("measured", "inferred", "measured")
    assert d.width.uncertainty_m is not None
    assert (d.width.uncertainty_m.lower, d.width.uncertainty_m.upper) == (1.19, 1.21)
    assert d.height.uncertainty_m is None


@pytest.mark.parametrize("axis", AXES)
@pytest.mark.parametrize("value", [0.0, -0.001])
def test_rejects_non_positive_lengths(
    fixture_data: dict[str, Any], axis: str, value: float
) -> None:
    _object(fixture_data, "obj-column-c1")["dimensions"][axis]["value_m"] = value
    loc, msg = _only_error(fixture_data)
    assert loc == ("scene", "objects", 1, "dimensions", axis, "value_m")
    assert msg == "Input should be greater than 0"


def test_each_axis_requires_its_own_evidence(fixture_data: dict[str, Any]) -> None:
    del _object(fixture_data, "obj-floor")["dimensions"]["height"]["origin"]
    assert _only_error(fixture_data) == (
        ("scene", "objects", 0, "dimensions", "height", "origin"),
        "Field required",
    )


def test_rejects_the_flat_0_1_0_dimension_shape(fixture_data: dict[str, Any]) -> None:
    obj = _object(fixture_data, "obj-floor")
    obj["dimensions"] = {
        "width_m": 20.0,
        "height_m": 0.2,
        "depth_m": 12.0,
        "origin": "measured",
        "source_ref": None,
        "review_status": "unreviewed",
    }
    messages = {loc[-1]: msg for loc, msg in _errors(fixture_data)}
    assert messages["width"] == "Field required"
    assert messages["width_m"] == "Extra inputs are not permitted"


def test_length_must_lie_within_its_uncertainty(fixture_data: dict[str, Any]) -> None:
    _object(fixture_data, "obj-packing-station")["dimensions"]["width"]["value_m"] = 1.25
    loc, msg = _only_error(fixture_data)
    assert loc == ("scene", "objects", 4, "dimensions", "width")
    assert "1.25 m lies outside its uncertainty bounds [1.19, 1.21] m" in msg


def test_length_uncertainty_cannot_reach_zero(fixture_data: dict[str, Any]) -> None:
    width = _object(fixture_data, "obj-packing-station")["dimensions"]["width"]
    width["uncertainty_m"] = {"lower": 0.0, "upper": 1.3}
    assert "lower bound must be greater than 0 m" in _only_error(fixture_data)[1]


# --- units, finiteness and strictness -------------------------------------------------------


def test_rejects_non_si_unit_system(fixture_data: dict[str, Any]) -> None:
    fixture_data["units"]["length"] = "mm"
    assert _only_error(fixture_data) == (("units", "length"), "Input should be 'm'")


@pytest.mark.parametrize("value", [float("inf"), float("-inf"), float("nan")])
def test_rejects_non_finite_values(fixture_data: dict[str, Any], value: float) -> None:
    _object(fixture_data, "obj-packing-station")["transform"]["rotation_rad"]["y"] = value
    assert _only_error(fixture_data) == (
        ("scene", "objects", 4, "transform", "rotation_rad", "y"),
        "Input should be a finite number",
    )


def test_rejects_numbers_sent_as_strings(fixture_data: dict[str, Any]) -> None:
    _object(fixture_data, "obj-floor")["dimensions"]["width"]["value_m"] = "20"
    assert _only_error(fixture_data)[1] == "Input should be a valid number"


def test_rejects_unexpected_fields_and_versions(fixture_data: dict[str, Any]) -> None:
    fixture_data["scale"] = 1.0
    fixture_data["schema_version"] = "0.1.0"
    messages = {loc: msg for loc, msg in _errors(fixture_data)}
    assert "Extra inputs are not permitted" in messages[("scale",)]
    assert "Input should be '0.5.0'" in messages[("schema_version",)]


# --- parameters (unchanged rules) -----------------------------------------------------------


def test_unknown_parameters_stay_unknown(fixture_text: str) -> None:
    project = Project.model_validate_json(fixture_text)
    params = [p for o in project.scene.objects for p in o.parameters]
    assert any(isinstance(p, UnknownParameter) for p in params)
    assert all(not hasattr(p, "value") for p in params if isinstance(p, UnknownParameter))
    assert all(p.origin for p in params if isinstance(p, KnownParameter))


def test_unknown_parameter_cannot_carry_a_value(fixture_data: dict[str, Any]) -> None:
    param = _object(fixture_data, "obj-packing-station")["parameters"][0]
    assert param["state"] == "unknown"
    param["value"] = 30.0
    loc, msg = _only_error(fixture_data)
    assert loc[-1] == "value" and "Extra inputs are not permitted" in msg


def test_known_value_must_lie_within_uncertainty(fixture_data: dict[str, Any]) -> None:
    _object(fixture_data, "obj-process-station")["parameters"][0]["value"] = 55.0
    assert "outside its uncertainty bounds [40.0, 50.0]" in _only_error(fixture_data)[1]


def test_rejects_duplicate_parameter_ids(fixture_data: dict[str, Any]) -> None:
    params = _object(fixture_data, "obj-infeed-conveyor")["parameters"]
    params.append(copy.deepcopy(params[0]))
    assert "duplicate parameter id in object 'obj-infeed-conveyor'" in _only_error(fixture_data)[1]


# --- stable IDs and references -------------------------------------------------------------


@pytest.mark.parametrize("bad_id", ["", "Obj-Upper", "has space", "-leading-dash", "x" * 129])
def test_rejects_unstable_object_ids(fixture_data: dict[str, Any], bad_id: str) -> None:
    _object(fixture_data, "obj-floor")["id"] = bad_id
    assert "should match pattern" in _only_error(fixture_data)[1]


@pytest.mark.parametrize("bad_id", ["Asset-Packing", "asset packing"])
def test_rejects_unstable_asset_ids_and_references(
    fixture_data: dict[str, Any], bad_id: str
) -> None:
    _asset(fixture_data, "asset-generic-packing-station")["id"] = bad_id
    _object(fixture_data, "obj-packing-station")["asset_id"] = bad_id
    locs = {loc for loc, _ in _errors(fixture_data)}
    assert locs == {("catalog", 2, "id"), ("scene", "objects", 4, "asset_id")}


def test_every_asset_reference_resolves(fixture_text: str) -> None:
    project = Project.model_validate_json(fixture_text)
    catalog = {a.id for a in project.catalog}
    refs = [o.asset_id for o in project.scene.objects if o.asset_id is not None]
    assert refs and set(refs) <= catalog


def test_rejects_a_dangling_asset_reference(fixture_data: dict[str, Any]) -> None:
    _object(fixture_data, "obj-process-station")["asset_id"] = "asset-not-in-catalog"
    loc, msg = _only_error(fixture_data)
    assert loc == ()
    assert "object 'obj-process-station' references asset 'asset-not-in-catalog'" in msg


def test_rejects_an_asset_of_a_different_kind(fixture_data: dict[str, Any]) -> None:
    _object(fixture_data, "obj-column-c1")["asset_id"] = "asset-generic-packing-station"
    assert (
        "(kind 'structure') references asset 'asset-generic-packing-station' of kind "
        in (_only_error(fixture_data)[1])
    )


def test_rejects_duplicate_asset_ids(fixture_data: dict[str, Any]) -> None:
    fixture_data["catalog"].append(copy.deepcopy(fixture_data["catalog"][0]))
    assert (
        "duplicate catalog asset id: 'asset-generic-belt-conveyor'"
        in (_only_error(fixture_data)[1])
    )


def test_unused_assets_and_assetless_geometry_are_allowed(fixture_data: dict[str, Any]) -> None:
    unused = copy.deepcopy(fixture_data["catalog"][0])
    unused["id"] = "asset-spare-conveyor"
    fixture_data["catalog"].append(unused)
    _object(fixture_data, "obj-infeed-conveyor")["asset_id"] = None
    Project.model_validate(fixture_data)


# --- asset source and rights ---------------------------------------------------------------


def test_fixture_assets_are_synthetic_with_no_asserted_license(fixture_text: str) -> None:
    for asset in Project.model_validate_json(fixture_text).catalog:
        assert asset.source.kind == "synthetic"
        assert (asset.rights.license, asset.rights.redistribution) == ("NOASSERTION", "unknown")
        assert asset.visual.type == "placeholder_box"


def test_unknown_license_cannot_allow_redistribution(fixture_data: dict[str, Any]) -> None:
    _asset(fixture_data, "asset-generic-belt-conveyor")["rights"]["redistribution"] = "allowed"
    loc, msg = _only_error(fixture_data)
    assert loc == ("catalog", 0, "rights")
    assert "redistribution must be 'unknown' while the license is NOASSERTION" in msg


@pytest.mark.parametrize("license_id", ["CC0-1.0", "MIT", "LicenseRef-Acme-EULA-2026"])
def test_accepts_spdx_and_licenseref_identifiers(
    fixture_data: dict[str, Any], license_id: str
) -> None:
    rights = _asset(fixture_data, "asset-generic-belt-conveyor")["rights"]
    rights.update(license=license_id, redistribution="restricted", terms_ref="vendor EULA §4")
    asset = Project.model_validate(fixture_data).catalog[0]
    assert asset.rights.license == license_id


@pytest.mark.parametrize("license_id", ["", "MIT License", "MIT OR Apache-2.0", "(MIT)", "-MIT"])
def test_rejects_free_text_licenses(fixture_data: dict[str, Any], license_id: str) -> None:
    _asset(fixture_data, "asset-generic-belt-conveyor")["rights"]["license"] = license_id
    loc, msg = _only_error(fixture_data)
    assert loc == ("catalog", 0, "rights", "license") and "should match pattern" in msg


@pytest.mark.parametrize("kind", ["vendor", "third_party"])
def test_external_asset_sources_must_cite_a_reference(
    fixture_data: dict[str, Any], kind: str
) -> None:
    _asset(fixture_data, "asset-generic-belt-conveyor")["source"]["kind"] = kind
    loc, msg = _only_error(fixture_data)
    assert loc == ("catalog", 0, "source")
    assert f"a {kind} asset source must give a reference" in msg


def test_asset_requires_rights_and_source(fixture_data: dict[str, Any]) -> None:
    asset = _asset(fixture_data, "asset-generic-belt-conveyor")
    del asset["rights"], asset["source"]
    assert {loc for loc, _ in _errors(fixture_data)} == {
        ("catalog", 0, "rights"),
        ("catalog", 0, "source"),
    }


# --- invalid sample files ------------------------------------------------------------------


@pytest.mark.parametrize(
    ("filename", "expected_loc", "expected_msg"),
    [
        (
            "negative-dimension.json",
            ("scene", "objects", 4, "dimensions", "width", "value_m"),
            "greater than 0",
        ),
        (
            "nonfinite-coordinate.json",
            ("scene", "objects", 2, "transform", "position_m", "x"),
            "finite number",
        ),
        ("duplicate-object-id.json", ("scene",), "duplicate object id: 'obj-column-c1'"),
        (
            "dangling-asset-reference.json",
            (),
            "references asset 'asset-not-in-catalog', which is not in the catalog",
        ),
    ],
)
def test_invalid_fixture_files_are_rejected_for_the_intended_reason(
    filename: str, expected_loc: tuple[str | int, ...], expected_msg: str
) -> None:
    # json.loads accepts the bare NaN token, as Python web frameworks do.
    data = json.loads((FIXTURES / "invalid" / filename).read_text())
    loc, msg = _only_error(data)
    assert loc == expected_loc
    assert expected_msg in msg


def _leaf_diff(a: Any, b: Any, path: tuple[str | int, ...] = ()) -> set[tuple[str | int, ...]]:
    if isinstance(a, dict) and isinstance(b, dict) and a.keys() == b.keys():
        return {d for k in a for d in _leaf_diff(a[k], b[k], (*path, k))}
    if isinstance(a, list) and isinstance(b, list) and len(a) == len(b):
        return {
            d
            for i, (x, y) in enumerate(zip(a, b, strict=True))
            for d in _leaf_diff(x, y, (*path, i))
        }
    same = a == b or (
        isinstance(a, float) and isinstance(b, float) and math.isnan(a) and math.isnan(b)
    )
    return set() if same else {path}


@pytest.mark.parametrize(
    ("filename", "defect"),
    [
        ("negative-dimension.json", ("scene", "objects", 4, "dimensions", "width", "value_m")),
        ("nonfinite-coordinate.json", ("scene", "objects", 2, "transform", "position_m", "x")),
        ("duplicate-object-id.json", ("scene", "objects", 5, "id")),
        ("dangling-asset-reference.json", ("scene", "objects", 3, "asset_id")),
    ],
)
def test_invalid_samples_differ_from_the_fixture_only_by_their_defect(
    fixture_data: dict[str, Any], filename: str, defect: tuple[str | int, ...]
) -> None:
    invalid = json.loads((FIXTURES / "invalid" / filename).read_text())
    assert _leaf_diff(fixture_data, invalid) == {("id",), defect}
