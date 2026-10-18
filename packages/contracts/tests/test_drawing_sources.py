"""Drawing sources: a DXF reading is linked to its scene objects (0.9.0); its review settles the
floor, the scale and each object, and drawn geometry is design evidence, never a site
measurement (0.10.0). A display default can never pass for a verified value."""

from __future__ import annotations

import copy
from typing import Any

import pytest
from pydantic import ValidationError
from replay_world_contracts import DESIGN_ORIGINS, Length, Project, is_verified
from replay_world_contracts.migrations import upgrade_document

SHA = "b" * 64


def ref(handle: str, layer: str = "EQUIPMENT", entity: str = "LWPOLYLINE") -> dict[str, Any]:
    return {"handle": handle, "layer": layer, "entity": entity, "block": None}


def scale(**changes: Any) -> dict[str, Any]:
    return {
        "basis": "drawing_unit",
        "unit": "mm",
        "metres_per_unit": 0.001,
        "status": "unchecked",
        "reference": None,
        **changes,
    }


def drawing_source(object_id: str, status: str = "proposed", **units: Any) -> dict[str, Any]:
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
            "raster": None,
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
                    "footprint_fit": "exact",
                    "tolerance": None,
                    "centre": {"x": 500.0, "y": 400.0},
                    "width": 1000.0,
                    "depth": 800.0,
                    "rotation_rad": 0.0,
                    "notes": [],
                }
            ],
            "skipped": [
                {
                    "entity": "SPLINE",
                    "layer": "EQUIPMENT",
                    "count": 1,
                    "handles": ["2B"],
                    "layout": True,
                    "reason": "Splines are not in the supported subset.",
                }
            ],
            "omitted": [
                {
                    "entity": "SPLINE",
                    "handle": "2B",
                    "layer": "EQUIPMENT",
                    "min": {"x": 100.0, "y": 100.0},
                    "max": {"x": 300.0, "y": 200.0},
                }
            ],
            "review": {
                "floor": {
                    "choice": "none",
                    "drawn_id": None,
                    "object_id": None,
                    "status": "proposed",
                },
                "scale": scale(),
                "objects": [{"drawn_id": "dxf-2a", "status": status}],
                "omissions": "proposed",
            },
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


def test_a_header_unit_with_an_open_question_needs_the_person(
    fixture_data: dict[str, Any],
) -> None:
    source = drawing_source(
        object_id(fixture_data), question="The header disagrees with itself.", basis="user_supplied"
    )
    with pytest.raises(ValidationError, match="the person must have confirmed it"):
        Project.model_validate(with_source(fixture_data, source))
    source["drawing"]["review"]["scale"]["status"] = "confirmed"
    Project.model_validate(with_source(fixture_data, source))


def test_the_transform_uses_the_reviewed_scale_exactly(fixture_data: dict[str, Any]) -> None:
    source = drawing_source(object_id(fixture_data))
    source["source_to_world"]["metres_per_source_unit"] = 0.0011
    with pytest.raises(ValidationError, match="must use the reviewed scale"):
        Project.model_validate(with_source(fixture_data, source))
    source = drawing_source(object_id(fixture_data))
    source["drawing"]["review"]["scale"] = scale(
        basis="chosen_unit", unit="cm", metres_per_unit=0.01
    )
    with pytest.raises(ValidationError, match="unit the person chose is at least confirmed"):
        Project.model_validate(with_source(fixture_data, source))


def reference(real: float, compared_with: float | None) -> dict[str, Any]:
    mpu = real / 600.0
    agrees = None if compared_with is None else abs(mpu / compared_with - 1) <= 0.02
    return {
        "a": {"x": 100.0, "y": 50.0},
        "b": {"x": 700.0, "y": 50.0},
        "drawing_length": 600.0,
        "real_length_m": real,
        "metres_per_unit": mpu,
        "compared_with": compared_with,
        "agrees": agrees,
        "tolerance": None,
    }


def test_a_known_length_can_set_the_scale_and_both_values_are_kept(
    fixture_data: dict[str, Any],
) -> None:
    source = drawing_source(object_id(fixture_data))
    ref_length = reference(6.0, 0.001)  # the drawing says mm; the person's 6 m says cm
    assert ref_length["agrees"] is False
    source["drawing"]["review"]["scale"] = scale(
        basis="reference_length", metres_per_unit=0.01, status="measured", reference=ref_length
    )
    source["source_to_world"]["metres_per_source_unit"] = 0.01
    project = Project.model_validate(with_source(fixture_data, source))
    drawing = project.sources[-1].drawing
    assert drawing is not None and drawing.review is not None
    assert drawing.units.declared == "mm" and drawing.review.scale.metres_per_unit == 0.01


def test_a_reference_length_must_be_consistent(fixture_data: dict[str, Any]) -> None:
    bad = reference(6.0, 0.001)
    bad["agrees"] = True
    source = drawing_source(object_id(fixture_data))
    source["drawing"]["review"]["scale"] = scale(status="confirmed", reference=bad)
    with pytest.raises(ValidationError, match="must match the 2 % rule"):
        Project.model_validate(with_source(fixture_data, source))
    source["drawing"]["review"]["scale"] = scale(status="measured", reference=reference(6.0, 0.001))
    with pytest.raises(ValidationError, match="only when a reference length agrees"):
        Project.model_validate(with_source(fixture_data, source))
    agreeing = reference(0.6, 0.001)
    source["drawing"]["review"]["scale"] = scale(status="measured", reference=agreeing)
    Project.model_validate(with_source(fixture_data, source))


def test_the_review_covers_every_drawn_object_and_its_floor(fixture_data: dict[str, Any]) -> None:
    source = drawing_source(object_id(fixture_data))
    source["drawing"]["review"]["objects"] = []
    with pytest.raises(ValidationError, match="one entry per drawn object"):
        Project.model_validate(with_source(fixture_data, source))
    source = drawing_source(object_id(fixture_data), status="used_as_floor")
    with pytest.raises(ValidationError, match="exactly the floor's outline"):
        Project.model_validate(with_source(fixture_data, source))


def test_not_an_object_means_no_scene_object(fixture_data: dict[str, Any]) -> None:
    with pytest.raises(ValidationError, match="reviewed as not an object"):
        Project.model_validate(
            with_source(fixture_data, drawing_source(object_id(fixture_data), "not_an_object"))
        )
    Project.model_validate(
        with_source(fixture_data, drawing_source("obj-never-made", "not_an_object"))
    )


def test_the_stored_file_is_named_by_its_hash(fixture_data: dict[str, Any]) -> None:
    source = drawing_source(object_id(fixture_data))
    source["drawing"]["file"]["uri"] = f"drawings/{'c' * 64}.dxf"
    with pytest.raises(ValidationError, match="stored file name must be its sha256"):
        Project.model_validate(with_source(fixture_data, source))


def test_only_a_dxf_source_carries_a_drawing(fixture_data: dict[str, Any]) -> None:
    source = drawing_source(object_id(fixture_data))
    source["kind"] = "synthetic"
    with pytest.raises(ValidationError, match="only a dxf, pdf, png or jpeg source carries"):
        Project.model_validate(with_source(fixture_data, source))


def test_drawn_geometry_is_design_evidence_not_a_verified_measurement() -> None:
    drawn = Length.model_validate(
        {
            "value_m": 3.0,
            "origin": "drawn",
            "source_ref": "Drawn in hall.dxf",
            "review_status": "unreviewed",
            "uncertainty_m": None,
        }
    )
    assert not is_verified(drawn) and drawn.origin in DESIGN_ORIGINS


def reviewed(fixture_data: dict[str, Any], after: dict[str, Any] | None) -> dict[str, Any]:
    project = copy.deepcopy(fixture_data)
    target = project["scene"]["objects"][0]
    before = copy.deepcopy(target)
    if after is None:
        project["scene"]["objects"].remove(target)
    else:
        project["scene"]["objects"][0] = after
    project["scene"]["revision"] += 1
    project["scene"]["edit_log"].append(
        {
            "type": "drawing_reviewed",
            "revision": project["scene"]["revision"],
            "source_id": "src-drawing",
            "correction": "Scale: 1 unit = 1 cm from your 6.00 m measurement",
            "objects": [
                {"object_id": before["id"], "before": before, "after": copy.deepcopy(after)}
            ],
        }
    )
    return project


def test_a_review_correction_is_logged_so_the_log_still_describes_the_scene(
    fixture_data: dict[str, Any],
) -> None:
    moved = copy.deepcopy(fixture_data["scene"]["objects"][0])
    moved["transform"]["position_m"]["x"] += 1.0
    Project.model_validate(reviewed(fixture_data, moved))
    tampered = reviewed(fixture_data, moved)
    tampered["scene"]["objects"][0]["transform"]["position_m"]["x"] += 1.0
    with pytest.raises(ValidationError, match="the log no longer describes the scene"):
        Project.model_validate(tampered)


def test_an_object_removed_by_a_review_is_never_reused(fixture_data: dict[str, Any]) -> None:
    project = reviewed(fixture_data, None)
    Project.model_validate(project)
    project["scene"]["objects"].append(copy.deepcopy(fixture_data["scene"]["objects"][0]))
    with pytest.raises(ValidationError, match="IDs are never reused"):
        Project.model_validate(project)


def test_a_0_9_0_drawing_is_reviewed_as_unchecked_and_its_drawn_sizes_are_weakened(
    fixture_data: dict[str, Any],
) -> None:
    current = with_source(fixture_data, drawing_source(object_id(fixture_data)))
    old = copy.deepcopy(current)
    old["schema_version"] = "0.9.0"
    drawing = old["sources"][-1]["drawing"]
    del drawing["review"]
    del drawing["omitted"]
    del drawing["raster"]
    for drawn in drawing["objects"]:
        del drawn["footprint_fit"]
        del drawn["tolerance"]
    press = old["scene"]["objects"][0]
    for axis in ("width", "depth"):
        press["dimensions"][axis].update(
            origin="measured", source_ref="Drawn in hall.dxf: LWPOLYLINE 2A"
        )
    upgrade = upgrade_document(old)
    assert upgrade.notes == [
        "schema_version 0.9.0 -> 0.10.0 (adds an unchecked review to 1 drawing source and "
        "footprint_fit to 1 drawn object; 2 drawn footprint values recorded as measured become "
        "drawn (a design drawing, not a site measurement); nothing is strengthened)",
        "schema_version 0.10.0 -> 0.11.0 (adds 'omitted: null' to 1 drawing reading: where their "
        "left-out shapes lie was not recorded, so checks treat them as possibly anywhere)",
        "schema_version 0.11.0 -> 0.12.0 (adds 'raster: null' to 1 drawing reading and "
        "'tolerance: null' to 1 drawn outline: DXF geometry is exact as drawn; no values or "
        "evidence changed)",
    ]
    project = Project.model_validate(upgrade.document)
    review = project.sources[-1].drawing.review  # type: ignore[union-attr]
    assert review is not None
    assert (review.scale.status, review.floor.choice, review.objects[0].status) == (
        "unchecked",
        "none",
        "proposed",
    )
    upgraded = project.scene.objects[0].dimensions
    assert (upgraded.width.origin, upgraded.depth.origin, upgraded.height) == (
        "drawn",
        "drawn",
        project.scene.objects[0].dimensions.height,
    )


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


def test_an_omitted_shape_has_a_whole_extent_or_none(fixture_data: dict[str, Any]) -> None:
    source = drawing_source(object_id(fixture_data))
    source["drawing"]["omitted"][0]["max"] = None
    with pytest.raises(ValidationError, match="both corners or neither"):
        Project.model_validate(with_source(fixture_data, source))
    source["drawing"]["omitted"][0]["min"] = None
    Project.model_validate(with_source(fixture_data, source))  # position unknown: allowed
