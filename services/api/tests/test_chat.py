"""Chat interpretation (UX-03, AGT-01): one message becomes one bounded, checked action.

Recorded live answers replay offline (never live AI). The checks hold whatever the model says:
ids must be objects in the scene, a width counts only when the message states it, ambiguous
names become questions with clickable candidates, and anything else is refused with a reason.
"""

from __future__ import annotations

import json
import sys
from collections.abc import Iterator
from pathlib import Path
from typing import Any, Literal

import pytest
from fastapi.testclient import TestClient
from replay_world_api.app import create_app
from replay_world_api.assist.chat import interpret_chat
from replay_world_api.assist.provider import Completion
from replay_world_api.settings import AssistSettings, Settings
from replay_world_contracts import ChatRequest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts"))
from record_chat import (  # type: ignore[import-not-found]  # noqa: E402
    EMPTY,
    SAMPLE,
    SAMPLE_CASES,
    STATE,
    context_of,
)

PROJECTS = {"sample": json.loads(SAMPLE.read_text()), "empty": EMPTY}


def body(message: str, which: str = "sample", **state: bool) -> dict[str, Any]:
    return {
        "request": message,
        "context": context_of(PROJECTS[which], None),
        "state": {**STATE, **state},
    }


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    settings = Settings(sources_dir=tmp_path, assist=AssistSettings(provider="recorded"))
    with TestClient(create_app(settings)) as c:
        yield c


EXPECTED = {
    "move-machine-b": ("plan", "move"),
    "move-machine-b-forward": ("plan", "move"),
    "ambiguous-rack": ("plan", "move"),  # the move step asks which rack
    "ambiguous-rack-chosen": ("plan", "move"),
    "route-fit": ("plan", "check_route"),
    "route-cart": ("plan", "check_route"),
    "run-shift": ("plan", "run_day"),
    "run-again": ("plan", "run_again"),
    "why-changed": ("plan", "explain_change"),
    "undo": ("plan", "undo"),
    "capabilities": ("plan", "capabilities"),
    "unsupported-colour": ("unsupported", None),
    "hostile": ("unsupported", None),
    "show-example": ("plan", "show_example"),
}


@pytest.mark.parametrize("case", SAMPLE_CASES, ids=[c[0] for c in SAMPLE_CASES])
def test_recorded_answers_replay_as_checked_actions(client: TestClient, case: Any) -> None:
    name, message, _selected, which, state = case
    response = client.post("/api/v1/assist/chat", json=body(message, which, **state))
    assert response.status_code == 200, response.text
    result = response.json()
    first = result["steps"][0]["action"] if result["steps"] else None
    assert (result["outcome"], first) == EXPECTED[name]
    assert result["provider"]["mode"] == "recorded"


def test_the_details_are_the_ones_in_the_words(client: TestClient) -> None:
    move = client.post("/api/v1/assist/chat", json=body("Move Machine B 1 metre right")).json()
    step = move["steps"][0]
    assert step["target_id"] == "obj-dxf-111"
    assert step["move"] == {"direction": "right", "distance": 1.0, "unit": "m", "quote": "1 metre"}
    ask = client.post("/api/v1/assist/chat", json=body("Move the rack 1 m back")).json()
    need = ask["steps"][0]["needs"]
    assert need["kind"] == "target" and need["candidates"] == ["obj-dxf-106", "obj-dxf-108"]
    assert ask["steps"][0]["move"]["distance"] == 1  # kept while the person chooses
    route = client.post(
        "/api/v1/assist/chat", json=body("Can a 1.2 m cart get from Rack A to the packing table?")
    ).json()["steps"][0]["route"]
    assert route == {
        "from_object_id": "obj-dxf-106",
        "to_object_id": "obj-dxf-113",
        "width_m": 1.2,
        "width_quote": "1.2 m",
    }
    bare = client.post("/api/v1/assist/chat", json=body("Does the route still fit?")).json()
    assert bare["steps"][0]["route"] == {
        "from_object_id": None,
        "to_object_id": None,
        "width_m": None,
        "width_quote": None,
    }


class Scripted:
    """A provider that answers with fixed JSON, to check the rules whatever a model says."""

    service = "test"
    base_url = "http://test"
    model = "scripted"
    mode: Literal["live", "recorded"] = "recorded"

    def __init__(self, *answers: dict[str, Any]) -> None:
        self.answers = [json.dumps(a) for a in answers]

    def complete(self, *, attempt: int, **_: Any) -> Completion:
        return Completion(content=self.answers[min(attempt, len(self.answers) - 1)], latency_ms=1)


def answer(**fields: Any) -> dict[str, Any]:
    """One step, in the plan's step shape (also the chat-01 one-intent shape)."""
    base: dict[str, Any] = {
        "intent": "cannot",
        "question": None,
        "candidates": [],
        "message": None,
        "target": None,
        "move": None,
        "rotate": None,
        "route": None,
        "add": None,
    }
    return {**base, **fields}


def plan(*steps: dict[str, Any]) -> dict[str, Any]:
    return {"steps": list(steps)}


def request(message: str) -> ChatRequest:
    return ChatRequest.model_validate(body(message))


MACHINE_B = {"reference": "named", "object_id": "obj-dxf-111", "phrase": "Machine B"}


def test_a_width_not_in_the_message_is_not_used() -> None:
    made_up = answer(
        intent="check_route",
        route={
            "from_object_id": "obj-dxf-106",
            "to_object_id": None,
            "width": 2,
            "unit": "m",
            "quote": "2 m",
        },
    )
    result = interpret_chat(Scripted(made_up), request("Can a cart get out of Rack A?"))
    route = result.steps[0].route
    assert route is not None and route.width_m is None
    assert result.checks == [
        "A route width was suggested but is not in the message, so it is asked."
    ]


def test_an_object_that_is_not_in_the_scene_is_refused_after_retries() -> None:
    from replay_world_api.assist.proposals import AssistError

    ghost = answer(
        intent="select", target={"reference": "named", "object_id": "obj-nope", "phrase": "nope"}
    )
    with pytest.raises(AssistError):
        interpret_chat(Scripted(ghost), request("Show the nope"))


def test_a_move_without_a_distance_in_the_words_asks_on_its_step() -> None:
    guessed = answer(
        intent="move",
        target=MACHINE_B,
        move={"direction": "right", "distance": 1, "unit": "m", "quote": "a bit"},
    )
    result = interpret_chat(
        Scripted(plan(guessed, answer(intent="run_again"))),
        request("Move Machine B a bit to the right and run again"),
    )
    assert result.outcome == "plan"
    first, second = result.steps
    assert first.needs is not None and first.needs.kind == "move_details"
    assert first.target_id == "obj-dxf-111"
    assert second.action == "run_again" and second.needs is None


def test_a_letter_names_one_object_and_a_vague_name_asks_on_its_step() -> None:
    chosen = answer(
        intent="select",
        target={"reference": "named", "object_id": "obj-dxf-108", "phrase": "Rack B"},
    )
    assert (
        interpret_chat(Scripted(chosen), request("Show Rack B")).steps[0].target_id == "obj-dxf-108"
    )
    vague = answer(
        intent="move",
        target={"reference": "named", "object_id": "obj-dxf-108", "phrase": "the rack"},
        move={"direction": "back", "distance": 1, "unit": "m", "quote": "1 m back"},
    )
    result = interpret_chat(
        Scripted(plan(vague, answer(intent="run_again"))),
        request("Move the rack 1 m back and run again"),
    )
    step = result.steps[0]
    assert step.needs is not None and step.needs.kind == "target"
    assert step.needs.candidates == ["obj-dxf-106", "obj-dxf-108"]
    assert step.move is not None and step.move.distance == 1  # kept while the person chooses
    assert result.steps[1].action == "run_again"


def test_it_means_the_object_of_an_earlier_step_then_the_focus() -> None:
    steps = plan(
        answer(
            intent="select",
            target={"reference": "named", "object_id": "obj-dxf-10a", "phrase": "the mixer"},
        ),
        answer(
            intent="rotate",
            target={"reference": "selected", "object_id": None, "phrase": "it"},
            rotate={"direction": "clockwise", "angle_deg": 90, "quote": "90 degrees clockwise"},
        ),
        answer(intent="check_layout"),
    )
    result = interpret_chat(
        Scripted(steps),
        request("Select the mixer, turn it 90 degrees clockwise, and check the layout"),
    )
    assert [s.action for s in result.steps] == ["select", "rotate", "check_layout"]
    assert result.steps[1].target_id == "obj-dxf-10a"
    it = answer(
        intent="move",
        target={"reference": "selected", "object_id": None, "phrase": "it"},
        move={"direction": "left", "distance": 1, "unit": "m", "quote": "1 m left"},
    )
    unclear = interpret_chat(Scripted(it), request("Move it 1 m left"))
    assert unclear.steps[0].needs is not None and unclear.steps[0].needs.kind == "reference"
    focused = ChatRequest.model_validate(
        {**body("Move it 1 m left"), "focus_object_id": "obj-dxf-111"}
    )
    assert interpret_chat(Scripted(it), focused).steps[0].target_id == "obj-dxf-111"


def test_an_unsupported_part_is_kept_and_more_than_four_steps_is_refused() -> None:
    mixed = plan(
        answer(
            intent="move",
            target=MACHINE_B,
            move={"direction": "right", "distance": 1, "unit": "m", "quote": "1 m right"},
        ),
        answer(intent="cannot", message="The app cannot paint objects."),
    )
    result = interpret_chat(Scripted(mixed), request("Move Machine B 1 m right and paint it red"))
    assert [s.action for s in result.steps] == ["move", None]
    assert result.steps[1].unsupported == "The app cannot paint objects."
    many = plan(*[answer(intent="run_again") for _ in range(5)])
    refused = interpret_chat(Scripted(many), request("Run it again five times please"))
    assert refused.outcome == "unsupported" and refused.message is not None


def test_an_added_object_keeps_only_the_stated_sizes() -> None:
    add = answer(
        intent="add_object",
        add={
            "description": "packing table",
            "width": 1.5,
            "depth": 0.8,
            "height": 0.9,
            "unit": "m",
            "near_object_id": "obj-dxf-111",
            "side": None,
        },
    )
    result = interpret_chat(
        Scripted(add),
        request("Add a packing table, 1.5 metres wide and 0.8 metres deep, beside Machine B"),
    )
    added = result.steps[0].add
    assert added is not None
    assert (added.width_m, added.depth_m, added.height_m) == (1.5, 0.8, None)
    assert added.near_object_id == "obj-dxf-111"
    assert result.checks == ["A height was suggested but is not in the message, so it is not used."]


def test_without_a_provider_chat_is_refused_with_the_reason(tmp_path: Path) -> None:
    settings = Settings(sources_dir=tmp_path, assist=AssistSettings())
    with TestClient(create_app(settings)) as c:
        response = c.post("/api/v1/assist/chat", json=body("Run a day"))
    assert response.status_code == 503
