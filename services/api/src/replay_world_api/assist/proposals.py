"""Description -> typed object proposal.

The language model drafts; this module decides what reaches the user:

1. the answer must parse and match the requested schema (one retry with the problems listed);
2. every dimension marked "stated" must be found, with its unit, in the description - if not,
   it becomes an estimate that the user has to confirm;
3. parts must use approved shapes and materials and are fitted to the overall size by the
   deterministic generator (never by model-written code);
4. mass, strength, chemical composition and operating behaviour are always unknown.

Every correction is reported back in plain words (``checks``).
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Final, Literal

from pydantic import ValidationError
from replay_world_contracts import (
    GEOMETRY_FORMAT,
    UNKNOWN_PROPERTIES,
    GeometryDraft,
    ObjectProposal,
    ObjectProposalResult,
    ProposedDimensions,
    ProposedLength,
    ProviderRun,
    UnknownProperty,
)
from replay_world_contracts.models import (
    GEOMETRY_MAX_ENVELOPE_M,
    GEOMETRY_MAX_PARTS,
    GEOMETRY_MIN_ENVELOPE_M,
    GEOMETRY_MIN_PART_M,
    GeometryPart,
    parts_bounds,
)

from ..objects import fit_to_envelope
from . import prompts
from .answers import RawObjectAnswer, RawPart, provider_schema
from .lengths import appears_in, find_lengths, find_stated
from .provider import Provider

MAX_ATTEMPTS: Final = 2
MAX_FACTS: Final = 12
OBJECT_SCHEMA: Final = provider_schema(RawObjectAnswer)

UNKNOWN_REASONS: Final[dict[str, str]] = {
    "mass": "Not established. A generated model is a picture at the stated size; use a "
    "measured or supplier value.",
    "strength": "Not established. Load capacity and structural strength are not modelled.",
    "chemical_composition": "Not established. Colours and finishes are appearance only, not "
    "the material or its chemistry.",
    "operating_behaviour": "Not established. Speeds, cycle times and motion are not modelled.",
}

_MASS = re.compile(r"\b\d+(?:[.,]\d+)?\s*(?:kg|kilograms?|tonnes?|tons?|lbs?|pounds?)\b", re.I)
_RATE = re.compile(
    r"\b\d+(?:[.,]\d+)?\s*(?:m/s|m/min|rpm|(?:\w+\s+)?(?:per|an|a|/)\s*(?:hour|minute|min|h)\b)",
    re.I,
)


@dataclass(frozen=True)
class AssistError(Exception):
    """The request could not be answered. ``status`` is the HTTP status the API returns."""

    status: int
    message: str

    def __str__(self) -> str:
        return self.message


class _Unusable(ValueError):
    """The answer parsed but cannot become a proposal; worth one more attempt."""


def unknown_properties() -> list[UnknownProperty]:
    return [UnknownProperty(property=p, reason=UNKNOWN_REASONS[p]) for p in UNKNOWN_PROPERTIES]


def _parse(content: str) -> RawObjectAnswer:
    text = content.strip()
    if text.startswith("```"):  # some models wrap JSON in a code fence despite the schema
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text)
    return RawObjectAnswer.model_validate_json(text)


def describe_problems(exc: Exception) -> str:
    if isinstance(exc, ValidationError):
        lines = [f"{'/'.join(map(str, e['loc'])) or '(root)'}: {e['msg']}" for e in exc.errors()]
        return "; ".join(lines[:8]) + (f"; and {len(lines) - 8} more" if len(lines) > 8 else "")
    return str(exc)


def propose_object(provider: Provider, description: str) -> ObjectProposalResult:
    """Ask the provider for a proposal and turn its answer into a checked contract record."""
    messages = [
        {"role": "system", "content": prompts.OBJECT_SYSTEM},
        {"role": "user", "content": prompts.OBJECT_EXAMPLE_USER},
        {"role": "assistant", "content": prompts.OBJECT_EXAMPLE_ANSWER},
        {"role": "user", "content": prompts.object_user_message(description)},
    ]
    latency = 0
    first_valid = False
    last_problem = ""
    for attempt in range(MAX_ATTEMPTS):
        completion = provider.complete(
            task="object", key=description, messages=messages, schema=OBJECT_SCHEMA, attempt=attempt
        )
        latency += completion.latency_ms
        try:
            answer = _parse(completion.content)
            if attempt == 0:
                first_valid = True
            run = ProviderRun(
                service=provider.service,
                base_url=provider.base_url,
                model=provider.model,
                mode=provider.mode,
                attempts=attempt + 1,
                first_attempt_valid=first_valid,
                latency_ms=latency,
            )
            return _result(answer, description, run)
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
        f"{provider.service} ({provider.model}) did not return a usable proposal after "
        f"{MAX_ATTEMPTS} attempts. Last problem: {last_problem[:300]}",
    )


def _result(answer: RawObjectAnswer, description: str, run: ProviderRun) -> ObjectProposalResult:
    if answer.outcome == "clarification":
        question = (answer.question or "").strip() or (
            "What kind of object is it, and roughly how big?"
        )
        return ObjectProposalResult(
            outcome="clarification",
            proposal=None,
            question=question[:500],
            message=None,
            checks=[],
            provider=run,
        )
    if answer.outcome == "unsupported":
        message = (answer.message or "").strip() or "This is not a description of an object."
        return ObjectProposalResult(
            outcome="unsupported",
            proposal=None,
            question=None,
            message=message[:500],
            checks=[],
            provider=run,
        )
    proposal, checks = _proposal(answer, description)
    return ObjectProposalResult(
        outcome="proposal",
        proposal=proposal,
        question=None,
        message=None,
        checks=checks,
        provider=run,
    )


def _text(value: str | None, limit: int, fallback: str) -> str:
    text = " ".join((value or "").split()) or fallback
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def _facts(items: list[str]) -> list[str]:
    cleaned = [_text(item, 500, "") for item in items]
    return [item for item in cleaned if item][:MAX_FACTS]


def _proposal(answer: RawObjectAnswer, description: str) -> tuple[ObjectProposal, list[str]]:
    if answer.dimensions is None:
        raise _Unusable("a proposal needs dimensions")
    checks: list[str] = []
    lengths: dict[str, ProposedLength] = {}
    raw_dims = answer.dimensions
    for axis, raw in (
        ("width", raw_dims.width),
        ("height", raw_dims.height),
        ("depth", raw_dims.depth),
    ):
        value = raw.value_m
        if not GEOMETRY_MIN_ENVELOPE_M <= value <= GEOMETRY_MAX_ENVELOPE_M:
            raise _Unusable(
                f"dimensions/{axis}: {value} m is outside {GEOMETRY_MIN_ENVELOPE_M}-"
                f"{GEOMETRY_MAX_ENVELOPE_M} m"
            )
        basis: Literal["stated", "inferred"] = raw.basis
        quote: str | None = None
        if basis == "stated":
            found = find_stated(description, value)
            if found is None:
                basis = "inferred"
                checks.append(
                    f"The {axis} ({value:g} m) was marked as coming from your description, but "
                    "no such length is in it, so it is treated as an estimate to confirm."
                )
            elif raw.quote and appears_in(raw.quote, description) and find_stated(raw.quote, value):
                quote = " ".join(raw.quote.split())
            else:
                quote = found.text
        lengths[axis] = ProposedLength(
            value_m=value, basis=basis, quote=quote, needs_confirmation=basis == "inferred"
        )
    stated_values = [f for f in find_lengths(description)]
    if stated_values and not any(length.basis == "stated" for length in lengths.values()):
        checks.append(
            "Your description gives a size ("
            + ", ".join(f.text for f in stated_values[:3])
            + "), but the proposal does not use it for the overall size. Check the dimensions."
        )

    parts, part_checks = _parts(answer.parts)
    checks += part_checks
    if _length_runs_along_depth(lengths):
        # Long equipment runs along X in this tool (the catalog conveyors do), so its front
        # (+Z) faces the long side. Turn the proposal a quarter turn about +Y: a rotation, not a
        # mirror, so a screen on the operator's left stays on the left.
        parts = [_quarter_turn(part) for part in parts]
        lengths["width"], lengths["depth"] = lengths["depth"], lengths["width"]
        checks.append(
            f"Turned so that its stated length ({lengths['width'].value_m:g} m) runs along the "
            "width (X), like other long equipment; its front faces the long side."
        )
    # A stated size is the user's and the parts are fitted to it. An estimate is the model's own
    # guess, so it follows the parts the model laid out rather than stretching them to a second,
    # inconsistent guess.
    lo, hi = parts_bounds(parts)
    for axis, key in (("width", "x"), ("height", "y"), ("depth", "z")):
        length = lengths[axis]
        extent = round(getattr(hi, key) - getattr(lo, key), 3)
        if length.basis != "inferred" or not (
            GEOMETRY_MIN_ENVELOPE_M <= extent <= GEOMETRY_MAX_ENVELOPE_M
        ):
            continue
        if abs(extent - length.value_m) > 0.02 * max(extent, length.value_m):
            checks.append(
                f"The estimated {axis} was taken from the proposed parts ({extent:g} m rather "
                f"than {length.value_m:g} m), so the parts are not stretched."
            )
        lengths[axis] = length.model_copy(update={"value_m": extent})
    draft = GeometryDraft.model_validate(
        {
            "format": GEOMETRY_FORMAT,
            "envelope_m": {
                "x": lengths["width"].value_m,
                "y": lengths["height"].value_m,
                "z": lengths["depth"].value_m,
            },
            "parts": parts,
        }
    )
    spec, scale, notes = fit_to_envelope(draft)
    checks += notes
    largest = max(abs(scale.x - 1), abs(scale.y - 1), abs(scale.z - 1))
    if largest > 0.3:
        checks.append(
            "The model's parts did not agree with its overall size and were stretched by up to "
            f"{largest * 100:.0f} %. Check the preview before placing it."
        )

    not_modelled = _facts(answer.not_modelled)
    for pattern, what in ((_MASS, "Mass"), (_RATE, "A rate or speed")):
        for match in pattern.finditer(description):
            if not any(match.group(0).lower() in item.lower() for item in not_modelled):
                not_modelled.append(
                    f"{what} mentioned (“{match.group(0)}”); recorded here only, not modelled."
                )

    proposal = ObjectProposal(
        name=_text(answer.name, 80, "Described object"),
        category=_text(answer.category, 80, "object"),
        appearance=_text(answer.appearance, 300, "Appearance not described."),
        dimensions=ProposedDimensions(**lengths),
        spec=spec,
        stated_facts=_facts(answer.stated_facts),
        inferred_facts=_facts(answer.inferred_facts),
        not_modelled=not_modelled[:MAX_FACTS],
        unknown_properties=unknown_properties(),
    )
    return proposal, checks


_LENGTH_WORDS: Final = re.compile(r"\b(?:long|length|lengths)\b", re.IGNORECASE)


def _length_runs_along_depth(lengths: dict[str, ProposedLength]) -> bool:
    """The user's "long" size landed on the depth axis while the width is only an estimate."""
    depth, width = lengths["depth"], lengths["width"]
    return (
        depth.basis == "stated"
        and width.basis == "inferred"
        and depth.quote is not None
        and _LENGTH_WORDS.search(depth.quote) is not None
        and depth.value_m > width.value_m
    )


def _quarter_turn(part: GeometryPart) -> GeometryPart:
    """Rotate a part +90° about +Y: x' = z, z' = -x; extents swap; a cylinder's axis follows."""
    c, size = part.center_m, part.size_m
    axis = {"x": "z", "z": "x"}.get(part.axis, part.axis) if part.axis else None
    return GeometryPart.model_validate(
        {
            **part.model_dump(),
            "center_m": {"x": c.z, "y": c.y, "z": -c.x + 0.0},
            "size_m": {"x": size.z, "y": size.y, "z": size.x},
            "axis": axis,
        }
    )


def _slug(text: str) -> str:
    slug = re.sub(r"[^a-z0-9_-]+", "-", text.lower()).strip("-_")
    return (slug or "part")[:36]


def _parts(raw_parts: list[RawPart]) -> tuple[list[GeometryPart], list[str]]:
    """Repair what can be repaired deterministically; drop what cannot, and say so."""
    parts: list[GeometryPart] = []
    checks: list[str] = []
    used: set[str] = set()
    dropped: list[str] = []
    for raw in raw_parts[:GEOMETRY_MAX_PARTS]:
        size = {a: getattr(raw.size_m, a) for a in "xyz"}
        if any(v <= 0 for v in size.values()):
            dropped.append(raw.label or raw.id)
            continue
        size = {a: max(v, GEOMETRY_MIN_PART_M) for a, v in size.items()}
        axis: Literal["x", "y", "z"] | None = raw.axis if raw.shape == "cylinder" else None
        taper = raw.taper
        narrow_end = raw.narrow_end
        if raw.shape == "frustum":
            taper = min(max(taper if taper is not None else 0.5, 0.0), 1.0)
            narrow_end = narrow_end or "top"
        else:
            taper = None
            narrow_end = None
        base = _slug(raw.id or raw.label)
        part_id = base
        n = 2
        while part_id in used:
            part_id = f"{base}-{n}"
            n += 1
        used.add(part_id)
        try:
            parts.append(
                GeometryPart.model_validate(
                    {
                        "id": part_id,
                        "label": _text(raw.label, 80, part_id),
                        "shape": raw.shape,
                        "material": raw.material,
                        "center_m": raw.center_m.model_dump(),
                        "size_m": size,
                        "axis": axis,
                        "taper": taper,
                        "narrow_end": narrow_end,
                        "basis": raw.basis,
                    }
                )
            )
        except ValidationError:
            dropped.append(raw.label or raw.id)
    if len(raw_parts) > GEOMETRY_MAX_PARTS:
        checks.append(f"Only the first {GEOMETRY_MAX_PARTS} parts were kept.")
    if dropped:
        checks.append("Parts left out because their shape was invalid: " + ", ".join(dropped[:6]))
    if not parts:
        raise _Unusable("a proposal needs at least one valid part")
    return parts, checks


def proposal_as_json(result: ObjectProposalResult) -> str:
    return json.dumps(result.model_dump(mode="json"), indent=2)
