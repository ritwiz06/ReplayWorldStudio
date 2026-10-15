"""GEN-04: turn the visual review of numbered sheets into per-case scores, after scoring.

    uv run python scripts/unblind_gen04_review.py REVIEW_BLIND.json SHEET_KEY.json

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

import json
import sys
from pathlib import Path
from typing import Any, Final

OUT: Final = (
    Path(__file__).resolve().parents[1] / "docs" / "assist-evaluation" / "gen-04" / "review.json"
)


def unblind(review: dict[str, Any], key: dict[str, Any]) -> dict[str, Any]:
    sheets = review["sheets"]
    missing = [sheet for sheet in key["sheets"] if sheets.get(sheet, {}).get("score") is None]
    if missing:
        raise SystemExit(f"Not scored yet: {', '.join(missing)}")
    cases = {case: {"sheet": sheet, **sheets[sheet]} for sheet, case in key["sheets"].items()}
    return {**review, "model": key["model"], "key": key["sheets"], "cases": cases}


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    review = json.loads(Path(argv[0]).read_text())
    key = json.loads(Path(argv[1]).read_text())
    OUT.write_text(json.dumps(unblind(review, key), indent=1, ensure_ascii=False) + "\n")
    print(f"Wrote {OUT}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
