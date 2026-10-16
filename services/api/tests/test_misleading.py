"""Misleading but unwarned revisions (GEN-09).

Three things a viewer would not notice before Apply: glass in front of a solid body that stays,
kept parts left floating, and parts the request did not mention changing anyway. The GEN-08
glass-door (t2) and floating-frame (p3) answers are development regressions here; the GEN-08
results themselves are not rescored.
"""

from __future__ import annotations

import dataclasses
import json
from pathlib import Path
from typing import Any

import pytest
from replay_world_api.assist import revisions, visibility
from replay_world_api.assist.provider import RecordedProvider
from replay_world_api.objects import fit_to_envelope
from replay_world_api.settings import Settings
from replay_world_contracts import (
    GeometryDraft,
    GeometrySpec,
    ModelRevisionProposalRequest,
    ProviderRun,
)

ROOT = Path(__file__).resolve().parents[3]
GEN08 = ROOT / "docs" / "assist-evaluation" / "gen-08"
REGRESSIONS = ROOT / "fixtures" / "gen09" / "gen08-regressions.json"
BROWSER_CASES = json.loads((ROOT / "apps" / "web" / "e2e" / "gen09-cases.json").read_text())
RUN = ProviderRun(
    service="x",
    base_url="https://x.invalid",
    model="m",
    mode="recorded",
    attempts=1,
    first_attempt_valid=True,
    latency_ms=0,
)


def gen08(case_id: str) -> Any:
    data = json.loads((GEN08 / "revisions.json").read_text())
    case = next(c for c in data["cases"] if c["id"] == case_id)
    row = json.loads((GEN08 / "results" / "qwen3-235b-a22b-instruct-2507.json").read_text())[
        "rows"
    ][case_id]
    answer = [c["answer"] for c in row["calls"] if "answer" in c][-1]
    target = data["targets"][case["target"]]
    request = ModelRevisionProposalRequest(
        name=target["name"][:80],
        spec=GeometrySpec.model_validate(target["spec"]),
        instruction=case["instruction"],
    )
    return revisions._judge(revisions._parse(answer), request, RUN).result


def kinds(result: Any) -> dict[str, set[str]]:
    out: dict[str, set[str]] = {}
    for p in result.problems:
        out.setdefault(p.kind, set()).update(p.part_ids)
    return out


def test_gen08_t2_glass_door_over_the_kept_solid_body_is_warned() -> None:
    found = kinds(gen08("t2"))
    assert found["backed_glass"] == {"door-glass", "body"}
    text = next(p.text for p in gen08("t2").problems if p.kind == "backed_glass")
    assert "solid body through it" in text and "not removed" in text


def test_gen08_p3_kept_panel_and_light_left_floating_are_warned() -> None:
    found = kinds(gen08("p3"))
    assert found["floating_kept"] == {"panel", "light"}
    # The proposal also recoloured and resized the plinth nobody mentioned: said in plain words.
    plinth = next(p.text for p in gen08("p3").problems if p.part_ids == ["plinth"])
    assert "proposal changed it" in plain(plinth) and "paint anthracite to steel dark" in plinth


def plain(text: str) -> str:
    return text.replace("\N{NO-BREAK SPACE}", " ")


def part(
    pid: str,
    center: tuple[float, ...],
    size: tuple[float, ...],
    material: str = "paint_light_grey",
    label: str | None = None,
) -> dict[str, Any]:
    return {
        "id": pid,
        "label": label or pid.replace("-", " "),
        "shape": "box",
        "material": material,
        "center_m": dict(zip("xyz", center, strict=True)),
        "size_m": dict(zip("xyz", size, strict=True)),
        "axis": None,
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


CABINET = (
    part("plinth", (0, 0.05, 0), (0.6, 0.1, 0.4), "paint_anthracite"),
    part("body", (0, 1.0, -0.01), (0.6, 1.8, 0.38), label="cabinet body"),
)
GLASS = part("door", (0, 1.0, 0.19), (0.56, 1.7, 0.02), "glass_clear", label="glass door")


def review(
    after: GeometrySpec,
    before: GeometrySpec,
    instruction: str,
    changed: set[str] | None = None,
    size: bool = False,
) -> dict[str, set[str]]:
    result = visibility.review_kept_parts(
        after, before, instruction, model_changed=changed or set(), size_asked=size
    )
    out: dict[str, set[str]] = {}
    for p in result.problems:
        out.setdefault(p.kind, set()).update(p.parts)
    return out


def test_glass_over_a_solid_body_is_warned_only_when_seeing_through_is_asked() -> None:
    before = spec((0.6, 1.9, 0.4), *CABINET)
    after = spec((0.6, 1.9, 0.4), *CABINET, GLASS)
    assert review(after, before, "replace the door with a clear glass door")["backed_glass"] == {
        "door",
        "body",
    }
    # Intentionally backed: a protective glass cover, or glass on purpose over the body.
    assert "backed_glass" not in review(after, before, "add a clear glass cover over the front")
    # The body was rebuilt as panels (an open inside): nothing to warn about.
    shell = (
        part("plinth", (0, 0.05, 0), (0.6, 0.1, 0.4), "paint_anthracite"),
        part("back", (0, 1.0, -0.19), (0.6, 1.8, 0.02)),
        part("left", (-0.29, 1.0, 0), (0.02, 1.8, 0.36)),
        part("right", (0.29, 1.0, 0), (0.02, 1.8, 0.36)),
    )
    open_after = spec((0.6, 1.9, 0.4), *shell, GLASS)
    assert "backed_glass" not in review(
        open_after, before, "replace the door with a clear glass door"
    )


def test_glass_over_a_screen_is_a_cover_not_a_misleading_window() -> None:
    screen = part("face", (0, 1.0, 0.0), (0.9, 0.6, 0.3), "hmi_screen", label="screen")
    before = spec((1.0, 1.4, 0.34), part("stand", (0, 0.35, 0), (0.1, 0.7, 0.1)), screen)
    cover = part("glass", (0, 1.0, 0.16), (0.88, 0.58, 0.02), "glass_clear", label="glass panel")
    after = spec((1.0, 1.4, 0.34), part("stand", (0, 0.35, 0), (0.1, 0.7, 0.1)), screen, cover)
    assert "backed_glass" not in review(
        after, before, "add a clear glass panel in front of the screen"
    )


def test_kept_parts_that_lose_their_support_float_but_mounted_ones_do_not() -> None:
    lamp = part("lamp", (0, 1.95, 0), (0.1, 0.1, 0.1), "signal_green", label="stack light")
    before = spec((0.6, 2.0, 0.4), *CABINET, lamp)
    # The body goes; the lamp that stood on it stays where it was.
    after = spec(
        (0.6, 2.0, 0.4), CABINET[0], part("post", (-0.29, 0.95, -0.19), (0.02, 1.7, 0.02)), lamp
    )
    assert review(after, before, "remove the body and keep a corner post")["floating_kept"] == {
        "lamp"
    }
    # Moved onto the post, it is held up again.
    held = spec(
        (0.6, 2.0, 0.4),
        CABINET[0],
        part("post", (-0.25, 0.95, -0.15), (0.1, 1.7, 0.1)),
        {**lamp, "center_m": {"x": -0.25, "y": 1.85, "z": -0.15}},
    )
    assert "floating_kept" not in review(held, before, "remove the body and keep a corner post")
    # A part the instruction says hangs is mounted on purpose (from outside the object).
    assert "floating_kept" not in review(
        after, before, "remove the body; the light hangs from the ceiling"
    )


def test_untouched_parts_are_quiet_and_an_unmentioned_change_is_said_plainly() -> None:
    before = spec((0.6, 1.9, 0.4), *CABINET)
    button = part("button", (0.2, 1.4, 0.21), (0.04, 0.04, 0.02), "estop_red", label="stop button")
    inside = spec((0.6, 1.9, 0.42), *CABINET, button)
    assert review(inside, before, "add a red stop button on the front") == {}
    # The proposal repainted and moved the plinth nobody mentioned.
    moved = {**CABINET[0], "material": "steel_dark", "center_m": {"x": 0.05, "y": 0.05, "z": 0}}
    changed = spec((0.7, 1.9, 0.42), moved, CABINET[1], button)
    found = visibility.review_kept_parts(
        changed,
        before,
        "add a red stop button on the front",
        model_changed={"plinth"},
        size_asked=False,
    )
    text = next(p.text for p in found.problems if p.part_ids == ("plinth",))
    assert (
        "the proposal changed it" in text
        and "moved 3 cm to the right" in text
        and "paint anthracite to steel dark" in text
    )


def test_a_requested_resize_is_explained_once_not_reported_part_by_part() -> None:
    before = spec((0.6, 1.9, 0.4), *CABINET)
    taller = spec((0.6, 2.2, 0.4), *[p.model_dump(mode="json") for p in before.parts])
    found = visibility.review_kept_parts(
        taller, before, "make it 30 cm taller", model_changed=set(), size_asked=True
    )
    assert found.problems == []
    assert [a.kind for a in found.adjustments] == ["scaled"]
    assert "\N{MULTIPLICATION SIGN}1.16 in height (1.90 → 2.20 m)" in found.adjustments[0].text
    # The same scaling without a size request is an unrelated change from fitting.
    unasked = visibility.review_kept_parts(
        taller, before, "paint it blue", model_changed=set(), size_asked=False
    )
    assert [p.kind for p in unasked.problems] == ["unrelated_change"]
    assert "Fitting the parts back inside" in unasked.problems[0].text


def test_a_re_centred_model_is_said_once_not_as_a_change_to_every_part() -> None:
    legs = [
        part(f"leg-{i}", (sx * 0.5, 0.35, sz * 0.25), (0.05, 0.7, 0.05))
        for i, (sx, sz) in enumerate([(-1, -1), (1, -1), (-1, 1), (1, 1)])
    ]
    top = part("top", (0, 0.72, 0), (1.1, 0.04, 0.6), "wood", label="table top")
    shelf = part("shelf", (0.75, 0.5, 0), (0.4, 0.04, 0.5), "wood", label="side shelf")
    before = spec((1.5, 0.74, 0.6), *legs, top, shelf)
    # The shelf on the right goes: the model is re-centred on the table, so in the scene every
    # kept part moves 20 cm to the right (the object stays where it was).
    after = spec((1.1, 0.74, 0.6), *legs, top)
    found = visibility.review_kept_parts(
        after, before, "remove the side shelf", model_changed=set(), size_asked=False
    )
    assert found.problems == []
    assert [a.kind for a in found.adjustments] == ["recentred"]
    assert "move 20 cm to the right" in plain(found.adjustments[0].text)


@pytest.mark.parametrize(
    ("moved", "resized", "expected"),
    [
        (
            {"x": 0.05, "y": 0.0, "z": 0.0},
            {"x": 0.0, "y": 0.0, "z": 0.0},
            "moved 5 cm to the right",
        ),
        (
            {"x": 0.0, "y": -0.12, "z": 0.0},
            {"x": 0.0, "y": -0.03, "z": 0.0},
            "moved 12 cm down; became 3 cm shorter",
        ),
        (
            {"x": 0.0, "y": 0.0, "z": 0.01},
            {"x": 0.0, "y": 0.0, "z": 0.0},
            "",
        ),  # under 2 cm: not reported
    ],
)
def test_changes_are_said_in_plain_words(
    moved: dict[str, float], resized: dict[str, float], expected: str
) -> None:
    assert visibility.describe_change(moved, resized, "wood", "wood", "box", "box") == expected


@pytest.mark.parametrize("case", BROWSER_CASES, ids=[c["label"] for c in BROWSER_CASES])
def test_the_browser_regressions_are_judged_as_expected_through_the_whole_path(
    case: dict[str, Any],
) -> None:
    """The recordings the browser test replays, asked exactly as the dialog asks, offline."""
    project = json.loads(REGRESSIONS.read_text())
    asset = next(a for a in project["catalog"] if a["name"] == case["name"])
    request = ModelRevisionProposalRequest(
        name=asset["name"][:80],
        spec=GeometrySpec.model_validate(asset["generation"]["spec"]),
        instruction=case["instruction"],
    )
    settings = Settings.from_env()
    result = revisions.propose_revision(
        RecordedProvider(dataclasses.replace(settings.assist, provider="recorded")), request
    )
    assert result.outcome == "proposal" and result.provider.mode == "recorded"
    found = {p.kind for p in result.problems}
    for kind, expected in case["expect"].items():
        assert (kind in found) is expected, (kind, [p.text for p in result.problems])
