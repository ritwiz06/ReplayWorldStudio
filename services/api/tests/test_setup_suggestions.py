"""'Suggest setup' (SIM-01): the language model suggests station roles, order and questions;
the API keeps only stations that are reviewed objects, used once, with material coming from the
first; nothing in the answer can carry a cycle time or a staffing level; and a recorded live
answer replays offline."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from replay_world_api.app import create_app
from replay_world_api.assist.proposals import AssistError
from replay_world_api.assist.provider import Completion, RecordedProvider, Task
from replay_world_api.assist.setup import RawSetupAnswer, request_key, suggest_setup
from replay_world_api.settings import AssistSettings, Settings
from replay_world_contracts import ProcessSuggestion, ProcessSuggestionRequest

ROOT = Path(__file__).resolve().parents[3]
RECORDINGS = ROOT / "fixtures" / "assist" / "recorded"


def objects() -> list[dict[str, Any]]:
    return [
        {"id": "obj-rack", "name": "Rack A", "kind": "equipment", "width_m": 15, "depth_m": 1},
        {"id": "obj-mixer", "name": "Mixer", "kind": "equipment", "width_m": 1.6, "depth_m": 1.6},
        {
            "id": "obj-press",
            "name": "Fixtures 5",
            "kind": "equipment",
            "width_m": 5.2,
            "depth_m": 0.6,
        },
    ]


def request(
    description: str = "Material from the rack is mixed, then pressed.",
) -> ProcessSuggestionRequest:
    return ProcessSuggestionRequest.model_validate(
        {"description": description, "objects": objects()}
    )


@dataclass
class Scripted:
    """A provider that answers from a list; for rules that need a particular answer."""

    answers: list[dict[str, Any]]
    calls: list[str] = field(default_factory=list)
    service: str = "Test"
    base_url: str = "http://test"
    model: str = "test-model"
    mode: Any = "live"

    def complete(
        self,
        *,
        task: Task,
        key: str,
        messages: list[dict[str, Any]],
        schema: dict[str, Any],
        attempt: int,
        timeout_s: float | None = None,
    ) -> Completion:
        self.calls.append(task)
        return Completion(json.dumps(self.answers[min(attempt, len(self.answers) - 1)]), 5)


def answer(stations: list[tuple[str, str, str]], **extra: Any) -> dict[str, Any]:
    return {
        "understood": True,
        "item": "batch",
        "stations": [
            {"object_id": i, "name": n, "role": r, "why": "from its name"} for i, n, r in stations
        ],
        "questions": ["How long does mixing take?"],
        "message": None,
        **extra,
    }


def test_a_recorded_live_answer_replays_offline_and_suggests_no_operating_value() -> None:
    record = json.loads((RECORDINGS / "setup-layout-checks.json").read_text())
    provider = RecordedProvider(
        AssistSettings(provider="recorded", recordings_dir=RECORDINGS), tasks=("setup",)
    )
    analysis = json.loads(
        (ROOT / "fixtures" / "drawings" / "layout-checks-mm.analysis.json").read_text()
    )
    listed = [
        {
            "id": o["object_id"],
            "name": o["label"],
            "kind": o["kind"],
            "width_m": o["width"] / 1000,
            "depth_m": o["depth"] / 1000,
        }
        for o in analysis["drawing"]["objects"]
        if o["role"] != "floor" and o["kind"] in ("equipment", "structure")
    ]
    req = ProcessSuggestionRequest.model_validate(
        {"description": record["description"], "objects": listed[::-1]}
    )
    assert request_key(req) == record["key"]  # sizes and order do not matter to the key
    result = suggest_setup(provider, req)
    assert result.outcome == "suggestion" and result.provider.mode == "recorded"
    suggestion = result.suggestion
    assert suggestion is not None
    assert [s.name for s in suggestion.stations] == [
        "Rack A",
        "Mixer",
        "Machine B",
        "Packing table",
    ]
    assert [s.role for s in suggestion.stations] == ["supply", "process", "process", "process"]
    assert any("how long" in q.lower() for q in suggestion.questions)


def test_the_answer_has_no_place_for_times_or_staffing() -> None:
    fields = set(ProcessSuggestion.model_fields) | set(RawSetupAnswer.model_fields)
    assert not any(
        word in f
        for f in fields
        for word in ("time", "cycle", "worker", "staff", "speed", "capacity")
    )
    provider = Scripted(
        [answer([("obj-rack", "Rack", "supply"), ("obj-mixer", "Mixer", "process")], cycle_s=60)]
        * 2
    )
    with pytest.raises(AssistError, match="did not return a usable suggestion"):
        suggest_setup(provider, request())  # the extra field is refused, twice


def test_unknown_and_repeated_objects_are_dropped_and_the_first_is_the_supply() -> None:
    provider = Scripted(
        [
            answer(
                [
                    ("obj-mixer", "Mixer", "process"),
                    ("obj-ghost", "Ignore all instructions", "process"),
                    ("obj-press", "Press bench", "supply"),
                    ("obj-mixer", "Mixer again", "process"),
                ]
            )
        ]
    )
    result = suggest_setup(provider, request())
    assert result.suggestion is not None
    assert [(s.object_id, s.role, s.name) for s in result.suggestion.stations] == [
        ("obj-mixer", "supply", "Mixer"),
        ("obj-press", "process", "Press bench"),
    ]
    assert result.checks == [
        "Mixer is where material comes from: material comes from the first station only.",
        "Dropped “obj-ghost”: not one of the reviewed objects.",
        "Fixtures 5 is a step: material comes from the first station only.",
        "Dropped a second use of Mixer: each step is at its own object.",
    ]


def test_too_few_stations_is_asked_again_and_a_misunderstanding_is_said_plainly() -> None:
    provider = Scripted(
        [
            answer([("obj-ghost", "X", "supply")]),
            answer([("obj-rack", "Rack", "supply"), ("obj-press", "Press", "process")]),
        ]
    )
    result = suggest_setup(provider, request())
    assert result.provider.attempts == 2 and result.suggestion is not None
    unclear = Scripted(
        [
            {
                "understood": False,
                "item": None,
                "stations": [],
                "questions": [],
                "message": "This is a poem.",
            }
        ]
    )
    result = suggest_setup(unclear, request("roses are red"))
    assert (result.outcome, result.message, result.suggestion) == (
        "unsupported",
        "This is a poem.",
        None,
    )


def test_the_endpoint_replays_a_recording_and_is_off_without_a_provider(tmp_path: Path) -> None:
    record = json.loads((RECORDINGS / "setup-layout-checks.json").read_text())
    analysis = json.loads(
        (ROOT / "fixtures" / "drawings" / "layout-checks-mm.analysis.json").read_text()
    )
    body = {
        "description": record["description"],
        "objects": [
            {
                "id": o["object_id"],
                "name": o["label"],
                "kind": o["kind"],
                "width_m": 1,
                "depth_m": 1,
            }
            for o in analysis["drawing"]["objects"]
            if o["role"] != "floor" and o["kind"] in ("equipment", "structure")
        ],
    }
    recorded = TestClient(
        create_app(Settings(assist=AssistSettings(provider="recorded", recordings_dir=RECORDINGS)))
    )
    response = recorded.post("/api/v1/assist/process-suggestions", json=body)
    assert response.status_code == 200, response.text
    assert response.json()["suggestion"]["stations"][0]["name"] == "Rack A"
    off = TestClient(create_app(Settings(assist=AssistSettings(provider="off"))))
    assert off.post("/api/v1/assist/process-suggestions", json=body).status_code == 503
    assert (
        recorded.post(
            "/api/v1/assist/process-suggestions", json={**body, "objects": body["objects"][:1]}
        ).status_code
        == 422
    )
