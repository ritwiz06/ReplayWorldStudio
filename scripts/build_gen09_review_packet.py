"""GEN-09: a fresh blinded packet of the GEN-08 dialog sheets for an independent reviewer.

    uv run --project services/api python scripts/build_gen09_review_packet.py

Copies the 25 GEN-08 dialog renders (docs/assist-evaluation/gen-08/renders/dialog/) into
``docs/assist-evaluation/gen-09-review-packet/sheets/`` in a new shuffled order, with the old
sheet number cropped off each picture (macOS ``sips``), so neither the GEN-08 order nor its key
identifies a case. The key goes to ``docs/assist-evaluation/gen-09-review-key/key.json``, which
is never shared with the reviewer. The pictures are not re-rendered and the GEN-08 results are
not touched.
"""

from __future__ import annotations

import json
import random
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Final

ROOT: Final = Path(__file__).resolve().parents[1]
GEN08: Final = ROOT / "docs" / "assist-evaluation" / "gen-08"
PACKET: Final = ROOT / "docs" / "assist-evaluation" / "gen-09-review-packet"
KEY: Final = ROOT / "docs" / "assist-evaluation" / "gen-09-review-key"
SEED: Final = 9090
HEADER_PX: Final = 22  # the "Sheet NN" line at the top of each GEN-08 sheet


def main() -> int:
    renders = sorted((GEN08 / "renders" / "dialog").glob("*.jpg"))
    cases = [p.stem for p in renders]
    if len(cases) != 25:
        print(f"Expected the 25 GEN-08 dialog sheets, found {len(cases)}", file=sys.stderr)
        return 2
    order = cases[:]
    random.Random(SEED).shuffle(order)
    sheets = PACKET / "sheets"
    if sheets.exists():
        shutil.rmtree(sheets)
    sheets.mkdir(parents=True)
    key: dict[str, str] = {}
    for n, case in enumerate(order, start=1):
        name = f"Sheet {n:02d}"
        key[name] = case
        source = GEN08 / "renders" / "dialog" / f"{case}.jpg"
        out = sheets / f"sheet-{n:02d}.jpg"
        size = subprocess.run(
            ["sips", "-g", "pixelHeight", "-g", "pixelWidth", str(source)],
            check=True,
            capture_output=True,
            text=True,
        ).stdout
        height = int(size.split("pixelHeight:")[1].split()[0])
        width = int(size.split("pixelWidth:")[1].split()[0])
        # sips silently skips a crop that reaches the very bottom edge: leave one pixel row.
        keep = height - HEADER_PX - 1
        subprocess.run(
            [
                "sips",
                "--cropOffset",
                str(HEADER_PX),
                "0",
                "-c",
                str(keep),
                str(width),
                str(source),
                "--out",
                str(out),
            ],
            check=True,
            capture_output=True,
        )
        cropped = subprocess.run(
            ["sips", "-g", "pixelHeight", str(out)], check=True, capture_output=True, text=True
        ).stdout
        if int(cropped.split("pixelHeight:")[1].split()[0]) != keep:
            print(f"Could not crop the old sheet number off {source.name}", file=sys.stderr)
            return 1
    KEY.mkdir(parents=True, exist_ok=True)
    (KEY / "key.json").write_text(
        json.dumps(
            {
                "source": "docs/assist-evaluation/gen-08/renders/dialog (GEN-08 dialog method)",
                "seed": SEED,
                "model": "qwen3-235b-a22b-instruct-2507",
                "sheets": key,
            },
            indent=1,
        )
        + "\n"
    )
    lines = ["sheet,score,looks_done_but_is_not,note"] + [f"{s},,," for s in key]
    (PACKET / "answers-template.csv").write_text("\n".join(lines) + "\n")
    print(f"Wrote {len(key)} sheets to {PACKET.relative_to(ROOT)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
