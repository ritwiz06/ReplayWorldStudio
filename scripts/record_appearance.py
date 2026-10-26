"""Record live appearance proposals from reference photos, for offline tests (ENR-01).

    uv run python scripts/record_appearance.py                  # show what each case would send
    uv run python scripts/record_appearance.py --run            # send them (live provider calls)
    uv run python scripts/record_appearance.py --run --only machine-b

Read-only by default: without ``--run`` nothing is sent. With it, each case sends one crop of a
permitted photo (a metadata-free JPEG made in Chromium by apps/web/scripts/reference-crop.mjs,
as the app makes it), the object's name and its recorded size, and nothing else, to the
configured vision model, and checks the answer exactly as the API does. Needs VOYAGER_API_KEY in
.env; the key is never printed or written.

Every provider call is appended to docs/enr-01/live-calls.jsonl, failures included, before the
next one is made. A run is refused once that log holds 6 calls or 480 s of waiting (ENR-01's
limit). A recording that already exists is never replaced unless ``--replace`` is given.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import subprocess
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Final
from zoneinfo import ZoneInfo

from replay_world_api.assist.appearance import appearance_key, propose_appearance
from replay_world_api.assist.proposals import AssistError
from replay_world_api.assist.provider import (
    Completion,
    OpenAICompatibleProvider,
    ProviderError,
    Task,
)
from replay_world_api.settings import Settings
from replay_world_contracts import APPEARANCE_PROMPT_VERSION, AppearanceProposalRequest

ROOT: Final = Path(__file__).resolve().parents[1]
RECORDED: Final = ROOT / "fixtures" / "assist" / "recorded"
LOG: Final = ROOT / "docs" / "enr-01" / "live-calls.jsonl"
MAX_CALLS: Final = 6
MAX_WAIT_S: Final = 480.0
PHOENIX: Final = ZoneInfo("America/Phoenix")

# (case, photo, crop (left, top, right, bottom), project fixture, object id, note, what it is)
CASES: Final = (
    (
        "machine-b",
        "fixtures/photos/factory-walk.png",
        (0.40, 0.36, 0.57, 0.62),
        "fixtures/scenes/sample-factory.json",
        "obj-dxf-111",
        None,
        "A render made by this repository (synthetic, not a photograph): one guarded machine "
        "cell of the industrial demo, cropped from a view with several machines.",
    ),
    (
        "control-cabinet",
        "fixtures/photos/office.jpg",
        (0.88, 0.68, 1.00, 1.00),
        "fixtures/scenes/industrial-demo.json",
        "obj-cabinet-1",
        None,
        "A real public-domain photograph (USDA, Public Domain Mark): an office drawer unit, used "
        "as a look reference for the demo's control cabinet. It is not a photo of that equipment.",
    ),
)


def _calls_so_far() -> tuple[int, float]:
    if not LOG.exists():
        return 0, 0.0
    lines = [json.loads(line) for line in LOG.read_text().splitlines() if line.strip()]
    return len(lines), sum(line.get("waited_s", 0.0) for line in lines)


def _log(entry: dict[str, Any]) -> None:
    LOG.parent.mkdir(parents=True, exist_ok=True)
    with LOG.open("a", encoding="utf-8") as out:
        out.write(json.dumps(entry, ensure_ascii=False) + "\n")


class Recorder:
    """Wraps the live provider: keeps every raw answer, and logs every call as it ends."""

    mode: Any = "live"

    def __init__(self, inner: OpenAICompatibleProvider, case: str, crop_sha256: str) -> None:
        self.inner = inner
        self.service, self.base_url, self.model = inner.service, inner.base_url, inner.model
        self.case, self.crop_sha256 = case, crop_sha256
        self.answers: list[str] = []
        self.usage: list[dict[str, int | None]] = []

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
        calls, waited = _calls_so_far()
        if calls >= MAX_CALLS or waited >= MAX_WAIT_S:
            raise ProviderError("unavailable", "The ENR-01 live-call limit is reached.")
        started = time.monotonic()
        entry: dict[str, Any] = {
            "at": datetime.now(PHOENIX).isoformat(timespec="seconds"),
            "case": self.case,
            "task": task,
            "service": self.service,
            "model": self.model,
            "attempt": attempt,
            "crop_sha256": self.crop_sha256,
        }
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
            _log(
                {
                    **entry,
                    "waited_s": round(time.monotonic() - started, 1),
                    "outcome": exc.kind,
                    "message": exc.message,
                }
            )
            raise
        _log(
            {
                **entry,
                "waited_s": round(time.monotonic() - started, 1),
                "outcome": "answered",
                "input_tokens": completion.input_tokens,
                "output_tokens": completion.output_tokens,
            }
        )
        self.answers.append(completion.content)
        self.usage.append(
            {"input_tokens": completion.input_tokens, "output_tokens": completion.output_tokens}
        )
        return completion


def _crop(photo: Path, box: tuple[float, float, float, float]) -> tuple[bytes, int, int]:
    with tempfile.TemporaryDirectory() as folder:
        out = Path(folder) / "crop.jpg"
        done = subprocess.run(
            ["node", "scripts/reference-crop.mjs", str(photo), *map(str, box), str(out)],
            cwd=ROOT / "apps" / "web",
            capture_output=True,
            text=True,
            check=True,
        )
        size = json.loads(done.stdout.strip().splitlines()[-1])
        return out.read_bytes(), int(size["width"]), int(size["height"])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--run", action="store_true", help="send the cases (live provider calls)")
    parser.add_argument("--only", nargs="*", help="case names")
    parser.add_argument("--replace", action="store_true", help="replace an existing recording")
    args = parser.parse_args()
    settings = Settings.from_env()
    for case, photo_path, box, project_path, object_id, note, what in CASES:
        if args.only and case not in args.only:
            continue
        project = json.loads((ROOT / project_path).read_text())
        obj = next(o for o in project["scene"]["objects"] if o["id"] == object_id)
        dims = obj["dimensions"]
        photo = ROOT / photo_path
        data, width, height = _crop(photo, box)
        request = AppearanceProposalRequest.model_validate(
            {
                "name": obj["name"],
                "envelope_m": {
                    "x": dims["width"]["value_m"],
                    "y": dims["height"]["value_m"],
                    "z": dims["depth"]["value_m"],
                },
                "spec": None,
                "instruction": note,
                "media_type": "image/jpeg",
                "data_base64": base64.b64encode(data).decode("ascii"),
                "width_px": width,
                "height_px": height,
                "photo_sha256": hashlib.sha256(photo.read_bytes()).hexdigest(),
                "crop": dict(zip(("left", "top", "right", "bottom"), box, strict=True)),
            }
        )
        crop_sha = hashlib.sha256(data).hexdigest()
        target = RECORDED / f"appearance-{case}.json"
        print(
            f"{case}: {photo_path} crop {box} -> {width} x {height} px JPEG ({len(data)} bytes, "
            f"sha256 {crop_sha[:12]}…), object '{obj['name']}' "
            f"{dims['width']['value_m']} x {dims['depth']['value_m']} m, "
            f"{dims['height']['value_m']} m high"
        )
        if not args.run:
            continue
        if target.exists() and not args.replace:
            print(f"  {target.relative_to(ROOT)} exists; not replaced (use --replace).")
            continue
        if settings.assist.api_key is None:
            print("  VOYAGER_API_KEY is not set; nothing was sent.", file=sys.stderr)
            return 1
        calls, waited = _calls_so_far()
        if calls >= MAX_CALLS or waited >= MAX_WAIT_S:
            print(f"  The live-call limit is reached ({calls} calls, {waited:.0f} s).")
            return 1
        live = OpenAICompatibleProvider(settings.assist, model=settings.assist.vision_model)
        recorder = Recorder(live, case, crop_sha)
        try:
            # One request's budget, clipped to what is left of the run's waiting limit.
            result = propose_appearance(recorder, request, budget_s=min(150.0, MAX_WAIT_S - waited))
            print(f"  {result.outcome}: {result.summary or result.message}")
            print(f"  visible: {result.visible}; estimated: {result.estimated}")
            print(f"  not drawable: {result.not_represented}; problems: {len(result.problems)}")
        except (ProviderError, AssistError) as exc:
            print(f"  failed: {exc}")
        if recorder.answers:
            target.write_text(
                json.dumps(
                    {
                        "task": "appearance",
                        "key": appearance_key(request),
                        "photo": photo_path,
                        "case": case,
                        "what": what,
                        "service": recorder.service,
                        "model": recorder.model,
                        "prompt_version": APPEARANCE_PROMPT_VERSION,
                        "recorded_at": datetime.now(PHOENIX).date().isoformat(),
                        "note": "Raw answers from the live vision model for the crop named above, "
                        "replayed by the offline test provider. Not live AI when replayed.",
                        "responses": recorder.answers,
                        "usage": recorder.usage,
                    },
                    indent=2,
                    ensure_ascii=False,
                )
                + "\n"
            )
            print(f"  wrote {target.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
