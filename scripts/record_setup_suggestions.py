"""Record live "Suggest setup" answers for offline tests (SIM-01).

    uv run python scripts/record_setup_suggestions.py

Needs VOYAGER_API_KEY. Sends each case's description and the names, kinds and sizes of the
reviewed objects of a synthetic fixture drawing (no image, nothing else) to the configured
language model, checks the answer exactly as the API does, and writes the raw answers to
fixtures/assist/recorded/setup-<case>.json, which the recorded provider replays offline.
"""

from __future__ import annotations

import json
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from replay_world_api.assist.provider import Completion, OpenAICompatibleProvider, Task
from replay_world_api.assist.setup import PROMPT_VERSION, request_key, suggest_setup
from replay_world_api.settings import Settings
from replay_world_contracts import ProcessSuggestionRequest

ROOT = Path(__file__).resolve().parents[1]

# The objects a reviewed layout-checks-mm.dxf offers as stations (equipment and structures,
# not the floor or the keep-clear zone), as the browser lists them.
CASES: dict[str, dict[str, Any]] = {
    "layout-checks": {
        "analysis": "fixtures/drawings/layout-checks-mm.analysis.json",
        "description": "Material is taken from Rack A, mixed in the Mixer, formed on Machine B "
        "and packed at the packing table.",
    },
}


class Recorder:
    """Wraps the live provider and keeps every raw answer, for recordings."""

    mode: Any = "live"

    def __init__(self, inner: OpenAICompatibleProvider) -> None:
        self.inner = inner
        self.service, self.base_url, self.model = inner.service, inner.base_url, inner.model
        self.answers: list[str] = []

    def complete(
        self,
        *,
        task: Task,
        key: str,
        messages: list[dict[str, Any]],
        schema: dict[str, Any],
        attempt: int,
        timeout_s: float | None = None,
    ) -> Completion:
        completion = self.inner.complete(
            task=task,
            key=key,
            messages=messages,
            schema=schema,
            attempt=attempt,
            timeout_s=timeout_s,
        )
        self.answers.append(completion.content)
        return completion


def request_for(case: dict[str, Any]) -> ProcessSuggestionRequest:
    data = json.loads((ROOT / case["analysis"]).read_text())
    drawing = data["drawing"]
    mm = 0.001 if drawing["units"]["declared"] == "mm" else 1.0
    objects = [
        {
            "id": o["object_id"],
            "name": o["label"],
            "kind": o["kind"],
            "width_m": round(o["width"] * mm, 3),
            "depth_m": round(o["depth"] * mm, 3),
        }
        for o in drawing["objects"]
        if o["role"] != "floor" and o["kind"] in ("equipment", "structure")
    ]
    return ProcessSuggestionRequest.model_validate(
        {"description": case["description"], "objects": objects}
    )


def main() -> int:
    settings = Settings.from_env().assist
    if not settings.api_key:
        print("VOYAGER_API_KEY is not set; recording needs it (see README).", file=sys.stderr)
        return 2
    for name, case in CASES.items():
        request = request_for(case)
        recorder = Recorder(OpenAICompatibleProvider(settings))
        result = suggest_setup(recorder, request)
        print(json.dumps(result.model_dump(mode="json"), indent=1)[:3000], file=sys.stderr)
        record = {
            "task": "setup",
            "key": request_key(request),
            "case": name,
            "description": case["description"],
            "service": settings.service,
            "model": recorder.model,
            "prompt_version": PROMPT_VERSION,
            "recorded_at": datetime.now(UTC).strftime("%Y-%m-%d"),
            "note": "Raw answers from the live language model for the synthetic drawing named above, replayed by the offline test provider. Not live AI when replayed.",  # noqa: E501
            "responses": recorder.answers,
        }
        out = settings.recordings_dir / f"setup-{name}.json"
        out.write_text(json.dumps(record, indent=2) + "\n")
        print(f"Wrote {out.relative_to(ROOT)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
