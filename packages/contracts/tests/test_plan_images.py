"""Plan images (0.12.0, IMP-03): a PNG, JPEG or one PDF page read as a drawing in pixels. Its
scale comes only from a known length, its picture is stored by hash, and an outline is either a
proposal (approximate, no tolerance) or traced by the person (with the marking tolerance)."""

from __future__ import annotations

import copy
from typing import Any

import pytest
from pydantic import ValidationError
from replay_world_contracts import Project

SHA = "d" * 64
RASTER_SHA = "e" * 64


def region(entity: str = "REGION") -> dict[str, Any]:
    return {"handle": None, "layer": "page 2", "entity": entity, "block": None}


def drawn(
    entity: str = "REGION", fit: str = "approximate", tolerance: float | None = None
) -> dict[str, Any]:
    box = [{"x": 100.0, "y": 100.0}, {"x": 300.0, "y": 100.0}, {"x": 300.0, "y": 180.0}]
    return {
        "id": "plan-1",
        "object_id": "obj-plan-1",
        "role": "footprint",
        "label": "Rack 1",
        "label_from": "proposed",
        "kind": "equipment",
        "refs": [region(entity)],
        "outline": box,
        "footprint_fit": fit,
        "tolerance": tolerance,
        "centre": {"x": 200.0, "y": 140.0},
        "width": 200.0,
        "depth": 80.0,
        "rotation_rad": 0.0,
        "notes": [],
    }


def plan_source(kind: str = "pdf", **raster: Any) -> dict[str, Any]:
    reference = {
        "a": {"x": 0.0, "y": 0.0},
        "b": {"x": 1000.0, "y": 0.0},
        "drawing_length": 1000.0,
        "real_length_m": 20.0,
        "metres_per_unit": 0.02,
        "compared_with": None,
        "agrees": None,
        "tolerance": 4.0,
    }
    pdf = kind == "pdf"
    extension = {"pdf": "pdf", "png": "png", "jpeg": "jpg"}[kind]
    return {
        "id": "src-plan",
        "kind": kind,
        "filename": f"hall.{extension}",
        "sha256": SHA,
        "source_to_world": {
            "convention": "plan_xy_to_world_x_neg_z",
            "source_unit": "px",
            "metres_per_source_unit": 0.02,
            "rotation_about_world_y_rad": 0.0,
            "translation_m": {"x": 0.0, "y": 0.0, "z": 0.0},
        },
        "import_warnings": [],
        "image": None,
        "photo_import": None,
        "reference": None,
        "drawing": {
            "reader": "rws-plan-image/1",
            "file": {"uri": f"drawings/{SHA}.{extension}", "bytes": 5000},
            "raster": {
                "uri": f"drawings/{SHA}-p2.png" if pdf else f"drawings/{SHA}.{extension}",
                "media_type": "image/jpeg" if kind == "jpeg" else "image/png",
                "sha256": RASTER_SHA if pdf else SHA,
                "width_px": 1200,
                "height_px": 800,
                "page": 2 if pdf else None,
                "page_count": 2 if pdf else None,
                "dpi": 150.0 if pdf else None,
                **raster,
            },
            "dxf_version": None,
            "units": {
                "insunits": None,
                "declared": None,
                "measurement": None,
                "question": "A plan image has no unit: mark one length you know.",
                "basis": "user_supplied",
            },
            "layers": ["page 2"],
            "extent_min": {"x": 0.0, "y": 0.0},
            "extent_max": {"x": 1200.0, "y": 800.0},
            "lines": [],
            "labels": [],
            "objects": [drawn()],
            "skipped": [],
            "omitted": [],
            "review": {
                "floor": {
                    "choice": "none",
                    "drawn_id": None,
                    "object_id": None,
                    "status": "proposed",
                },
                "scale": {
                    "basis": "reference_length",
                    "unit": "px",
                    "metres_per_unit": 0.02,
                    "status": "measured",
                    "reference": reference,
                },
                "objects": [{"drawn_id": "plan-1", "status": "proposed"}],
                "omissions": "proposed",
                "symbol_layers": [],
            },
        },
    }


def with_plan(fixture_data: dict[str, Any], source: dict[str, Any]) -> dict[str, Any]:
    project = copy.deepcopy(fixture_data)
    source["drawing"]["objects"][0]["object_id"] = project["scene"]["objects"][0]["id"]
    project["sources"].append(source)
    return project


@pytest.mark.parametrize("kind", ["pdf", "png", "jpeg"])
def test_a_plan_image_is_a_drawing_in_pixels(fixture_data: dict[str, Any], kind: str) -> None:
    project = Project.model_validate(with_plan(fixture_data, plan_source(kind)))
    drawing = project.sources[-1].drawing
    assert drawing is not None and drawing.raster is not None and drawing.review is not None
    assert (drawing.review.scale.unit, drawing.review.scale.basis) == ("px", "reference_length")


def test_pixels_get_a_scale_only_from_a_known_length(fixture_data: dict[str, Any]) -> None:
    source = plan_source()
    source["drawing"]["review"]["scale"] = {
        "basis": "chosen_unit",
        "unit": "px",
        "metres_per_unit": 0.02,
        "status": "confirmed",
        "reference": None,
    }
    with pytest.raises(ValidationError, match="pixels have no length of their own"):
        Project.model_validate(with_plan(fixture_data, source))


def test_a_pdf_page_is_its_rendered_raster(fixture_data: dict[str, Any]) -> None:
    with pytest.raises(ValidationError, match="its page rendered as"):
        Project.model_validate(with_plan(fixture_data, plan_source(uri=f"drawings/{SHA}.png")))
    with pytest.raises(ValidationError, match="page, page count and resolution"):
        Project.model_validate(with_plan(fixture_data, plan_source(dpi=None)))
    with pytest.raises(ValidationError, match="beyond the PDF's last page"):
        Project.model_validate(with_plan(fixture_data, plan_source(page_count=1)))


def test_an_image_plan_is_its_own_raster(fixture_data: dict[str, Any]) -> None:
    with pytest.raises(ValidationError, match="its raster is the image itself"):
        Project.model_validate(with_plan(fixture_data, plan_source("png", sha256=RASTER_SHA)))


def test_a_plan_image_reading_needs_a_raster_and_no_unit(fixture_data: dict[str, Any]) -> None:
    source = plan_source()
    source["drawing"]["raster"] = None
    with pytest.raises(ValidationError, match="records its raster"):
        Project.model_validate(with_plan(fixture_data, source))
    source = plan_source()
    source["drawing"]["units"]["declared"] = "mm"
    with pytest.raises(ValidationError, match="declares no unit"):
        Project.model_validate(with_plan(fixture_data, source))


def test_a_proposal_is_approximate_and_a_trace_records_its_tolerance(
    fixture_data: dict[str, Any],
) -> None:
    source = plan_source()
    source["drawing"]["objects"] = [drawn(fit="approximate", tolerance=3.0)]
    with pytest.raises(ValidationError, match="approximate outline has no known tolerance"):
        Project.model_validate(with_plan(fixture_data, source))
    source["drawing"]["objects"] = [drawn(entity="TRACE", fit="exact", tolerance=None)]
    with pytest.raises(ValidationError, match="records its tolerance"):
        Project.model_validate(with_plan(fixture_data, source))
    source["drawing"]["objects"] = [drawn(entity="TRACE", fit="exact", tolerance=3.0)]
    Project.model_validate(with_plan(fixture_data, source))


def test_a_later_plan_is_kept_with_the_world_without_replacing_it(
    fixture_data: dict[str, Any],
) -> None:
    project = with_plan(fixture_data, plan_source())
    attached = {
        "id": "src-attached",
        "kind": "png",
        "filename": "mezzanine.png",
        "sha256": "f" * 64,
        "source_to_world": None,
        "import_warnings": ["Kept with this world; not aligned with its plan (ENR-01)."],
        "image": None,
        "photo_import": None,
        "drawing": None,
        "reference": None,
    }
    project["sources"].append(attached)
    project["scene"]["revision"] += 1
    record = {
        "type": "source_attached",
        "revision": project["scene"]["revision"],
        "source_id": "src-attached",
        "filename": "mezzanine.png",
    }
    project["scene"]["edit_log"].append(record)
    Project.model_validate(project)
    project["scene"]["edit_log"][-1] = {**record, "source_id": "src-nowhere"}
    with pytest.raises(ValidationError, match="which is not in the project"):
        Project.model_validate(project)
    nameless = copy.deepcopy(project)
    nameless["scene"]["edit_log"].pop()
    nameless["sources"][-1]["filename"] = None
    with pytest.raises(ValidationError, match="needs its filename and sha256"):
        Project.model_validate(nameless)
