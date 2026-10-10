"""The object generator: exact primitives, envelope fitting and verified, deterministic GLBs.

Primitives are checked as closed solids (every edge shared by exactly two triangles in
opposite directions, positive enclosed volume close to the analytic one), not just by counting
vertices. Generated files are re-read with an independent reader and validated as the
contract's ``CatalogAsset`` would see them.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import struct
from collections import Counter
from collections.abc import Callable
from pathlib import Path
from typing import Any, get_args

import pytest
from pydantic import ValidationError
from replay_world_api.objects import (
    MATERIALS,
    BuiltModel,
    GeneratorError,
    GlbError,
    StoreConflictError,
    build_model,
    fit_to_envelope,
    gltf_visual,
    read_glb,
    store_model,
    write_glb,
)
from replay_world_api.objects import generator as generator_module
from replay_world_api.objects import mesh as shapes
from replay_world_api.objects.glb import UNSIGNED_INT, UNSIGNED_SHORT, srgb_to_linear
from replay_world_api.objects.mesh import Mesh, Point
from replay_world_contracts import (
    GENERATOR_VERSION,
    UNKNOWN_PROPERTIES,
    CatalogAsset,
    GeometryDraft,
    GeometrySpec,
    Vec3,
)
from replay_world_contracts.models import (
    CATALOG_PATH_PATTERN,
    GEOMETRY_MIN_PART_M,
    GeometryMaterial,
    parts_bounds,
)

# --- Specification builders -------------------------------------------------------------


def part(
    part_id: str,
    shape: str,
    material: str,
    center: Point,
    size: Point,
    *,
    axis: str | None = None,
    taper: float | None = None,
    narrow_end: str | None = None,
) -> dict[str, Any]:
    return {
        "id": part_id,
        "label": part_id.replace("-", " ").capitalize(),
        "shape": shape,
        "material": material,
        "center_m": dict(zip("xyz", center, strict=True)),
        "size_m": dict(zip("xyz", size, strict=True)),
        "axis": axis,
        "taper": taper,
        "narrow_end": narrow_end,
        "basis": "inferred",
    }


def draft(envelope: Point, parts: list[dict[str, Any]]) -> GeometryDraft:
    return GeometryDraft.model_validate(
        {
            "format": "rws-geometry/1",
            "envelope_m": dict(zip("xyz", envelope, strict=True)),
            "parts": parts,
        }
    )


def guarded_conveyor() -> GeometryDraft:
    """Authored from its left end (x from 0), wider and deeper than its envelope."""
    parts = [
        part("rail-back", "box", "aluminium", (1.55, 0.85, -0.32), (3.1, 0.12, 0.05)),
        part("rail-front", "box", "aluminium", (1.55, 0.85, 0.32), (3.1, 0.12, 0.05)),
        part("belt", "box", "rubber_black", (1.55, 0.92, 0.0), (3.0, 0.02, 0.6)),
        part("roller-in", "cylinder", "steel_dark", (0.05, 0.86, 0.0), (0.1, 0.1, 0.62), axis="z"),
        part("roller-out", "cylinder", "steel_dark", (3.05, 0.86, 0.0), (0.1, 0.1, 0.62), axis="z"),
        part("guard-back", "box", "polycarbonate", (1.55, 1.15, -0.4), (2.6, 0.5, 0.01)),
        part("guard-front", "box", "polycarbonate", (1.55, 1.15, 0.4), (2.6, 0.5, 0.01)),
        part("motor", "cylinder", "motor_blue", (2.9, 0.6, 0.45), (0.2, 0.2, 0.3), axis="z"),
        part("e-stop", "cylinder", "estop_red", (0.15, 1.0, 0.43), (0.06, 0.06, 0.04), axis="z"),
    ]
    for i, (x, z) in enumerate([(0.2, -0.3), (0.2, 0.3), (2.9, -0.3), (2.9, 0.3)]):
        parts.append(part(f"leg-{i}", "box", "paint_anthracite", (x, 0.42, z), (0.06, 0.8, 0.06)))
        parts.append(
            part(f"foot-{i}", "cylinder", "rubber_black", (x, 0.01, z), (0.1, 0.02, 0.1), axis="y")
        )
    return draft((3.0, 1.4, 0.9), parts)


def tank_with_hopper() -> GeometryDraft:
    """A vertical tank on legs, a conical hopper below and a pointed rain cap on top."""
    parts = [
        part("body", "cylinder", "stainless_steel", (0.0, 2.2, 0.0), (1.6, 1.8, 1.6), axis="y"),
        part("dome", "sphere", "stainless_steel", (0.0, 3.1, 0.0), (1.6, 0.6, 1.6)),
        part(
            "hopper",
            "frustum",
            "stainless_steel",
            (0.0, 0.95, 0.0),
            (1.6, 0.7, 1.6),
            taper=0.15,
            narrow_end="bottom",
        ),
        part("outlet", "cylinder", "steel_dark", (0.0, 0.45, 0.0), (0.24, 0.3, 0.24), axis="y"),
        part("valve", "sphere", "paint_red", (0.0, 0.3, 0.0), (0.3, 0.2, 0.3)),
        part("lid", "cylinder", "steel_dark", (0.0, 3.42, 0.0), (0.4, 0.04, 0.4), axis="y"),
        part(
            "rain-cap",
            "frustum",
            "steel_dark",
            (0.0, 3.48, 0.0),
            (0.3, 0.08, 0.3),
            taper=0.0,
            narrow_end="top",
        ),
        part("label", "box", "label_black", (0.0, 2.2, 0.805), (0.3, 0.1, 0.01)),
    ]
    for i, (x, z) in enumerate([(-0.6, -0.6), (-0.6, 0.6), (0.6, -0.6), (0.6, 0.6)]):
        parts.append(part(f"leg-{i}", "box", "paint_blue", (x, 0.65, z), (0.08, 1.3, 0.08)))
    return draft((1.6, 3.4, 1.6), parts)


def workbench_with_screen() -> GeometryDraft:
    """Already fitted to its envelope: fitting leaves it as it is."""
    parts = [
        part("top", "rounded_box", "wood", (0.0, 0.88, 0.0), (1.8, 0.04, 0.8)),
        part("shelf", "box", "paint_light_grey", (0.0, 0.15, 0.0), (1.7, 0.02, 0.7)),
        part("drawers", "rounded_box", "paint_light_grey", (0.6, 0.65, 0.0), (0.45, 0.4, 0.65)),
        part("handle", "cylinder", "aluminium", (0.6, 0.7, 0.335), (0.2, 0.02, 0.02), axis="x"),
        part("pole", "cylinder", "aluminium", (0.0, 1.05, -0.3), (0.04, 0.3, 0.04), axis="y"),
        part("bezel", "rounded_box", "plastic_black", (0.0, 1.4, -0.27), (0.6, 0.38, 0.03)),
        part("screen", "box", "hmi_screen", (0.0, 1.4, -0.254), (0.56, 0.34, 0.004)),
        part("lamp-arm", "cylinder", "steel_dark", (-0.7, 1.3, -0.3), (0.03, 0.8, 0.03), axis="y"),
        part("lamp", "sphere", "signal_white", (-0.7, 1.7, -0.3), (0.1, 0.1, 0.1)),
    ]
    for i, (x, z) in enumerate([(-0.85, -0.35), (-0.85, 0.35), (0.85, -0.35), (0.85, 0.35)]):
        parts.append(part(f"leg-{i}", "box", "paint_anthracite", (x, 0.43, z), (0.05, 0.86, 0.05)))
    return draft((1.8, 1.75, 0.8), parts)


EXAMPLES: dict[str, Callable[[], GeometryDraft]] = {
    "conveyor": guarded_conveyor,
    "tank": tank_with_hopper,
    "workbench": workbench_with_screen,
}


def envelope_box(spec: GeometryDraft) -> tuple[Point, Point]:
    e = spec.envelope_m
    return (-e.x / 2, 0.0, -e.z / 2), (e.x / 2, e.y, e.z / 2)


def as_tuple(v: Vec3) -> Point:
    return (v.x, v.y, v.z)


# --- Geometry helpers -------------------------------------------------------------------


def sub(a: Point, b: Point) -> Point:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def cross(a: Point, b: Point) -> Point:
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def dot(a: Point, b: Point) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def triangles(m: Mesh) -> list[tuple[int, int, int]]:
    i = m.indices
    return [(i[t], i[t + 1], i[t + 2]) for t in range(0, len(i), 3)]


def bounds(m: Mesh) -> tuple[Point, Point]:
    p = m.positions
    lo = (min(v[0] for v in p), min(v[1] for v in p), min(v[2] for v in p))
    hi = (max(v[0] for v in p), max(v[1] for v in p), max(v[2] for v in p))
    return lo, hi


def signed_volume(m: Mesh) -> float:
    p = m.positions
    return sum(dot(p[a], cross(p[b], p[c])) for a, b, c in triangles(m)) / 6


# --- Materials --------------------------------------------------------------------------


def test_material_table_covers_exactly_the_contract_materials() -> None:
    assert set(MATERIALS) == set(get_args(GeometryMaterial))
    transparent = {k for k, m in MATERIALS.items() if m.opacity is not None}
    assert transparent == {"glass_clear", "polycarbonate"}
    for key, m in MATERIALS.items():
        assert re.fullmatch(r"#[0-9a-f]{6}", m.color_srgb), key
        assert 0 <= m.metalness <= 1 and 0 <= m.roughness <= 1, key
        assert m.opacity is None or 0 < m.opacity < 1, key
        assert 0 <= m.emissive_intensity <= 1, key


def test_srgb_conversion_uses_the_standard_transfer_function() -> None:
    assert srgb_to_linear("#000000") == (0.0, 0.0, 0.0)
    assert srgb_to_linear("#ffffff") == pytest.approx((1.0, 1.0, 1.0))
    # 128/255 is above the linear toe: ((0.50196 + 0.055) / 1.055) ** 2.4
    assert srgb_to_linear("#808080")[0] == pytest.approx(0.2158605, abs=1e-7)
    # 10/255 is inside the linear toe: c / 12.92
    assert srgb_to_linear("#0a0a0a")[0] == pytest.approx(10 / 255 / 12.92)


# --- Primitives -------------------------------------------------------------------------

CENTER: Point = (0.25, 0.6, -0.125)
SIZE: Point = (0.4, 1.2, 0.7)  # every axis different: ellipses and ellipsoids are exercised
A, B, C = (s / 2 for s in SIZE)


def frustum_volume(s_low: float, s_high: float, base_area: float, height: float) -> float:
    return base_area * height * (s_low**2 + s_low * s_high + s_high**2) / 3


PRIMITIVES: dict[str, tuple[Callable[[], Mesh], float]] = {
    "box": (lambda: shapes.box(CENTER, SIZE), 8 * A * B * C),
    "rounded_box": (lambda: shapes.rounded_box(CENTER, SIZE), 8 * A * B * C),
    "cylinder_x": (lambda: shapes.cylinder(CENTER, SIZE, "x"), math.pi * B * C * SIZE[0]),
    "cylinder_y": (lambda: shapes.cylinder(CENTER, SIZE, "y"), math.pi * A * C * SIZE[1]),
    "cylinder_z": (lambda: shapes.cylinder(CENTER, SIZE, "z"), math.pi * A * B * SIZE[2]),
    "frustum_top": (
        lambda: shapes.frustum(CENTER, SIZE, 0.4, "top"),
        frustum_volume(1, 0.4, math.pi * A * C, SIZE[1]),
    ),
    "frustum_bottom": (
        lambda: shapes.frustum(CENTER, SIZE, 0.4, "bottom"),
        frustum_volume(0.4, 1, math.pi * A * C, SIZE[1]),
    ),
    "cone_top": (
        lambda: shapes.frustum(CENTER, SIZE, 0.0, "top"),
        frustum_volume(1, 0, math.pi * A * C, SIZE[1]),
    ),
    "cone_bottom": (
        lambda: shapes.frustum(CENTER, SIZE, 0.0, "bottom"),
        frustum_volume(0, 1, math.pi * A * C, SIZE[1]),
    ),
    "upright_cylinder_frustum": (
        lambda: shapes.frustum(CENTER, SIZE, 1.0, "top"),
        math.pi * A * C * SIZE[1],
    ),
    "sphere": (lambda: shapes.sphere(CENTER, SIZE), 4 / 3 * math.pi * A * B * C),
}


@pytest.mark.parametrize("name", PRIMITIVES)
def test_primitive_fills_its_box_exactly(name: str) -> None:
    lo, hi = bounds(PRIMITIVES[name][0]())
    for i in range(3):
        assert lo[i] == round(CENTER[i] - SIZE[i] / 2, 6)
        assert hi[i] == round(CENTER[i] + SIZE[i] / 2, 6)


@pytest.mark.parametrize("name", PRIMITIVES)
def test_primitive_normals_are_unit_and_agree_with_the_winding(name: str) -> None:
    m = PRIMITIVES[name][0]()
    assert len(m.positions) == len(m.normals)
    for n in m.normals:
        assert math.sqrt(dot(n, n)) == pytest.approx(1.0, abs=2e-6)
    for a, b, c in triangles(m):
        p = m.positions
        face = cross(sub(p[b], p[a]), sub(p[c], p[a]))
        assert dot(face, face) > 0, "degenerate triangle"
        # Counter-clockwise seen from outside: the face normal points the way the surface does.
        for v in (a, b, c):
            assert dot(face, m.normals[v]) > 0


@pytest.mark.parametrize("name", PRIMITIVES)
def test_primitive_is_a_closed_outward_facing_solid(name: str) -> None:
    builder, analytic = PRIMITIVES[name]
    m = builder()
    # Weld by position only: flat faces and caps duplicate vertices to keep sharp normals.
    ids: dict[Point, int] = {}
    welded = [ids.setdefault(p, len(ids)) for p in m.positions]
    edges = Counter(
        (welded[u], welded[v])
        for tri in triangles(m)
        for u, v in ((tri[0], tri[1]), (tri[1], tri[2]), (tri[2], tri[0]))
    )
    for (u, v), count in edges.items():
        assert count == 1 and edges[(v, u)] == 1, f"edge {u}-{v} is not shared once each way"
    # Positive volume means the triangles face outward; polygons are inscribed, so a little less.
    volume = signed_volume(m)
    assert 0.97 * analytic < volume <= analytic * (1 + 1e-6)


def test_rounded_box_uses_the_catalog_edge_radius() -> None:
    m = shapes.rounded_box(CENTER, SIZE)
    radius = min(0.25 * min(SIZE), 0.015)
    assert radius == 0.015
    right = max(p[0] for p in m.positions)
    face = [p for p in m.positions if p[0] == right]
    # The flat part of the +X face stops one radius short of the box edges.
    assert max(p[1] for p in face) == pytest.approx(CENTER[1] + B - radius, abs=1e-6)
    assert min(p[2] for p in face) == pytest.approx(CENTER[2] - C + radius, abs=1e-6)
    small = shapes.rounded_box((0.0, 0.01, 0.0), (0.02, 0.02, 0.02))
    assert bounds(small) == ((-0.01, 0.0, -0.01), (0.01, 0.02, 0.01))


def test_a_vanishing_frustum_end_becomes_a_point() -> None:
    m = shapes.frustum((0.0, 0.001, 0.0), (0.002, 0.002, 0.002), 0.01, "top")
    top = max(p[1] for p in m.positions)
    assert {(p[0], p[2]) for p in m.positions if p[1] == top} == {(0.0, 0.0)}


# --- Fitting ----------------------------------------------------------------------------


@pytest.mark.parametrize("example", EXAMPLES)
def test_fitting_makes_the_union_of_the_parts_the_envelope(example: str) -> None:
    d = EXAMPLES[example]()
    before_lo, before_hi = parts_bounds(d.parts)
    spec, scale, _ = fit_to_envelope(d)
    lo, hi = parts_bounds(spec.parts)
    want_lo, want_hi = envelope_box(spec)
    assert as_tuple(lo) == pytest.approx(want_lo, abs=1e-9)
    assert as_tuple(hi) == pytest.approx(want_hi, abs=1e-9)
    extents = (d.envelope_m.x, d.envelope_m.y, d.envelope_m.z)
    for i, axis in enumerate("xyz"):
        span = getattr(before_hi, axis) - getattr(before_lo, axis)
        assert getattr(scale, axis) == pytest.approx(extents[i] / span, abs=1e-6)
    assert spec.envelope_m == d.envelope_m
    assert [p.id for p in spec.parts] == [p.id for p in d.parts]


def test_fitting_keeps_proportions_along_each_axis() -> None:
    d = guarded_conveyor()
    spec, scale, _ = fit_to_envelope(d)
    before = {p.id: p for p in d.parts}
    for p in spec.parts:
        # Faces are snapped to 2 µm, so a size may move by up to two of those half-steps.
        assert p.size_m.x == pytest.approx(before[p.id].size_m.x * scale.x, abs=3e-6)
        assert p.size_m.z == pytest.approx(before[p.id].size_m.z * scale.z, abs=3e-6)
        assert (p.shape, p.material, p.axis, p.label) == (
            before[p.id].shape,
            before[p.id].material,
            before[p.id].axis,
            before[p.id].label,
        )


def test_fitting_reports_noticeable_scaling_only() -> None:
    d = draft(
        (2.08, 1.01, 0.5),
        [
            part("base", "box", "paint_white", (0.0, 0.25, 0.0), (2.0, 0.5, 0.5)),
            part("head", "box", "paint_white", (0.5, 0.75, 0.0), (1.0, 0.5, 0.5)),
        ],
    )
    spec, scale, notes = fit_to_envelope(d)
    assert (scale.x, scale.y, scale.z) == (1.04, 1.01, 1.0)
    assert notes == [
        "Parts were scaled \N{MULTIPLICATION SIGN}1.04 in width (X) to fit the 2.080 m envelope."
    ]
    assert spec.parts[1].center_m.y == pytest.approx(0.7575, abs=1e-9)


def test_fitting_is_idempotent() -> None:
    for build in EXAMPLES.values():
        spec, _, _ = fit_to_envelope(build())
        again, scale, notes = fit_to_envelope(spec)  # a GeometrySpec is accepted as a draft
        assert again == spec
        assert (scale.x, scale.y, scale.z) == (1.0, 1.0, 1.0)
        assert notes == []


def test_an_already_fitted_draft_is_unchanged() -> None:
    d = workbench_with_screen()
    spec, scale, notes = fit_to_envelope(d)
    assert spec.parts == d.parts
    assert (scale.x, scale.y, scale.z, notes) == (1.0, 1.0, 1.0, [])


def test_parts_squeezed_below_the_minimum_are_thickened_inward() -> None:
    d = draft(
        (0.1, 0.5, 0.5),
        [
            part("body", "box", "paint_white", (0.0, 0.25, 0.0), (1.0, 0.5, 0.5)),
            # A 2 mm plate on the right-hand face, which a 0.1x squeeze would make 0.2 mm.
            part("face-plate", "box", "label_black", (0.501, 0.25, 0.0), (0.002, 0.3, 0.3)),
        ],
    )
    spec, scale, notes = fit_to_envelope(d)
    plate = spec.parts[1]
    assert plate.size_m.x == GEOMETRY_MIN_PART_M
    # Its outer face stays on the envelope, so the union is still exactly the envelope.
    assert plate.center_m.x + plate.size_m.x / 2 == pytest.approx(0.05, abs=1e-9)
    lo, hi = parts_bounds(spec.parts)
    assert (lo.x, hi.x) == pytest.approx((-0.05, 0.05), abs=1e-9)
    assert scale.x == pytest.approx(0.1 / 1.002, abs=1e-6)
    assert "Part 'Face plate' was thickened to the 2 mm minimum in width (X)." in notes


def test_parts_too_far_out_are_refused_before_fitting() -> None:
    # The contract bounds draft coordinates (100 m), so a draft whose span would overflow a
    # float when fitted never reaches the generator.
    with pytest.raises(ValidationError, match="exceeds 100 m"):
        draft(
            (1.0, 1.0, 1.0),
            [
                part("left", "box", "concrete", (-1e308, 0.5, 0.0), (1.0, 1.0, 1.0)),
                part("right", "box", "concrete", (1e308, 0.5, 0.0), (1.0, 1.0, 1.0)),
            ],
        )


# --- Building ---------------------------------------------------------------------------


def fitted(example: str) -> GeometrySpec:
    return fit_to_envelope(EXAMPLES[example]())[0]


def glb_document(glb: bytes) -> dict[str, Any]:
    (length,) = struct.unpack_from("<I", glb, 12)
    document: dict[str, Any] = json.loads(glb[20 : 20 + length])
    return document


@pytest.mark.parametrize("example", EXAMPLES)
def test_build_is_deterministic_and_content_addressed(example: str) -> None:
    spec = fitted(example)
    model = build_model(spec)
    # Same specification, separately parsed from JSON: same bytes.
    again = build_model(GeometrySpec.model_validate_json(spec.model_dump_json()))
    assert again.glb == model.glb
    assert model.sha256 == hashlib.sha256(model.glb).hexdigest()
    assert model.uri == f"generated/{model.sha256}.glb"
    assert re.fullmatch(CATALOG_PATH_PATTERN, model.uri)


@pytest.mark.parametrize("example", EXAMPLES)
def test_built_model_bounds_are_the_envelope_at_the_bottom_centre(example: str) -> None:
    spec = fitted(example)
    model = build_model(spec)
    summary = read_glb(model.glb)
    want_lo, want_hi = envelope_box(spec)
    assert summary.min == pytest.approx(want_lo, abs=1e-6)
    assert summary.max == pytest.approx(want_hi, abs=1e-6)
    assert (as_tuple(model.bounds.min), as_tuple(model.bounds.max)) == (summary.min, summary.max)
    assert summary.triangles == model.triangles
    assert summary.generator == GENERATOR_VERSION
    used = list(dict.fromkeys(p.material for p in spec.parts))
    assert list(model.materials) == used


@pytest.mark.parametrize("example", EXAMPLES)
def test_visual_passes_the_catalog_asset_checks(example: str) -> None:
    spec = fitted(example)
    model = build_model(spec)
    visual = gltf_visual(model)
    e = spec.envelope_m

    def length(value: float) -> dict[str, Any]:
        return {
            "value_m": value,
            "origin": "user_supplied",
            "source_ref": None,
            "review_status": "unreviewed",
            "uncertainty_m": None,
        }

    asset = CatalogAsset.model_validate(
        {
            "id": f"asset-generated-{example}",
            "name": example.capitalize(),
            "kind": "equipment",
            "visual": visual.model_dump(),
            "nominal_dimensions": {
                "width": length(e.x),
                "height": length(e.y),
                "depth": length(e.z),
            },
            "source": {"kind": "generated", "author": "Object builder test", "reference": None},
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
                "generator": GENERATOR_VERSION,
                "spec": spec.model_dump(),
                "stated_facts": [],
                "inferred_facts": [],
                "not_modelled": [],
                "unknown_properties": [
                    {"property": p, "reason": "Not established by a generated model."}
                    for p in UNKNOWN_PROPERTIES
                ],
            },
        }
    )
    assert asset.visual == visual
    bounds = visual.model_bounds_m
    assert (bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y) == pytest.approx(
        (e.x, e.y), abs=1e-6
    )
    assert (visual.metres_per_model_unit, visual.max_fit_distortion) == (1.0, 0.05)


def test_glb_records_conventions_and_materials() -> None:
    model = build_model(fitted("conveyor"))
    document = glb_document(model.glb)
    assert document["asset"] == {"version": "2.0", "generator": GENERATOR_VERSION}
    assert document["scenes"][0]["extras"] == {
        "units": "metres",
        "up_axis": "+Y",
        "front_axis": "+Z",
        "origin": "bottom_centre",
        "generator": GENERATOR_VERSION,
    }
    assert all(set(node) == {"name", "mesh"} for node in document["nodes"])
    materials = {m["name"]: m for m in document["materials"]}
    glass = materials["polycarbonate"]
    assert glass["alphaMode"] == "BLEND"
    assert glass["pbrMetallicRoughness"]["baseColorFactor"][3] == 0.2
    grey = materials["paint_anthracite"]["pbrMetallicRoughness"]
    assert grey["baseColorFactor"] == pytest.approx([*srgb_to_linear("#3a4045"), 1.0], abs=1e-6)
    assert (grey["metallicFactor"], grey["roughnessFactor"]) == (0.25, 0.5)
    assert "alphaMode" not in materials["aluminium"]
    for primitive in (m["primitives"][0] for m in document["meshes"]):
        assert primitive["mode"] == 4
        assert document["accessors"][primitive["indices"]]["componentType"] == UNSIGNED_SHORT


def test_emissive_materials_glow_at_their_intensity() -> None:
    model = build_model(fitted("workbench"))
    materials = {m["name"]: m for m in glb_document(model.glb)["materials"]}
    assert materials["signal_white"]["emissiveFactor"] == [0.5, 0.5, 0.5]
    assert "emissiveFactor" not in materials["wood"]


def test_different_objects_give_different_models() -> None:
    models = {name: build_model(fitted(name)) for name in EXAMPLES}
    assert len({m.sha256 for m in models.values()}) == 3
    material_sets = [frozenset(m.materials) for m in models.values()]
    assert len(set(material_sets)) == 3
    assert "stainless_steel" in models["tank"].materials
    assert "hmi_screen" in models["workbench"].materials
    assert "polycarbonate" in models["conveyor"].materials


def test_the_contract_refuses_a_spec_whose_model_origin_would_be_off_centre() -> None:
    # 0.4 mm off: within the old 1 mm fit tolerance, but the glTF origin rule allows 0.1 mm.
    # The specification tolerance now equals the origin tolerance, so this cannot be a spec.
    with pytest.raises(ValidationError, match="fit the parts to the envelope first"):
        GeometrySpec.model_validate(
            {
                "format": "rws-geometry/1",
                "envelope_m": {"x": 1.0, "y": 1.0, "z": 1.0},
                "parts": [part("block", "box", "concrete", (0.0004, 0.5, 0.0), (1.0, 1.0, 1.0))],
            }
        )
    loose = draft(
        (1.0, 1.0, 1.0), [part("block", "box", "concrete", (0.0004, 0.5, 0.0), (1.0, 1.0, 1.0))]
    )
    fixed, _, _ = fit_to_envelope(loose)
    assert build_model(fixed).bounds.min.x == pytest.approx(-0.5, abs=1e-6)


def test_model_limits_are_enforced(monkeypatch: pytest.MonkeyPatch) -> None:
    spec = fitted("tank")
    monkeypatch.setattr(generator_module, "MAX_TRIANGLES", 100)
    with pytest.raises(GeneratorError, match="triangles"):
        build_model(spec)
    monkeypatch.setattr(generator_module, "MAX_TRIANGLES", 200_000)
    monkeypatch.setattr(generator_module, "MAX_GLB_BYTES", 1000)
    with pytest.raises(GeneratorError, match="bytes"):
        build_model(spec)


def test_large_meshes_switch_to_32_bit_indices() -> None:
    # Spaced apart, so no vertex is shared between boxes: 2800 * 24 vertices.
    many = shapes.merge(shapes.box((i * 0.02, 0.005, 0.0), (0.01, 0.01, 0.01)) for i in range(2800))
    assert len(many.positions) >= 65536
    glb = write_glb([("concrete", many)])
    document = glb_document(glb)
    assert document["accessors"][2]["componentType"] == UNSIGNED_INT
    assert read_glb(glb).triangles == many.triangles


def test_generator_errors_are_value_errors() -> None:
    assert issubclass(GlbError, GeneratorError)
    assert issubclass(StoreConflictError, GeneratorError)
    assert issubclass(GeneratorError, ValueError)


# --- Reading ----------------------------------------------------------------------------


def unpack(glb: bytes) -> tuple[dict[str, Any], bytes]:
    (length,) = struct.unpack_from("<I", glb, 12)
    return glb_document(glb), glb[20 + length + 8 :]


def pack(document: dict[str, Any], binary: bytes) -> bytes:
    text = json.dumps(document).encode()
    text += b" " * (-len(text) % 4)
    total = 12 + 8 + len(text) + 8 + len(binary)
    return b"".join(
        (
            struct.pack("<4sII", b"glTF", 2, total),
            struct.pack("<I4s", len(text), b"JSON"),
            text,
            struct.pack("<I4s", len(binary), b"BIN\x00"),
            binary,
        )
    )


def _set_mode(d: dict[str, Any]) -> None:
    d["meshes"][0]["primitives"][0]["mode"] = 1  # LINES


def _external_buffer(d: dict[str, Any]) -> None:
    d["buffers"][0]["uri"] = "model.bin"


def _image(d: dict[str, Any]) -> None:
    d["images"] = [{"uri": "texture.png"}]


def _node_transform(d: dict[str, Any]) -> None:
    d["nodes"][0]["translation"] = [1.0, 0.0, 0.0]


def _extension(d: dict[str, Any]) -> None:
    d["materials"][0]["extensions"] = {"KHR_materials_unlit": {}}


def _wrong_bounds(d: dict[str, Any]) -> None:
    d["accessors"][0]["max"][1] += 1.0


def _second_buffer(d: dict[str, Any]) -> None:
    d["buffers"].append({"byteLength": 4})


MUTATIONS: dict[str, tuple[Callable[[dict[str, Any]], None], str]] = {
    "non-triangle primitive": (_set_mode, "not TRIANGLES"),
    "external buffer": (_external_buffer, "'uri'"),
    "image": (_image, "'images'"),
    "node transform": (_node_transform, "transform"),
    "extension": (_extension, "'extensions'"),
    "bounds that disagree with the vertices": (_wrong_bounds, "min/max"),
    "second buffer": (_second_buffer, "own binary buffer"),
}


@pytest.fixture(scope="module")
def sample_glb() -> bytes:
    return build_model(fitted("workbench")).glb


def test_repacking_a_valid_file_still_reads(sample_glb: bytes) -> None:
    assert read_glb(pack(*unpack(sample_glb))) == read_glb(sample_glb)


@pytest.mark.parametrize("mutation", MUTATIONS)
def test_reader_refuses_what_a_generated_model_never_contains(
    sample_glb: bytes, mutation: str
) -> None:
    change, message = MUTATIONS[mutation]
    document, binary = unpack(sample_glb)
    change(document)
    with pytest.raises(GlbError, match=re.escape(message)):
        read_glb(pack(document, binary))


def test_reader_refuses_a_broken_container(sample_glb: bytes) -> None:
    with pytest.raises(GlbError, match="magic"):
        read_glb(b"gltf" + sample_glb[4:])
    with pytest.raises(GlbError, match="header says"):
        read_glb(sample_glb[:-4])
    longer = bytearray(sample_glb)
    struct.pack_into("<I", longer, 8, len(sample_glb) + 4)
    with pytest.raises(GlbError, match="header says"):
        read_glb(bytes(longer))
    with pytest.raises(GlbError, match="version"):
        read_glb(sample_glb[:4] + struct.pack("<I", 1) + sample_glb[8:])
    with pytest.raises(GlbError, match="too short"):
        read_glb(b"glTF")


# --- Storing ----------------------------------------------------------------------------


@pytest.fixture
def model() -> BuiltModel:
    return build_model(fitted("tank"))


def test_store_writes_the_model_once(tmp_path: Path, model: BuiltModel) -> None:
    catalog = tmp_path / "catalog"
    path = store_model(model, catalog)
    assert path == (catalog / model.uri).resolve()
    assert path.read_bytes() == model.glb
    first = path.stat()
    assert store_model(model, catalog) == path
    second = path.stat()
    assert (second.st_ino, second.st_mtime_ns) == (first.st_ino, first.st_mtime_ns)
    assert sorted(p.name for p in path.parent.iterdir()) == [path.name]  # no temporary files


def test_store_never_replaces_different_bytes(tmp_path: Path, model: BuiltModel) -> None:
    target = tmp_path / model.uri
    target.parent.mkdir(parents=True)
    target.write_bytes(b"someone else's file")
    with pytest.raises(StoreConflictError):
        store_model(model, tmp_path)
    assert target.read_bytes() == b"someone else's file"


def test_store_stays_inside_the_catalog_library(tmp_path: Path, model: BuiltModel) -> None:
    catalog, outside = tmp_path / "catalog", tmp_path / "outside"
    catalog.mkdir()
    outside.mkdir()
    (catalog / "generated").symlink_to(outside, target_is_directory=True)
    with pytest.raises(GeneratorError, match="outside the catalog library"):
        store_model(model, catalog)
    assert list(outside.iterdir()) == []


def test_store_refuses_a_model_whose_name_does_not_match_its_bytes(
    tmp_path: Path, model: BuiltModel
) -> None:
    forged = BuiltModel(
        glb=model.glb,
        sha256=model.sha256,
        uri="generated/../../escape.glb",
        bounds=model.bounds,
        triangles=model.triangles,
        materials=model.materials,
    )
    with pytest.raises(GeneratorError):
        store_model(forged, tmp_path)
    tampered = BuiltModel(
        glb=model.glb + b"\x00",
        sha256=model.sha256,
        uri=model.uri,
        bounds=model.bounds,
        triangles=model.triangles,
        materials=model.materials,
    )
    with pytest.raises(GeneratorError):
        store_model(tampered, tmp_path)
    assert not any(tmp_path.rglob("*.glb"))
    assert not (tmp_path.parent / "escape.glb").exists()


def test_stored_file_is_readable_by_others(tmp_path: Path, model: BuiltModel) -> None:
    path = store_model(model, tmp_path)
    assert os.stat(path).st_mode & 0o777 == 0o644
