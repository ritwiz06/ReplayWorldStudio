"""GEN-05: turn the visual review of numbered sheets into per-case scores, after scoring.

    uv run python scripts/unblind_gen05_review.py REVIEW_BLIND.json SHEET_KEY.json [--set DIR]

REVIEW_BLIND.json holds the reviewer's scores per sheet, written from the pictures alone:

    {"reviewer": "...", "method": "...",
     "sheets": {"Sheet 01": {"score": 2, "corrections": 0, "note": "..."}, ...}}

``score`` is 0, 1 or 2 as defined in criteria.md; ``corrections`` is the number of sizes or parts
the reviewer would still change before applying. SHEET_KEY.json is sheet-key.json from
apps/web/scripts/assist/render-gen04.ts. The result, docs/assist-evaluation/gen-04/review.json,
keeps the blind sheets, the key and the per-case view; it refuses to run if any sheet in the key
has not been scored.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Final

DEFAULT_SET: Final = Path(__file__).resolve().parents[1] / "docs" / "assist-evaluation" / "gen-05"


def unblind(review: dict[str, Any], key: dict[str, Any]) -> dict[str, Any]:
    sheets = review["sheets"]
    missing = [sheet for sheet in key["sheets"] if sheets.get(sheet, {}).get("score") is None]
    if missing:
        raise SystemExit(f"Not scored yet: {', '.join(missing)}")
    cases = {case: {"sheet": sheet, **sheets[sheet]} for sheet, case in key["sheets"].items()}
    return {**review, "model": key["model"], "key": key["sheets"], "cases": cases}


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("review", type=Path)
    parser.add_argument("key", type=Path)
    parser.add_argument("--set", type=Path, default=DEFAULT_SET)
    parser.add_argument("--out-name", default="review.json", help="file name inside the set")
    args = parser.parse_args(argv)
    out = args.set / args.out_name
    review = json.loads(args.review.read_text())
    key = json.loads(args.key.read_text())
    out.write_text(json.dumps(unblind(review, key), indent=1, ensure_ascii=False) + "\n")
    print(f"Wrote {out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
