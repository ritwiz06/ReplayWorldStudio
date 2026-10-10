"""Edit request -> one bounded, typed edit intent.

The language model interprets the words; this module checks the interpretation against the
scene the browser described and the user's own words before anything is shown:

* the target must be an object in the scene; "the selected ..." must be the selection;
* when the words fit several objects, the answer becomes a question listing them;
* a distance or angle must appear in the request with its unit, and so must a direction -
  otherwise the user is asked rather than given a guess.

The browser then turns the intent into an exact command and validates it with the same
command engine as every other edit (revision, limits, contract) before showing it.
"""

from __future__ import annotations

import json
import re
from typing import Final

from pydantic import ValidationError
from replay_world_contracts import (
    EditIntent,
    EditProposalRequest,
    EditProposalResult,
    ProviderRun,
)
from replay_world_contracts.assist import ContextObject, EditContext

from . import prompts
from .answers import RawEditAnswer, provider_schema
from .lengths import METRES_PER_UNIT, find_angles, find_stated
from .proposals import MAX_ATTEMPTS, AssistError, describe_problems
from .provider import Provider

EDIT_SCHEMA: Final = provider_schema(RawEditAnswer)

# Words that must appear for a direction to count as stated.
_DIRECTION_WORDS: Final[dict[str, tuple[str, ...]]] = {
    "left": ("left", "-x", "negative x"),
    "right": ("right", "+x", "positive x"),
    "back": ("back", "backward", "backwards", "away", "rear", "-z", "up the screen"),
    "forward": ("forward", "forwards", "toward the front", "towards the front", "front", "+z"),
    "up": ("up", "upward", "upwards", "raise", "higher", "lift"),
    "down": ("down", "downward", "downwards", "lower"),
}
_TURN_WORDS: Final[dict[str, tuple[str, ...]]] = {
    "clockwise": ("clockwise", "cw"),
    "counterclockwise": (
        "counterclockwise",
        "counter-clockwise",
        "anticlockwise",
        "anti-clockwise",
        "ccw",
    ),
}
_STOP_WORDS: Final = frozenset(
    {
        *("the", "a", "an", "this", "that", "it", "selected", "object", "one", "to", "by"),
        *("of", "on", "in", "at", "for", "please", "move", "turn", "rotate"),
    }
)


def _context_json(context: EditContext) -> str:
    def row(o: ContextObject) -> dict[str, object]:
        p, s = o.position_m, o.size_m
        return {
            "id": o.id,
            "name": o.name,
            "kind": o.kind,
            "position_m": [round(p.x, 3), round(p.y, 3), round(p.z, 3)],
            "size_m": [round(s.x, 3), round(s.y, 3), round(s.z, 3)],
            "rotation_y_deg": round(o.rotation_y_rad * 180 / 3.141592653589793, 1),
        }

    return json.dumps(
        {
            "selected_object_id": context.selected_object_id,
            "objects": [row(o) for o in context.objects],
        },
        separators=(",", ":"),
    )


def recording_key(request: EditProposalRequest) -> str:
    return f"{request.request} | selected={request.context.selected_object_id or 'none'}"


def propose_edit(provider: Provider, request: EditProposalRequest) -> EditProposalResult:
    messages = [
        {"role": "system", "content": prompts.EDIT_SYSTEM},
        {
            "role": "user",
            "content": prompts.edit_user_message(request.request, _context_json(request.context)),
        },
    ]
    latency = 0
    first_valid = False
    last_problem = ""
    for attempt in range(MAX_ATTEMPTS):
        completion = provider.complete(
            task="edit",
            key=recording_key(request),
            messages=messages,
            schema=EDIT_SCHEMA,
            attempt=attempt,
        )
        latency += completion.latency_ms
        try:
            answer = RawEditAnswer.model_validate_json(completion.content.strip())
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
                    "content": f"That answer cannot be used: {last_problem}. Reply again with "
                    "corrected JSON only.",
                },
            ]
    raise AssistError(
        502,
        f"{provider.service} ({provider.model}) did not return a usable edit after "
        f"{MAX_ATTEMPTS} attempts. Last problem: {last_problem[:300]}",
    )


def _ask(
    run: ProviderRun, question: str, candidates: list[str], checks: list[str]
) -> EditProposalResult:
    return EditProposalResult(
        outcome="clarification",
        intent=None,
        question=question,
        candidates=candidates,
        message=None,
        checks=checks,
        provider=run,
    )


def _words(text: str) -> list[str]:
    return [w for w in re.findall(r"[a-z0-9+-]+", text.casefold()) if w not in _STOP_WORDS]


def _says(text: str, words: tuple[str, ...]) -> bool:
    lowered = f" {' '.join(re.findall(r'[a-z0-9+-]+', text.casefold()))} "
    return any(f" {w} " in lowered for w in words)


def _result(
    answer: RawEditAnswer, request: EditProposalRequest, run: ProviderRun
) -> EditProposalResult:
    context = request.context
    objects = {o.id: o for o in context.objects}
    text = request.request

    if answer.outcome == "unsupported":
        message = (answer.message or "").strip() or "That kind of change is not supported yet."
        return EditProposalResult(
            outcome="unsupported",
            intent=None,
            question=None,
            candidates=[],
            message=message[:500],
            checks=[],
            provider=run,
        )
    if answer.outcome == "clarification":
        question = (answer.question or "").strip() or "Which object, and what change?"
        return _ask(run, question[:500], [c for c in answer.candidates if c in objects], [])

    if answer.action is None or answer.target is None:
        raise ValueError("a proposal needs an action and a target")
    target = answer.target
    # "the selected cabinet" refers to the selection whatever object the model picked; the
    # check below then asks when the words do not fit the selected object.
    if target.reference == "named" and re.search(r"\bselected\b", text, re.IGNORECASE):
        target = target.model_copy(update={"reference": "selected"})
    if target.reference == "selected":
        selected = context.selected_object_id
        if selected is None or selected not in objects:
            return _ask(run, "Nothing is selected. Which object should change?", [], [])
        current = objects[selected]
        # "the selected cabinet" while a conveyor is selected: the words and the selection
        # disagree, so ask which one is meant.
        nouns = _words(target.phrase)
        described = f"{current.name} {current.kind}".casefold()
        if target.object_id != selected or (nouns and not all(n in described for n in nouns)):
            others = [
                o.id
                for o in context.objects
                if o.id != selected and nouns and all(n in o.name.casefold() for n in nouns)
            ]
            return _ask(
                run,
                f"You said “{target.phrase}”, but the selected object is {current.name}. Which "
                "object should change?",
                [selected, *others[:5]],
                [],
            )
    if target.object_id is None or target.object_id not in objects:
        raise ValueError(f"target/object_id: '{target.object_id}' is not an object in the scene")
    chosen = objects[target.object_id]

    # The words may fit several objects even though the model picked one ("the cabinet" when
    # there are two cabinets). Only an explicit selection settles that without asking.
    if target.reference == "named":
        tokens = _words(target.phrase)
        matches = [
            o.id for o in context.objects if tokens and all(t in o.name.casefold() for t in tokens)
        ]
        exact = [o.id for o in context.objects if o.name.casefold() == " ".join(tokens)]
        if len(matches) > 1 and len(exact) != 1:
            names = ", ".join(objects[i].name for i in matches[:6])
            return _ask(run, f"“{target.phrase}” could be {names}. Which one?", matches[:6], [])

    if answer.action == "move":
        move = answer.move
        if move is None:
            raise ValueError("move: a move proposal needs a distance and direction")
        metres = move.distance * METRES_PER_UNIT[move.unit]
        if move.distance <= 0 or find_stated(text, metres) is None:
            return _ask(
                run,
                f"How far should {chosen.name} move? Give a distance with a unit, for example "
                "“1 m” or “300 mm”.",
                [],
                ["No distance with a unit was found in the request."],
            )
        if not _says(text, _DIRECTION_WORDS[move.direction]):
            return _ask(
                run,
                f"Which way should {chosen.name} move: left, right, forward, back, up or down?",
                [],
                ["The direction is not in the request."],
            )
        intent = EditIntent.model_validate(
            {
                "action": "move",
                "target": {
                    "reference": target.reference,
                    "object_ids": [chosen.id],
                    "phrase": target.phrase or chosen.name,
                },
                "move": {
                    "direction": move.direction,
                    "distance": move.distance,
                    "unit": move.unit,
                    "quote": move.quote or text,
                },
                "rotate": None,
            }
        )
    else:
        rotate = answer.rotate
        if rotate is None:
            raise ValueError("rotate: a rotate proposal needs an angle and direction")
        if not any(abs(a - rotate.angle_deg) < 1e-9 for a in find_angles(text)):
            return _ask(
                run,
                f"By how many degrees should {chosen.name} turn?",
                [],
                ["No angle was found in the request."],
            )
        if not _says(text, _TURN_WORDS[rotate.direction]):
            return _ask(
                run,
                f"Should {chosen.name} turn clockwise or counterclockwise (seen from above)?",
                [],
                ["The turning direction is not in the request."],
            )
        intent = EditIntent.model_validate(
            {
                "action": "rotate",
                "target": {
                    "reference": target.reference,
                    "object_ids": [chosen.id],
                    "phrase": target.phrase or chosen.name,
                },
                "move": None,
                "rotate": {
                    "direction": rotate.direction,
                    "angle_deg": rotate.angle_deg,
                    "quote": rotate.quote or text,
                },
            }
        )
    return EditProposalResult(
        outcome="proposal",
        intent=intent,
        question=None,
        candidates=[],
        message=None,
        checks=[],
        provider=run,
    )


__all__ = ["AssistError", "propose_edit", "recording_key"]
