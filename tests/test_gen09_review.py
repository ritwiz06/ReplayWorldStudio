"""GEN-09 review packet and scorer, checked on synthetic answers (no reviewer, no provider).

The packet holds all 25 GEN-08 dialog sheets in a new order, with no case id and no GEN-08 sheet
number on them; the key is kept apart. The scorer refuses an incomplete answer sheet, and
reports the independent mean against the gate and its agreement with the assistant's scores.
"""

from __future__ import annotations

import csv
import importlib.util
import json
import sys
from collections.abc import Collection
from pathlib import Path
from types import ModuleType

import pytest

ROOT = Path(__file__).resolve().parents[1]
PACKET = ROOT / "docs" / "assist-evaluation" / "gen-09-review-packet"
KEY = json.loads(
    (ROOT / "docs" / "assist-evaluation" / "gen-09-review-key" / "key.json").read_text()
)


def load(name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


score = load("score_gen09_review")


def test_the_packet_has_every_gen08_sheet_in_a_new_order_without_identifiers() -> None:
    gen08 = json.loads(
        (ROOT / "docs" / "assist-evaluation" / "gen-08" / "review-dialog.json").read_text()
    )
    assert sorted(KEY["sheets"].values()) == sorted(gen08["cases"])
    assert len(list((PACKET / "sheets").glob("sheet-*.jpg"))) == 25
    # A new order: the GEN-08 sheet numbers do not carry over.
    assert sum(KEY["sheets"][s] == c for s, c in gen08["key"].items()) < 5
    shared = (
        " ".join(p.read_text() for p in PACKET.glob("*.md"))
        + (PACKET / "answers-template.csv").read_text()
    )
    assert not any(f"“{c}”" in shared or f" {c} " in shared for c in KEY["sheets"].values())
    assert "key.json" not in {p.name for p in PACKET.rglob("*")}


def answers(tmp_path: Path, scores: dict[str, int], done: Collection[str] = ()) -> Path:
    path = tmp_path / "answers.csv"
    with path.open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["sheet", "score", "looks_done_but_is_not", "note"])
        for sheet, value in scores.items():
            writer.writerow([sheet, value, "yes" if sheet in done else "no", ""])
    return path


def test_an_incomplete_answer_sheet_is_refused(tmp_path: Path) -> None:
    some = dict(list({s: 2 for s in KEY["sheets"]}.items())[:10])
    with pytest.raises(SystemExit, match="Not scored yet"):
        score.summarise(score.read_answers(answers(tmp_path, some)), KEY["sheets"], {}, {})


def test_the_mean_agreement_and_unwarned_looks_done_are_reported(tmp_path: Path) -> None:
    sheets = KEY["sheets"]
    first, second = sorted(sheets)[:2]
    given = {s: 1 for s in sheets} | {first: 2}
    assistant = {c: 1 for c in sheets.values()} | {sheets[second]: 2}
    warned = {c: False for c in sheets.values()} | {sheets[second]: True}
    result = score.summarise(
        score.read_answers(answers(tmp_path, given, {first, second})), sheets, assistant, warned
    )
    assert result["visual_mean_dialog"] == round(26 / 25, 3) and not result["meets_gate"]
    assert result["agreement_exact"] == "23/25" and result["agreement_within_one"] == "25/25"
    assert result["looks_done_but_is_not_unwarned_in_gen08"] == [sheets[first]]
