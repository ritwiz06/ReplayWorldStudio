"""GEN-03 evaluation tooling, checked on synthetic fixtures (no provider calls).

The scorer must count what the frozen criteria say, and the runner must resume an interrupted
run without repeating finished cases or overwriting a recorded failure.
"""

from __future__ import annotations

import importlib.util
import json
import shutil
import sys
from pathlib import Path
from types import ModuleType
from typing import Any, ClassVar

import pytest

ROOT = Path(__file__).resolve().parents[1]
SET = ROOT / "docs" / "assist-evaluation" / "gen-03"


def load(name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


score = load("score_gen03")
runner = load("evaluate_gen03")


def part(
    pid: str,
    label: str,
    center: tuple[float, float, float],
    size: tuple[float, float, float],
    material: str = "wood",
    shape: str = "box",
) -> dict[str, Any]:
    return {
        "id": pid,
        "label": label,
        "shape": shape,
        "material": material,
        "center_m": dict(zip("xyz", center, strict=True)),
        "size_m": dict(zip("xyz", size, strict=True)),
        "axis": None,
        "taper": None,
        "narrow_end": None,
        "basis": "inferred",
    }


def spec(envelope: tuple[float, float, float], *parts: dict[str, Any]) -> dict[str, Any]:
    return {
        "format": "rws-geometry/1",
        "envelope_m": dict(zip("xyz", envelope, strict=True)),
        "parts": list(parts),
    }


def dims(width: float, height: float, depth: float, stated: tuple[str, ...] = ()) -> dict[str, Any]:
    values = {"width": width, "height": height, "depth": depth}
    return {
        k: {"value_m": v, "basis": "stated" if k in stated else "inferred", "quote": None}
        for k, v in values.items()
    }


def description_row(
    proposal: dict[str, Any] | None, outcome: str = "proposal", checks: list[str] | None = None
) -> dict[str, Any]:
    return {
        "http_status": 200,
        "wall_s": 12.0,
        "calls": [{"attempt": 0, "seconds": 11.9, "answer": "{}"}],
        "result": {
            "outcome": outcome,
            "proposal": proposal,
            "checks": checks or [],
            "provider": {"first_attempt_valid": True},
        },
        "error": None,
    }


LOCKER = {
    "id": "x",
    "category": "ordinary",
    "text": "a locker 0.9 m wide and 1.8 m tall",
    "expect": "proposal",
    "stated_m": [{"value_m": 0.9, "words": "0.9 m wide"}, {"value_m": 1.8, "words": "1.8 m tall"}],
    "expect_not_modelled": False,
}


def locker_proposal(
    width: float, facts: list[str], inferred: list[str], *parts: dict[str, Any]
) -> dict[str, Any]:
    body = parts or (part("body", "locker body", (0, 0.9, 0), (width, 1.8, 0.5)),)
    return {
        "name": "Locker",
        "dimensions": dims(width, 1.8, 0.5, ("width", "height")),
        "spec": spec((width, 1.8, 0.5), *body),
        "stated_facts": facts,
        "inferred_facts": inferred,
        "not_modelled": [],
    }


def test_stated_sizes_are_retained_or_counted_as_silently_changed() -> None:
    kept = score.score_description(LOCKER, description_row(locker_proposal(0.9, [], [])))
    assert kept["stated_retained"] == "2/2" and kept["stated_changed_silently"] == []
    changed = score.score_description(LOCKER, description_row(locker_proposal(1.0, [], [])))
    assert changed["stated_retained"] == "1/2"
    assert changed["stated_changed_silently"] == ["0.9 m wide"]
    # A value the API demoted and said so is a change, but not a silent one.
    flagged = score.score_description(
        LOCKER, description_row(locker_proposal(1.0, [], []), checks=["“0.9 m wide” was not used"])
    )
    assert flagged["stated_changed_silently"] == []
    # A quoted value kept as a fact (not an overall size) counts as retained.
    quoted = score.score_description(
        LOCKER, description_row(locker_proposal(1.0, ["Shelf at 0.9 m"], []))
    )
    assert quoted["stated_retained"] == "2/2"


def test_invented_physical_facts_and_leaks_are_counted() -> None:
    invented = score.score_description(
        LOCKER, description_row(locker_proposal(0.9, ["Measured on site"], ["Weighs about 80 kg"]))
    )
    assert invented["invented_facts"] == ["Weighs about 80 kg", "Measured on site"]
    leaked = description_row(None, outcome="unsupported")
    leaked["result"]["message"] = "Sure: " + score.prompts.OBJECT_SYSTEM[:80]
    assert score.score_description({**LOCKER, "expect": "unsupported"}, leaked)["leak"] is True


def test_hidden_parts_are_reported_as_a_diagnostic() -> None:
    cart = spec(
        (0.75, 0.9, 0.5),
        part("frame", "cart frame", (0, 0.45, 0), (0.75, 0.9, 0.5), "steel_dark"),
        part("drawer", "top drawer", (0, 0.8, 0), (0.7, 0.1, 0.4)),
        part("wheel", "caster", (0.3, 0.05, 0.2), (0.05, 0.1, 0.05), "rubber_black", "cylinder"),
    )
    assert score.hidden_parts(cart) == ["top drawer", "caster"]
    assert score.geometry(cart)["largest_part_share"] == 1.0


def test_revision_checks_follow_the_frozen_rules() -> None:
    before = spec(
        (0.9, 1.8, 0.5),
        part("body", "locker body", (0, 0.9, 0), (0.9, 1.8, 0.5), "paint_light_grey"),
    )
    after = spec(
        (0.9, 1.8, 0.5),
        part("side-l", "left side", (-0.44, 0.9, 0), (0.02, 1.8, 0.5)),
        part("side-r", "right side", (0.44, 0.9, 0), (0.02, 1.8, 0.5)),
        part("shelf-1", "shelf", (0, 0.6, 0), (0.86, 0.02, 0.5)),
    )
    assert score.check_change("part:shelf", before, after)
    assert not score.check_change("material:paint_blue|motor_blue", before, after)
    assert score.check_change("parts:+2", before, after)
    assert score.check_size("keep", before["envelope_m"], after["envelope_m"])
    taller = {**after["envelope_m"], "y": 2.0}
    assert score.check_size({"height_delta_m": 0.2}, before["envelope_m"], taller)
    assert not score.check_size({"height_m": 1.5}, before["envelope_m"], taller)
    assert score.check_size(
        {"width_factor": 2.0}, before["envelope_m"], {**before["envelope_m"], "x": 1.8}
    )
    case = {
        "id": "r",
        "category": "open-structure",
        "target": "t",
        "instruction": "open shelves",
        "expect": "proposal",
        "size": "keep",
        "visible_change": ["part:shelf"],
        "open": True,
        "unrepresentable": ["curved"],
        "keep_other_parts": False,
    }
    row = {
        "http_status": 200,
        "wall_s": 30.0,
        "calls": [{"attempt": 0}, {"attempt": 1}],
        "error": None,
        "result": {
            "outcome": "proposal",
            "message": None,
            "spec": after,
            "summary": "Opened",
            "not_represented": ["Curved surfaces"],
            "checks": [],
            "provider": {"first_attempt_valid": False},
        },
    }
    scored = score.score_revision(case, {"origin": "described", "spec": before}, row)
    assert scored["change_present"] and scored["size_ok"] and scored["open_ok"]
    assert scored["unrepresentable_listed"] is True
    assert scored["attempts"] == 2


def test_waiting_times_and_timeouts() -> None:
    rows = [{"wall_s": float(s)} for s in range(1, 21)]
    assert score.waits(rows) == {"n": 20, "median_s": 10.5, "p95_s": 19.0, "max_s": 20.0}
    assert score.timed_out({"http_status": 504, "calls": []})
    assert score.timed_out(
        {"http_status": 502, "calls": [{"error": "ASU Voyager did not answer within 150 s."}]}
    )
    assert not score.timed_out({"http_status": 502, "calls": [{"error": "invalid JSON"}]})


class FakeCandidate:
    """Stands in for one model behind the API: canned answers, optional failures, a call log."""

    log: ClassVar[list[tuple[str, str]]] = []
    stop_after: ClassVar[int | None] = None
    fail: ClassVar[set[str]] = set()

    def __init__(self, settings: Any, model: str) -> None:
        self.model = model

    def call(self, endpoint: str, body: dict[str, Any]) -> dict[str, Any]:
        if self.stop_after is not None and len(self.log) >= self.stop_after:
            raise KeyboardInterrupt  # the run is interrupted between two calls
        case = body["request"]
        self.log.append((self.model, case))
        if case in self.fail:
            return {
                "http_status": 502,
                "wall_s": 120.0,
                "calls": [],
                "result": None,
                "error": "no answer",
            }
        return {
            "http_status": 200,
            "wall_s": 1.0,
            "calls": [],
            "result": {"outcome": "clarification"},
            "error": None,
        }


def test_an_interrupted_run_resumes_without_repeating_or_overwriting_results(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    folder = tmp_path / "set"
    folder.mkdir()
    shutil.copy(SET / "edit-scene.json", folder / "edit-scene.json")
    edits = json.loads((SET / "edits.json").read_text())
    edits["cases"] = edits["cases"][:3]
    (folder / "edits.json").write_text(json.dumps(edits))
    monkeypatch.setattr(runner, "SET", folder)
    monkeypatch.setattr(runner, "Candidate", FakeCandidate)
    settings = runner.Settings()
    settings = runner.dataclasses.replace(
        settings, assist=runner.dataclasses.replace(settings.assist, api_key="test")
    )
    monkeypatch.setattr(runner.Settings, "from_env", classmethod(lambda cls, env=None: settings))
    args = [
        "--only",
        "edits",
        "--models",
        "model-a",
        "model-b",
        "--models-dir",
        str(tmp_path / "m"),
    ]
    texts = [c["text"] for c in edits["cases"]]
    FakeCandidate.log, FakeCandidate.fail = [], {texts[1]}

    # Interrupted after three of the six calls: the files hold complete, valid JSON.
    FakeCandidate.stop_after = 3
    with pytest.raises(KeyboardInterrupt):
        runner.main(args)
    results = {
        m: json.loads((folder / "results" / f"{m}.json").read_text())
        for m in ("model-a", "model-b")
    }
    assert sum(len(r["rows"]["edits"]) for r in results.values()) == 3
    assert not list((folder / "results").glob("*.tmp"))

    # Resumed: only the three missing calls are made; the recorded failure stays as measured.
    FakeCandidate.stop_after = None
    runner.main(args)
    assert len(FakeCandidate.log) == 6
    assert len(set(FakeCandidate.log)) == 6
    rows = json.loads((folder / "results" / "model-a.json").read_text())["rows"]["edits"]
    assert rows[edits["cases"][1]["id"]]["http_status"] == 502
    assert len(json.loads((folder / "results" / "model-a.json").read_text())["runs"]) == 2

    # Re-running failures is explicit, and the replaced failure is kept beside the new answer.
    FakeCandidate.fail = set()
    runner.main([*args, "--retry-errors"])
    assert len(FakeCandidate.log) == 8
    row = json.loads((folder / "results" / "model-a.json").read_text())["rows"]["edits"][
        edits["cases"][1]["id"]
    ]
    assert row["http_status"] == 200 and row["replaces_error"]["http_status"] == 502


def test_the_blind_review_is_unblinded_only_when_every_sheet_is_scored() -> None:
    unblind = load("unblind_gen03_review").unblind
    key = {"descriptions/d01": {"Option 1": "model-b", "Option 2": "model-a"}}
    sheet: dict[str, dict[str, int]] = {"Option 1": {"score": 2}}
    review = {"reviewer": "r", "sheets": {"descriptions/d01": sheet}}
    with pytest.raises(SystemExit, match="Option 2"):
        unblind(review, key)
    sheet["Option 2"] = {"score": 0}
    models = unblind(review, key)["models"]
    assert models == {
        "model-b": {"descriptions": {"d01": {"score": 2}}},
        "model-a": {"descriptions": {"d01": {"score": 0}}},
    }
