"""Drawing sources (0.9.0): a DXF reading is linked to its scene objects, its unit is settled
before any real size is assigned, and a display default can never pass for a verified value."""

from __future__ import annotations

import copy
from typing import Any

import pytest
from pydantic import ValidationError
from replay_world_contracts import Length, Project, is_verified

SHA = "b" * 64


def ref(handle: str, layer: str = "EQUIPMENT", entity: str = "LWPOLYLINE") -> dict[str, Any]:
    return {"handle": handle, "layer": layer, "entity": entity, "block": None}


def drawing_source(object_id: str, **units: Any) -> dict[str, Any]:
    square = [{"x": 0.0, "y": 0.0}, {"x": 1000.0, "y": 0.0}, {"x": 1000.0, "y": 800.0}]
    return {
        "id": "src-drawing",
        "kind": "dxf",
        "filename": "hall.dxf",
        "sha256": SHA,
        "source_to_world": {
            "convention": "plan_xy_to_world_x_neg_z",
            "source_unit": "mm",
            "metres_per_source_unit": 0.001,
            "rotation_about_world_y_rad": 0.0,
            "translation_m": {"x": 0.0, "y": 0.0, "z": 0.0},
        },
        "import_warnings": [],
        "image": None,
        "photo_import": None,
        "drawing": {
            "reader": "rws-dxf/1",
            "file": {"uri": f"drawings/{SHA}.dxf", "bytes": 1234},
            "dxf_version": "AC1015",
            "units": {
                "insunits": 4,
                "declared": "mm",
                "measurement": "metric",
                "question": None,
                "basis": "drawing_header",
                **units,
            },
            "layers": ["0", "EQUIPMENT"],
            "extent_min": {"x": 0.0, "y": 0.0},
            "extent_max": {"x": 1000.0, "y": 800.0},
            "lines": [{"ref": ref("2A"), "points": square, "closed": True}],
            "labels": [],
            "objects": [
                {
                    "id": "dxf-2a",
                    "object_id": object_id,
                    "role": "footprint",
                    "label": "Press",
                    "label_from": "text",
                    "kind": "equipment",
                    "refs": [ref("2A")],
                    "outline": square,
                    "centre": {"x": 500.0, "y": 400.0},
                    "width": 1000.0,
                    "depth": 800.0,
                    "rotation_rad": 0.0,
                    "notes": [],
                }
            ],
            "skipped": [
                {
                    "entity": "CIRCLE",
                    "layer": "EQUIPMENT",
                    "count": 1,
                    "handles": ["2B"],
                    "layout": True,
                    "reason": "Circles are not in the supported subset.",
                }
            ],
        },
    }


def with_source(fixture_data: dict[str, Any], source: dict[str, Any]) -> dict[str, Any]:
    project = copy.deepcopy(fixture_data)
    project["sources"].append(source)
    return project


def object_id(fixture_data: dict[str, Any]) -> str:
    oid: str = fixture_data["scene"]["objects"][0]["id"]
    return oid


def test_a_drawing_source_links_its_objects(fixture_data: dict[str, Any]) -> None:
    project = Project.model_validate(
        with_source(fixture_data, drawing_source(object_id(fixture_data)))
    )
    drawing = project.sources[-1].drawing
    assert drawing is not None and drawing.objects[0].refs[0].handle == "2A"


def test_a_drawn_object_must_be_in_the_scene_or_removed(fixture_data: dict[str, Any]) -> None:
    with pytest.raises(ValidationError, match="not in the scene and was not removed"):
        Project.model_validate(with_source(fixture_data, drawing_source("obj-nowhere")))


def test_a_unit_nobody_settled_is_refused(fixture_data: dict[str, Any]) -> None:
    source = drawing_source(object_id(fixture_data), basis=None)
    with pytest.raises(ValidationError, match="unit was never settled"):
        Project.model_validate(with_source(fixture_data, source))


def test_a_header_unit_needs_a_declared_unit_and_no_open_question(
    fixture_data: dict[str, Any],
) -> None:
    source = drawing_source(object_id(fixture_data), question="The drawing does not say.")
    with pytest.raises(ValidationError, match="needs a declared unit and no open question"):
        Project.model_validate(with_source(fixture_data, source))


def test_the_transform_uses_the_settled_unit_exactly(fixture_data: dict[str, Any]) -> None:
    source = drawing_source(object_id(fixture_data))
    source["source_to_world"]["source_unit"] = "cm"
    source["source_to_world"]["metres_per_source_unit"] = 0.01
    with pytest.raises(ValidationError, match=r"header \(mm\) but its transform uses cm"):
        Project.model_validate(with_source(fixture_data, source))
    source = drawing_source(object_id(fixture_data))
    source["source_to_world"]["metres_per_source_unit"] = 0.0011
    with pytest.raises(ValidationError, match=r"mm is 0\.001 m per unit"):
        Project.model_validate(with_source(fixture_data, source))


def test_a_user_supplied_unit_may_differ_from_an_unclear_header(
    fixture_data: dict[str, Any],
) -> None:
    source = drawing_source(
        object_id(fixture_data),
        insunits=0,
        declared=None,
        question="The drawing does not say what its units are.",
        basis="user_supplied",
    )
    Project.model_validate(with_source(fixture_data, source))


def test_the_stored_file_is_named_by_its_hash(fixture_data: dict[str, Any]) -> None:
    source = drawing_source(object_id(fixture_data))
    source["drawing"]["file"]["uri"] = f"drawings/{'c' * 64}.dxf"
    with pytest.raises(ValidationError, match="stored file name must be its sha256"):
        Project.model_validate(with_source(fixture_data, source))


def test_only_a_dxf_source_carries_a_drawing(fixture_data: dict[str, Any]) -> None:
    source = drawing_source(object_id(fixture_data))
    source["kind"] = "synthetic"
    with pytest.raises(ValidationError, match="only a dxf source carries a drawing"):
        Project.model_validate(with_source(fixture_data, source))


def test_a_display_default_is_never_confirmed_or_verified() -> None:
    shown = {"value_m": 1.2, "source_ref": "Display height", "uncertainty_m": None}
    with pytest.raises(ValidationError, match="cannot be confirmed"):
        Length.model_validate({**shown, "origin": "default", "review_status": "confirmed"})
    lengths = [
        Length.model_validate({**shown, "origin": origin, "review_status": status})
        for origin, status in (
            ("default", "unreviewed"),
            ("inferred", "confirmed"),
            ("user_supplied", "unreviewed"),
            ("measured", "unreviewed"),
        )
    ]
    assert [is_verified(x) for x in lengths] == [False, False, True, True]
