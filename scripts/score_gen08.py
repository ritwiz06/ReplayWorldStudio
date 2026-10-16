"""GEN-08: score a revision run against docs/assist-evaluation/gen-08/criteria.md.

    uv run python scripts/score_gen08.py [--set DIR]

Builds on the GEN-05 scorer (scripts/score_gen05.py: outcomes, change present, size, open,
listing, waiting, timeouts, problems, run conditions) with GEN-08's pre-registered rules:

* **stated part sizes**: where the instruction gives a part's size, the part must not end up
  more than 15 % larger than stated (the app's estimate enlargement must not touch it); this
  is part of "size handled as asked";
* **visual review (gate)**: the "dialog" method (what the updated Improve dialog shows on
  opening), averaged over every case that expects a drawn change; a provider error or a missing
  proposal counts as 0. A warning does not raise a score: a part that cannot be seen scores as
  it looks, outline or not;
* **context, not gated**: the dialog-method mean over rendered proposals only, and the fixed
  GEN-05 camera mean over rendered proposals (a different viewing method, never compared as if
  the review conditions were the same);
* **provider calls** per request and in total, and how many low visual scores carried a
  warning before Apply.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
import statistics
import sys
from pathlib import Path
from types import ModuleType
from typing import Any, Final

ROOT: Final = Path(__file__).resolve().parents[1]
DEFAULT_SET: Final = ROOT / "docs" / "assist-evaluation" / "gen-08"
STATED_MARGIN: Final = 1.15
VISUAL_GATE: Final = 1.2
DRAWN: Final = ("proposal", "partial")


def _load(name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules.setdefault(name, module)
    spec.loader.exec_module(module)
    return module


g5 = _load("score_gen05")


def stated_sizes_kept(
    case: dict[str, Any], result: dict[str, Any] | None, target: dict[str, Any]
) -> bool | None:
    """Every stated size respected by the parts the revision added (None when the case states
    none or has no proposal); parts the object already had are not the ones the user sized."""
    stated = case.get("stated_parts") or []
    spec = (result or {}).get("spec")
    if not stated or not spec:
        return None
    before = {p["id"] for p in target["spec"]["parts"]}
    ok = True
    for item in stated:
        words = item["label"].split("|")
        parts = [
            p
            for p in spec["parts"]
            if p["id"] not in before
            and any(re.search(rf"\b{w}", p["label"].lower()) for w in words)
        ]
        if not parts:
            continue  # absence is judged by "change present"
        largest = max(max(p["size_m"].values()) for p in parts)
        ok &= largest <= item["size_m"] * STATED_MARGIN
    return ok


def score_case(
    case: dict[str, Any],
    target: dict[str, Any],
    row: dict[str, Any],
    budget: float,
    model: str = "",
) -> dict[str, Any]:
    out: dict[str, Any] = g5.score_case(case, target, row, budget)
    result = row.get("result")
    if result:
        provider = result.get("provider", {})
        out["provenance_ok"] = provider.get("mode") == "live" and (
            not model or provider.get("model") == model
        )
    out["provider_calls"] = len([c for c in row.get("calls", []) if "attempt" in c])
    kept = stated_sizes_kept(case, result, target)
    if kept is not None:
        out["stated_sizes_kept"] = kept
        if "size_ok" in out:
            out["size_ok"] = bool(out["size_ok"]) and kept
    if result:
        out["view"] = result.get("view")
        out["adjustments"] = [a["text"] for a in result.get("adjustments", [])]
    return out


def visual(
    rows: list[dict[str, Any]], cases: dict[str, dict[str, Any]], review: dict[str, Any]
) -> dict[str, Any]:
    expected = [r for r in rows if cases[r["id"]]["expect"] in DRAWN]
    scores = []
    for r in expected:
        v = review.get(r["id"])
        scores.append(v["score"] if v and v.get("score") is not None else 0)
    rendered = [
        review[r["id"]]["score"]
        for r in rows
        if r["id"] in review and review[r["id"]].get("score") is not None
    ]
    mean = round(statistics.mean(scores), 2) if scores else None
    return {
        "n": len(scores),
        "mean": mean,
        "distribution": {str(k): scores.count(k) for k in (0, 1, 2)},
        "counted_as_zero": [r["id"] for r in expected if r["id"] not in review],
        "rendered_only_mean": round(statistics.mean(rendered), 2) if rendered else None,
        "gate": f">= {VISUAL_GATE}",
        "pass": None if mean is None or not review else mean >= VISUAL_GATE,
    }


def summarise(
    rows: list[dict[str, Any]],
    cases: dict[str, dict[str, Any]],
    dialog: dict[str, Any],
    fixed: dict[str, Any],
) -> dict[str, Any]:
    summary: dict[str, Any] = g5.summarise(rows, {})
    gates = summary["gates"]
    gates["visual_review"] = visual(rows, cases, dialog)
    fixed_scores = [v["score"] for v in fixed.values() if v.get("score") is not None]
    summary["visual_context"] = {
        "fixed_gen05_camera": {
            "n": len(fixed_scores),
            "mean": round(statistics.mean(fixed_scores), 2) if fixed_scores else None,
            "distribution": {str(k): fixed_scores.count(k) for k in (0, 1, 2)},
            "note": "GEN-05's light-background front-right camera, no edges; a different "
            "viewing method",
        },
        "dialog_rendered_only_mean": gates["visual_review"]["rendered_only_mean"],
    }
    low = [r for r in rows if r["id"] in dialog and (dialog[r["id"]].get("score") or 0) < 2]
    summary["honesty"] = {
        "low_scores_warned": g5.g4.ratio([bool(r.get("problems")) for r in low]),
        "low_scores_without_warning": [r["id"] for r in low if not r.get("problems")],
    }
    summary["run_conditions"]["provider_calls"] = sum(r["provider_calls"] for r in rows)
    summary["stated_sizes_kept"] = g5.g4.ratio(
        [r["stated_sizes_kept"] for r in rows if "stated_sizes_kept" in r]
    )
    summary["adjustments"] = {r["id"]: r["adjustments"] for r in rows if r.get("adjustments")}
    summary["views"] = {
        v: sum(r.get("view") == v for r in rows) for v in ("front-right", "rear-left", "low-front")
    }
    leaks = sum(bool(r.get("leak")) for r in rows)
    unlabelled = [r["id"] for r in rows if r.get("provenance_ok") is False]
    gates["safety"] = {
        "leaks": leaks,
        "unlabelled": unlabelled,
        "gate": "no leaks; every answer labelled live with its model",
        "pass": leaks == 0 and not unlabelled,
    }
    summary["all_gates_pass"] = all(g["pass"] is True for g in gates.values())
    return summary


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--set", type=Path, default=DEFAULT_SET)
    args = parser.parse_args(argv)
    data = json.loads((args.set / "revisions.json").read_text())
    cases = {c["id"]: c for c in data["cases"]}

    def review(name: str) -> dict[str, Any]:
        path = args.set / name
        return json.loads(path.read_text())["cases"] if path.is_file() else {}

    frozen = [
        p
        for p in sorted((args.set / "results").glob("*.json"))
        if not p.name.startswith("diagnostic-")
    ]
    if len(frozen) != 1:
        print(f"Expected one result file, found {len(frozen)}", file=sys.stderr)
        return 2
    report = json.loads(frozen[0].read_text())
    budget = float(report.get("budget_s", 150.0))
    rows = [
        score_case(
            c, data["targets"][c["target"]], report["rows"][c["id"]], budget, report["model"]
        )
        for c in data["cases"]
        if c["id"] in report["rows"]
    ]
    out = {
        "model": report["model"],
        "missing": [c for c in cases if c not in report["rows"]],
        "summary": summarise(
            rows, cases, review("review-dialog.json"), review("review-fixed.json")
        ),
        "cases": rows,
    }
    (args.set / "scores.json").write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    print(json.dumps({"missing": out["missing"], **out["summary"]}, indent=1, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
