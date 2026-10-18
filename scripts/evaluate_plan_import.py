"""Evaluate plan proposals (IMP-03) against the live vision model, and record answers for
offline tests.

    uv run python scripts/evaluate_plan_import.py            run both synthetic plans live
    uv run python scripts/evaluate_plan_import.py --record   also save the answers tests replay

Needs VOYAGER_API_KEY (from the environment or .env); the key is never printed or written. The
plans are the synthetic ones in fixtures/plans/ (scripts/build_plan_fixtures.py), whose true
geometry is known, so each proposal is scored: which objects were found (box overlap, IoU, on
the picture), how far each box's centre is from the true one in metres on the plan, what was
proposed that is not an object, and whether a note addressed to automated tools was obeyed.
These are two synthetic plans: the numbers say nothing about real drawings. Results go to
docs/assist-evaluation/<prompt version>.json.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import math
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Final

import pypdfium2 as pdfium
from replay_world_api.assist.plans import PROMPT_VERSION, propose_plan
from replay_world_api.assist.proposals import AssistError
from replay_world_api.assist.provider import (
    Completion,
    OpenAICompatibleProvider,
    ProviderError,
    Task,
)
from replay_world_api.plans import RENDER_SIDE_PX, _render
from replay_world_api.settings import Settings
from replay_world_contracts import ImageAnalysisRequest, PlanProposalResult

ROOT: Final = Path(__file__).resolve().parents[1]
PLANS: Final = ROOT / "fixtures" / "plans"
TRUTH: Final = json.loads((PLANS / "plans.truth.json").read_text())
ANALYSIS_SIDE_PX: Final = 1600  # as the editor's copy


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
        self.answers.setdefault(key, []).append(completion.content)
        return completion


def analysis_copy(name: str) -> tuple[bytes, int, int, int, int]:
    """The picture sent (PNG, at most 1600 px) and the size of the picture the app reads."""
    data = (PLANS / name).read_bytes()
    if name.endswith(".pdf"):
        page = pdfium.PdfDocument(data)[TRUTH[name]["plan_page"] - 1]
        width, height = page.get_size()
        png, w, h = _render(page, ANALYSIS_SIDE_PX / max(width, height))
        full = RENDER_SIDE_PX / max(width, height)
        return png, w, h, round(width * full), round(height * full)
    w, h = TRUTH[name]["size_px"]
    return data, w, h, w, h


def box_of(points: list[list[float]], w: int, h: int) -> list[float]:
    """Plan pixels (y up) -> a picture box in fractions [left, top, right, bottom]."""
    xs = [p[0] / w for p in points]
    ys = [1 - p[1] / h for p in points]
    return [min(xs), min(ys), max(xs), max(ys)]


def iou(a: list[float], b: list[float]) -> float:
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - ix * iy
    return ix * iy / union if union > 0 else 0.0


def score(name: str, result: PlanProposalResult, w: int, h: int) -> dict[str, Any]:
    truth = TRUTH[name]
    proposals = result.proposal.objects if result.proposal else []
    px_per_m = truth["px_per_m"]
    rows, used = [], set()
    for t in truth["objects"]:
        corners = t.get("corners_px") or [t["px"][:2], t["px"][2:]]
        if "corners_px" in t:
            (ax, ay), (bx, by), (cx, cy) = corners
            corners = [[ax, ay], [bx, by], [cx, cy], [ax + cx - bx, ay + cy - by]]
        box = box_of(corners, w, h)
        best, best_iou = None, 0.0
        for i, p in enumerate(proposals):
            s = iou([p.box.left, p.box.top, p.box.right, p.box.bottom], box)
            if s > best_iou:
                best, best_iou = i, s
        row: dict[str, Any] = {"object": t["name"], "iou": round(best_iou, 2)}
        if best is not None and best_iou >= 0.3:
            used.add(best)
            p = proposals[best]
            du = ((p.box.left + p.box.right) - (box[0] + box[2])) / 2 * w
            dv = ((p.box.top + p.box.bottom) - (box[1] + box[3])) / 2 * h
            row["proposed_as"] = p.label
            row["kind"] = p.kind
            row["centre_error_m"] = round(math.hypot(du, dv) / px_per_m, 2)
            pw = (p.box.right - p.box.left) * w / px_per_m
            tw = (box[2] - box[0]) * w / px_per_m
            row["width_error_m"] = round(pw - tw, 2)
        else:
            row["proposed_as"] = None
        rows.append(row)
    extra = [proposals[i].label for i in range(len(proposals)) if i not in used]
    floor = result.proposal.floor if result.proposal else None
    floor_iou = None
    if floor:
        fb = [min(p.u for p in floor), min(p.v for p in floor)]
        fb += [max(p.u for p in floor), max(p.v for p in floor)]
        floor_iou = round(iou(fb, box_of(truth["floor"], w, h)), 2)
    texts = [t.text for t in result.proposal.texts] if result.proposal else []
    return {
        "found": sum(r["proposed_as"] is not None for r in rows),
        "of": len(rows),
        "objects": rows,
        "proposed_but_not_objects": extra,
        "floor_box_iou": floor_iou,
        "walls": len(result.proposal.walls) if result.proposal else 0,
        "texts": texts,
    }


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
    for name in ("packing-hall.pdf", "rough-cell.png"):
        copy, w, h, full_w, full_h = analysis_copy(name)
        key = hashlib.sha256((PLANS / name).read_bytes()).hexdigest()
        request = ImageAnalysisRequest(
            media_type="image/png",
            data_base64=base64.b64encode(copy).decode("ascii"),
            width_px=w,
            height_px=h,
            original_sha256=key,
        )
        print(f"plan {name} ({w} x {h} px sent)…", file=sys.stderr)
        started = time.monotonic()
        try:
            result = propose_plan(recorder, request)
        except (ProviderError, AssistError) as exc:
            rows.append({"plan": name, "outcome": "error", "error": str(exc)})
            continue
        row: dict[str, Any] = {
            "plan": name,
            "sha256": key,
            "sent_px": [w, h],
            "outcome": result.outcome,
            "attempts": result.provider.attempts,
            "first_attempt_valid": result.provider.first_attempt_valid,
            "latency_s": round(result.provider.latency_ms / 1000, 1),
            "wall_clock_s": round(time.monotonic() - started, 1),
            "checks": result.checks,
            "message": result.message,
        }
        if result.outcome == "proposal":
            row["score"] = score(name, result, full_w, full_h)
        rows.append(row)
        print(f"  {row['latency_s']} s, {row.get('score', {}).get('found')} found", file=sys.stderr)
    report = {
        "date": datetime.now(UTC).isoformat(timespec="seconds"),
        "service": settings.service,
        "base_url": settings.base_url,
        "model": settings.vision_model,
        "prompt_version": PROMPT_VERSION,
        "mode": "live, schema-guided",
        "note": "Two synthetic plans with known geometry; not evidence about real drawings.",
        "plans": rows,
    }
    out = ROOT / "docs" / "assist-evaluation" / f"{PROMPT_VERSION}.json"
    out.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    print(f"Report: {out.relative_to(ROOT)}", file=sys.stderr)
    if args.record:
        directory = settings.recordings_dir
        for name in ("packing-hall.pdf", "rough-cell.png"):
            key = hashlib.sha256((PLANS / name).read_bytes()).hexdigest()
            if key not in recorder.answers:
                continue
            record = {
                "task": "plan",
                "key": key,
                "plan": name,
                "service": settings.service,
                "model": settings.vision_model,
                "prompt_version": PROMPT_VERSION,
                "recorded_at": datetime.now(UTC).strftime("%Y-%m-%d"),
                "note": "Raw answers from the live vision model for the synthetic plan named "
                "above, replayed by the offline test provider. Not live AI when replayed.",
                "responses": recorder.answers[key],
            }
            stem = name.rsplit(".", 1)[0]
            (directory / f"plan-{stem}.json").write_text(json.dumps(record, indent=2) + "\n")
        print(f"Wrote recordings to {directory.relative_to(ROOT)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
