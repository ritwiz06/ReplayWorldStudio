"""Instruction -> proposed change to a generated model's specification (GEN-02, GEN-04).

The language model answers with changes to the current parts (remove, change, add); every part
it does not mention is kept exactly. This module decides what reaches the user:

1. the answer must parse and match the requested schema (one retry with the problems listed);
   a change or removal must name an existing part;
2. parts are repaired as for a new object and fitted to the overall size by the deterministic
   generator (never by model-written code); a revision needing more parts than the generator
   allows is an explicit limitation, never silently cut;
3. the overall size is kept unless the instruction asks for a different one;
4. three outcomes: a proposal (``partial`` when some requested things cannot be shown),
   ``unsupported`` (nothing drawable, or a proposal that would misrepresent the object: no
   change, or a solid block where the user asked for something open) and
   ``already_satisfied`` (the current model already shows it; no identical version is made);
5. what cannot be shown is listed, grounded in the user's own words, and never imitated.

Nothing is built or stored here: the user reviews the proposal, and only then does the API
build the revision as a new asset (see ``generated_assets.create_asset_revision``).
"""

from __future__ import annotations

import hashlib
import json
import re
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
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
    GEOMETRY_MAX_PARTS,
    GEOMETRY_MIN_ENVELOPE_M,
    GEOMETRY_MIN_PART_M,
    GeometryPart,
)

from ..objects import fit_to_envelope
from . import prompts, visibility
from .answers import RawPart, RawRepeat, RawRevisionAnswer, provider_schema
from .lengths import find_lengths
from .proposals import MAX_ATTEMPTS, AssistError, _parts, _text, _Unusable, describe_problems
from .provider import Provider, ProviderError

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
# "Open" as a structure (open shelves, open front), not as an action ("a lid that can open").
_OPEN_WORDS: Final = re.compile(
    r"(?<!can )(?<!to )(?<!that )(?<!which )(?<!will )(?<!and )"
    r"\b(?:open|opening|hollow|empty|without\s+doors?|no\s+doors?|no\s+front|frame\s+only"
    r"|see-through|cage|shelves)\b",
    re.IGNORECASE,
)
# Requested features the generator cannot show, recognised in the user's own words. Each is
# listed with the words that asked for it, so nothing is invented from the model's prose.
_UNREPRESENTABLE: Final = (
    (
        re.compile(
            r"\b(?:curved?|curving|bends?|bent|slanted|sloped|sloping|angled|diagonal(?:ly)?"
            r"|tilted|rotated|rounded\s+arch)\b",
            re.IGNORECASE,
        ),
        "curved, slanted or rotated surfaces are not available (only axis-aligned boxes, "
        "cylinders, frustums and spheres)",
    ),
    (
        re.compile(r"\b(?:holes?|perforated|perforations?|mesh|grilles?|slots?)\b", re.IGNORECASE),
        "holes, slots and perforations cannot be shown",
    ),
    (
        re.compile(
            r"\b(?:textures?|textured|logos?|printed|print|text|lettering|labels?|engrav\w*"
            r"|patterns?|patterned|grain|stickers?)\b",
            re.IGNORECASE,
        ),
        "textures, printing, labels and patterns cannot be shown",
    ),
    (
        re.compile(
            r"\b(?:hinges?|hinged|sliding|rolling|spinning|swivel\w*|folding|lockable"
            r"|motori[sz]ed|motors?|working|functional|lights?\s+up|glow(?:s|ing)?|heat(?:s|ing|ed)?"
            r"|cool(?:s|ing)|refrigerat\w*|powered|electric\w*|battery|actually\s+\w+"
            r"|opening\s+(?:doors?|lids?|drawers?)"
            r"|(?:that|which|can|could|to)\s+(?:open|opens|close|closes|turn|turns|roll|rolls"
            r"|spin|spins|move|moves|slide|slides|swivel|swivels|fold|folds|lock|locks|rotate"
            r"|rotates))\b",
            re.IGNORECASE,
        ),
        "anything that works or moves is drawn as a fixed shape only",
    ),
    (
        re.compile(
            r"\b(?:fireproof|fire-?resistant|waterproof|water-?resistant|rust-?proof|strength"
            r"|load[- ]bearing|load\s+capacity|weigh(?:s|ing|t)?|light-?weight|chemical\w*"
            r"|antibacterial|magnetic|insulated|soundproof|bulletproof)\b",
            re.IGNORECASE,
        ),
        "material properties (strength, weight, fire or water resistance, chemistry) are not "
        "modelled",
    ),
)
_WORD: Final = re.compile(r"[a-z]{4,}")
_STOP: Final = frozenset(
    [
        "that",
        "this",
        "with",
        "from",
        "into",
        "them",
        "they",
        "their",
        "there",
        "make",
        "made",
        "have",
        "just",
        "only",
        "also",
        "would",
        "should",
        "could",
        "like",
        "more",
        "less",
        "very",
        "each",
        "some",
        "what",
        "when",
        "then",
        "than",
        "your",
        "about",
        "cannot",
        "shown",
        "show",
        "model",
        "generator",
        "object",
        "part",
        "parts",
        "feature",
        "features",
    ]
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


BUDGET_S: Final = 150.0
"""One limit for the whole request: the first answer, its checks and the one corrected answer."""
MIN_RETRY_S: Final = 20.0
"""A corrected answer is only asked for when at least this much of the budget is left (and at
least as long as the first answer took)."""
MAX_PROBLEMS: Final = 20


class Cancelled(AssistError):
    """The user cancelled (or closed the page); nothing more is asked of the provider."""

    def __init__(self) -> None:
        super().__init__(499, "The request was cancelled; nothing was changed.")


@dataclass
class _Judged:
    """What one answer would give the user, and what a corrected answer could fix."""

    result: ModelRevisionProposalResult
    feedback: list[str] = field(default_factory=list)


def propose_revision(
    provider: Provider,
    request: ModelRevisionProposalRequest,
    *,
    budget_s: float = BUDGET_S,
    cancelled: threading.Event | None = None,
    clock: Callable[[], float] = time.monotonic,
) -> ModelRevisionProposalResult:
    """Ask the provider for a revised specification and return it checked and fitted.

    The whole request has one time budget. The model gets at most one more try, shared by
    every problem the checks find (an unusable answer, a solid block where the user asked for
    something open, added parts nobody could see), and only while the budget can cover it.
    When the corrected answer cannot be had, the first answer is judged as it is: its problems
    are shown, never hidden. Cancelling stops further provider calls; an answer that arrives
    after it is discarded.
    """
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
    started = clock()
    latency = 0
    first_valid = False
    last_problem = ""
    fallback: _Judged | None = None
    first_took = 0.0

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
                    return _with_check(fallback.result, note)
                raise AssistError(
                    504,
                    f"{provider.service} ({provider.model}) gave an unusable answer and there "
                    f"was no time left to ask again within {budget_s:.0f} s. Last problem: "
                    f"{last_problem[:300]}",
                )
        asked = clock()
        try:
            completion = provider.complete(
                task="revision",
                key=key,
                messages=messages,
                schema=REVISION_SCHEMA,
                attempt=attempt,
                timeout_s=remaining,
            )
        except ProviderError as exc:
            stop_if_cancelled()
            if fallback is not None and exc.kind == "timeout":
                return _with_check(
                    fallback.result,
                    f"The corrected answer did not arrive within the {budget_s:.0f} s limit; "
                    "this is the first answer, with the problems the checks found.",
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
            judged = _judge(answer, request, run)
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
        if not judged.feedback or attempt + 1 >= MAX_ATTEMPTS:
            return judged.result
        # One corrected answer for every problem found, in a single message.
        fallback = judged
        listed = "\n".join(f"- {line}" for line in judged.feedback)
        messages += [
            {"role": "assistant", "content": completion.content},
            {
                "role": "user",
                "content": "The app checked that answer and found problems a viewer would "
                f"notice:\n{listed}\nFix all of them in one corrected answer and keep every "
                "other part as it was. Reply again with corrected JSON only.",
            },
        ]
    raise AssistError(
        502,
        f"{provider.service} ({provider.model}) did not return a usable revision after "
        f"{MAX_ATTEMPTS} attempts. Last problem: {last_problem[:300]}",
    )


def _with_check(result: ModelRevisionProposalResult, note: str) -> ModelRevisionProposalResult:
    return result.model_copy(update={"checks": [*result.checks, note]})


def _unsupported(
    message: str,
    run: ProviderRun,
    not_represented: list[str],
    checks: list[str],
    outcome: str = "unsupported",
) -> ModelRevisionProposalResult:
    return ModelRevisionProposalResult.model_validate(
        {
            "outcome": outcome,
            "message": message,
            "spec": None,
            "summary": None,
            "partial": False,
            "size_changed": False,
            "not_represented": not_represented,
            "checks": checks,
            "problems": [],
            "provider": run,
        }
    )


def _judge(
    answer: RawRevisionAnswer,
    request: ModelRevisionProposalRequest,
    run: ProviderRun,
) -> _Judged:
    instruction = request.instruction
    checks: list[str] = []
    not_represented = _not_represented(answer.not_representable, instruction, checks)
    if answer.outcome == "unsupported":
        message = _text(
            answer.message, 500, "Nothing in this request can be shown by the generator."
        )
        return _Judged(_unsupported(message, run, not_represented, checks))
    if answer.outcome == "already_satisfied":
        message = _text(answer.message, 500, "The current model already shows this.")
        return _Judged(_unsupported(message, run, not_represented, checks, "already_satisfied"))

    parts, part_checks = _apply_changes(answer, request.spec.parts)
    checks += part_checks
    if len(parts) > GEOMETRY_MAX_PARTS:
        # Never cut parts silently: the user sees the limit and can simplify the request.
        return _Judged(
            _unsupported(
                f"This change would need {len(parts)} parts; the generator draws at most "
                f"{GEOMETRY_MAX_PARTS}. Nothing was changed: ask for fewer repeated items, or "
                "change the parts by hand.",
                run,
                not_represented,
                checks,
            )
        )
    parts, overlap_checks = separate_overlaps(parts)
    checks += overlap_checks

    envelope = request.spec.envelope_m
    if find_lengths(instruction) or _SIZE_WORDS.search(instruction):
        raw = answer.envelope_m
        target = Extent3(x=_clamp(raw.x), y=_clamp(raw.y), z=_clamp(raw.z))
    else:
        # The object's recorded size is kept: parts that reach outside it are fitted back in
        # (the fit says so), rather than growing a size that carries its own evidence.
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

    if _geometry(spec) == _geometry(request.spec):
        return _Judged(
            _unsupported("The proposal does not change the model.", run, not_represented, checks)
        )
    if _imitates_a_property(instruction, spec, request.spec):
        return _Judged(
            _unsupported(
                "Only colours changed, but the request was for properties a colour cannot give. "
                "Nothing was changed.",
                run,
                not_represented,
                checks,
            )
        )
    if _OPEN_WORDS.search(instruction):
        e = spec.envelope_m
        solid = max(spec.parts, key=lambda p: p.size_m.x * p.size_m.y * p.size_m.z)
        share = solid.size_m.x * solid.size_m.y * solid.size_m.z / (e.x * e.y * e.z)
        if share >= SOLID_SHARE:
            return _Judged(
                _unsupported(
                    f"The proposal still has a solid block filling {share * 100:.0f} % of the "
                    "object, so it would not be open. Nothing was changed; try the part controls "
                    "instead.",
                    run,
                    not_represented,
                    checks,
                ),
                [
                    f"The solid part “{solid.label}” (id {solid.id}) still fills "
                    f"{share * 100:.0f} % of the object, so it is not open. Put its id in remove "
                    "and build the open structure from separate panels."
                ],
            )

    # Colours: what the user named is shown; an unnamed addition that blends in stands out.
    colours = visibility.honour_colours(spec, request.spec, instruction)
    spec, contrast_notes = visibility.contrast_additions(
        colours.spec, request.spec, colours.named_parts
    )
    checks += list(dict.fromkeys(colours.notes + contrast_notes))
    not_represented = _drop_shown_colours(not_represented, colours.honoured, checks)
    not_represented = list(dict.fromkeys(not_represented + colours.texture_limits))[
        :MAX_NOT_REPRESENTED
    ]
    problems = visibility.find_problems(spec, request.spec, instruction)
    result = ModelRevisionProposalResult(
        outcome="proposal",
        message=None,
        spec=spec,
        summary=_text(answer.summary, 300, f"Changed as asked: “{instruction}”"),
        partial=bool(not_represented),
        size_changed=size_changed,
        not_represented=not_represented,
        checks=checks,
        problems=list(dict.fromkeys(p.text for p in problems))[:MAX_PROBLEMS],
        provider=run,
    )
    feedback = [p.feedback for p in problems if p.retry]
    return _Judged(result, list(dict.fromkeys(feedback))[:MAX_PROBLEMS])


def _drop_shown_colours(items: list[str], shown: set[str], checks: list[str]) -> list[str]:
    """A listed limitation that only says a colour is missing, when that colour is shown."""
    kept: list[str] = []
    for item in items:
        words = set(re.findall(r"[a-z]+", item.lower()))
        if words & shown and not words & visibility.TEXTURES:
            checks.append(f"Left out “{item}” from what cannot be shown: the colour is shown.")
            continue
        kept.append(item)
    return kept


MAX_COPIES: Final = 2 * GEOMETRY_MAX_PARTS


def _expand(repeats: list[RawRepeat]) -> list[RawPart]:
    """Each repeat as its copies, ids numbered from 1. A repeat asking for more copies than the
    object could ever hold is unusable (asked again), never cut short."""
    out: list[RawPart] = []
    for r in repeats:
        counts = (r.counts.x, r.counts.y, r.counts.z)
        if min(counts) < 1 or counts[0] * counts[1] * counts[2] > MAX_COPIES:
            raise _Unusable(f"repeat counts must be 1 or more, with at most {MAX_COPIES} copies")
        n = 0
        for i in range(counts[0]):
            for j in range(counts[1]):
                for k in range(counts[2]):
                    n += 1
                    centre = r.part.center_m.model_copy(
                        update={
                            "x": r.part.center_m.x + i * r.step_m.x,
                            "y": r.part.center_m.y + j * r.step_m.y,
                            "z": r.part.center_m.z + k * r.step_m.z,
                        }
                    )
                    out.append(
                        r.part.model_copy(update={"id": f"{r.part.id}-{n}", "center_m": centre})
                    )
    return out


def _apply_changes(
    answer: RawRevisionAnswer, current: list[GeometryPart]
) -> tuple[list[GeometryPart], list[str]]:
    """The current parts with the answer's removals, changes and additions applied.

    Every part the answer does not mention is kept unchanged (with its id, values and basis). A
    removal or change naming a part that does not exist makes the answer unusable (it is asked
    again), so a typo can never drop or duplicate a part silently.
    """
    by_id = {p.id: p for p in current}
    unknown = [i for i in answer.remove if i not in by_id] + [
        p.id for p in answer.change if p.id not in by_id
    ]
    if unknown:
        raise _Unusable(f"remove and change must name existing part ids; unknown: {unknown[:5]}")
    changed, checks = _parts(answer.change) if answer.change else ([], [])
    added, add_checks = (
        _parts([*answer.add, *_expand(answer.repeat)])
        if (answer.add or answer.repeat)
        else ([], [])
    )
    checks += add_checks
    # A changed part keeps where it came from; new parts take the answer's basis.
    replaced = {
        p.id: p.model_copy(update={"basis": by_id[p.id].basis}) for p in changed if p.id in by_id
    }
    removed = set(answer.remove)
    kept = [replaced.get(p.id, p) for p in current if p.id not in removed]
    used = {p.id for p in kept}
    fresh = []
    for part in added:
        part_id, n = part.id, 2
        while part_id in used:
            part_id = f"{part.id}-{n}"[:40]
            n += 1
        used.add(part_id)
        fresh.append(part.model_copy(update={"id": part_id}))
    parts = kept + fresh
    if not parts:
        raise _Unusable("a revision must leave at least one part")
    return parts, checks


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


_PROPERTY: Final = _UNREPRESENTABLE[-1][0]
_APPEARANCE_WORDS: Final = re.compile(
    r"\b(?:colou?rs?|paint\w*|red|blue|green|yellow|orange|white|black|gr[ae]y|silver|brown"
    r"|beige|pink|purple|wood\w*|steel|metal\w*|alumin\w*|chrome|glass|plastic|fabric"
    r"|concrete|copper|cardboard|finish|look)\b",
    re.IGNORECASE,
)


def _imitates_a_property(instruction: str, spec: GeometrySpec, current: GeometrySpec) -> bool:
    """A material-only change offered for a request that asks only for material properties
    ("make it fireproof"): a colour would merely suggest the property, so it is not offered."""
    if not _PROPERTY.search(instruction) or _APPEARANCE_WORDS.search(instruction):
        return False
    shape = [(p.shape, p.center_m, p.size_m, p.axis, p.taper, p.narrow_end) for p in spec.parts]
    before = [(p.shape, p.center_m, p.size_m, p.axis, p.taper, p.narrow_end) for p in current.parts]
    return shape == before and spec.envelope_m == current.envelope_m


def _stem(word: str) -> str:
    for suffix in ("ing", "ed", "es", "s"):
        if word.endswith(suffix) and len(word) - len(suffix) >= 4:
            return word[: -len(suffix)]
    return word


def _words(text: str) -> set[str]:
    return {_stem(w) for w in _WORD.findall(text.lower()) if w not in _STOP}


def _clause(instruction: str, match: re.Match[str]) -> str:
    """The part of the instruction around a match, as the user wrote it (at most ~60 chars)."""
    bounds = [
        m.end()
        for m in re.finditer(r"[,;.]|\band\b|\bbut\b", instruction)
        if m.end() <= match.start()
    ]
    start = bounds[-1] if bounds else 0
    end_match = re.search(r"[,;.]|\band\b|\bbut\b", instruction[match.end() :])
    end = match.end() + (end_match.start() if end_match else len(instruction) - match.end())
    words = instruction[start:end].strip()
    return words if len(words) <= 60 else instruction[match.start() : match.end()]


def _not_represented(items: list[str], instruction: str, checks: list[str]) -> list[str]:
    """What cannot be shown, grounded in the instruction.

    The model's own list is kept only where an entry shares a word with the instruction, so it
    cannot invent requests the user never made; each feature the instruction asks for that the
    generator cannot show is then added in the user's words if the model did not list it.
    """
    asked = _words(instruction)
    listed: list[str] = []
    dropped = 0
    for item in items:
        text = _text(item, 300, "")
        if not text:
            continue
        if _words(text) & asked:
            listed.append(text)
        else:
            dropped += 1
    if dropped:
        checks.append(
            f"Left out {dropped} listed limitation{'' if dropped == 1 else 's'} that the "
            "instruction did not ask for."
        )
    for pattern, why in _UNREPRESENTABLE:
        for match in pattern.finditer(instruction):
            clause = _clause(instruction, match)
            # Already listed when an entry shares a word with this part of the request.
            if any(_words(clause) & _words(item) for item in listed):
                continue
            listed.append(f"“{clause}”: {why}")
    return list(dict.fromkeys(listed))[:MAX_NOT_REPRESENTED]
