"""GEN-03: turn the blind visual review into per-model scores, after scoring is finished.

    uv run python scripts/unblind_gen03_review.py REVIEW_BLIND.json KEY.json

REVIEW_BLIND.json holds the reviewer's scores per sheet and option, written without the key:

    {"reviewer": "...", "method": "...",
     "sheets": {"descriptions/d01-locker": {"Option 1": {"score": 2, "corrections": 1,
                                                          "note": "..."}, "Option 2": {...}}}}

``score`` is 0, 1 or 2 as defined in criteria.md; ``corrections`` is the number of sizes or
parts the reviewer would still change before placing (descriptions) or before applying
(revisions). KEY.json is blind-key.json from apps/web/scripts/assist/render-gen03.ts. The result,
docs/assist-evaluation/gen-03/review.json, keeps both the blind sheets and the per-model view; it
refuses to run if any sheet in the key has not been scored.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Final

OUT: Final = (
    Path(__file__).resolve().parents[1] / "docs" / "assist-evaluation" / "gen-03" / "review.json"
)


def unblind(review: dict[str, Any], key: dict[str, dict[str, str]]) -> dict[str, Any]:
    sheets = review["sheets"]
    missing = [
        f"{sheet} {option}"
        for sheet, options in key.items()
        for option in options
        if option not in sheets.get(sheet, {})
    ]
    if missing:
        raise SystemExit(f"Not scored yet: {', '.join(missing[:10])}")
    models: dict[str, dict[str, dict[str, Any]]] = {}
    for sheet, options in key.items():
        workflow, case = sheet.split("/")
        for option, model in options.items():
            models.setdefault(model, {}).setdefault(workflow, {})[case] = sheets[sheet][option]
    return {**review, "key": key, "models": models}


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
