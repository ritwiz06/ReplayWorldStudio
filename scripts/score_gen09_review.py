"""GEN-09: score an independent review of the blinded GEN-08 sheets, after it is complete.

    uv run --project services/api python scripts/score_gen09_review.py ANSWERS.csv \\
        --reviewer "R1 (independent; how recruited)" \\
        [--out docs/assist-evaluation/gen-09-review/R1.json]

ANSWERS.csv is a filled copy of gen-09-review-packet/answers-template.csv. The key
(gen-09-review-key/key.json) is opened only here, after every sheet is scored. The result gives
the independent visual mean (dialog method, the GEN-08 gate's denominator of 25), agreement with
the assistant's own GEN-08 scores (which are not changed), and how many sheets the reviewer found
"looks done but is not" that carried no warning in GEN-08.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path
from typing import Any, Final

ROOT: Final = Path(__file__).resolve().parents[1]
KEY: Final = ROOT / "docs" / "assist-evaluation" / "gen-09-review-key" / "key.json"
GEN08: Final = ROOT / "docs" / "assist-evaluation" / "gen-08"
GATE: Final = 1.2


def read_answers(path: Path) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    with path.open(newline="") as handle:
        for row in csv.DictReader(handle):
            sheet = row["sheet"].strip()
            score = row["score"].strip()
            if score not in {"0", "1", "2"}:
                raise SystemExit(f"{sheet}: score must be 0, 1 or 2 (got {score!r})")
            done = row["looks_done_but_is_not"].strip().lower()
            if done not in {"yes", "no", "y", "n"}:
                raise SystemExit(f"{sheet}: looks_done_but_is_not must be yes or no (got {done!r})")
            out[sheet] = {
                "score": int(score),
                "looks_done_but_is_not": done.startswith("y"),
                "note": row.get("note", "").strip(),
            }
    return out


def summarise(
    answers: dict[str, dict[str, Any]],
    key: dict[str, str],
    assistant: dict[str, int],
    warned: dict[str, bool],
) -> dict[str, Any]:
    missing = sorted(set(key) - set(answers))
    if missing:
        raise SystemExit(f"Not scored yet: {', '.join(missing)}")
    cases = {case: {"sheet": sheet, **answers[sheet]} for sheet, case in key.items()}
    scores = [c["score"] for c in cases.values()]
    mean = sum(scores) / len(scores)
    same = sum(cases[c]["score"] == assistant[c] for c in cases)
    within_one = sum(abs(cases[c]["score"] - assistant[c]) <= 1 for c in cases)
    misleading = sorted(c for c in cases if cases[c]["looks_done_but_is_not"])
    return {
        "visual_mean_dialog": round(mean, 3),
        "distribution": {str(s): scores.count(s) for s in (2, 1, 0)},
        "gate": GATE,
        "meets_gate": mean >= GATE,
        "assistant_mean_dialog": round(sum(assistant[c] for c in cases) / len(cases), 3),
        "agreement_exact": f"{same}/{len(cases)}",
        "agreement_within_one": f"{within_one}/{len(cases)}",
        "differences": {
            c: {"independent": cases[c]["score"], "assistant": assistant[c]}
            for c in sorted(cases)
            if cases[c]["score"] != assistant[c]
        },
        "looks_done_but_is_not": misleading,
        "looks_done_but_is_not_unwarned_in_gen08": [c for c in misleading if not warned[c]],
        "cases": cases,
    }


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("answers", type=Path)
    parser.add_argument("--reviewer", required=True, help="who reviewed, and how independent")
    parser.add_argument("--out", type=Path)
    args = parser.parse_args(argv)
    key = json.loads(KEY.read_text())["sheets"]
    review = json.loads((GEN08 / "review-dialog.json").read_text())["cases"]
    rows = json.loads((GEN08 / "results" / "qwen3-235b-a22b-instruct-2507.json").read_text())[
        "rows"
    ]
    assistant = {case: int(review[case]["score"]) for case in key.values()}
    warned = {case: bool((rows[case]["result"] or {}).get("problems")) for case in key.values()}
    result = {
        "reviewer": args.reviewer,
        "method": "GEN-09 blinded packet of the GEN-08 dialog sheets (gen-09-review-packet)",
        **summarise(read_answers(args.answers), key, assistant, warned),
    }
    text = json.dumps(result, indent=1, ensure_ascii=False) + "\n"
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(text)
        print(f"Wrote {args.out}", file=sys.stderr)
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
