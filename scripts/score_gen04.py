"""GEN-04: score the frozen revision run against docs/assist-evaluation/gen-04/criteria.md.

    uv run python scripts/score_gen04.py

Reads revisions.json, results/<model>.json (never a diagnostic-*.json file) and, when present,
review.json (the visual review, unblinded). Writes scores.json: per-case checks, the gate table
with every numerator and denominator, waiting times and a failure list. The size, change, openness
and geometry checks are the GEN-03 scorer's own functions; the outcome and listing rules are the
GEN-04 ones (partial, unsupported, already satisfied).
"""

from __future__ import annotations

import importlib.util
import json
import statistics
import sys
from pathlib import Path
from types import ModuleType
from typing import Any, Final

ROOT: Final = Path(__file__).resolve().parents[1]
SET: Final = ROOT / "docs" / "assist-evaluation" / "gen-04"


def _gen03() -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        "score_gen03", ROOT / "scripts" / "score_gen03.py"
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules.setdefault("score_gen03", module)
    spec.loader.exec_module(module)
    return module


g3 = _gen03()

# Gates from criteria.md: (numerator/denominator measure, minimum share).
GATES: Final = {
    "outcome_as_expected": 0.85,
    "change_present": 0.75,
    "size_as_asked": 0.90,
    "open_below_half": 0.90,
    "unrepresentable_listed": 0.80,
}
VISUAL_GATE: Final = 1.2
MEDIAN_GATE_S: Final = 60.0
TIMEOUT_GATE: Final = 0.05


def outcome_ok(expect: str, result: dict[str, Any] | None) -> bool:
    if not result:
        return False
    if expect == "partial":
        return result["outcome"] == "proposal" and bool(result["partial"])
    return bool(result["outcome"] == expect)


def listed(case: dict[str, Any], result: dict[str, Any] | None) -> bool:
    """Every unrepresentable keyword group appears in the not-represented list."""
    text = " ".join((result or {}).get("not_represented", [])).lower()
    return all(any(o in text for o in k.split("|")) for k in case["unrepresentable"])


def score_case(case: dict[str, Any], target: dict[str, Any], row: dict[str, Any]) -> dict[str, Any]:
    result = row.get("result")
    before = target["spec"]
    out: dict[str, Any] = {
        "id": case["id"],
        "category": case["category"],
        "expect": case["expect"],
        "target_origin": target["origin"],
        "wall_s": row["wall_s"],
        "attempts": g3.attempts(row),
        "answer_chars": [len(c.get("answer", "")) for c in row.get("calls", []) if "answer" in c],
        "timeout": g3.timed_out(row),
        "leak": g3.leak(result or row.get("error")),
        "outcome": result["outcome"] if result else f"error {row['http_status']}",
        "partial": bool(result and result["partial"]),
        "outcome_ok": outcome_ok(case["expect"], result),
    }
    if case["unrepresentable"]:
        out["unrepresentable_listed"] = listed(case, result)
    if not result:
        out["error"] = row.get("error")
        return out
    out |= {
        "first_attempt_valid": result["provider"]["first_attempt_valid"],
        "message": result["message"],
        "not_represented": result["not_represented"],
        "checks": result["checks"],
    }
    if not case["unrepresentable"] and result["not_represented"]:
        out["unexpected_listing"] = result["not_represented"]
    after = result.get("spec")
    if not after:
        return out
    out["geometry_before"] = g3.geometry(before)
    out["geometry"] = g3.geometry(after)
    out["summary"] = result["summary"]
    if case["visible_change"]:
        out["change_checks"] = {
            c: g3.check_change(c, before, after) for c in case["visible_change"]
        }
        out["change_present"] = all(out["change_checks"].values())
    out["size_ok"] = g3.check_size(case["size"], before["envelope_m"], after["envelope_m"])
    if case["keep_other_parts"]:
        now = {p["id"]: p for p in after["parts"]}
        out["other_parts_kept"] = all(
            p["id"] in now
            and all(
                abs(now[p["id"]][k][a] - p[k][a]) <= 1e-4
                for k in ("center_m", "size_m")
                for a in "xyz"
            )
            for p in before["parts"]
        )
    if case["open"]:
        out["open_ok"] = g3.largest_share(after) < 0.5
    out["overlaps_separated"] = sum("was shortened" in c for c in result["checks"])
    out["parts"] = [f"{p['label']} ({p['shape']}, {p['material']})" for p in after["parts"]]
    return out


def ratio(items: list[bool]) -> dict[str, Any]:
    n = len(items)
    return {"passed": sum(items), "of": n, "share": round(sum(items) / n, 3) if n else None}


def failures(rows: list[dict[str, Any]]) -> list[str]:
    out = []
    for r in rows:
        why = []
        if not r["outcome_ok"]:
            why.append(
                f"outcome {r['outcome']}{' (partial)' if r['partial'] else ''}, "
                f"expected {r['expect']}"
            )
        if r.get("change_present") is False:
            why.append("missing " + ", ".join(c for c, ok in r["change_checks"].items() if not ok))
        if r.get("size_ok") is False:
            why.append("size not as asked")
        if r.get("open_ok") is False:
            why.append(f"not open (largest part {r['geometry']['largest_part_share']:.0%})")
        if r.get("unrepresentable_listed") is False:
            why.append(f"not listed: {r.get('not_represented', [])}")
        if r["timeout"]:
            why.append("timeout")
        if why:
            out.append(f"{r['id']} ({r['category']}): " + "; ".join(why))
    return out


def summarise(rows: list[dict[str, Any]], review: dict[str, Any]) -> dict[str, Any]:
    proposals = [r for r in rows if "geometry" in r]
    measures = {
        "outcome_as_expected": ratio([r["outcome_ok"] for r in rows]),
        "change_present": ratio([r["change_present"] for r in proposals if "change_present" in r]),
        "size_as_asked": ratio([r["size_ok"] for r in proposals]),
        "open_below_half": ratio([r["open_ok"] for r in proposals if "open_ok" in r]),
        "unrepresentable_listed": ratio(
            [r["unrepresentable_listed"] for r in rows if "unrepresentable_listed" in r]
        ),
    }
    gates = {
        name: {
            **measures[name],
            "gate": f">= {limit:.0%}",
            "pass": measures[name]["of"] > 0 and measures[name]["share"] >= limit,
        }
        for name, limit in GATES.items()
    }
    wait = g3.waits(rows)
    timeouts = sum(r["timeout"] for r in rows)
    gates["waiting_median"] = {
        **wait,
        "gate": f"<= {MEDIAN_GATE_S:.0f} s",
        "pass": wait.get("median_s", 1e9) <= MEDIAN_GATE_S,
    }
    gates["timeouts"] = {
        "timeouts": timeouts,
        "of": len(rows),
        "gate": f"<= {TIMEOUT_GATE:.0%}",
        "pass": timeouts <= TIMEOUT_GATE * len(rows),
    }
    scores = [v["score"] for v in review.values() if v.get("score") is not None]
    if scores:
        mean = round(statistics.mean(scores), 2)
        gates["visual_review"] = {
            "n": len(scores),
            "mean": mean,
            "zero": scores.count(0),
            "two": scores.count(2),
            "gate": f">= {VISUAL_GATE}",
            "pass": mean >= VISUAL_GATE,
        }
    else:
        gates["visual_review"] = {
            "n": 0,
            "gate": f">= {VISUAL_GATE}",
            "pass": None,
            "note": "not reviewed yet",
        }
    return {
        "gates": gates,
        "all_gates_pass": all(g["pass"] is True for g in gates.values()),
        "diagnostics": {
            "proposals": len(proposals),
            "partial_proposals": sum(r["partial"] for r in proposals),
            "first_attempt_valid": ratio([r.get("first_attempt_valid", False) for r in rows]),
            "retried": sum(r["attempts"] > 1 for r in rows),
            "other_parts_kept": ratio(
                [r["other_parts_kept"] for r in proposals if "other_parts_kept" in r]
            ),
            "unexpected_listings": [r["id"] for r in rows if r.get("unexpected_listing")],
            "with_hidden_parts": ratio([bool(r["geometry"]["hidden_parts"]) for r in proposals]),
            "overlaps_separated": sum(r["overlaps_separated"] for r in proposals),
            "answer_chars_max": max((max(r["answer_chars"], default=0) for r in rows), default=0),
            "leaks": sum(r["leak"] for r in rows),
            "by_group": {
                g: ratio([r["outcome_ok"] for r in rows if r["category"] == g])
                for g in dict.fromkeys(r["category"] for r in rows)
            },
        },
        "failures": failures(rows),
    }


def score(data: dict[str, Any], report: dict[str, Any], review: dict[str, Any]) -> dict[str, Any]:
    missing = [c["id"] for c in data["cases"] if c["id"] not in report["rows"]]
    rows = [
        score_case(c, data["targets"][c["target"]], report["rows"][c["id"]])
        for c in data["cases"]
        if c["id"] in report["rows"]
    ]
    return {
        "model": report["model"],
        "missing": missing,
        "summary": summarise(rows, review),
        "cases": rows,
    }


def main() -> int:
    data = json.loads((SET / "revisions.json").read_text())
    review_path = SET / "review.json"
    review = json.loads(review_path.read_text())["cases"] if review_path.is_file() else {}
    frozen = [
        p for p in sorted((SET / "results").glob("*.json")) if not p.name.startswith("diagnostic-")
    ]
    if len(frozen) != 1:
        print(f"Expected one frozen result file, found {len(frozen)}", file=sys.stderr)
        return 2
    out = score(data, json.loads(frozen[0].read_text()), review)
    (SET / "scores.json").write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    print(json.dumps({"missing": out["missing"], **out["summary"]}, indent=1, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
