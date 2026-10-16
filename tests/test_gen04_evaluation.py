"""GEN-04 evaluation tooling, checked on synthetic rows (no provider calls).

The frozen set must have the composition the criteria state, the scorer must apply the GEN-04
outcome and listing rules with honest denominators, and the runner must resume without repeating
a measured case and keep diagnostic runs apart from the frozen result.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from collections import Counter
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[1]
SET = ROOT / "docs" / "assist-evaluation" / "gen-04"


def load(name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


score = load("score_gen04")
runner = load("evaluate_gen04")
unblind = load("unblind_gen04_review")
DATA = json.loads((SET / "revisions.json").read_text())
CASES = {c["id"]: c for c in DATA["cases"]}


def test_the_frozen_set_has_the_stated_groups_photo_targets_and_new_instructions() -> None:
    groups = Counter(c["category"] for c in DATA["cases"])
    assert groups == {
        "mixed": 5,
        "unsupported": 3,
        "open-structure": 5,
        "colour-parts": 5,
        "already-satisfied": 2,
    }
    photo = {
        c["category"] for c in DATA["cases"] if DATA["targets"][c["target"]]["origin"] == "photo"
    }
    assert {"mixed", "unsupported", "open-structure", "colour-parts", "already-satisfied"} <= photo
    gen03 = json.loads(
        (ROOT / "docs" / "assist-evaluation" / "gen-03" / "revisions.json").read_text()
    )
    development = json.loads((ROOT / "scripts" / "model_revision_cases.json").read_text())
    # Development cases as they were when the set was frozen: the gen04-* regressions were
    # added after the GEN-04 run, for GEN-05 development.
    development = [c for c in development if not c["label"].startswith("gen04-")]
    earlier = {c["instruction"] for c in gen03["cases"]} | {c["instruction"] for c in development}
    assert not earlier & {c["instruction"] for c in DATA["cases"]}
    assert not set(gen03["targets"]) & set(DATA["targets"])
    for c in DATA["cases"]:
        assert bool(c["unrepresentable"]) == (c["category"] in ("mixed", "unsupported"))
        assert c["open"] == (c["category"] == "open-structure")


def result(
    outcome: str, spec: dict[str, Any] | None = None, not_represented: list[str] | None = None
) -> dict[str, Any]:
    listed = not_represented or []
    return {
        "outcome": outcome,
        "message": None if outcome == "proposal" else "Nothing was changed.",
        "spec": spec,
        "summary": "changed" if spec else None,
        "partial": outcome == "proposal" and bool(listed),
        "size_changed": False,
        "not_represented": listed,
        "checks": [],
        "provider": {"first_attempt_valid": True},
    }


def row(res: dict[str, Any] | None, wall: float = 30.0, status: int = 200) -> dict[str, Any]:
    return {
        "http_status": status,
        "wall_s": wall,
        "calls": [{"attempt": 0, "seconds": wall, "answer": "{}"}]
        if res
        else [{"attempt": 0, "seconds": 150.0, "error": "Voyager did not answer within 150 s"}],
        "result": res,
        "error": None if res else "timeout",
    }


def with_part(
    case_id: str,
    label: str,
    material: str = "wood",
    size: tuple[float, float, float] = (0.1, 0.05, 0.1),
) -> dict[str, Any]:
    before = DATA["targets"][CASES[case_id]["target"]]["spec"]
    added = {
        **before["parts"][0],
        "id": "added",
        "label": label,
        "material": material,
        "size_m": dict(zip("xyz", size, strict=True)),
    }
    return {**before, "parts": [*before["parts"], added]}


def scored(case_id: str, r: dict[str, Any]) -> dict[str, Any]:
    case = CASES[case_id]
    out: dict[str, Any] = score.score_case(case, DATA["targets"][case["target"]], r)
    return out


def test_a_mixed_case_needs_a_partial_proposal_that_draws_and_lists() -> None:
    good = scored(
        "m01",
        row(
            result(
                "proposal",
                with_part("m01", "seat cushion", "fabric_grey"),
                ["“recline when I press a button”: a moving part"],
            )
        ),
    )
    assert good["outcome_ok"] and good["change_present"] and good["unrepresentable_listed"]
    assert good["size_ok"] and good["other_parts_kept"]
    # Drawn without saying what is left out: the outcome and the listing both fail.
    silent = scored("m01", row(result("proposal", with_part("m01", "seat cushion", "fabric_grey"))))
    assert not silent["outcome_ok"] and silent["unrepresentable_listed"] is False
    # Refusing the whole request lists the feature but loses the drawable part.
    refused = scored("m01", row(result("unsupported", None, ["recline"])))
    assert not refused["outcome_ok"] and refused["unrepresentable_listed"]


def test_unsupported_and_satisfied_need_their_exact_outcome() -> None:
    assert scored("u02", row(result("unsupported", None, ["run quieter", "use less electricity"])))[
        "unrepresentable_listed"
    ]
    assert not scored("u02", row(result("unsupported", None, ["run quieter"])))[
        "unrepresentable_listed"
    ]
    imitated = scored(
        "u01", row(result("proposal", with_part("u01", "lavender flowers", "paint_blue")))
    )
    assert not imitated["outcome_ok"] and imitated["unrepresentable_listed"] is False
    assert scored("s01", row(result("already_satisfied")))["outcome_ok"]
    assert not scored("s01", row(result("proposal", with_part("s01", "cushion"))))["outcome_ok"]
    # A no-op is wrong anywhere else.
    assert not scored("c01", row(result("already_satisfied")))["outcome_ok"]


def test_a_timeout_is_a_wrong_outcome_and_an_unlisted_feature() -> None:
    timed_out = scored("m02", row(None, wall=151.0, status=504))
    assert timed_out["timeout"] and not timed_out["outcome_ok"]
    assert timed_out["unrepresentable_listed"] is False and "geometry" not in timed_out


def test_the_summary_counts_every_denominator_and_applies_the_gates() -> None:
    rows = [scored(c["id"], row(result("unsupported", None, ["x"]))) for c in DATA["cases"]]
    summary = score.summarise(rows, {})
    gates = summary["gates"]
    assert gates["outcome_as_expected"]["of"] == 20 and gates["outcome_as_expected"]["passed"] == 3
    assert gates["unrepresentable_listed"]["of"] == 8
    assert gates["change_present"]["of"] == 0 and gates["change_present"]["pass"] is False
    assert gates["visual_review"]["pass"] is None and summary["all_gates_pass"] is False
    assert gates["timeouts"]["pass"] and gates["waiting_median"]["median_s"] == 30.0
    assert any(f.startswith("o01 ") for f in summary["failures"])
    two_timeouts = [
        *rows[:18],
        scored("m01", row(None, 150.5, 504)),
        scored("m02", row(None, 150.5, 504)),
    ]
    assert score.summarise(two_timeouts, {})["gates"]["timeouts"]["pass"] is False


def test_the_open_check_uses_the_largest_part_share() -> None:
    target = DATA["targets"][CASES["o01"]["target"]]["spec"]  # one solid block
    still_solid = {
        **target,
        "parts": [*target["parts"], {**target["parts"][0], "id": "shelf", "label": "shelf"}],
    }
    assert scored("o01", row(result("proposal", still_solid)))["open_ok"] is False


def test_unblinding_refuses_unscored_sheets_and_maps_sheets_to_cases() -> None:
    key = {"model": "m", "sheets": {"Sheet 01": "o01", "Sheet 02": "c01"}}
    with pytest.raises(SystemExit):
        unblind.unblind({"sheets": {"Sheet 01": {"score": 2}}}, key)
    out = unblind.unblind({"sheets": {"Sheet 01": {"score": 2}, "Sheet 02": {"score": 0}}}, key)
    assert out["cases"] == {
        "o01": {"sheet": "Sheet 01", "score": 2},
        "c01": {"sheet": "Sheet 02", "score": 0},
    }


class FakeCandidate:
    model = "fake-model"

    def __init__(self) -> None:
        self.calls: list[str] = []

    def call(self, endpoint: str, body: dict[str, Any]) -> dict[str, Any]:
        self.calls.append(body["instruction"])
        return {
            "http_status": 504,
            "wall_s": 150.1,
            "calls": [],
            "result": None,
            "error": "timeout",
        }


def test_the_runner_resumes_keeps_failures_and_writes_after_each_call(tmp_path: Path) -> None:
    report = {"rows": {"m01": {"http_status": 504, "wall_s": 150.0}}}
    path = tmp_path / "fake-model.json"
    candidate = FakeCandidate()
    runner.run(candidate, DATA, report, path, tmp_path / "models", only=["m01", "m02"])
    assert candidate.calls == [CASES["m02"]["instruction"]]  # m01 was measured: kept, not repeated
    assert json.loads(path.read_text())["rows"]["m01"] == {"http_status": 504, "wall_s": 150.0}
    with pytest.raises(SystemExit):
        runner.main(["--cases", "m01"])  # selecting cases is only for a diagnostic run
