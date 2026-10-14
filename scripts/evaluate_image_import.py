"""Evaluate photo analysis against the live vision model, and record answers for offline tests.

    uv run python scripts/evaluate_image_import.py            run every permitted photo live
    uv run python scripts/evaluate_image_import.py --record   also save the answers tests replay

Needs VOYAGER_API_KEY (from the environment or .env); the key is never printed or written. The
photos are the permitted ones in fixtures/photos/ (public domain or rendered here). For the
render of the industrial demo, whose true layout is known, detections are scored against ground
truth: box overlap (IoU) and the floor-position error of each object's front point, using the
recorded render camera. Results go to docs/assist-evaluation/<prompt version>.json.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import math
import sys
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
from replay_world_contracts import ImageAnalysisRequest, ImageProposalResult

ROOT: Final = Path(__file__).resolve().parents[1]
PHOTOS: Final = ROOT / "fixtures" / "photos"
DEMO: Final = ROOT / "fixtures" / "scenes" / "industrial-demo.json"
CASES: Final = (
    "living-room.webp",
    "office.jpg",
    "classroom.jpg",
    "factory-walk.png",
    "factory-walk-sign.jpg",
)


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


class RenderCamera:
    """The pinhole camera the demo render was made with (fixtures/photos/*.camera.json)."""

    def __init__(self, record: dict[str, Any]) -> None:
        c, t = record["camera"]["position"], record["camera"]["target"]
        self.w, self.h = record["width"], record["height"]
        self.f = (self.h / 2) / math.tan(math.radians(record["fov_deg_vertical"]) / 2)
        self.c = c
        fwd = [t[i] - c[i] for i in range(3)]
        n = math.hypot(*fwd)
        self.fwd = [v / n for v in fwd]
        right = [-self.fwd[2], 0.0, self.fwd[0]]  # fwd x up(0,1,0)
        rn = math.hypot(*right)
        self.right = [v / rn for v in right]
        r, fw = self.right, self.fwd
        self.up = [
            r[1] * fw[2] - r[2] * fw[1],
            r[2] * fw[0] - r[0] * fw[2],
            r[0] * fw[1] - r[1] * fw[0],
        ]

    def project(self, p: tuple[float, float, float]) -> tuple[float, float, float]:
        d = [p[i] - self.c[i] for i in range(3)]
        x = sum(d[i] * self.right[i] for i in range(3))
        y = sum(d[i] * self.up[i] for i in range(3))
        z = sum(d[i] * self.fwd[i] for i in range(3))
        return (self.w / 2 + self.f * x / z) / self.w, (self.h / 2 - self.f * y / z) / self.h, z

    def floor_of(self, u: float, v: float) -> tuple[float, float]:
        x = (u * self.w - self.w / 2) / self.f
        y = -(v * self.h - self.h / 2) / self.f
        d = [self.right[i] * x + self.up[i] * y + self.fwd[i] for i in range(3)]
        t = -self.c[1] / d[1]
        return self.c[0] + t * d[0], self.c[2] + t * d[2]


def iou(a: list[float], b: list[float]) -> float:
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - ix * iy
    return ix * iy / union if union > 0 else 0.0


def ground_truth(result: ImageProposalResult, camera_file: Path) -> list[dict[str, Any]]:
    """Each visible demo object against the best-matching detection."""
    cam = RenderCamera(json.loads(camera_file.read_text()))
    demo = json.loads(DEMO.read_text())
    rows = []
    objects = result.proposal.objects if result.proposal else []
    for o in demo["scene"]["objects"]:
        if o["kind"] != "equipment":
            continue
        p, d = o["transform"]["position_m"], o["dimensions"]
        w, h, dep = d["width"]["value_m"], d["height"]["value_m"], d["depth"]["value_m"]
        if abs(math.sin(o["transform"]["rotation_rad"]["y"])) > 0.5:
            w, dep = dep, w
        front = (p["x"], 0.0, p["z"] + dep / 2)
        fu, fv, z = cam.project(front)
        corners = [
            cam.project((p["x"] + sx * w / 2, y, p["z"] + sz * dep / 2))
            for sx in (-1, 1)
            for sz in (-1, 1)
            for y in (0.0, h)
        ]
        if z <= 0 or not (-0.05 < fu < 1.05 and 0 < fv < 1.05):
            continue
        box = [
            max(0.0, min(c[0] for c in corners)),
            max(0.0, min(c[1] for c in corners)),
            min(1.0, max(c[0] for c in corners)),
            min(1.0, max(c[1] for c in corners)),
        ]
        best, best_iou = None, 0.0
        for det in objects:
            b = det.box
            score = iou([b.left, b.top, b.right, b.bottom], box)
            if score > best_iou:
                best, best_iou = det, score
        row: dict[str, Any] = {"object": o["name"], "iou": round(best_iou, 2)}
        if best is not None and best_iou >= 0.3:
            row["detected_as"] = best.label
            if best.floor_contact is not None:
                x, zz = cam.floor_of(best.floor_contact.u, best.floor_contact.v)
                row["front_point_error_m"] = round(math.hypot(x - front[0], zz - front[2]), 2)
                row["contact_basis"] = best.contact_basis
        else:
            row["detected_as"] = None
        rows.append(row)
    return rows


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--record", action="store_true")
    args = parser.parse_args(argv)
    settings = Settings.from_env().assist
    if not settings.api_key:
        print("VOYAGER_API_KEY is not set; live evaluation needs it (see README).", file=sys.stderr)
        return 2
    recorder = Recorder(OpenAICompatibleProvider(settings, model=settings.vision_model))
    rows = []
    for name in CASES:
        print(f"photo {name}…", file=sys.stderr)
        data = (PHOTOS / name).read_bytes()
        request = request_for(data)
        try:
            result = propose_image(recorder, request)
        except (ProviderError, AssistError) as exc:
            rows.append({"photo": name, "outcome": "error", "error": str(exc)})
            continue
        row: dict[str, Any] = {
            "photo": name,
            "sha256": request.original_sha256,
            "outcome": result.outcome,
            "attempts": result.provider.attempts,
            "first_attempt_valid": result.provider.first_attempt_valid,
            "latency_s": round(result.provider.latency_ms / 1000, 1),
            "checks": result.checks,
            "message": result.message,
        }
        if result.proposal:
            row["objects"] = [
                {
                    "label": o.label,
                    "template": o.template,
                    "on_floor": o.on_floor,
                    "suggest_accept": o.suggest_accept,
                    "contact_basis": o.contact_basis,
                    "cut_off": o.cut_off,
                    "notes": o.notes,
                }
                for o in result.proposal.objects
            ]
            row["floor_rectangles"] = [r.label for r in result.proposal.floor_rectangles]
            row["visible_text"] = result.proposal.visible_text
        camera = PHOTOS / (name.split(".")[0].removesuffix("-sign") + ".camera.json")
        if camera.is_file():
            row["ground_truth"] = ground_truth(result, camera)
        rows.append(row)
        print(f"  {row.get('latency_s')} s, {len(row.get('objects', []))} objects", file=sys.stderr)
    report = {
        "date": datetime.now(UTC).isoformat(timespec="seconds"),
        "service": settings.service,
        "base_url": settings.base_url,
        "model": settings.vision_model,
        "prompt_version": PROMPT_VERSION,
        "mode": "live, schema-guided",
        "photos": rows,
    }
    out = ROOT / "docs" / "assist-evaluation" / f"{PROMPT_VERSION}.json"
    out.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    print(f"Report: {out.relative_to(ROOT)}", file=sys.stderr)
    if args.record:
        directory = settings.recordings_dir
        for name in CASES:
            key = hashlib.sha256((PHOTOS / name).read_bytes()).hexdigest()
            if key not in recorder.answers:
                continue
            record = {
                "task": "image",
                "key": key,
                "photo": name,
                "service": settings.service,
                "model": settings.vision_model,
                "prompt_version": PROMPT_VERSION,
                "recorded_at": datetime.now(UTC).strftime("%Y-%m-%d"),
                "note": "Raw answers from the live vision model for the permitted photo named "
                "above, replayed by the offline test provider. Not live AI when replayed.",
                "responses": recorder.answers[key],
            }
            stem = name.rsplit(".", 1)[0]
            (directory / f"image-{stem}.json").write_text(json.dumps(record, indent=2) + "\n")
        print(f"Wrote recordings to {directory.relative_to(ROOT)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
