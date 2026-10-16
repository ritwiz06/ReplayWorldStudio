"""GEN-05 evaluation tooling, checked on synthetic rows (no provider calls).

A timeout is a request with no answer in time or one over the whole-request budget; a corrected
answer cut short by the budget is reported apart; a host pause (the two clocks disagree) is a
run fault, reported and never reclassified; the review is unblinded into the chosen set.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[1]
PILOT = ROOT / "docs" / "assist-evaluation" / "gen-05-pilot"


def load(name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


score = load("score_gen05")
runner = load("evaluate_gen05")
unblind = load("unblind_gen05_review")
DATA = json.loads((PILOT / "revisions.json").read_text())
CASES = {c["id"]: c for c in DATA["cases"]}


def result(spec: dict[str, Any] | None, **fields: Any) -> dict[str, Any]:
    return {
        "outcome": "proposal" if spec else "unsupported",
        "message": None if spec else "Nothing was changed.",
        "spec": spec,
        "summary": "changed" if spec else None,
        "partial": False,
        "size_changed": False,
        "not_represented": [],
        "checks": [],
        "problems": [],
        "provider": {"first_attempt_valid": True},
    } | fields


def row(res: dict[str, Any] | None, wall: float = 40.0, status: int = 200) -> dict[str, Any]:
    return {
        "http_status": status,
        "wall_s": wall,
        "clock_s": wall,
        "calls": [{"attempt": 0, "seconds": wall, "answer": "{}"}],
        "result": res,
        "error": None if res else "timeout",
    }


def with_light(case_id: str) -> dict[str, Any]:
    before = DATA["targets"][CASES[case_id]["target"]]["spec"]
    light = {
        **before["parts"][0],
        "id": "light",
        "label": "status light",
        "material": "signal_green",
    }
    return {**before, "parts": [*before["parts"], light]}


def scored(case_id: str, r: dict[str, Any]) -> dict[str, Any]:
    case = CASES[case_id]
    out: dict[str, Any] = score.score_case(case, DATA["targets"][case["target"]], r, 150.0)
    return out


def test_timeouts_are_missing_answers_or_requests_over_the_budget() -> None:
    assert scored("p1", row(None, 150.2, 504))["timeout"]
    assert scored("p1", row(result(with_light("p1")), 156.0))["timeout"]
    # A first answer shown with its problems after the corrected one was cut off is not a
    # timeout for the user: it is reported as a budget-cut retry.
    cut = result(
        with_light("p1"),
        checks=[
            "The corrected answer did not arrive within the 150 s limit; this is the first answer."
        ],
        problems=["“status light” does not touch anything that holds it up; it floats."],
    )
    late = scored("p1", row(cut, 149.0))
    assert not late["timeout"] and late["budget_cut_retry"]
    assert late["additions_clear"] is False


def test_the_summary_reports_run_conditions_and_problems_apart() -> None:
    faulty = row(result(with_light("p1")), 30.0)
    faulty["clock_s"] = 900.0
    faulty["run_fault"] = "host paused for about 870 s during this request"
    rows = [scored("p1", faulty), scored("p2", row(None, 150.1, 504))]
    summary = score.summarise(rows, {})
    conditions = summary["run_conditions"]
    assert conditions["run_faults"] == {"p1": "host paused for about 870 s during this request"}
    assert conditions["total_request_s"] == 180.1 and conditions["requests"] == 2
    # The timeout stays a timeout; nothing is reclassified by the fault list.
    assert summary["gates"]["timeouts"]["timeouts"] == 1
    assert summary["visibility"]["visible_additions_clear"] == {"passed": 1, "of": 1, "share": 1.0}


class Clockwork:
    """A candidate whose request timer and the real clock can be made to disagree."""

    model = "fake-model"

    def __init__(self, wall: float, real: float, monkeypatch: pytest.MonkeyPatch) -> None:
        self.wall, self.real = wall, real
        self.monkeypatch = monkeypatch

    def call(self, endpoint: str, body: dict[str, Any]) -> dict[str, Any]:
        now = runner.time.time()
        self.monkeypatch.setattr(runner.time, "time", lambda: now + self.real)
        return {"http_status": 200, "wall_s": self.wall, "calls": [], "result": None, "error": None}


def test_a_pause_of_the_host_is_recorded_as_a_run_fault(monkeypatch: pytest.MonkeyPatch) -> None:
    paused = runner.timed(Clockwork(30.0, 600.0, monkeypatch), {})
    assert paused["clock_s"] == 600.0 and "host paused for about 570 s" in paused["run_fault"]
    monkeypatch.undo()
    steady = runner.timed(Clockwork(30.0, 30.5, monkeypatch), {})
    assert "run_fault" not in steady


def test_unblinding_writes_into_the_chosen_set(tmp_path: Path) -> None:
    review = tmp_path / "review-blind.json"
    key = tmp_path / "sheet-key.json"
    review.write_text(json.dumps({"sheets": {"Sheet 01": {"score": 2}}}))
    key.write_text(json.dumps({"model": "m", "sheets": {"Sheet 01": "p1"}}))
    assert unblind.main([str(review), str(key), "--set", str(tmp_path)]) == 0
    assert json.loads((tmp_path / "review.json").read_text())["cases"]["p1"]["score"] == 2
