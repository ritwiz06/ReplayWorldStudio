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
    "move-machine-b": ("action", "move"),
    "move-machine-b-forward": ("action", "move"),
    "ambiguous-rack": ("clarification", None),
    "ambiguous-rack-chosen": ("action", "move"),
    "route-fit": ("action", "check_route"),
    "route-cart": ("action", "check_route"),
    "run-shift": ("action", "run_day"),
    "run-again": ("action", "run_again"),
    "why-changed": ("action", "explain_change"),
    "undo": ("action", "undo"),
    "capabilities": ("action", "capabilities"),
    "unsupported-colour": ("unsupported", None),
    "hostile": ("unsupported", None),
    "show-example": ("action", "show_example"),
}


@pytest.mark.parametrize("case", SAMPLE_CASES, ids=[c[0] for c in SAMPLE_CASES])
def test_recorded_answers_replay_as_checked_actions(client: TestClient, case: Any) -> None:
    name, message, _selected, which, state = case
    response = client.post("/api/v1/assist/chat", json=body(message, which, **state))
    assert response.status_code == 200, response.text
    result = response.json()
    assert (result["outcome"], result["action"]) == EXPECTED[name]
    assert result["provider"]["mode"] == "recorded"


def test_the_details_are_the_ones_in_the_words(client: TestClient) -> None:
    move = client.post("/api/v1/assist/chat", json=body("Move Machine B 1 metre right")).json()
    assert move["edit"]["target"]["object_ids"] == ["obj-dxf-111"]
    assert move["edit"]["move"] == {
        "direction": "right",
        "distance": 1.0,
        "unit": "m",
        "quote": "1 metre",
    }
    ask = client.post("/api/v1/assist/chat", json=body("Move the rack 1 m back")).json()
    assert ask["candidates"] == ["obj-dxf-106", "obj-dxf-108"]
    route = client.post(
        "/api/v1/assist/chat", json=body("Can a 1.2 m cart get from Rack A to the packing table?")
    ).json()["route"]
    assert route == {
        "from_object_id": "obj-dxf-106",
        "to_object_id": "obj-dxf-113",
        "width_m": 1.2,
        "width_quote": "1.2 m",
    }
    bare = client.post("/api/v1/assist/chat", json=body("Does the route still fit?")).json()[
        "route"
    ]
    assert bare == {
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
    base: dict[str, Any] = {
        "intent": "cannot",
        "question": None,
        "candidates": [],
        "message": None,
        "target": None,
        "move": None,
        "rotate": None,
        "route": None,
    }
    return {**base, **fields}


def request(message: str) -> ChatRequest:
    return ChatRequest.model_validate(body(message))


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
    assert result.route is not None and result.route.width_m is None
    assert result.checks == ["A width was suggested but is not in the message, so it is asked."]


def test_an_object_that_is_not_in_the_scene_is_refused_after_retries() -> None:
    from replay_world_api.assist.proposals import AssistError

    ghost = answer(
        intent="select", target={"reference": "named", "object_id": "obj-nope", "phrase": "nope"}
    )
    with pytest.raises(AssistError):
        interpret_chat(Scripted(ghost), request("Show the nope"))


def test_a_move_without_a_distance_in_the_words_becomes_a_question() -> None:
    guessed = answer(
        intent="move",
        target={"reference": "named", "object_id": "obj-dxf-111", "phrase": "Machine B"},
        move={"direction": "right", "distance": 1, "unit": "m", "quote": "a bit"},
    )
    result = interpret_chat(Scripted(guessed), request("Move Machine B a bit to the right"))
    assert result.outcome == "clarification"
    assert result.question is not None and "How far" in result.question


def test_a_letter_names_one_object() -> None:
    chosen = answer(
        intent="select",
        target={"reference": "named", "object_id": "obj-dxf-108", "phrase": "Rack B"},
    )
    assert interpret_chat(Scripted(chosen), request("Show Rack B")).object_id == "obj-dxf-108"
    vague = answer(
        intent="select",
        target={"reference": "named", "object_id": "obj-dxf-108", "phrase": "the rack"},
    )
    result = interpret_chat(Scripted(vague), request("Show the rack"))
    assert result.outcome == "clarification" and result.candidates == ["obj-dxf-106", "obj-dxf-108"]


def test_without_a_provider_chat_is_refused_with_the_reason(tmp_path: Path) -> None:
    settings = Settings(sources_dir=tmp_path, assist=AssistSettings())
    with TestClient(create_app(settings)) as c:
        response = c.post("/api/v1/assist/chat", json=body("Run a day"))
    assert response.status_code == 503
