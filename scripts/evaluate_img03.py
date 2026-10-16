"""IMG-03: run photos once through the live vision model, keeping everything needed to score them.

    uv run --project services/api python scripts/evaluate_img03.py --split held_out
    uv run --project services/api python scripts/evaluate_img03.py --split development \\
        --model glm-4-5v --cases dev-line-a --out results/probe-glm-4-5v.json

For each annotated photo in docs/assist-evaluation/img-03/annotations/ (of the given split, or the
named cases), the photo's bytes go through the API's own image path (``propose_image``: the same
prompt, schema, checks and one validation retry as ``POST /api/v1/assist/image-proposals``). The
photos are metadata-free JPEGs no larger than 1600 px, the form the browser sends.

Each row keeps: the photo's sha256, the model, the prompt version, request settings (temperature 0,
schema-guided, timeout), the attempts and whether the first was valid, the request time and the
real elapsed time (a difference over 5 s marks a host pause as a run fault), any error, every raw
answer, and the checked ``ImageProposalResult``. A failed case is recorded as failed; nothing is
retried automatically or replaced. A diagnostic re-run goes to its own file (``--out``).

Needs VOYAGER_API_KEY (environment or .env). The key is never printed or written. Live calls are
never made in CI.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Final

from replay_world_api.assist.images import PROMPT_VERSION, propose_image
from replay_world_api.assist.proposals import AssistError
from replay_world_api.assist.provider import (
    Completion,
    OpenAICompatibleProvider,
    ProviderError,
    Task,
)
from replay_world_api.photos import inspect_photo
from replay_world_api.settings import Settings
from replay_world_contracts import ImageAnalysisRequest

ROOT: Final = Path(__file__).resolve().parents[1]
SET: Final = ROOT / "docs" / "assist-evaluation" / "img-03"


class Recorder:
    """Wraps the live provider and keeps every raw answer with its timing."""

    mode: Any = "live"

    def __init__(self, inner: OpenAICompatibleProvider) -> None:
        self.inner = inner
        self.service, self.base_url, self.model = inner.service, inner.base_url, inner.model
        self.calls: list[dict[str, Any]] = []

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
        start = time.monotonic()
        try:
            completion = self.inner.complete(
                task=task,
                key=key,
                messages=messages,
                schema=schema,
                attempt=attempt,
                timeout_s=timeout_s,
            )
        except ProviderError as exc:
            self.calls.append(
                {
                    "attempt": attempt,
                    "seconds": round(time.monotonic() - start, 2),
                    "error": str(exc),
                }
            )
            raise
        self.calls.append(
            {
                "attempt": attempt,
                "seconds": round(time.monotonic() - start, 2),
                "answer": completion.content,
            }
        )
        return completion


def keep_awake() -> str:
    """Keep a Mac awake for as long as this process runs."""
    if platform.system() == "Darwin" and shutil.which("caffeinate"):
        subprocess.Popen(["caffeinate", "-i", "-w", str(os.getpid())])
        return "caffeinate -i -w <pid> (macOS idle and system sleep prevented)"
    return "not managed (no caffeinate); pauses are detected from the two clocks"


def request_for(data: bytes) -> ImageAnalysisRequest:
    info = inspect_photo(data)
    return ImageAnalysisRequest.model_validate(
        {
            "media_type": info.media_type,
            "data_base64": base64.b64encode(data).decode("ascii"),
            "width_px": info.width_px,
            "height_px": info.height_px,
            "original_sha256": hashlib.sha256(data).hexdigest(),
        }
    )


def cases(split: str | None, names: list[str]) -> list[tuple[str, dict[str, Any]]]:
    out = []
    for path in sorted((SET / "annotations").glob("*.annotation.json")):
        a = json.loads(path.read_text())
        name = path.name.removesuffix(".annotation.json")
        if names and name not in names:
            continue
        if split and a["image"]["split"] != split:
            continue
        out.append((name, a))
    return out


def run_case(provider: Recorder, name: str, a: dict[str, Any]) -> dict[str, Any]:
    data = (SET / "photos" / a["image"]["file"]).read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if digest != a["image"]["sha256"]:
        raise SystemExit(f"{name}: the photo differs from its annotation (sha256)")
    provider.calls = []
    row: dict[str, Any] = {
        "case": name,
        "sha256": digest,
        "started_at": datetime.now(UTC).isoformat(timespec="seconds"),
    }
    wall, clock = time.monotonic(), time.time()
    try:
        result = propose_image(provider, request_for(data))
        row["result"] = result.model_dump(mode="json")
        row["error"] = None
    except (ProviderError, AssistError) as exc:
        row["result"] = None
        row["error"] = str(exc)
    row["wall_s"] = round(time.monotonic() - wall, 2)
    row["clock_s"] = round(time.time() - clock, 2)
    if row["clock_s"] - row["wall_s"] > 5:
        row["run_fault"] = (
            f"host paused: clock {row['clock_s']:.0f} s, request timer {row['wall_s']:.0f} s"
        )
    row["calls"] = provider.calls
    return row


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--split", choices=("development", "held_out"))
    parser.add_argument("--cases", nargs="*", default=[])
    parser.add_argument("--model", help="vision model (default: the configured one)")
    parser.add_argument("--out", help="file under img-03/ (default: results/<model>.json)")
    args = parser.parse_args(argv)
    settings = Settings.from_env().assist
    if not settings.api_key:
        print("VOYAGER_API_KEY is not set; the live run needs it (see README).", file=sys.stderr)
        return 2
    model = args.model or settings.vision_model
    out = SET / (args.out or f"results/{model}.json")
    if out.exists():
        print(
            f"{out.relative_to(ROOT)} exists: a run is never overwritten (use --out).",
            file=sys.stderr,
        )
        return 2
    selected = cases(args.split, args.cases)
    if not selected:
        print("No cases selected.", file=sys.stderr)
        return 2
    awake = keep_awake()
    provider = Recorder(OpenAICompatibleProvider(settings, model=model))
    started = datetime.now(UTC).isoformat(timespec="seconds")
    rows = []
    for name, a in selected:
        print(f"{name}…", file=sys.stderr)
        row = run_case(provider, name, a)
        rows.append(row)
        objects = (
            len((row["result"] or {}).get("proposal", {}).get("objects", []))
            if row["result"]
            else 0
        )
        print(
            f"  {row['wall_s']} s, {len(row['calls'])} call(s), {objects} objects, "
            f"error: {row['error']}",
            file=sys.stderr,
        )
        out.parent.mkdir(parents=True, exist_ok=True)
        report = {
            "service": settings.service,
            "base_url": settings.base_url,
            "model": model,
            "prompt_version": PROMPT_VERSION,
            "settings": {
                "temperature": 0,
                "schema_guided": True,
                "timeout_s": settings.timeout_s,
                "validation_retries": 1,
            },
            "split": args.split,
            "awake": awake,
            "started_at": started,
            "rows": rows,
        }
        out.write_text(json.dumps(report, indent=1, ensure_ascii=False) + "\n")
    print(f"Wrote {out.relative_to(ROOT)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
