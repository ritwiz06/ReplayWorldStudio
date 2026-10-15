"""GEN-03: score the live results against the frozen held-out set and the pre-registered criteria.

    uv run python scripts/score_gen03.py

Reads docs/assist-evaluation/gen-03/{descriptions,edits,revisions}.json, results/<model>.json,
edit-scores.json (from apps/web/scripts/assist/score-gen03-edits.ts) and, when present,
review.json (the blind visual review). Writes scores.json with per-case checks and per-model
summaries: counts with denominators, median and p95 waiting time, retries, timeouts and a
categorised failure list. Automatic checks only measure what the files can show; recognisability
comes from the review.
"""

from __future__ import annotations

import json
import re
import statistics
import sys
from pathlib import Path
from typing import Any, Final

from replay_world_api.assist import prompts

ROOT: Final = Path(__file__).resolve().parents[1]
SET: Final = ROOT / "docs" / "assist-evaluation" / "gen-03"
LEAK_MARKS: Final = (
    "VOYAGER_API_KEY",
    "Bearer ",
    prompts.OBJECT_SYSTEM[:60],
    prompts.EDIT_SYSTEM[:60],
    prompts.REVISION_SYSTEM[:60],
)
# Physical claims a description never establishes unless the words state them.
PHYSICAL: Final = re.compile(
    r"\b\d+(?:[.,]\d+)?\s*(?:kg|kilograms?|tonnes?|rpm|bar|psi|kw|kilowatts?|°\s?c|degrees?\s?c|"
    r"m/s|km/h|per\s+(?:hour|minute))\b",
    re.I,
)
# Frozen notes in descriptions.json name the acceptable alternatives for these cases.
DESCRIPTION_ACCEPT: Final = {
    "d25-two-lengths": ("proposal", "clarification"),
    "d31-poison-size": ("proposal", "unsupported"),
}
REVISION_ACCEPT: Final = {"r21": ("unsupported", "proposal")}
AXES: Final = (("width", "x"), ("height", "y"), ("depth", "z"))


def leak(value: Any) -> bool:
    text = json.dumps(value, ensure_ascii=False)
    return any(mark in text for mark in LEAK_MARKS)


def waits(rows: list[dict[str, Any]]) -> dict[str, Any]:
    times = sorted(r["wall_s"] for r in rows if "wall_s" in r)
    if not times:
        return {"n": 0}
    p95 = times[min(len(times) - 1, round(0.95 * (len(times) - 1)))]
    return {
        "n": len(times),
        "median_s": round(statistics.median(times), 1),
        "p95_s": round(p95, 1),
        "max_s": round(times[-1], 1),
    }


def attempts(row: dict[str, Any]) -> int:
    return len([c for c in row.get("calls", []) if "attempt" in c])


def timed_out(row: dict[str, Any]) -> bool:
    return row.get("http_status") == 504 or any(
        "did not answer" in str(c.get("error", "")) for c in row.get("calls", [])
    )


def largest_share(spec: dict[str, Any]) -> float:
    e = spec["envelope_m"]
    volume = float(e["x"] * e["y"] * e["z"])
    return float(
        max(p["size_m"]["x"] * p["size_m"]["y"] * p["size_m"]["z"] for p in spec["parts"]) / volume
    )


def hidden_parts(spec: dict[str, Any]) -> list[str]:
    """Parts whose box lies wholly inside another part's box: a user never sees them."""
    tol = 1e-4
    out = []
    for p in spec["parts"]:
        for q in spec["parts"]:
            if p is q or q["shape"] not in ("box", "rounded_box"):
                continue
            inside = all(
                q["center_m"][a] - q["size_m"][a] / 2 - tol <= p["center_m"][a] - p["size_m"][a] / 2
                and p["center_m"][a] + p["size_m"][a] / 2
                <= q["center_m"][a] + q["size_m"][a] / 2 + tol
                for a in "xyz"
            )
            if inside and p["size_m"]["x"] * p["size_m"]["y"] * p["size_m"]["z"] < (
                q["size_m"]["x"] * q["size_m"]["y"] * q["size_m"]["z"]
            ):
                out.append(p["label"])
                break
    return out


def geometry(spec: dict[str, Any]) -> dict[str, Any]:
    parts = spec["parts"]
    return {
        "hidden_parts": hidden_parts(spec),
        "parts": len(parts),
        "shapes": len({p["shape"] for p in parts}),
        "materials": len({p["material"] for p in parts}),
        "largest_part_share": round(largest_share(spec), 3),
        "envelope_m": [round(spec["envelope_m"][a], 3) for a in "xyz"],
    }


def score_description(case: dict[str, Any], row: dict[str, Any]) -> dict[str, Any]:
    accept = DESCRIPTION_ACCEPT.get(case["id"], (case["expect"],))
    result = row.get("result")
    out: dict[str, Any] = {
        "id": case["id"],
        "category": case["category"],
        "wall_s": row["wall_s"],
        "attempts": attempts(row),
        "timeout": timed_out(row),
        "leak": leak(result or row.get("error")),
    }
    if not result:
        out |= {"outcome": f"error {row['http_status']}", "outcome_ok": False}
        return out
    out["outcome"] = result["outcome"]
    out["outcome_ok"] = result["outcome"] in accept
    out["first_attempt_valid"] = result["provider"]["first_attempt_valid"]
    proposal = result.get("proposal")
    if not proposal:
        return out
    dims = proposal["dimensions"]
    facts = " ".join(proposal["stated_facts"])
    retained: list[str] = []
    silent: list[str] = []
    for stated in case["stated_m"]:
        value = stated["value_m"]
        on_axis = any(
            abs(dims[name]["value_m"] - value) <= 0.001 and dims[name]["basis"] == "stated"
            for name, _ in AXES
        )
        number = re.search(r"\d+(?:[.,]\d+)?", stated["words"])
        quoted = number is not None and number.group(0) in facts
        ok = on_axis or quoted
        (retained if ok else silent).append(stated["words"])
    out["stated_retained"] = f"{len(retained)}/{len(case['stated_m'])}"
    out["stated_not_retained"] = silent
    # A value the API demoted says so in its checks; anything else was changed silently.
    flagged = " ".join(result["checks"])
    out["stated_changed_silently"] = [w for w in silent if w not in flagged]
    invented = [
        f
        for f in proposal["stated_facts"] + proposal["inferred_facts"]
        if PHYSICAL.search(f) and not PHYSICAL.search(case["text"])
    ]
    invented += [
        f
        for f in proposal["stated_facts"]
        if "measured" in f.lower() and "measured" not in case["text"]
    ]
    out["invented_facts"] = invented
    out["not_modelled"] = proposal["not_modelled"]
    if case["expect_not_modelled"]:
        out["not_modelled_ok"] = bool(proposal["not_modelled"])
    out["oversized"] = any(dims[name]["value_m"] >= 30 for name, _ in AXES)
    out["geometry"] = geometry(proposal["spec"])
    out["name"] = proposal["name"]
    out["parts"] = [
        f"{p['label']} ({p['shape']}, {p['material']})" for p in proposal["spec"]["parts"]
    ]
    return out


def check_change(check: str, before: dict[str, Any], after: dict[str, Any]) -> bool:
    kind, _, value = check.partition(":")
    options = value.split("|")
    parts = after["parts"]
    if kind == "material":
        return any(p["material"] in options for p in parts)
    if kind == "part":
        return any(any(o in p["label"].lower() for o in options) for p in parts)
    if kind == "parts":
        return len(parts) >= len(before["parts"]) + int(value.lstrip("+"))
    if kind == "shape":
        return any(p["shape"] in options and "top" in p["label"].lower() for p in parts)
    raise ValueError(check)


def check_size(rule: Any, before: dict[str, float], after: dict[str, float]) -> bool:
    if rule == "keep":
        return all(abs(before[a] - after[a]) <= 1e-6 for a in "xyz")
    ok = True
    for key, value in rule.items():
        axis = {"width": "x", "height": "y", "depth": "z"}[key.split("_")[0]]
        if key.endswith("_delta_m"):
            ok &= abs(after[axis] - (before[axis] + value)) <= 0.01
        elif key.endswith("_factor"):
            ok &= abs(after[axis] - before[axis] * value) <= 0.01
        else:
            ok &= abs(after[axis] - value) <= 0.01
    return ok


def score_revision(
    case: dict[str, Any], target: dict[str, Any], row: dict[str, Any]
) -> dict[str, Any]:
    accept = REVISION_ACCEPT.get(case["id"], (case["expect"],))
    result = row.get("result")
    before = target["spec"]
    out: dict[str, Any] = {
        "id": case["id"],
        "category": case["category"],
        "target_origin": target["origin"],
        "wall_s": row["wall_s"],
        "attempts": attempts(row),
        "timeout": timed_out(row),
        "leak": leak(result or row.get("error")),
    }
    if not result:
        out |= {"outcome": f"error {row['http_status']}", "outcome_ok": False}
        return out
    out["outcome"] = result["outcome"]
    out["outcome_ok"] = result["outcome"] in accept
    out["first_attempt_valid"] = result["provider"]["first_attempt_valid"]
    out["message"] = result["message"]
    out["not_represented"] = result["not_represented"]
    out["checks"] = result["checks"]
    if case["unrepresentable"]:
        text = " ".join(result["not_represented"]).lower()
        out["unrepresentable_listed"] = all(
            any(o in text for o in k.split("|")) for k in case["unrepresentable"]
        )
    after = result.get("spec")
    if not after:
        return out
    out["geometry_before"] = geometry(before)
    out["geometry"] = geometry(after)
    out["summary"] = result["summary"]
    out["change_checks"] = {c: check_change(c, before, after) for c in case["visible_change"]}
    out["change_present"] = all(out["change_checks"].values()) if case["visible_change"] else None
    out["size_ok"] = check_size(case["size"], before["envelope_m"], after["envelope_m"])
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
            if not any(
                ch.startswith("material:") and now.get(p["id"], {}).get("material") != p["material"]
                for ch in case["visible_change"]
            )
        )
    if case["open"]:
        out["open_ok"] = largest_share(after) < 0.5
    out["overlaps_separated"] = sum("was shortened" in c for c in result["checks"])
    out["overlaps_reported"] = sum("may flicker" in c for c in result["checks"])
    out["parts"] = [f"{p['label']} ({p['shape']}, {p['material']})" for p in after["parts"]]
    return out


def rate(items: list[bool]) -> str:
    return f"{sum(items)}/{len(items)}"


Row = dict[str, Any]


def summarise(
    model: str, desc: list[Row], edits: list[Row], revs: list[Row], review: dict[str, Any]
) -> dict[str, Any]:
    proposals = [d for d in desc if d.get("outcome") == "proposal" and "geometry" in d]
    rev_props = [r for r in revs if r.get("outcome") == "proposal" and "geometry" in r]
    edit_props = [e for e in edits if e.get("outcome") == "proposal"]
    stated_total = sum(int(d["stated_retained"].split("/")[1]) for d in proposals)
    stated_kept = sum(int(d["stated_retained"].split("/")[0]) for d in proposals)
    summary: dict[str, Any] = {
        "descriptions": {
            "outcome_as_expected": rate([d["outcome_ok"] for d in desc]),
            "first_attempt_valid": rate([d.get("first_attempt_valid", False) for d in desc]),
            "stated_sizes_retained": f"{stated_kept}/{stated_total}",
            "stated_sizes_changed_silently": sum(
                len(d["stated_changed_silently"]) for d in proposals
            ),
            "invented_facts": sum(len(d["invented_facts"]) for d in proposals),
            "not_modelled_listed": rate(
                [d["not_modelled_ok"] for d in proposals if "not_modelled_ok" in d]
            ),
            "oversized": sum(d["oversized"] for d in proposals),
            "median_parts": statistics.median([d["geometry"]["parts"] for d in proposals])
            if proposals
            else None,
            "with_hidden_parts": rate([bool(d["geometry"]["hidden_parts"]) for d in proposals]),
            "waiting": waits(desc),
            "retries": sum(d["attempts"] > 1 for d in desc),
            "timeouts": sum(d["timeout"] for d in desc),
            "leaks": sum(d["leak"] for d in desc),
        },
        "edits": {
            "outcome_accepted": rate([e.get("accepted", False) for e in edits]),
            "exact_proposals": rate([bool(e.get("exact")) for e in edit_props]),
            "unintended_changes": sum(bool(e.get("unintended_changes")) for e in edits),
            "extreme_applied": sum(
                e["category"] == "extreme" and e.get("outcome") == "proposal" for e in edits
            ),
            "hostile_followed": sum(
                e["category"] == "hostile" and not e.get("accepted", False) for e in edits
            ),
            "waiting": waits(edits),
            "leaks": sum(bool(e.get("leak")) for e in edits),
        },
        "revisions": {
            "outcome_as_expected": rate([r["outcome_ok"] for r in revs]),
            "first_attempt_valid": rate([r.get("first_attempt_valid", False) for r in revs]),
            "change_present": rate(
                [bool(r["change_present"]) for r in rev_props if r["change_present"] is not None]
            ),
            "size_as_asked": rate([r["size_ok"] for r in rev_props]),
            "other_parts_kept": rate(
                [r["other_parts_kept"] for r in rev_props if "other_parts_kept" in r]
            ),
            "open_below_half": rate([r["open_ok"] for r in rev_props if "open_ok" in r]),
            "unrepresentable_listed": rate(
                [r["unrepresentable_listed"] for r in revs if "unrepresentable_listed" in r]
            ),
            "with_hidden_parts": rate([bool(r["geometry"]["hidden_parts"]) for r in rev_props]),
            "overlaps_separated": sum(r["overlaps_separated"] for r in rev_props),
            "overlaps_reported": sum(r["overlaps_reported"] for r in rev_props),
            "waiting": waits(revs),
            "retries": sum(r["attempts"] > 1 for r in revs),
            "timeouts": sum(r["timeout"] for r in revs),
            "leaks": sum(r["leak"] for r in revs),
        },
    }
    scores = review.get(model)
    if scores:
        for workflow in ("descriptions", "revisions"):
            values = [v["score"] for v in scores.get(workflow, {}).values()]
            if values:
                summary[workflow]["visual_review"] = {
                    "n": len(values),
                    "mean": round(statistics.mean(values), 2),
                    "zero": sum(v == 0 for v in values),
                    "two": sum(v == 2 for v in values),
                }
    return summary


def main() -> int:
    descriptions = json.loads((SET / "descriptions.json").read_text())["cases"]
    revisions = json.loads((SET / "revisions.json").read_text())
    edit_scores = (
        json.loads((SET / "edit-scores.json").read_text())
        if (SET / "edit-scores.json").is_file()
        else {}
    )
    review_path = SET / "review.json"
    review = json.loads(review_path.read_text()).get("models", {}) if review_path.is_file() else {}
    out: dict[str, Any] = {"models": {}}
    for path in sorted((SET / "results").glob("*.json")):
        report = json.loads(path.read_text())
        rows = report["rows"]
        desc = [
            score_description(c, rows["descriptions"][c["id"]])
            for c in descriptions
            if c["id"] in rows["descriptions"]
        ]
        revs = [
            score_revision(c, revisions["targets"][c["target"]], rows["revisions"][c["id"]])
            for c in revisions["cases"]
            if c["id"] in rows["revisions"]
        ]
        edits = edit_scores.get(report["model"], [])
        out["models"][report["model"]] = {
            "summary": summarise(report["model"], desc, edits, revs, review),
            "descriptions": desc,
            "edits": edits,
            "revisions": revs,
        }
    (SET / "scores.json").write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    for model, data in out["models"].items():
        print(model)
        for workflow, summary in data["summary"].items():
            print(" ", workflow, json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
