"""GEN-08 evaluation tooling, checked on synthetic rows (no provider calls).

The frozen set has the composition the criteria state and repeats no earlier instruction; a
stated part size enlarged beyond 15 % fails size handling; the gated visual mean counts a
provider error as 0 over every case expecting a drawn change, and the fixed-camera context is
kept apart; provider calls and provenance are counted.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from collections import Counter
from pathlib import Path
from types import ModuleType
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
SET = ROOT / "docs" / "assist-evaluation" / "gen-08"


def load(name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


score = load("score_gen08")
DATA = json.loads((SET / "revisions.json").read_text())
CASES = {c["id"]: c for c in DATA["cases"]}


def test_the_frozen_set_has_its_stated_composition_and_new_instructions() -> None:
    assert len(DATA["cases"]) == 26
    assert Counter(c["category"] for c in DATA["cases"]) == {
        "transparent": 4,
        "small-addition": 4,
        "explicit-colour": 4,
        "occluded": 4,
        "open-structure": 3,
        "partial": 3,
        "stated-size": 3,
        "already-satisfied": 1,
    }
    photo = [c for c in DATA["cases"] if DATA["targets"][c["target"]]["origin"] == "photo"]
    assert len(photo) == 13 and len({c["category"] for c in photo}) >= 6
    assert sum(bool(c["unrepresentable"]) for c in DATA["cases"]) == 5
    assert sum(bool(c["stated_parts"]) for c in DATA["cases"]) == 3
    earlier: set[str] = set()
    for name in ("gen-03", "gen-04", "gen-05", "gen-05-pilot", "gen-08-pilot"):
        earlier |= {
            c["instruction"]
            for c in json.loads((SET.parent / name / "revisions.json").read_text())["cases"]
        }
    earlier |= {
        c["instruction"]
        for c in json.loads((ROOT / "scripts" / "model_revision_cases.json").read_text())
    }
    assert not earlier & {c["instruction"] for c in DATA["cases"]}


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
        "adjustments": [],
        "view": "front-right",
        "provider": {"first_attempt_valid": True, "mode": "live", "model": "m"},
    } | fields


def row(
    res: dict[str, Any] | None, wall: float = 30.0, status: int = 200, calls: int = 1
) -> dict[str, Any]:
    return {
        "http_status": status,
        "wall_s": wall,
        "clock_s": wall,
        "calls": [{"attempt": i, "seconds": wall / calls, "answer": "{}"} for i in range(calls)],
        "result": res,
        "error": None if res else "error",
    }


def with_light(case_id: str, size: float) -> dict[str, Any]:
    before = DATA["targets"][CASES[case_id]["target"]]["spec"]
    first = before["parts"][0]
    light = {
        **first,
        "id": "status-light",
        "label": "status light",
        "material": "signal_green",
        "size_m": {"x": size, "y": size, "z": size},
    }
    return {**before, "parts": [*before["parts"], light]}


def scored(case_id: str, r: dict[str, Any]) -> dict[str, Any]:
    case = CASES[case_id]
    out: dict[str, Any] = score.score_case(case, DATA["targets"][case["target"]], r, 150.0, "m")
    return out


def test_a_stated_part_size_enlarged_beyond_its_margin_fails_size_handling() -> None:
    kept = scored("d1", row(result(with_light("d1", 0.04))))
    assert kept["stated_sizes_kept"] and kept["size_ok"]
    grown = scored("d1", row(result(with_light("d1", 0.08))))
    assert grown["stated_sizes_kept"] is False and grown["size_ok"] is False


def test_the_gated_visual_mean_counts_errors_as_zero_and_the_fixed_camera_stays_apart() -> None:
    rows = [
        scored("s1", row(result(with_light("s1", 0.06)), calls=2)),
        scored("t1", row(None, 150.2, 504)),
    ]
    rows += [scored("a1", row(result(None, outcome="already_satisfied", message="Already.")))]
    dialog = {"s1": {"score": 2}}
    summary = score.summarise(rows, CASES, dialog, {"s1": {"score": 1}})
    visual = summary["gates"]["visual_review"]
    assert visual["n"] == 2 and visual["mean"] == 1.0 and visual["counted_as_zero"] == ["t1"]
    assert visual["rendered_only_mean"] == 2.0
    assert summary["visual_context"]["fixed_gen05_camera"]["mean"] == 1.0
    assert summary["run_conditions"]["provider_calls"] == 4  # 2 + the error's 1 + 1
    assert summary["gates"]["safety"]["pass"]


def test_an_answer_not_labelled_live_with_the_default_model_fails_provenance() -> None:
    recorded = result(
        with_light("s1", 0.06),
        provider={"first_attempt_valid": True, "mode": "recorded", "model": "m"},
    )
    summary = score.summarise([scored("s1", row(recorded))], CASES, {}, {})
    assert (
        summary["gates"]["safety"]["unlabelled"] == ["s1"]
        and not summary["gates"]["safety"]["pass"]
    )
