"""Instruction -> proposed change to a generated model's specification (GEN-02).

The language model proposes the complete revised parts list; this module decides what reaches
the user:

1. the answer must parse and match the requested schema (one retry with the problems listed);
2. parts are repaired as for a new object and fitted to the overall size by the deterministic
   generator (never by model-written code);
3. the overall size is kept unless the instruction asks for a different one;
4. an answer that changes nothing, or that keeps a solid block where the user asked for
   something open, is not offered as a proposal;
5. requested features the generator cannot depict are listed, never imitated.

Nothing is built or stored here: the user reviews the proposal, and only then does the API
build the revision as a new asset (see ``generated_assets.create_asset_revision``).
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Final

from pydantic import ValidationError
from replay_world_contracts import (
    GEOMETRY_FORMAT,
    Extent3,
    GeometryDraft,
    GeometrySpec,
    ModelRevisionProposalRequest,
    ModelRevisionProposalResult,
    ProviderRun,
)
from replay_world_contracts.models import (
    GEOMETRY_MAX_ENVELOPE_M,
    GEOMETRY_MIN_ENVELOPE_M,
    GEOMETRY_MIN_PART_M,
    GeometryPart,
)

from ..objects import fit_to_envelope
from . import prompts
from .answers import RawRevisionAnswer, provider_schema
from .lengths import find_lengths
from .proposals import MAX_ATTEMPTS, AssistError, _parts, _text, describe_problems
from .provider import Provider

REVISION_SCHEMA: Final = provider_schema(RawRevisionAnswer)
MAX_NOT_REPRESENTED: Final = 20
SOLID_SHARE: Final = 0.5
"""A single part filling this share of the overall box means the object is not open."""
SIZE_TOLERANCE_M: Final = 1e-6

_SIZE_WORDS: Final = re.compile(
    r"\b(?:bigger|smaller|larger|taller|shorter|wider|narrower|longer|deeper|shallower|higher"
    r"|lower|size|height|width|depth|tall|wide|long|deep|scale)\b",
    re.IGNORECASE,
)
_OPEN_WORDS: Final = re.compile(
    r"\b(?:open|opening|hollow|empty|without\s+doors?|no\s+doors?|no\s+front|frame\s+only"
    r"|see-through|cage|shelves)\b",
    re.IGNORECASE,
)
# Requested features the generator cannot depict, and how they are listed when the model did
# not list them itself.
_UNREPRESENTABLE: Final = (
    (
        re.compile(
            r"\b(?:curved?|bent|slanted|sloped|sloping|angled|diagonal(?:ly)?|tilted|rotated)\b",
            re.IGNORECASE,
        ),
        "Curved, slanted or rotated surfaces (the generator has only axis-aligned boxes, "
        "cylinders, frustums and spheres)",
    ),
    (
        re.compile(r"\b(?:holes?|perforated|perforations?|mesh|grilles?|slots?)\b", re.IGNORECASE),
        "Holes, slots or perforations",
    ),
    (
        re.compile(
            r"\b(?:textures?|textured|logos?|printed|text|labels?|patterns?|patterned|grain)\b",
            re.IGNORECASE,
        ),
        "Textures, printing and patterns",
    ),
    (
        re.compile(
            r"\b(?:hinges?|hinged|opening\s+doors?|sliding|moving|rotating|animated)\b",
            re.IGNORECASE,
        ),
        "Moving or hinged parts",
    ),
)


def revision_key(request: ModelRevisionProposalRequest) -> str:
    """Recording key: the specification's hash and the instruction."""
    canonical = json.dumps(
        request.spec.model_dump(mode="json"), sort_keys=True, separators=(",", ":")
    )
    return f"{hashlib.sha256(canonical.encode()).hexdigest()[:16]}:{request.instruction}"


def _spec_json(request: ModelRevisionProposalRequest) -> str:
    """The current specification in the shape the answer uses (every part gives an axis)."""
    spec = request.spec
    return json.dumps(
        {
            "name": request.name,
            "envelope_m": spec.envelope_m.model_dump(),
            "parts": [
                {
                    "id": p.id,
                    "label": p.label,
                    "shape": p.shape,
                    "material": p.material,
                    "center_m": p.center_m.model_dump(),
                    "size_m": p.size_m.model_dump(),
                    "axis": p.axis or "y",
                    "taper": p.taper,
                    "narrow_end": p.narrow_end,
                }
                for p in spec.parts
            ],
        },
        separators=(",", ":"),
    )


def _parse(content: str) -> RawRevisionAnswer:
    text = content.strip()
    if text.startswith("```"):  # some models wrap JSON in a code fence despite the schema
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text)
    return RawRevisionAnswer.model_validate_json(text)


def propose_revision(
    provider: Provider, request: ModelRevisionProposalRequest
) -> ModelRevisionProposalResult:
    """Ask the provider for a revised specification and return it checked and fitted."""
    messages = [
        {"role": "system", "content": prompts.REVISION_SYSTEM},
        {"role": "user", "content": prompts.REVISION_EXAMPLE_USER},
        {"role": "assistant", "content": prompts.REVISION_EXAMPLE_ANSWER},
        {
            "role": "user",
            "content": prompts.revision_user_message(_spec_json(request), request.instruction),
        },
    ]
    key = revision_key(request)
    latency = 0
    first_valid = False
    last_problem = ""
    for attempt in range(MAX_ATTEMPTS):
        completion = provider.complete(
            task="revision", key=key, messages=messages, schema=REVISION_SCHEMA, attempt=attempt
        )
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
            return _result(answer, request, run)
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
    raise AssistError(
        502,
        f"{provider.service} ({provider.model}) did not return a usable revision after "
        f"{MAX_ATTEMPTS} attempts. Last problem: {last_problem[:300]}",
    )


def _unsupported(
    message: str, run: ProviderRun, not_represented: list[str], checks: list[str]
) -> ModelRevisionProposalResult:
    return ModelRevisionProposalResult(
        outcome="unsupported",
        message=message,
        spec=None,
        summary=None,
        size_changed=False,
        not_represented=not_represented,
        checks=checks,
        provider=run,
    )


def _result(
    answer: RawRevisionAnswer, request: ModelRevisionProposalRequest, run: ProviderRun
) -> ModelRevisionProposalResult:
    instruction = request.instruction
    if answer.outcome == "unsupported":
        message = _text(answer.message, 500, "This is not a change to this object.")
        return _unsupported(message, run, [], [])
    parts, checks = _parts(answer.parts)
    # A part the revision keeps keeps where it came from; only new parts take the answer's basis.
    current = {p.id: p for p in request.spec.parts}
    parts = [
        p.model_copy(update={"basis": current[p.id].basis}) if p.id in current else p for p in parts
    ]

    parts, overlap_checks = separate_overlaps(parts)
    checks += overlap_checks

    envelope = request.spec.envelope_m
    if find_lengths(instruction) or _SIZE_WORDS.search(instruction):
        raw = answer.envelope_m
        target = Extent3(x=_clamp(raw.x), y=_clamp(raw.y), z=_clamp(raw.z))
    else:
        target = envelope
        checks.append("Size kept: the instruction did not ask for a different size.")
    draft = GeometryDraft.model_validate(
        {
            "format": GEOMETRY_FORMAT,
            "envelope_m": target.model_dump(),
            "parts": [p.model_dump() for p in parts],
        }
    )
    spec, _scale, notes = fit_to_envelope(draft)
    checks += notes
    size_changed = any(
        abs(getattr(spec.envelope_m, a) - getattr(envelope, a)) > SIZE_TOLERANCE_M for a in "xyz"
    )
    not_represented = _not_represented(answer.not_representable, instruction)

    if _geometry(spec) == _geometry(request.spec):
        return _unsupported("The proposal does not change the model.", run, not_represented, checks)
    if _OPEN_WORDS.search(instruction):
        e = spec.envelope_m
        largest = max(p.size_m.x * p.size_m.y * p.size_m.z for p in spec.parts)
        share = largest / (e.x * e.y * e.z)
        if share >= SOLID_SHARE:
            return _unsupported(
                f"The proposal still has a solid block filling {share * 100:.0f} % of the "
                "object, so it would not be open. Nothing was changed; try the part controls "
                "instead.",
                run,
                not_represented,
                checks,
            )
    return ModelRevisionProposalResult(
        outcome="proposal",
        message=None,
        spec=spec,
        summary=_text(answer.summary, 300, f"Changed as asked: “{instruction}”"),
        size_changed=size_changed,
        not_represented=not_represented,
        checks=checks,
        provider=run,
    )


_BOXES: Final = ("box", "rounded_box")
_FLUSH_M: Final = 1e-4


def _bounds(part: GeometryPart) -> tuple[dict[str, float], dict[str, float]]:
    lo = {a: getattr(part.center_m, a) - getattr(part.size_m, a) / 2 for a in "xyz"}
    hi = {a: getattr(part.center_m, a) + getattr(part.size_m, a) / 2 for a in "xyz"}
    return lo, hi


def separate_overlaps(parts: list[GeometryPart]) -> tuple[list[GeometryPart], list[str]]:
    """Stop box parts from overlapping inside one another, which renders as flickering faces.

    A language model often "paints" the end of a part by putting a thin part over it (a red top
    inside a blue cabinet). When a box part covers the whole cross-section of a larger box part
    at one of its ends, the larger part is shortened to end where the smaller one starts, so the
    two meet instead of overlapping. Other parts that sit inside another and share its faces are
    only reported; nothing else is moved.
    """
    parts = list(parts)
    checks: list[str] = []
    noted: set[tuple[str, str]] = set()
    changed = True
    rounds = 0
    while changed and rounds < len(parts):
        changed = False
        rounds += 1
        for i, a in enumerate(parts):
            for b in parts:
                if b is a or a.shape not in _BOXES or b.shape not in _BOXES:
                    continue
                a_lo, a_hi = _bounds(a)
                b_lo, b_hi = _bounds(b)
                inside = all(
                    b_lo[k] >= a_lo[k] - _FLUSH_M and b_hi[k] <= a_hi[k] + _FLUSH_M for k in "xyz"
                )
                if not inside or (a.size_m.x * a.size_m.y * a.size_m.z) <= (
                    b.size_m.x * b.size_m.y * b.size_m.z
                ):
                    continue
                for k in "xyz":
                    others = [o for o in "xyz" if o != k]
                    covers = all(
                        abs(b_lo[o] - a_lo[o]) <= _FLUSH_M and abs(b_hi[o] - a_hi[o]) <= _FLUSH_M
                        for o in others
                    )
                    at_high = abs(b_hi[k] - a_hi[k]) <= _FLUSH_M
                    at_low = abs(b_lo[k] - a_lo[k]) <= _FLUSH_M
                    if not covers or at_high == at_low:
                        continue
                    lo, hi = (a_lo[k], b_lo[k]) if at_high else (b_hi[k], a_hi[k])
                    if hi - lo < GEOMETRY_MIN_PART_M:
                        continue
                    center = {**a.center_m.model_dump(), k: round((lo + hi) / 2, 6)}
                    size = {**a.size_m.model_dump(), k: round(hi - lo, 6)}
                    parts[i] = a.model_copy(
                        update={
                            "center_m": a.center_m.model_validate(center),
                            "size_m": a.size_m.model_validate(size),
                        }
                    )
                    checks.append(
                        f"“{a.label}” was shortened so “{b.label}” forms its end instead of "
                        "overlapping it."
                    )
                    changed = True
                    break
                else:
                    shares_face = any(
                        abs(b_lo[k] - a_lo[k]) <= _FLUSH_M or abs(b_hi[k] - a_hi[k]) <= _FLUSH_M
                        for k in "xyz"
                    )
                    if shares_face and (a.id, b.id) not in noted and len(noted) < 3:
                        noted.add((a.id, b.id))
                        checks.append(
                            f"“{b.label}” sits inside “{a.label}” and shares its faces, so they "
                            "may flicker; adjust them in the part list if they do."
                        )
                if changed:
                    break
            if changed:
                break
    return parts, checks


def _clamp(value: float) -> float:
    return min(max(value, GEOMETRY_MIN_ENVELOPE_M), GEOMETRY_MAX_ENVELOPE_M)


def _geometry(spec: GeometrySpec) -> tuple[object, ...]:
    """What the built model depends on: ids, labels and bases do not change it."""
    return (
        spec.envelope_m,
        [
            (p.shape, p.material, p.center_m, p.size_m, p.axis, p.taper, p.narrow_end)
            for p in spec.parts
        ],
    )


def _not_represented(items: list[str], instruction: str) -> list[str]:
    listed = [text for text in (_text(item, 300, "") for item in items) if text]
    for pattern, what in _UNREPRESENTABLE:
        if pattern.search(instruction) and not any(pattern.search(item) for item in listed):
            listed.append(what)
    return list(dict.fromkeys(listed))[:MAX_NOT_REPRESENTED]
