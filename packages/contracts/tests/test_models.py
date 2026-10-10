"""Contract invariants: units, finiteness, provenance and identity are enforced at the boundary."""

from __future__ import annotations

import copy
import json
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


def _errors(data: dict[str, Any]) -> list[tuple[tuple[str | int, ...], str]]:
    with pytest.raises(ValidationError) as info:
        Project.model_validate(data)
    return [(tuple(e["loc"]), e["msg"]) for e in info.value.errors()]


def _object(data: dict[str, Any], object_id: str) -> dict[str, Any]:
    obj: dict[str, Any] = next(o for o in data["scene"]["objects"] if o["id"] == object_id)
    return obj


def test_fixture_round_trips_exactly(fixture_text: str) -> None:
    project = Project.model_validate_json(fixture_text)
    assert json.loads(project.model_dump_json()) == json.loads(fixture_text)
    assert Project.model_validate_json(project.model_dump_json()) == project


def test_fixture_declares_si_units_frame_and_label(fixture_text: str) -> None:
    project = Project.model_validate_json(fixture_text)
    assert project.schema_version == SCHEMA_VERSION
    assert project.units.model_dump() == {"length": "m", "time": "s", "mass": "kg", "angle": "rad"}
    assert project.world_frame.up_axis == "+Y"
    assert project.fixture is not None and project.fixture.kind == "foundation"


def test_unknown_parameters_stay_unknown(fixture_text: str) -> None:
    project = Project.model_validate_json(fixture_text)
    params = [p for o in project.scene.objects for p in o.parameters]
    unknown = [p for p in params if isinstance(p, UnknownParameter)]
    assert unknown, "fixture should exercise unknown values"
    assert all(not hasattr(p, "value") for p in unknown)
    assert all(isinstance(p, KnownParameter) and p.origin for p in params if p.state == "known")


@pytest.mark.parametrize(
    ("filename", "expected_loc", "expected_msg"),
    [
        (
            "negative-dimension.json",
            ("scene", "objects", 4, "dimensions", "width_m"),
            "greater than 0",
        ),
        (
            "nonfinite-coordinate.json",
            ("scene", "objects", 2, "transform", "position_m", "x"),
            "finite number",
        ),
        ("duplicate-object-id.json", ("scene",), "duplicate object id: 'obj-column-c1'"),
    ],
)
def test_invalid_fixture_files_are_rejected_for_the_intended_reason(
    filename: str, expected_loc: tuple[str | int, ...], expected_msg: str
) -> None:
    # json.loads accepts the bare NaN token, as Python web frameworks do.
    data = json.loads((FIXTURES / "invalid" / filename).read_text())
    errors = _errors(data)
    assert len(errors) == 1, errors
    loc, msg = errors[0]
    assert loc == expected_loc
    assert expected_msg in msg


@pytest.mark.parametrize("value", [0.0, -0.001])
def test_rejects_non_positive_dimensions(fixture_data: dict[str, Any], value: float) -> None:
    _object(fixture_data, "obj-column-c1")["dimensions"]["height_m"] = value
    assert _errors(fixture_data)[0][1].startswith("Input should be greater than 0")


@pytest.mark.parametrize("value", [float("inf"), float("-inf"), float("nan")])
def test_rejects_non_finite_values(fixture_data: dict[str, Any], value: float) -> None:
    _object(fixture_data, "obj-packing-station")["transform"]["rotation_rad"]["y"] = value
    assert _errors(fixture_data) == [
        (
            ("scene", "objects", 4, "transform", "rotation_rad", "y"),
            "Input should be a finite number",
        )
    ]


def test_rejects_numbers_sent_as_strings(fixture_data: dict[str, Any]) -> None:
    _object(fixture_data, "obj-floor")["dimensions"]["width_m"] = "20"
    assert _errors(fixture_data)[0][1] == "Input should be a valid number"


def test_unknown_parameter_cannot_carry_a_value(fixture_data: dict[str, Any]) -> None:
    param = _object(fixture_data, "obj-packing-station")["parameters"][0]
    assert param["state"] == "unknown"
    param["value"] = 30.0
    loc, msg = _errors(fixture_data)[0]
    assert loc[-1] == "value" and "Extra inputs are not permitted" in msg


def test_known_parameter_requires_origin(fixture_data: dict[str, Any]) -> None:
    del _object(fixture_data, "obj-process-station")["parameters"][0]["origin"]
    assert _errors(fixture_data)[0][1] == "Field required"


def test_known_value_must_lie_within_uncertainty(fixture_data: dict[str, Any]) -> None:
    _object(fixture_data, "obj-process-station")["parameters"][0]["value"] = 55.0
    assert "outside its uncertainty bounds [40.0, 50.0]" in _errors(fixture_data)[0][1]


def test_uncertainty_bounds_must_be_ordered(fixture_data: dict[str, Any]) -> None:
    param = _object(fixture_data, "obj-process-station")["parameters"][0]
    param["uncertainty"] = {"lower": 50.0, "upper": 40.0}
    assert "lower bound must not exceed upper bound" in _errors(fixture_data)[0][1]


def test_rejects_duplicate_parameter_ids(fixture_data: dict[str, Any]) -> None:
    params = _object(fixture_data, "obj-infeed-conveyor")["parameters"]
    params.append(copy.deepcopy(params[0]))
    assert "duplicate parameter id in object 'obj-infeed-conveyor'" in _errors(fixture_data)[0][1]


def test_rejects_unexpected_fields_and_versions(fixture_data: dict[str, Any]) -> None:
    fixture_data["scale"] = 1.0
    fixture_data["schema_version"] = "0.0.9"
    messages = {loc: msg for loc, msg in _errors(fixture_data)}
    assert "Extra inputs are not permitted" in messages[("scale",)]
    assert "Input should be '0.1.0'" in messages[("schema_version",)]


@pytest.mark.parametrize("bad_id", ["", "Obj-Upper", "has space", "-leading-dash"])
def test_rejects_unstable_ids(fixture_data: dict[str, Any], bad_id: str) -> None:
    _object(fixture_data, "obj-floor")["id"] = bad_id
    assert "should match pattern" in _errors(fixture_data)[0][1]
