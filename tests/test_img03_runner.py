"""IMG-03 live runner, checked with a stub provider (no network, no key, never in CI as live).

Every row is written before anything else is done with it, so an answer without a proposal (the
case that once crashed the progress line and lost an answer) is kept; a provider error is a
recorded failure, not a retry; a result file is never overwritten; no key is written.
"""

from __future__ import annotations

import importlib.util
import json
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType, SimpleNamespace
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[1]
SET = ROOT / "docs" / "assist-evaluation" / "img-03"
CASE = "dev-office-a"


def load(name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


runner = load("evaluate_img03")
from replay_world_api.assist.provider import Completion, ProviderError  # noqa: E402

RECORDED = json.loads((SET / "development" / "qwen3-vl-32b-instruct.json").read_text())
ANSWER = next(r for r in RECORDED["rows"] if r["case"] == CASE)["calls"][0]["answer"]
NOTHING_ON_THE_FLOOR = json.dumps(
    {"floor_rectangles": [], "objects": [], "scene": "room_or_work_area", "visible_text": []}
)


@dataclass
class Stub:
    answers: list[str | ProviderError]
    service: str = "ASU Voyager"
    base_url: str = "https://example.invalid/v1"
    model: str = "stub-vision"

    def complete(self, **_: Any) -> Completion:
        answer = self.answers.pop(0)
        if isinstance(answer, ProviderError):
            raise answer
        return Completion(content=answer, latency_ms=1)


@pytest.fixture
def workspace(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    for sub in ("photos", "annotations"):
        (tmp_path / sub).mkdir()
    shutil.copy(SET / "photos" / f"{CASE}.jpg", tmp_path / "photos")
    shutil.copy(SET / "annotations" / f"{CASE}.annotation.json", tmp_path / "annotations")
    monkeypatch.setattr(runner, "SET", tmp_path)
    monkeypatch.setattr(runner, "ROOT", tmp_path)
    monkeypatch.setattr(runner, "keep_awake", lambda: "test")
    return tmp_path


def run(monkeypatch: pytest.MonkeyPatch, answers: list[str | ProviderError], out: str) -> int:
    settings = SimpleNamespace(
        service="ASU Voyager",
        base_url="https://example.invalid/v1",
        vision_model="stub-vision",
        timeout_s=150.0,
        api_key="sk-never-written",
    )
    monkeypatch.setattr(
        runner, "Settings", SimpleNamespace(from_env=lambda: SimpleNamespace(assist=settings))
    )
    monkeypatch.setattr(
        runner, "OpenAICompatibleProvider", lambda _s, model: Stub(list(answers), model=model)
    )
    code: int = runner.main(["--cases", CASE, "--out", out])
    return code


def test_an_answer_is_kept_with_its_raw_text_timing_and_no_key(
    workspace: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    assert run(monkeypatch, [ANSWER], "results/ok.json") == 0
    text = (workspace / "results" / "ok.json").read_text()
    [row] = json.loads(text)["rows"]
    assert row["error"] is None and row["result"]["outcome"] == "proposal"
    assert row["calls"][0]["answer"] == ANSWER and row["wall_s"] >= 0
    assert "sk-never-written" not in text


def test_an_answer_without_a_proposal_is_written_not_lost(
    workspace: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    assert run(monkeypatch, [NOTHING_ON_THE_FLOOR], "results/empty.json") == 0
    [row] = json.loads((workspace / "results" / "empty.json").read_text())["rows"]
    assert row["result"]["outcome"] == "unsupported" and row["result"]["proposal"] is None
    assert row["calls"][0]["answer"] == NOTHING_ON_THE_FLOOR


def test_a_provider_error_is_a_recorded_failure_and_a_result_is_never_overwritten(
    workspace: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    timeout = ProviderError("timeout", "ASU Voyager did not answer within 150 s.")
    assert run(monkeypatch, [timeout], "results/error.json") == 0
    [row] = json.loads((workspace / "results" / "error.json").read_text())["rows"]
    assert row["result"] is None and "did not answer" in row["error"]
    assert [c.get("error") for c in row["calls"]] == ["ASU Voyager did not answer within 150 s."]
    assert run(monkeypatch, [ANSWER], "results/error.json") == 2  # refused: never overwritten
