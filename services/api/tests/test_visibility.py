"""Visible, time-bounded revisions (GEN-05).

Added parts must be seen: not hidden inside another part, not sunk into one of the same
material, not floating, not covered from the usual view, and in the colour the user named (or
one that stands out when no colour was named). The model gets one shared corrected answer within
one time budget; what it cannot fix is shown as a problem before Apply. Cancelling stops further
provider calls and discards a late answer. A scripted fake provider and a fake clock make every
path deterministic.
"""

from __future__ import annotations

import dataclasses
import json
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

import pytest
from replay_world_api.assist import visibility
from replay_world_api.assist.provider import Completion, ProviderError, RecordedProvider, Task
from replay_world_api.assist.revisions import Cancelled, propose_revision
from replay_world_api.objects import fit_to_envelope
from replay_world_api.settings import Settings
from replay_world_contracts import (
    GeometryDraft,
    GeometrySpec,
    ModelRevisionProposalRequest,
    ModelRevisionProposalResult,
)


def part(
    pid: str,
    center: tuple[float, float, float],
    size: tuple[float, float, float],
    material: str = "wood",
    shape: str = "box",
    **extra: Any,
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
    } | extra


def table() -> GeometrySpec:
    """A wooden table top on four steel legs: 1.2 x 0.75 x 0.6 m."""
    legs = [
        part(f"leg-{i}", (x, 0.36, z), (0.05, 0.72, 0.05), "steel_dark")
        for i, (x, z) in enumerate(((-0.55, -0.25), (0.55, -0.25), (-0.55, 0.25), (0.55, 0.25)))
    ]
    draft = {
        "format": "rws-geometry/1",
        "envelope_m": {"x": 1.2, "y": 0.75, "z": 0.6},
        "parts": [part("top", (0, 0.735, 0), (1.2, 0.03, 0.6)), *legs],
    }
    return fit_to_envelope(GeometryDraft.model_validate(draft))[0]


def seat() -> GeometrySpec:
    """A grey fabric bench seat on a plinth: 1.0 x 0.5 x 0.5 m."""
    draft = {
        "format": "rws-geometry/1",
        "envelope_m": {"x": 1.0, "y": 0.5, "z": 0.5},
        "parts": [
            part("plinth", (0, 0.05, 0), (0.9, 0.1, 0.45), "steel_dark"),
            part("seat", (0, 0.3, 0), (1.0, 0.4, 0.5), "fabric_grey", "rounded_box"),
        ],
    }
    return fit_to_envelope(GeometryDraft.model_validate(draft))[0]


def plus(current: GeometrySpec, *added: dict[str, Any]) -> GeometrySpec:
    """The current model with parts added (inside its width and depth); the height grows to
    the tallest part, as the fitted proposal would."""
    parts = [p.model_dump(mode="json") for p in current.parts] + list(added)
    top = max(p["center_m"]["y"] + p["size_m"]["y"] / 2 for p in parts)
    envelope = current.envelope_m.model_dump() | {"y": round(top, 6)}
    return GeometrySpec.model_validate(
        {"format": "rws-geometry/1", "envelope_m": envelope, "parts": parts}
    )


def kinds(spec: GeometrySpec, current: GeometrySpec, instruction: str) -> dict[str, str]:
    return {p.part_id: p.kind for p in visibility.find_problems(spec, current, instruction)}


# --- Geometry and render checks ----------------------------------------------------------------


def test_a_part_wholly_inside_another_is_hidden() -> None:
    button = part("button", (0.3, 0.735, 0.1), (0.06, 0.02, 0.06), "estop_red", "cylinder")
    assert kinds(plus(table(), button), table(), "add a red stop button") == {"button": "hidden"}
    on_top = part("button", (0.3, 0.76, 0.1), (0.06, 0.02, 0.06), "estop_red", "cylinder")
    assert kinds(plus(table(), on_top), table(), "add a red stop button") == {}


def test_a_part_sunk_into_one_of_the_same_material_is_buried() -> None:
    cushion = part("cushion", (0, 0.48, 0.05), (0.4, 0.08, 0.35), "fabric_grey")
    assert kinds(plus(seat(), cushion), seat(), "add a grey cushion") == {"cushion": "buried"}
    # Resting on top instead, it is a separate part (here a contrasting colour, as asked).
    resting = part("cushion", (0, 0.5 + 0.04, 0.05), (0.4, 0.08, 0.35), "paint_blue")
    spec = plus(seat(), resting)
    assert kinds(spec, seat(), "add a blue cushion") == {}


def test_a_part_touching_nothing_that_rests_on_the_floor_floats() -> None:
    lamp = part("lamp", (0, 1.2, 0), (0.2, 0.2, 0.2), "paint_white", "sphere")
    spec = plus(table(), lamp)
    assert kinds(spec, table(), "add a lamp above it") == {"lamp": "floating"}
    # A lamp the user says hangs (from a ceiling outside the object) is a legitimate exception.
    assert kinds(spec, table(), "add a lamp hanging above it") == {}
    # On a post that stands on the top, it is supported through the post.
    post = part("lamp-post", (0, 0.925, 0), (0.03, 0.35, 0.03), "steel_dark", "cylinder")
    assert (
        kinds(
            plus(table(), lamp, post),
            table(),
            "add a lamp on a post",
        )
        == {}
    )


def test_framed_and_spanning_parts_are_supported_by_what_holds_them() -> None:
    # A glass panel held between two legs, and a round rail spanning between the two front legs.
    glass = part("glass-panel", (0, 0.4, -0.25), (1.05, 0.5, 0.01), "glass_clear")
    rail = part("rail", (0, 0.2, 0.25), (1.05, 0.03, 0.03), "aluminium", "cylinder", axis="x")
    assert kinds(plus(table(), glass, rail), table(), "add a glass panel and a rail") == {}


def test_a_tiny_requested_addition_with_no_size_given_is_too_small_to_see() -> None:
    light = part("status-light", (0.5, 0.76, 0.2), (0.02, 0.02, 0.02), "signal_green", "cylinder")
    assert kinds(plus(table(), light), table(), "add a green status light") == {
        "status-light": "tiny"
    }
    # A size the user gave is kept as asked.
    assert kinds(plus(table(), light), table(), "add a 2 cm green status light") == {}


def test_a_part_covered_from_the_usual_view_is_unseen() -> None:
    tray = part("cable-tray", (0, 0.69, -0.1), (0.6, 0.05, 0.2), "plastic_grey")
    found = kinds(plus(table(), tray), table(), "add a cable tray under the top")
    assert found == {"cable-tray": "unseen"}
    # At the front edge, below the top, it can be seen.
    front = part("cable-tray", (0, 0.5, 0.25), (0.6, 0.05, 0.05), "plastic_grey")
    shelf = part("bracket", (0, 0.6225, 0.25), (0.04, 0.195, 0.04), "steel_dark")
    assert kinds(plus(table(), front, shelf), table(), "add a cable tray at the front") == {}


def test_slats_asked_for_with_gaps_are_not_one_board_per_side() -> None:
    box = GeometrySpec.model_validate(
        {
            "format": "rws-geometry/1",
            "envelope_m": {"x": 0.6, "y": 0.4, "z": 0.4},
            "parts": [part("bottom", (0, 0.01, 0), (0.6, 0.02, 0.4))]
            + [
                part(f"post-{i}", (x, 0.2, z), (0.02, 0.4, 0.02))
                for i, (x, z) in enumerate(
                    ((-0.29, -0.19), (0.29, -0.19), (-0.29, 0.19), (0.29, 0.19))
                )
            ],
        }
    )
    boards = [
        part("left-slat", (-0.29, 0.21, 0), (0.02, 0.38, 0.4)),
        part("right-slat", (0.29, 0.21, 0), (0.02, 0.38, 0.4)),
    ]
    assert set(kinds(plus(box, *boards), box, "make it a crate of slats with gaps").values()) == {
        "solid_slats"
    }
    slats = [
        part(f"slat-{i}", (-0.29, 0.21, z), (0.02, 0.38, 0.08))
        for i, z in enumerate((-0.15, 0, 0.15))
    ]
    assert kinds(plus(box, *slats), box, "make it a crate of slats with gaps") == {}


def test_membership_follows_each_shape() -> None:
    def one(shape: str, **extra: Any) -> Any:
        return GeometrySpec.model_validate(
            {
                "format": "rws-geometry/1",
                "envelope_m": {"x": 1, "y": 1, "z": 1},
                "parts": [part("p", (0, 0.5, 0), (1, 1, 1), "wood", shape, **extra)],
            }
        ).parts[0]

    corner = (0.45, 0.95, 0.45)
    assert visibility._inside(one("box"), corner)
    assert not visibility._inside(one("sphere"), corner)
    assert not visibility._inside(one("cylinder", axis="y"), corner)
    assert visibility._inside(one("cylinder", axis="y"), (0.3, 0.95, 0.3))
    cone = one("frustum", taper=0.0, narrow_end="top")
    assert visibility._inside(cone, (0.4, 0.05, 0)) and not visibility._inside(cone, (0.4, 0.9, 0))


# --- Colours -----------------------------------------------------------------------------------


def test_a_named_colour_is_honoured_and_only_a_missing_texture_is_listed() -> None:
    cushion = part("cushion", (0, 0.54, 0.05), (0.4, 0.08, 0.35), "fabric_grey")
    spec = plus(seat(), cushion)
    red = visibility.honour_colours(spec, seat(), "add a red fabric cushion on the seat")
    assert next(p for p in red.spec.parts if p.id == "cushion").material == "paint_red"
    assert red.notes == ["Coloured “cushion” red, as asked."]
    assert red.texture_limits == [
        "“red fabric cushion”: the fabric texture is not shown; the colour is."
    ]
    # The seat it rests on is not repainted, and a colour already shown is left alone.
    assert next(p for p in red.spec.parts if p.id == "seat").material == "fabric_grey"
    kept = visibility.honour_colours(red.spec, seat(), "add a red cushion on the seat")
    assert kept.notes == [] and kept.honoured == {"red"}


def test_an_unnamed_addition_that_blends_in_gets_a_contrasting_finish() -> None:
    # Half sunk into a seat of the same grey fabric (as in GEN-04's sofa), it cannot be told apart.
    sunk = part("cushion", (0, 0.5, 0.05), (0.4, 0.08, 0.35), "fabric_grey")
    spec = plus(seat(), sunk)
    changed, notes = visibility.contrast_additions(spec, seat(), set())
    material = next(p for p in changed.parts if p.id == "cushion").material
    assert material in visibility.CONTRAST_FINISHES
    assert notes and "no colour was asked for" in notes[0]
    # A named colour is never overridden, and glass stays transparent.
    assert visibility.contrast_additions(spec, seat(), {"cushion"})[1] == []
    glass = plus(seat(), part("cover", (0, 0.51, 0), (0.9, 0.02, 0.45), "glass_clear"))
    assert visibility.contrast_additions(glass, seat(), set())[1] == []
    # Resting on top with its outline against the background, it is already seen as it is.
    resting = plus(seat(), part("cushion", (0, 0.54, 0.05), (0.4, 0.08, 0.35), "fabric_grey"))
    assert visibility.contrast_additions(resting, seat(), set())[1] == []


# --- One shared retry, one budget, cancellation ------------------------------------------------


@dataclass
class Clocked:
    """A fake provider on a fake clock: each call takes ``durations[i]`` seconds, or raises."""

    answers: list[str | ProviderError]
    durations: list[float]
    now: float = 0.0
    service: str = "Fake provider"
    base_url: str = "https://fake.invalid/v1"
    model: str = "fake-model"
    mode: Literal["live", "recorded"] = "recorded"
    timeouts: list[float | None] = field(default_factory=list)
    messages: list[list[dict[str, str]]] = field(default_factory=list)
    on_call: Any = None

    def clock(self) -> float:
        return self.now

    def complete(
        self,
        *,
        task: Task,
        key: str,
        messages: list[dict[str, str]],
        schema: dict[str, Any],
        attempt: int,
        timeout_s: float | None = None,
    ) -> Completion:
        self.timeouts.append(timeout_s)
        self.messages.append(list(messages))
        self.now += self.durations[min(attempt, len(self.durations) - 1)]
        if self.on_call is not None:
            self.on_call()
        answer = self.answers[min(attempt, len(self.answers) - 1)]
        if isinstance(answer, ProviderError):
            raise answer
        return Completion(answer, latency_ms=1)


def table_answer(*added: dict[str, Any], **fields: Any) -> str:
    answer = {
        "outcome": "revision",
        "message": None,
        "summary": "Added as asked.",
        "envelope_m": {"x": 1.2, "y": 0.75, "z": 0.6},
        "remove": [],
        "change": [],
        "add": [p | {"axis": p["axis"] or "y"} for p in added],
        "repeat": [],
        "not_representable": [],
    } | fields
    return json.dumps(answer)


HIDDEN = part("button", (0.3, 0.735, 0.1), (0.06, 0.02, 0.06), "estop_red", "cylinder")
SHOWN = part("button", (0.3, 0.76, 0.1), (0.06, 0.02, 0.06), "estop_red", "cylinder")
UNDER = part("tray", (0, 0.69, -0.1), (0.6, 0.05, 0.2), "plastic_grey")
ASK = "add a red stop button and a tray"


def request(instruction: str = ASK) -> ModelRevisionProposalRequest:
    return ModelRevisionProposalRequest(name="Table", spec=table(), instruction=instruction)


def test_every_problem_shares_one_corrected_answer_and_what_remains_is_shown() -> None:
    fake = Clocked([table_answer(HIDDEN, UNDER), table_answer(SHOWN, UNDER)], [30, 30])
    result = propose_revision(fake, request(), clock=fake.clock)
    assert len(fake.messages) == 2 and result.provider.attempts == 2
    feedback = fake.messages[1][-1]["content"]
    assert "button" in feedback and "tray" in feedback  # both problems, one message
    assert result.outcome == "proposal"
    assert result.problems == [
        next(p.text for p in visibility.find_problems(result.spec, table(), ASK))  # type: ignore[arg-type]
    ]
    assert "tray" in result.problems[0] and "button" not in " ".join(result.problems)
    # The budget is one: the second call may only use what the first left.
    assert fake.timeouts == [150.0, 120.0]


def test_no_retry_when_the_budget_cannot_cover_one_and_the_problems_are_shown() -> None:
    fake = Clocked([table_answer(HIDDEN)], [140])
    result = propose_revision(fake, request("add a red stop button"), clock=fake.clock)
    assert len(fake.messages) == 1
    assert result.outcome == "proposal" and result.problems
    assert "hidden inside" in result.problems[0]
    assert any(
        c.startswith("Not asked to correct this: 10 s of the 150 s limit") for c in result.checks
    )


def test_a_corrected_answer_that_runs_out_of_time_leaves_the_first_one_with_its_problems() -> None:
    late = ProviderError("timeout", "Fake provider did not answer within 100 s.")
    fake = Clocked([table_answer(HIDDEN), late], [30, 120])
    result = propose_revision(fake, request("add a red stop button"), clock=fake.clock)
    assert result.outcome == "proposal" and "hidden inside" in result.problems[0]
    assert any("did not arrive within the 150 s limit" in c for c in result.checks)
    # A first answer that never arrives is a timeout for the user (504), not a guess.
    with pytest.raises(ProviderError):
        never = Clocked([late], [150])
        propose_revision(never, request(), clock=never.clock)


def test_an_unusable_first_answer_uses_the_one_retry() -> None:
    fake = Clocked(["{not json", table_answer(HIDDEN)], [20, 20])
    result = propose_revision(fake, request("add a red stop button"), clock=fake.clock)
    # The retry was spent on the unusable answer, so the hidden button is shown as a problem.
    assert len(fake.messages) == 2 and "hidden inside" in result.problems[0]


def test_cancelling_stops_further_calls_and_discards_a_late_answer() -> None:
    stop = threading.Event()
    stop.set()
    before = Clocked([table_answer(SHOWN)], [10])
    with pytest.raises(Cancelled):
        propose_revision(before, request(), cancelled=stop, clock=before.clock)
    assert before.messages == []
    # Cancelled while the first answer was on its way: the answer is discarded, no retry.
    during = threading.Event()
    late = Clocked([table_answer(HIDDEN), table_answer(SHOWN)], [10, 10], on_call=during.set)
    with pytest.raises(Cancelled):
        propose_revision(late, request(), cancelled=during, clock=late.clock)
    assert len(late.messages) == 1


def test_a_proposal_without_problems_says_nothing_extra() -> None:
    fake = Clocked([table_answer(SHOWN)], [10])
    result = propose_revision(fake, request("add a red stop button"), clock=fake.clock)
    assert (result.outcome, result.problems, len(fake.messages)) == ("proposal", [], 1)


# --- Recorded live answers (gen-05.1), replayed offline -----------------------------------------

ROOT = Path(__file__).resolve().parents[3]
CASES = {
    c["label"]: c for c in json.loads((ROOT / "scripts" / "model_revision_cases.json").read_text())
}


def replay(label: str) -> ModelRevisionProposalResult:
    settings = Settings.from_env()
    provider = RecordedProvider(dataclasses.replace(settings.assist, provider="recorded"))
    case = CASES[label]
    request = ModelRevisionProposalRequest(
        name=case["name"][:80],
        spec=GeometrySpec.model_validate(case["spec"]),
        instruction=case["instruction"],
    )
    return propose_revision(provider, request)


def test_recorded_the_hidden_stop_button_is_fixed_by_the_one_corrected_answer() -> None:
    result = replay("gen04-stop-button")
    assert result.provider.attempts == 2 and result.outcome == "proposal"
    assert not any("hidden inside" in p for p in result.problems)
    button = [p for p in result.spec.parts if "button" in p.label]  # type: ignore[union-attr]
    assert button and all(p.material == "estop_red" for p in button)


def test_recorded_a_stack_light_still_floating_after_the_retry_is_shown_as_a_problem() -> None:
    result = replay("gen04-stack-light")
    assert result.provider.attempts == 2
    assert "“stack light” does not touch anything that holds it up; it floats." in result.problems


def test_recorded_a_tray_placed_under_the_top_as_asked_is_reported_not_retried_again() -> None:
    # The first answer put the tray inside the worktop (hidden): the one retry moved it under
    # the top, where the user asked for it. That place cannot be seen from the usual view, which
    # is said plainly; it is not a reason to ask again.
    result = replay("gen04-cable-tray")
    assert result.provider.attempts == 2
    assert len(result.problems) == 1
    assert result.problems[0].startswith("“cable tray” where you asked for it cannot be seen")
    assert result.spec is not None
    case = CASES["gen04-cable-tray"]
    current = GeometrySpec.model_validate(case["spec"])
    tray = visibility.find_problems(result.spec, current, case["instruction"])[0]
    assert tray.kind == "unseen" and not tray.retry
