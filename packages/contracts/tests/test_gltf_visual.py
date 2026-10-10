"""glTF visual records: safe paths, pinned content, authored conventions and fit tolerance."""

from __future__ import annotations

import copy
import json
from typing import Any

import pytest
from pydantic import ValidationError
from replay_world_contracts import GltfVisual, Project

from .conftest import FIXTURES


@pytest.fixture
def demo() -> dict[str, Any]:
    data: dict[str, Any] = json.loads((FIXTURES / "scenes" / "industrial-demo.json").read_text())
    return data


@pytest.fixture
def visual(demo: dict[str, Any]) -> dict[str, Any]:
    v: dict[str, Any] = copy.deepcopy(demo["catalog"][0]["visual"])
    return v


def _visual_errors(data: dict[str, Any]) -> list[tuple[tuple[str | int, ...], str]]:
    with pytest.raises(ValidationError) as info:
        GltfVisual.model_validate(data)
    return [(tuple(e["loc"]), e["msg"]) for e in info.value.errors()]


def test_demo_uses_gltf_visuals_with_explicit_conventions(demo: dict[str, Any]) -> None:
    project = Project.model_validate(demo)
    visuals = [a.visual for a in project.catalog]
    assert all(isinstance(v, GltfVisual) for v in visuals)
    for v in visuals:
        assert isinstance(v, GltfVisual)
        assert (v.up_axis, v.front_axis, v.origin) == ("+Y", "+Z", "bottom_centre")
        assert v.metres_per_model_unit == 1.0
        assert v.fit == "scale_to_dimensions"
    assert project.fixture is not None and project.fixture.kind == "demonstration"


def test_demo_round_trips_exactly(demo: dict[str, Any]) -> None:
    text = (FIXTURES / "scenes" / "industrial-demo.json").read_text()
    assert json.loads(Project.model_validate_json(text).model_dump_json()) == demo


@pytest.mark.parametrize(
    "uri",
    [
        "../secrets.glb",
        "models/../../pyproject.glb",
        "/etc/passwd.glb",
        "C:\\\\models\\\\x.glb",
        "models\\\\x.glb",
        "https://example.com/x.glb",
        "file:models/x.glb",
        "models/X.glb",
        "models/x.gltf",
        "models/x.glb?raw=1",
        "models//x.glb",
        ".hidden.glb",
        "models/.x.glb",
        "",
        "a/b/c/d/e/f/x.glb",
    ],
)
def test_rejects_unsafe_or_unsupported_paths(visual: dict[str, Any], uri: str) -> None:
    visual["uri"] = uri
    assert _visual_errors(visual)[0][0] == ("uri",)


@pytest.mark.parametrize(
    "uri", ["x.glb", "models/belt-conveyor-3m.glb", "vendor_a/line-2/cell_7.glb"]
)
def test_accepts_library_relative_glb_paths(visual: dict[str, Any], uri: str) -> None:
    visual["uri"] = uri
    assert GltfVisual.model_validate(visual).uri == uri


@pytest.mark.parametrize("sha", ["", "ABC", "0" * 63, "g" * 64, "0" * 64 + "0"])
def test_requires_a_lowercase_sha256(visual: dict[str, Any], sha: str) -> None:
    visual["sha256"] = sha
    assert _visual_errors(visual)[0][0] == ("sha256",)


def test_origin_must_be_the_bounding_box_bottom_centre(visual: dict[str, Any]) -> None:
    lifted = copy.deepcopy(visual)
    lifted["model_bounds_m"]["min"]["y"] = 0.05
    assert "y (bottom) is offset by 0.05 m" in _visual_errors(lifted)[0][1]
    shifted = copy.deepcopy(visual)
    shifted["model_bounds_m"]["max"]["x"] += 0.2
    assert "x (centre) is offset" in _visual_errors(shifted)[0][1]


def test_bounds_must_not_be_empty(visual: dict[str, Any]) -> None:
    visual["model_bounds_m"]["max"]["z"] = visual["model_bounds_m"]["min"]["z"]
    assert "min < max on z" in _visual_errors(visual)[0][1]


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("up_axis", "+Z"),
        ("front_axis", "-Z"),
        ("origin", "centre"),
        ("fit", "stretch"),
        ("metres_per_model_unit", 0.0),
        ("max_fit_distortion", -0.01),
        ("max_fit_distortion", 0.6),
    ],
)
def test_rejects_undeclared_conventions(visual: dict[str, Any], field: str, value: object) -> None:
    visual[field] = value
    assert _visual_errors(visual)[0][0] == (field,)


def test_nominal_dimensions_must_match_the_model(demo: dict[str, Any]) -> None:
    demo["catalog"][1]["nominal_dimensions"]["height"]["value_m"] = 2.6
    with pytest.raises(ValidationError) as info:
        Project.model_validate(demo)
    [error] = info.value.errors()
    assert error["loc"] == ("catalog", 1)
    assert "nominal height 2.6 m does not match its model's extent 2.4700 m" in error["msg"]


def test_placeholder_visual_still_valid(demo: dict[str, Any]) -> None:
    demo["catalog"][0]["visual"] = {"type": "placeholder_box"}
    Project.model_validate(demo)


def test_walkways_and_keep_clear_zones_are_object_kinds(demo: dict[str, Any]) -> None:
    kinds = {o["kind"] for o in demo["scene"]["objects"]}
    assert {"walkway", "keep_clear"} <= kinds
    demo["scene"]["objects"][0]["kind"] = "parking"
    with pytest.raises(ValidationError):
        Project.model_validate(demo)
