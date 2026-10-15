"""Evaluate model revisions against the live language model, and record answers for offline tests.

    uv run python scripts/evaluate_model_revisions.py [CASES.json]           run every case live
    uv run python scripts/evaluate_model_revisions.py [CASES.json] --record  also save recordings

Needs VOYAGER_API_KEY (from the environment or .env); the key is never printed or written. Each
case is {"label", "name", "spec", "instruction"}: a geometry draft (fitted here, as the editor
fits it) and one instruction. The default cases file is scripts/model_revision_cases.json.
Results go to docs/assist-evaluation/<revision prompt version>.json; recordings to
fixtures/assist/recorded/revision-<label>.json.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Final

from replay_world_api.assist.prompts import REVISION_PROMPT_VERSION
from replay_world_api.assist.proposals import AssistError
from replay_world_api.assist.provider import (
    Completion,
    OpenAICompatibleProvider,
    ProviderError,
    Task,
)
from replay_world_api.assist.revisions import propose_revision, revision_key
from replay_world_api.objects import fit_to_envelope
from replay_world_api.settings import Settings
from replay_world_contracts import GeometryDraft, GeometrySpec, ModelRevisionProposalRequest

ROOT: Final = Path(__file__).resolve().parents[1]
DEFAULT_CASES: Final = ROOT / "scripts" / "model_revision_cases.json"


class Recorder:
    """Wraps the live provider and keeps every raw answer, for recordings."""

    mode: Any = "live"

    def __init__(self, inner: OpenAICompatibleProvider) -> None:
        self.inner = inner
        self.service, self.base_url, self.model = inner.service, inner.base_url, inner.model
        self.answers: dict[str, list[str]] = {}

    def complete(
        self,
        *,
        task: Task,
        key: str,
        messages: list[dict[str, Any]],
        schema: dict[str, Any],
        attempt: int,
    ) -> Completion:
        completion = self.inner.complete(
            task=task, key=key, messages=messages, schema=schema, attempt=attempt
        )
        self.answers.setdefault(key, []).append(completion.content)
        return completion


def request_for(case: dict[str, Any]) -> ModelRevisionProposalRequest:
    spec, _scale, _notes = fit_to_envelope(GeometryDraft.model_validate(case["spec"]))
    return ModelRevisionProposalRequest(
        name=case["name"], spec=spec, instruction=case["instruction"]
    )


def largest_share(spec: GeometrySpec) -> float:
    """The largest single part's box as a share of the overall box (1.0 = a solid block)."""
    e = spec.envelope_m
    largest = max(p.size_m.x * p.size_m.y * p.size_m.z for p in spec.parts)
    return round(largest / (e.x * e.y * e.z), 3)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("cases", nargs="?", type=Path, default=DEFAULT_CASES)
    parser.add_argument("--record", action="store_true")
    args = parser.parse_args(argv)
    settings = Settings.from_env().assist
    if not settings.api_key:
        print("VOYAGER_API_KEY is not set; live evaluation needs it (see README).", file=sys.stderr)
        return 2
    cases: list[dict[str, Any]] = json.loads(args.cases.read_text())
    recorder = Recorder(OpenAICompatibleProvider(settings))
    rows = []
    keys: dict[str, str] = {}
    for case in cases:
        print(f"revision {case['label']}…", file=sys.stderr)
        request = request_for(case)
        keys[case["label"]] = revision_key(request)
        try:
            result = propose_revision(recorder, request)
        except (ProviderError, AssistError) as exc:
            rows.append({"label": case["label"], "outcome": "error", "error": str(exc)})
            continue
        row: dict[str, Any] = {
            "label": case["label"],
            "instruction": case["instruction"],
            "outcome": result.outcome,
            "message": result.message,
            "attempts": result.provider.attempts,
            "first_attempt_valid": result.provider.first_attempt_valid,
            "latency_s": round(result.provider.latency_ms / 1000, 1),
            "summary": result.summary,
            "size_changed": result.size_changed,
            "checks": result.checks,
            "not_represented": result.not_represented,
            "parts_before": len(request.spec.parts),
            "parts_after": len(result.spec.parts) if result.spec else None,
            "largest_part_share_before": largest_share(request.spec),
        }
        if result.spec:
            row["largest_part_share_after"] = largest_share(result.spec)
            row["parts"] = [
                f"{p.label} ({p.shape}, {p.material}, "
                f"{p.size_m.x:.3f} x {p.size_m.y:.3f} x {p.size_m.z:.3f} m)"
                for p in result.spec.parts
            ]
        rows.append(row)
        print(f"  {row['latency_s']} s, {row['outcome']}", file=sys.stderr)
    report = {
        "date": datetime.now(UTC).isoformat(timespec="seconds"),
        "service": settings.service,
        "base_url": settings.base_url,
        "model": settings.model,
        "prompt_version": REVISION_PROMPT_VERSION,
        "mode": "live, schema-guided",
        "cases": rows,
    }
    out = ROOT / "docs" / "assist-evaluation" / f"{REVISION_PROMPT_VERSION}.json"
    out.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    print(f"Report: {out.relative_to(ROOT)}", file=sys.stderr)
    if args.record:
        directory = settings.recordings_dir
        for case in cases:
            key = keys[case["label"]]
            if key not in recorder.answers:
                continue
            record = {
                "task": "revision",
                "key": key,
                "service": settings.service,
                "model": settings.model,
                "prompt_version": REVISION_PROMPT_VERSION,
                "recorded_at": datetime.now(UTC).strftime("%Y-%m-%d"),
                "note": "Raw answers from the live language model for the revision instruction "
                "above, replayed by the offline test provider. Not live AI when replayed.",
                "responses": recorder.answers[key],
            }
            path = directory / f"revision-{case['label']}.json"
            path.write_text(json.dumps(record, indent=2, ensure_ascii=False) + "\n")
        print(f"Wrote recordings to {directory.relative_to(ROOT)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
