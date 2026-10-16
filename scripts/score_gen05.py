"""GEN-05: score a revision run against its set's criteria (docs/assist-evaluation/gen-05/).

    uv run python scripts/score_gen05.py [--set DIR]

Reads <set>/revisions.json, results/<model>.json (never a diagnostic-*.json file) and, when
present, review.json (the visual review, unblinded). Writes <set>/scores.json. The per-case
checks and the gate table are GEN-04's (scripts/score_gen04.py), with GEN-05's additions:

* a **timeout** is a request the user got no answer for in time (HTTP 504) or one that took
  longer than the whole-request budget plus 5 s; a corrected answer cut short by the budget,
  after which the first answer was shown with its problems, is reported separately;
* the **problems** the API showed before Apply, per case, and whether the cases that add
  visible items came back without any;
* **run conditions**: total request time, retries, and run faults (the host paused during a
  request: real time and request timer differ by more than 5 s), listed apart and never
  reclassified.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path
from types import ModuleType
from typing import Any, Final

ROOT: Final = Path(__file__).resolve().parents[1]
DEFAULT_SET: Final = ROOT / "docs" / "assist-evaluation" / "gen-05"
MARGIN_S: Final = 5.0


def _load(name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules.setdefault(name, module)
    spec.loader.exec_module(module)
    return module


g4 = _load("score_gen04")

BUDGET_CUT: Final = ("Not asked to correct this", "did not arrive within")


def score_case(
    case: dict[str, Any], target: dict[str, Any], row: dict[str, Any], budget_s: float
) -> dict[str, Any]:
    out: dict[str, Any] = g4.score_case(case, target, row)
    result = row.get("result") or {}
    out["timeout"] = row["http_status"] == 504 or row["wall_s"] > budget_s + MARGIN_S
    out["clock_s"] = row.get("clock_s")
    if "run_fault" in row:
        out["run_fault"] = row["run_fault"]
    out["problems"] = result.get("problems", [])
    out["budget_cut_retry"] = any(
        any(mark in c for mark in BUDGET_CUT) for c in result.get("checks", [])
    )
    out["colour_notes"] = [c for c in result.get("checks", []) if c.startswith("Coloured ")]
    if case.get("visible_additions") and "geometry" in out:
        out["additions_clear"] = not out["problems"]
    return out


def summarise(rows: list[dict[str, Any]], review: dict[str, Any]) -> dict[str, Any]:
    summary: dict[str, Any] = g4.summarise(rows, review)
    proposals = [r for r in rows if "geometry" in r]
    summary["run_conditions"] = {
        "requests": len(rows),
        "total_request_s": round(sum(r["wall_s"] for r in rows), 1),
        "total_clock_s": round(sum(r["clock_s"] or 0 for r in rows), 1),
        "retried": sum(r["attempts"] > 1 for r in rows),
        "budget_cut_retries": [r["id"] for r in rows if r["budget_cut_retry"]],
        "run_faults": {r["id"]: r["run_fault"] for r in rows if "run_fault" in r},
    }
    summary["visibility"] = {
        "proposals_with_problems": g4.ratio([bool(r["problems"]) for r in proposals]),
        "visible_additions_clear": g4.ratio(
            [r["additions_clear"] for r in rows if "additions_clear" in r]
        ),
        "problems": {r["id"]: r["problems"] for r in rows if r["problems"]},
        "colour_notes": {r["id"]: r["colour_notes"] for r in rows if r["colour_notes"]},
    }
    return summary


def score(data: dict[str, Any], report: dict[str, Any], review: dict[str, Any]) -> dict[str, Any]:
    budget = float(report.get("budget_s", 150.0))
    missing = [c["id"] for c in data["cases"] if c["id"] not in report["rows"]]
    rows = [
        score_case(c, data["targets"][c["target"]], report["rows"][c["id"]], budget)
        for c in data["cases"]
        if c["id"] in report["rows"]
    ]
    return {
        "model": report["model"],
        "missing": missing,
        "summary": summarise(rows, review),
        "cases": rows,
    }


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--set", type=Path, default=DEFAULT_SET)
    args = parser.parse_args(argv)
    data = json.loads((args.set / "revisions.json").read_text())
    review_path = args.set / "review.json"
    review = json.loads(review_path.read_text())["cases"] if review_path.is_file() else {}
    frozen = [
        p
        for p in sorted((args.set / "results").glob("*.json"))
        if not p.name.startswith("diagnostic-")
    ]
    if len(frozen) != 1:
        print(f"Expected one result file, found {len(frozen)}", file=sys.stderr)
        return 2
    out = score(data, json.loads(frozen[0].read_text()), review)
    (args.set / "scores.json").write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    print(json.dumps({"missing": out["missing"], **out["summary"]}, indent=1, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
