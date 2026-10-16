"""Recognisable generated additions (GEN-06).

* Reproducibility: every model the GEN-04 and GEN-05 runs built rebuilds today to the sha256
  recorded then; a project saved before GEN-06 validates and its missing file is rebuilt to its
  recorded hash; a new asset rebuilds to its own; an unknown generator version is refused.
* Transparent parts are judged on the composited picture, not on raw pixels.
* A small requested part with no size given is enlarged within bounds, as an estimate; a size
  the user gave is never changed; pieces of one assembly are left as drawn.
* Touch tolerance depends on the parts; colour clauses carry their verb across "and".
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

import pytest
from replay_world_api.assist import visibility
from replay_world_api.generated_assets import create_generated_asset, restore_generated_models
from replay_world_api.objects import GeneratorError, build_model, fit_to_envelope
from replay_world_contracts import (
    GeneratedAssetRequest,
    GeometryDraft,
    GeometrySpec,
    GltfVisual,
    Project,
)

ROOT = Path(__file__).resolve().parents[3]
EVALUATIONS = ROOT / "docs" / "assist-evaluation"
LEGACY = ROOT / "fixtures" / "legacy" / "generated-0.7.0-pre-gen06.json"


# --- Reproducibility ---------------------------------------------------------------------------


def recorded_models() -> list[tuple[str, dict[str, Any], str]]:
    out = []
    for run in ("gen-04", "gen-05"):
        rows = json.loads(
            (EVALUATIONS / run / "results" / "qwen3-235b-a22b-instruct-2507.json").read_text()
        )["rows"]
        for case, row in rows.items():
            if row.get("model_sha256"):
                out.append((f"{run}/{case}", row["result"]["spec"], row["model_sha256"]))
    return out


@pytest.mark.parametrize(
    ("case", "spec", "sha256"),
    recorded_models(),
    ids=lambda v: v if isinstance(v, str) and "/" in v else "",
)
def test_every_model_built_in_the_gen04_and_gen05_runs_rebuilds_byte_identically(
    case: str, spec: dict[str, Any], sha256: str
) -> None:
    # Built (and hashed) by the generator as it was on the day of each run, transparent parts
    # included; the GEN-06 edge lines are drawn by the viewer and do not change these bytes.
    assert build_model(GeometrySpec.model_validate(spec)).sha256 == sha256, case


def test_a_project_saved_before_gen06_validates_and_its_missing_model_is_rebuilt(
    tmp_path: Path,
) -> None:
    project = Project.model_validate_json(LEGACY.read_text())
    asset = next(a for a in project.catalog if a.id.startswith("asset-gen-display-rack"))
    assert asset.generation is not None and asset.generation.generator == "rws-object-generator/1"
    assert any(p.material == "polycarbonate" for p in asset.generation.spec.parts)
    report = restore_generated_models(project, tmp_path)
    rebuilt = next(r for r in report.results if r.asset_id == asset.id)
    assert rebuilt.status == "restored"
    assert isinstance(asset.visual, GltfVisual)
    assert (tmp_path / asset.visual.uri).is_file()  # named by the sha256 recorded before GEN-06


def test_a_new_asset_rebuilds_to_its_own_hash_and_an_unknown_generator_is_refused(
    tmp_path: Path,
) -> None:
    project = json.loads(LEGACY.read_text())
    old = next(a for a in project["catalog"] if a["id"].startswith("asset-gen-display-rack"))
    entered = {"basis": "entered", "quote": None, "confirmed": True, "source_ref": None}
    request = GeneratedAssetRequest.model_validate(
        {
            "name": "Display rack (new)",
            "kind": "equipment",
            "method": "builder",
            "description": None,
            "language_model": None,
            "spec": old["generation"]["spec"],
            "dimensions": {"width": entered, "height": entered, "depth": entered},
            "stated_facts": [],
            "inferred_facts": [],
            "not_modelled": [],
        }
    )
    new = create_generated_asset(request, tmp_path / "made")
    # The same specification made today gives the same bytes as before GEN-06.
    assert isinstance(new.visual, GltfVisual)
    assert new.visual.sha256 == old["visual"]["sha256"]
    shutil.rmtree(tmp_path / "made")
    project["catalog"].append(new.model_dump(mode="json"))
    report = restore_generated_models(Project.model_validate(project), tmp_path / "restored")
    # The same bytes: restoring the old asset's file also restores the new one's (one file).
    assert {r.status for r in report.results} <= {"restored", "present"}
    assert all(r.status != "mismatch" for r in report.results)
    with pytest.raises(GeneratorError):
        build_model(new.generation.spec, generator="rws-object-generator/9")  # type: ignore[union-attr]


# --- Transparent parts on the composited picture -----------------------------------------------


def part(
    pid: str,
    center: tuple[float, ...],
    size: tuple[float, ...],
    material: str = "wood",
    shape: str = "box",
) -> dict[str, Any]:
    return {
        "id": pid,
        "label": pid.replace("-", " "),
        "shape": shape,
        "material": material,
        "center_m": dict(zip("xyz", center, strict=True)),
        "size_m": dict(zip("xyz", size, strict=True)),
        "axis": "y" if shape == "cylinder" else None,
        "taper": None,
        "narrow_end": None,
        "basis": "inferred",
    }


def spec(envelope: tuple[float, float, float], *parts: dict[str, Any]) -> GeometrySpec:
    draft = {
        "format": "rws-geometry/1",
        "envelope_m": dict(zip("xyz", envelope, strict=True)),
        "parts": list(parts),
    }
    return fit_to_envelope(GeometryDraft.model_validate(draft))[0]


TABLE = (
    part("leg-1", (-0.55, 0.36, -0.25), (0.05, 0.72, 0.05), "steel_dark"),
    part("leg-2", (0.55, 0.36, -0.25), (0.05, 0.72, 0.05), "steel_dark"),
    part("leg-3", (-0.55, 0.36, 0.25), (0.05, 0.72, 0.05), "steel_dark"),
    part("leg-4", (0.55, 0.36, 0.25), (0.05, 0.72, 0.05), "steel_dark"),
)


def kinds(after: GeometrySpec, before: GeometrySpec, instruction: str) -> dict[str, str]:
    return {
        pid: p.kind for p in visibility.find_problems(after, before, instruction) for pid in p.parts
    }


def test_a_glass_top_counts_as_shown_from_its_composited_edges_and_surface() -> None:
    before = spec((1.2, 0.75, 0.6), part("top", (0, 0.735, 0), (1.2, 0.03, 0.6)), *TABLE)
    glass = spec(
        (1.2, 0.75, 0.6), part("glass-top", (0, 0.735, 0), (1.2, 0.03, 0.6), "glass_clear"), *TABLE
    )
    assert kinds(glass, spec((1.2, 0.72, 0.6), *TABLE), "add a glass top") == {}
    view = visibility.render(glass)
    i = next(k for k, p in enumerate(glass.parts) if p.id == "glass-top")
    dark = visibility.outline_share(view, glass, i)
    light = visibility.outline_share(view, glass, i, background="#eef0f2")
    # On the dialog's dark ground both its edges and its surface show; on a light ground only the
    # edges do, so it scores less there (the GEN-05 renders were light).
    assert dark >= visibility.EDGE_SHARE and light < dark
    del before


def test_a_glass_panel_behind_an_opaque_one_is_not_shown_by_its_raw_pixels() -> None:
    front = part("front-panel", (0, 0.5, 0.2), (1.0, 1.0, 0.02), "paint_light_grey")
    back = part("back-panel", (0, 0.5, 0.18), (0.98, 0.98, 0.01), "glass_clear")
    current = spec(
        (1.0, 1.0, 0.42), part("base", (0, 0.5, -0.1), (1.0, 1.0, 0.22), "paint_anthracite"), front
    )
    after = spec((1.0, 1.0, 0.42), *[p.model_dump(mode="json") for p in current.parts], back)
    assert kinds(after, current, "add a glass back panel behind the front panel") == {
        "back-panel": "unseen"
    }


# --- Small parts: bounded enlargement, explicit sizes kept, assemblies left as drawn ------------


def screen() -> GeometrySpec:
    return spec(
        (1.1, 1.43, 0.4),
        part("base", (0, 0.025, 0), (0.6, 0.05, 0.4), "plastic_black"),
        part("pole", (0, 0.55, -0.05), (0.06, 1.0, 0.06), "aluminium", "cylinder"),
        part("frame", (0, 1.1, 0), (1.1, 0.66, 0.07), "plastic_black"),
    )


def with_light(size: float) -> GeometrySpec:
    """A status light standing on the base plate, with room above it."""
    current = screen()
    light = part(
        "light", (0.2, 0.05 + size / 2, 0.1), (size, size, size), "signal_green", "cylinder"
    )
    return spec((1.1, 1.43, 0.4), *[p.model_dump(mode="json") for p in current.parts], light)


def test_a_small_requested_part_with_no_size_is_enlarged_within_bounds_as_an_estimate() -> None:
    after = with_light(0.02)
    grown, notes = visibility.enlarge_small(
        after, screen(), "add a small green status light on the base"
    )
    light = next(p for p in grown.parts if p.id == "light")
    # 5 % of the largest side would be 7 cm; three times 2 cm is the bound here.
    assert light.size_m.x == pytest.approx(0.06) and light.size_m.y == pytest.approx(0.06)
    # It still stands on the base (the face that touches it stays put), inside the envelope.
    assert light.center_m.y - light.size_m.y / 2 == pytest.approx(0.05, abs=1e-6)
    assert grown.envelope_m == after.envelope_m
    assert notes[0].kind == "enlarged" and "estimate, not a measurement" in notes[0].text


def test_a_small_part_with_no_room_inside_the_recorded_size_is_reported_not_squeezed() -> None:
    # On top of the frame, at the very top of the object: growing would change the recorded
    # height, so it is not enlarged (and is reported as too small to see).
    current = screen()
    light = part("light", (0.3, 1.44, 0), (0.02, 0.02, 0.02), "signal_green", "cylinder")
    after = spec((1.1, 1.45, 0.4), *[p.model_dump(mode="json") for p in current.parts], light)
    grown, notes = visibility.enlarge_small(after, current, "add a small green status light on top")
    assert notes == [] and grown == after
    assert kinds(after, current, "add a small green status light on top") == {"light": "tiny"}


def test_a_size_the_user_gave_is_never_enlarged() -> None:
    after = with_light(0.02)
    grown, notes = visibility.enlarge_small(
        after, screen(), "add a 2 cm green status light on the base"
    )
    assert notes == [] and grown == after
    assert kinds(after, screen(), "add a 2 cm green status light on the base") == {}


def test_pieces_of_one_requested_assembly_are_left_as_drawn() -> None:
    current = screen()
    lamp = [
        part("lamp-base", (0.3, 1.44, 0), (0.03, 0.02, 0.03), "plastic_black"),
        part("lamp-head", (0.3, 1.46, 0), (0.03, 0.02, 0.03), "paint_white"),
    ]
    after = spec((1.1, 1.47, 0.4), *[p.model_dump(mode="json") for p in current.parts], *lamp)
    assert visibility.enlarge_small(after, current, "add a desk lamp on top")[1] == []


def test_enlargement_never_grows_past_twelve_centimetres() -> None:
    # A long bench with a taller back panel, so there is room above the button.
    body = part("body", (0, 0.4, 0), (3.0, 0.8, 1.0), "paint_light_grey")
    back = part("back", (0, 0.5, -0.45), (3.0, 1.0, 0.1), "paint_light_grey")
    bench = spec((3.0, 1.0, 1.0), body, back)
    button = part("button", (1.0, 0.825, 0.3), (0.05, 0.05, 0.05), "estop_red", "cylinder")
    after = spec((3.0, 1.0, 1.0), body, back, button)
    grown, _ = visibility.enlarge_small(after, bench, "add a red button on top")
    grown_button = next(p for p in grown.parts if p.id == "button")
    assert grown_button.size_m.x == pytest.approx(0.12)  # 5 % of 3 m is 15 cm; 12 cm is the cap


# --- Touch tolerance and colour clauses ---------------------------------------------------------


def test_touching_depends_on_the_parts_a_slat_gap_touches_a_detached_light_does_not() -> None:
    post = GeometrySpec.model_validate(
        spec(
            (0.5, 0.95, 0.5),
            part("post", (-0.234, 0.475, 0), (0.033, 0.95, 0.06), "steel_dark"),
            part("slat", (0.0, 0.8, 0), (0.402, 0.06, 0.06), "fabric_grey"),
            part("right", (0.234, 0.475, 0), (0.033, 0.95, 0.06), "steel_dark"),
        ).model_dump(mode="json")
    ).parts
    base = 0.01 + 0.006 * 0.95
    assert visibility._touches(post[1], post[0], visibility.touch_tolerance(post[1], post[0], base))
    stack = spec(
        (2.2, 1.12, 0.6),
        part("frame", (0, 0.75, 0), (2.2, 0.033, 0.6), "stainless_steel"),
        part("legs", (0, 0.367, 0), (2.0, 0.733, 0.5), "steel_dark"),
        part("light", (1.05, 1.0, 0), (0.06, 0.24, 0.06), "signal_green", "cylinder"),
    ).parts
    base = 0.01 + 0.006 * 2.2
    assert not visibility._touches(
        stack[2], stack[0], visibility.touch_tolerance(stack[2], stack[0], base)
    )


@pytest.mark.parametrize(
    ("instruction", "expected"),
    [
        (
            "make the legs black and the armrests dark blue fabric",
            {"leg": ["black"], "armrest": ["blue"]},
        ),
        (
            "make the armrests dark blue fabric and the legs black",
            {"armrest": ["blue"], "leg": ["black"]},
        ),
        ("paint the frame red and white", {"frame": ["red", "white"]}),
        ("give the armrests a dark blue colour", {"armrest": ["blue"]}),
    ],
)
def test_elliptical_and_joined_colour_clauses(
    instruction: str, expected: dict[str, list[str]]
) -> None:
    found = {visibility._stem(n.head): n.colours for n in visibility.named_colours(instruction)}
    assert found == expected


def test_the_requested_blue_is_drawn_and_only_the_fabric_texture_is_listed() -> None:
    sofa = spec(
        (1.9, 0.84, 0.85),
        part("base", (0, 0.25, 0), (1.9, 0.3, 0.85), "fabric_grey"),
        part("arm-l", (-0.85, 0.5, 0), (0.2, 0.3, 0.85), "fabric_grey"),
        part("arm-r", (0.85, 0.5, 0), (0.2, 0.3, 0.85), "fabric_grey"),
        part("leg", (0, 0.05, 0), (1.8, 0.1, 0.8), "plastic_black"),
        part("back", (0, 0.75, -0.35), (1.9, 0.18, 0.15), "fabric_grey"),
    )
    renamed = GeometrySpec.model_validate(
        sofa.model_dump(mode="json")
        | {
            "parts": [
                p | {"label": "armrest"} if p["id"].startswith("arm") else p
                for p in sofa.model_dump(mode="json")["parts"]
            ]
        }
    )
    result = visibility.honour_colours(
        renamed, renamed, "make the legs black and the armrests dark blue fabric"
    )
    arms = [p for p in result.spec.parts if p.id.startswith("arm")]
    assert all(p.material == "paint_blue" for p in arms)
    assert result.texture_limits == [
        "“blue fabric”: the fabric texture is not shown; the colour is."
    ]
    joined = visibility.honour_colours(renamed, renamed, "paint the base red and white")
    assert [p.material for p in joined.spec.parts if p.id == "base"] == ["paint_red"]
    assert joined.texture_limits == [
        "“base red and white”: one part shows one colour; white is not shown, red is."
    ]
