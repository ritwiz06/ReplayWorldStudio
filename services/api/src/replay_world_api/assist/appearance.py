"""A reference photo -> a proposed new look for ONE existing object (ENR-01).

One multimodal request to the vision model: the reviewed crop (a metadata-free JPEG made by the
browser), the object's name, its recorded size and, when it is drawn with a generated model,
that model's specification. Nothing else of the project is sent. The answer is changes to the
current parts, as for a revision (GEN-02), and is checked the same way:

1. it must parse and match the schema (one corrected answer, shared with every other problem,
   while the 150 s budget allows);
2. parts are repaired, separated and fitted by the deterministic generator, inside the object's
   recorded size, which never changes: a photo is not a measurement;
3. the visibility checks of GEN-05/06 run on the features the model says it drew;
4. what was seen and drawn, what was guessed, and what the generator cannot show are kept
   apart, and no physical property is ever inferred.

Nothing is built or stored here. The person reviews the proposal; only then does the API build
it as a new asset (``generated_assets.create_reference_asset``).
"""

from __future__ import annotations

import base64
import hashlib
import json
import re
import threading
import time
from collections.abc import Callable
from typing import Any, Final

from pydantic import ValidationError
from replay_world_contracts import (
    APPEARANCE_PROMPT_VERSION,
    GEOMETRY_FORMAT,
    AppearanceProposalRequest,
    AppearanceProposalResult,
    GeometryDraft,
    GeometrySpec,
    ModelRevisionProposalRequest,
    ProviderRun,
)
from replay_world_contracts.models import GEOMETRY_MAX_PARTS, GEOMETRY_MIN_PART_M, GeometryPart

from ..objects import fit_to_envelope
from . import prompts, visibility
from .answers import RawAppearanceAnswer, RawRevisionAnswer, RawVec, provider_schema
from .images import decode_analysis_image
from .proposals import MAX_ATTEMPTS, AssistError, _text, _Unusable, describe_problems
from .provider import Provider, ProviderError
from .revisions import (
    BUDGET_S,
    MAX_PROBLEMS,
    MIN_RETRY_S,
    Cancelled,
    _apply_changes,
    _geometry,
    _spec_json,
    separate_overlaps,
)

APPEARANCE_SCHEMA: Final = provider_schema(RawAppearanceAnswer)
MAX_LISTED: Final = 20
SIZE_MATCH_M: Final = 0.001
PLACE_TOLERANCE_M: Final = 1e-4
BLOCK_MATERIAL: Final = "paint_light_grey"
SIZE_KEPT: Final = (
    "Size kept: the object's recorded size is the envelope; a photo is not a measurement."
)
# A listed item that claims what a picture cannot show: a property, a grade or a behaviour.
_PROPERTY_CLAIM: Final = re.compile(
    r"\b(?:kg|kilo\w*|tonnes?|mass|weigh\w*|strength|load|capacity|grade|alloy|\d{3,4}\s*series"
    r"|cycle|throughput|per\s+(?:hour|minute)|speed|rpm|operat\w*|staff\w*|operator)\b",
    re.IGNORECASE,
)


def block_spec(request: AppearanceProposalRequest) -> GeometrySpec:
    """What a proposal starts from: the current generated specification, or the recorded
    envelope as one plain block (the object's stand-in, a catalog or an attached model)."""
    e = request.envelope_m
    if request.spec is not None:
        s = request.spec.envelope_m
        if max(abs(s.x - e.x), abs(s.y - e.y), abs(s.z - e.z)) > SIZE_MATCH_M:
            raise AssistError(
                422,
                "The current model's size differs from the object's recorded size; start from "
                "the recorded size instead (nothing was sent).",
            )
        return request.spec
    return GeometrySpec.model_validate(
        {
            "format": GEOMETRY_FORMAT,
            "envelope_m": e.model_dump(),
            "parts": [
                {
                    "id": "body",
                    "label": "body",
                    "shape": "box",
                    "material": BLOCK_MATERIAL,
                    "center_m": {"x": 0, "y": e.y / 2, "z": 0},
                    "size_m": e.model_dump(),
                    "axis": None,
                    "taper": None,
                    "narrow_end": None,
                    "basis": "inferred",
                }
            ],
        }
    )


def appearance_key(request: AppearanceProposalRequest) -> str:
    """Recording key: the original photo, the crop, the recorded size, the starting
    specification and the note. The image bytes themselves are not part of it."""
    crop = request.crop
    box = f"{crop.left:.3f},{crop.top:.3f},{crop.right:.3f},{crop.bottom:.3f}"
    e = request.envelope_m
    size = f"{e.x:.3f}x{e.y:.3f}x{e.z:.3f}"
    if request.spec is None:
        start = "block"
    else:
        canonical = json.dumps(
            request.spec.model_dump(mode="json"), sort_keys=True, separators=(",", ":")
        )
        start = hashlib.sha256(canonical.encode()).hexdigest()[:16]
    return f"{request.photo_sha256}|{box}|{size}|{start}|{request.instruction or ''}"


def _listed(items: list[str], limit: int = MAX_LISTED) -> list[str]:
    cleaned = [_text(item, 200, "") for item in items]
    return list(dict.fromkeys(item for item in cleaned if item))[:limit]


def _parse(content: str) -> RawAppearanceAnswer:
    text = content.strip()
    if text.startswith("```"):  # some models wrap JSON in a code fence despite the schema
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text)
    return RawAppearanceAnswer.model_validate_json(text)


def propose_appearance(
    provider: Provider,
    request: AppearanceProposalRequest,
    *,
    budget_s: float = BUDGET_S,
    cancelled: threading.Event | None = None,
    clock: Callable[[], float] = time.monotonic,
) -> AppearanceProposalResult:
    """Ask the vision provider for a new look from the photo; return it checked and fitted.

    One time budget covers the whole request, the corrected answer included. Cancelling stops
    any further call; an answer that arrives after it is discarded. A call already in flight is
    not interrupted: it ends within the budget, and its answer is not used.
    """
    data = decode_analysis_image(request)
    crop_sha256 = hashlib.sha256(data).hexdigest()
    url = f"data:image/jpeg;base64,{base64.b64encode(data).decode('ascii')}"
    base = block_spec(request)
    shown = ModelRevisionProposalRequest(name=request.name, spec=base, instruction="photo")
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": prompts.APPEARANCE_SYSTEM},
        {
            "role": "user",
            "content": "Example only (a different object): a 0.8 x 1.8 x 0.5 m cabinet, a photo "
            "of a blue two-door cabinet on feet. Its answer:",
        },
        {"role": "assistant", "content": prompts.APPEARANCE_EXAMPLE},
        {
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": url}},
                {
                    "type": "text",
                    "text": prompts.appearance_user_message(
                        request.name, _spec_json(shown), request.instruction
                    ),
                },
            ],
        },
    ]
    key = appearance_key(request)
    started = clock()
    latency = 0
    first_valid = False
    first_took = 0.0
    last_problem = ""
    fallback: AppearanceProposalResult | None = None

    def stop_if_cancelled() -> None:
        if cancelled is not None and cancelled.is_set():
            raise Cancelled()

    for attempt in range(MAX_ATTEMPTS):
        stop_if_cancelled()
        remaining = budget_s - (clock() - started)
        if attempt > 0:
            needed = max(MIN_RETRY_S, first_took)
            if remaining < needed:
                note = (
                    f"Not asked to correct this: {max(remaining, 0):.0f} s of the "
                    f"{budget_s:.0f} s limit were left, less than the {needed:.0f} s a "
                    "corrected answer would need."
                )
                if fallback is not None:
                    return fallback.model_copy(update={"checks": [*fallback.checks, note]})
                raise AssistError(
                    504,
                    f"{provider.service} ({provider.model}) gave an unusable answer and there "
                    f"was no time left to ask again within {budget_s:.0f} s. Last problem: "
                    f"{last_problem[:300]}",
                )
        asked = clock()
        try:
            completion = provider.complete(
                task="appearance",
                key=key,
                messages=messages,
                schema=APPEARANCE_SCHEMA,
                attempt=attempt,
                timeout_s=remaining,
            )
        except ProviderError as exc:
            stop_if_cancelled()
            if fallback is not None and exc.kind == "timeout":
                return fallback.model_copy(
                    update={
                        "checks": [
                            *fallback.checks,
                            f"The corrected answer did not arrive within the {budget_s:.0f} s "
                            "limit; this is the first answer, with the problems the checks found.",
                        ]
                    }
                )
            raise
        stop_if_cancelled()  # a late answer after cancelling changes nothing
        if attempt == 0:
            first_took = clock() - asked
        latency += completion.latency_ms
        try:
            answer = _parse(completion.content)
            first_valid = first_valid or attempt == 0
            run = ProviderRun(
                service=provider.service,
                base_url=provider.base_url,
                model=provider.model,
                mode=provider.mode,
                attempts=attempt + 1,
                first_attempt_valid=first_valid,
                latency_ms=latency,
            )
            result, feedback = judge_appearance(answer, request, base, run, crop_sha256)
        except (ValidationError, ValueError) as exc:
            last_problem = describe_problems(exc)
            messages += [
                {"role": "assistant", "content": completion.content},
                {
                    "role": "user",
                    "content": "That answer cannot be used: "
                    f"{last_problem}. Reply again with corrected JSON only.",
                },
            ]
            continue
        if not feedback or attempt + 1 >= MAX_ATTEMPTS:
            return result
        fallback = result
        listed = "\n".join(f"- {line}" for line in feedback)
        messages += [
            {"role": "assistant", "content": completion.content},
            {
                "role": "user",
                "content": "The app checked that answer and found problems a viewer would "
                f"notice:\n{listed}\nFix all of them in one corrected answer. Reply again with "
                "corrected JSON only.",
            },
        ]
    raise AssistError(
        502,
        f"{provider.service} ({provider.model}) did not return a usable appearance after "
        f"{MAX_ATTEMPTS} attempts. Last problem: {last_problem[:300]}",
    )


def _result(
    outcome: str,
    base: GeometrySpec,
    run: ProviderRun,
    crop_sha256: str,
    *,
    message: str | None = None,
    spec: GeometrySpec | None = None,
    summary: str | None = None,
    visible: list[str] | None = None,
    estimated: list[str] | None = None,
    not_represented: list[str] | None = None,
    checks: list[str] | None = None,
    problems: list[dict[str, Any]] | None = None,
    adjustments: list[dict[str, Any]] | None = None,
    view: str = "front-right",
) -> AppearanceProposalResult:
    return AppearanceProposalResult.model_validate(
        {
            "outcome": outcome,
            "message": message,
            "base": base,
            "spec": spec,
            "summary": summary,
            "visible": visible or [],
            "estimated": estimated or [],
            "not_represented": not_represented or [],
            "checks": checks or [],
            "problems": problems or [],
            "adjustments": adjustments or [],
            "view": view,
            "crop_sha256": crop_sha256,
            "prompt": APPEARANCE_PROMPT_VERSION,
            "provider": run,
        }
    )


def judge_appearance(
    answer: RawAppearanceAnswer,
    request: AppearanceProposalRequest,
    base: GeometrySpec,
    run: ProviderRun,
    crop_sha256: str,
) -> tuple[AppearanceProposalResult, list[str]]:
    """What the answer gives the person, and what a corrected answer could fix."""
    checks: list[str] = []
    claims = [i for i in [*answer.visible, *answer.estimated] if _PROPERTY_CLAIM.search(i)]
    if claims:
        checks.append(
            "Left out what a photo cannot establish (a property, grade or behaviour): "
            + "; ".join(f"“{c[:80]}”" for c in claims[:3])
        )
    visible = _listed([i for i in answer.visible if i not in claims])
    estimated = _listed([i for i in answer.estimated if i not in claims])
    not_represented = _listed(answer.not_representable)
    if answer.outcome != "revision":
        fallback = (
            "The current model already looks like the photo."
            if answer.outcome == "already_satisfied"
            else "The photo does not show this object clearly enough to propose a look."
        )
        return _result(
            answer.outcome,
            base,
            run,
            crop_sha256,
            message=_text(answer.message, 500, fallback),
            not_represented=not_represented,
            checks=checks,
        ), []
    if not visible:
        raise _Unusable("list in visible each feature seen in the photo that the changes draw")
    revision = RawRevisionAnswer(
        outcome="revision",
        message=None,
        summary=answer.summary,
        envelope_m=RawVec(x=base.envelope_m.x, y=base.envelope_m.y, z=base.envelope_m.z),
        remove=answer.remove,
        change=answer.change,
        add=answer.add,
        repeat=answer.repeat,
        not_representable=[],
    )
    parts, part_checks = _apply_changes(revision, base.parts)
    checks += part_checks
    if len(parts) > GEOMETRY_MAX_PARTS:
        return _result(
            "unsupported",
            base,
            run,
            crop_sha256,
            message=f"This look would need {len(parts)} parts; the generator draws at most "
            f"{GEOMETRY_MAX_PARTS}. Nothing was changed: build it by hand, or crop to fewer "
            "details.",
            visible=visible,
            not_represented=not_represented,
            checks=checks,
        ), []
    parts, overlap_checks = separate_overlaps(parts)
    checks += overlap_checks
    draft = GeometryDraft.model_validate(
        {
            "format": GEOMETRY_FORMAT,
            "envelope_m": base.envelope_m.model_dump(),
            "parts": [p.model_dump() for p in parts],
        }
    )
    spec, _scale, notes = fit_to_envelope(draft)
    checks += [*notes, SIZE_KEPT]
    if _geometry(spec) == _geometry(base):
        return _result(
            "unsupported",
            base,
            run,
            crop_sha256,
            message="The proposal does not change the model. Nothing was changed.",
            visible=visible,
            not_represented=not_represented,
            checks=checks,
        ), []
    # The checks read the features the model says it drew as what was asked for.
    words = " ".join([*visible, request.instruction or ""])
    colours = visibility.honour_colours(spec, base, words)
    spec, contrast_notes = visibility.contrast_additions(colours.spec, base, colours.named_parts)
    spec, enlarged = visibility.enlarge_small(spec, base, words)
    before = {p.id for p in base.parts}
    adjustments: list[dict[str, Any]] = [
        *(
            {"kind": a.kind, "part_ids": list(a.part_ids), "text": a.text}
            for a in colours.adjustments
        ),
        *(
            {
                "kind": "contrast",
                "part_ids": [
                    p.id for p in spec.parts if p.id not in before and f"“{p.label}”" in note
                ][:1]
                or [spec.parts[-1].id],
                "text": note,
            }
            for note in dict.fromkeys(contrast_notes)
        ),
        *({"kind": a.kind, "part_ids": list(a.part_ids), "text": a.text} for a in enlarged),
    ]
    spec, placed = place_details(spec, visibility.find_problems(spec, base, words))
    adjustments += placed
    problems = visibility.find_problems(spec, base, words)
    result = _result(
        "proposal",
        base,
        run,
        crop_sha256,
        spec=spec,
        summary=_text(answer.summary, 300, "Made the model look more like the photo."),
        visible=visible,
        estimated=estimated,
        not_represented=list(dict.fromkeys(not_represented + colours.texture_limits))[:MAX_LISTED],
        checks=checks,
        problems=[
            {"kind": p.kind, "part_ids": list(p.parts), "text": p.text}
            for p in problems[:MAX_PROBLEMS]
        ],
        adjustments=adjustments[:MAX_PROBLEMS],
        view=visibility.best_view(spec, base, words),
    )
    return result, list(dict.fromkeys(p.feedback for p in problems if p.retry))[:MAX_PROBLEMS]


def _box(part: GeometryPart) -> tuple[dict[str, float], dict[str, float]]:
    lo = {a: getattr(part.center_m, a) - getattr(part.size_m, a) / 2 for a in "xyz"}
    hi = {a: getattr(part.center_m, a) + getattr(part.size_m, a) / 2 for a in "xyz"}
    return lo, hi


def _volume(part: GeometryPart) -> float:
    return part.size_m.x * part.size_m.y * part.size_m.z


def _within(inner: GeometryPart, outer: GeometryPart) -> bool:
    (ilo, ihi), (olo, ohi) = _box(inner), _box(outer)
    return all(
        ilo[a] >= olo[a] - PLACE_TOLERANCE_M and ihi[a] <= ohi[a] + PLACE_TOLERANCE_M for a in "xyz"
    )


def _moved(part: GeometryPart, axis: str, centre: float) -> GeometryPart:
    return part.model_copy(update={"center_m": part.center_m.model_copy(update={axis: centre})})


def place_details(
    spec: GeometrySpec, problems: list[visibility.Problem]
) -> tuple[GeometrySpec, list[dict[str, Any]]]:
    """Two placements a photo answer often gets wrong, made as the app's visual choices (never
    a measurement), each listed: a small part buried inside the part it belongs on (a handle in
    a drawer, a button in a panel) goes onto that part's front face, the part set back to make
    room when the envelope requires; a part floating above the part below it settles onto it
    (or the floor). A move that would change the overall size is not made."""
    parts = {p.id: p for p in spec.parts}
    order = [p.id for p in spec.parts]
    notes: list[dict[str, Any]] = []
    front = spec.envelope_m.z / 2

    def bounds(current: dict[str, GeometryPart]) -> tuple[dict[str, float], dict[str, float]]:
        boxes = [_box(p) for p in current.values()]
        return (
            {a: min(b[0][a] for b in boxes) for a in "xyz"},
            {a: max(b[1][a] for b in boxes) for a in "xyz"},
        )

    whole = bounds(parts)

    def same(current: dict[str, GeometryPart]) -> bool:
        now = bounds(current)
        return all(
            abs(now[side][a] - whole[side][a]) <= PLACE_TOLERANCE_M
            for side in range(2)
            for a in "xyz"
        )

    # Buried parts, by the smallest part that holds each; `on` keeps what was put on each holder,
    # so it moves with it.
    held: dict[str, list[str]] = {}
    on: dict[str, list[str]] = {}
    for pid, part in parts.items():
        holders = [
            h
            for h in parts.values()
            if h.id != pid and _volume(h) > 2 * _volume(part) and _within(part, h)
        ]
        if holders:
            held.setdefault(min(holders, key=_volume).id, []).append(pid)
    for holder_id, ids in held.items():
        trial = dict(parts)
        holder = trial[holder_id]
        depth = max(trial[i].size_m.z for i in ids)
        face = _box(holder)[1]["z"]
        if face + depth > front + PLACE_TOLERANCE_M:
            if holder.size_m.z - depth < GEOMETRY_MIN_PART_M:
                continue
            holder = holder.model_copy(
                update={
                    "size_m": holder.size_m.model_copy(update={"z": holder.size_m.z - depth}),
                    "center_m": holder.center_m.model_copy(
                        update={"z": holder.center_m.z - depth / 2}
                    ),
                }
            )
            trial[holder_id] = holder
            face -= depth
        for i in ids:
            trial[i] = _moved(trial[i], "z", face + trial[i].size_m.z / 2)
        if not same(trial):
            continue
        parts = trial
        on.setdefault(holder_id, []).extend(ids)
        labels = ", ".join(f"“{parts[i].label}”" for i in ids)
        notes.append(
            {
                "kind": "placed",
                "part_ids": ids[:20],
                "text": f"Put {labels} on the front of “{holder.label}”, where it can be "
                "seen; it was drawn inside it.",
            }
        )
    # Floating parts, lowest first, each onto what is under it.
    floating = {i for p in problems if p.kind == "floating" for i in (p.part_ids or (p.part_id,))}
    for pid in sorted((i for i in floating if i in parts), key=lambda i: _box(parts[i])[0]["y"]):
        lo, hi = _box(parts[pid])
        under = [
            _box(q)[1]["y"]
            for q in parts.values()
            if q.id != pid
            and _box(q)[1]["y"] <= lo["y"] + PLACE_TOLERANCE_M
            and all(_box(q)[0][a] < hi[a] and _box(q)[1][a] > lo[a] for a in "xz")
        ]
        rest = max(under, default=0.0)
        if lo["y"] - rest <= PLACE_TOLERANCE_M:
            continue
        drop = lo["y"] - rest
        trial = dict(parts)
        for moving in (pid, *(i for i in on.get(pid, []) if i != pid)):
            trial[moving] = _moved(trial[moving], "y", trial[moving].center_m.y - drop)
        if not same(trial):
            continue
        parts = trial
        notes.append(
            {
                "kind": "placed",
                "part_ids": [pid],
                "text": f"Lowered “{parts[pid].label}” by {lo['y'] - rest:.2f} m to rest on "
                "what is under it; it floated.",
            }
        )
    if not notes:
        return spec, []
    placed = GeometrySpec.model_validate(
        {**spec.model_dump(), "parts": [parts[i].model_dump() for i in order]}
    )
    return placed, notes
