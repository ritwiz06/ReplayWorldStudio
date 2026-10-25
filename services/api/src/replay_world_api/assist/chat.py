"""Chat message -> a short plan of bounded, typed steps (UX-03/UX-04, AGT-01).

The language model only interprets the words, in one call. This module checks every step of its
answer before the browser sees it:

* move and rotate go through the edit checks: the target must be an object in the scene, the
  distance or angle and the direction must be in the message;
* "it", "this" and "that machine" mean the object of an earlier step, else the conversation's
  focus object, else the selection; if there is none, the step asks;
* a name that fits several objects does not stop the plan: that step carries the candidates, and
  the person's choice completes it without another call;
* a missing distance, direction or angle is asked for on its step;
* select, route ends and "beside" objects must be objects in the scene; a size or width counts
  only when the message states it with its unit;
* a part the app cannot do is kept as an unsupported step, never dropped silently.

The browser then checks prerequisites and the scene revision, shows the plan and its effect, and
performs the steps with its own deterministic code after one Apply. Nothing here changes anything.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any, Final

from pydantic import ValidationError
from replay_world_contracts import (
    ChatRequest,
    ChatResult,
    EditProposalRequest,
    ProviderRun,
)
from replay_world_contracts.assist import MAX_CHAT_STEPS, ChatStep

from . import prompts
from .answers import RawChatPlan, RawChatStep, RawEditAnswer, provider_schema
from .edits import _DIRECTION_WORDS, _context_json, _fits_all, _says, _words
from .edits import _result as _edit_result
from .lengths import METRES_PER_UNIT, find_stated
from .proposals import MAX_ATTEMPTS, AssistError, describe_problems
from .provider import Provider

PROMPT_VERSION: Final = "chat-02"
CHAT_SCHEMA: Final = provider_schema(RawChatPlan)


def recording_key(request: ChatRequest) -> str:
    """The message, the selection, the focus object and which objects the scene holds."""
    scene = json.dumps(
        sorted((o.id, o.name) for o in request.context.objects), separators=(",", ":")
    )
    digest = hashlib.sha256(scene.encode("utf-8")).hexdigest()[:12]
    selected = request.context.selected_object_id or "none"
    key = f"{request.request} | selected={selected} | scene={digest}"
    return f"{key} | focus={request.focus_object_id}" if request.focus_object_id else key


def _state_json(request: ChatRequest) -> str:
    state: dict[str, Any] = request.state.model_dump(mode="json")
    state["focus_object_id"] = request.focus_object_id
    return json.dumps(state, separators=(",", ":"))


def _parse(content: str) -> RawChatPlan:
    data = json.loads(content.strip())
    if isinstance(data, dict) and "intent" in data and "steps" not in data:
        data = {"steps": [{"add": None, **data}]}  # a chat-01 answer: one step
    return RawChatPlan.model_validate(data)


def interpret_chat(provider: Provider, request: ChatRequest) -> ChatResult:
    context = _context_json(request.context)
    messages = [
        {"role": "system", "content": prompts.CHAT_SYSTEM},
        {
            "role": "user",
            "content": prompts.chat_user_message(
                request.request, f"{context}\nApp state: {_state_json(request)}"
            ),
        },
    ]
    latency = 0
    first_valid = False
    last_problem = ""
    for attempt in range(MAX_ATTEMPTS):
        completion = provider.complete(
            task="chat",
            key=recording_key(request),
            messages=messages,
            schema=CHAT_SCHEMA,
            attempt=attempt,
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
            return _checked(answer, request, run)
        except (ValidationError, ValueError) as exc:
            last_problem = describe_problems(exc) if isinstance(exc, ValidationError) else str(exc)
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
        f"{provider.service} ({provider.model}) did not return a usable answer after "
        f"{MAX_ATTEMPTS} attempts. Last problem: {last_problem[:300]}",
    )


def _result(
    run: ProviderRun,
    outcome: str,
    *,
    steps: list[ChatStep] | None = None,
    question: str | None = None,
    candidates: list[str] | None = None,
    message: str | None = None,
    checks: list[str] | None = None,
) -> ChatResult:
    return ChatResult.model_validate(
        {
            "outcome": outcome,
            "steps": steps or [],
            "question": question,
            "candidates": candidates or [],
            "message": message,
            "checks": checks or [],
            "provider": run,
        }
    )


def _step(action: str | None, **fields: Any) -> ChatStep:
    base: dict[str, Any] = {
        "action": action,
        "target_id": None,
        "move": None,
        "rotate": None,
        "route": None,
        "add": None,
        "needs": None,
        "unsupported": None,
    }
    return ChatStep.model_validate({**base, **fields})


def _named(request: ChatRequest, phrase: str, chosen: str | None) -> tuple[str | None, list[str]]:
    """The one object a phrase names, or the candidates when it fits several."""
    objects = {o.id for o in request.context.objects}
    tokens = _words(phrase)
    matches = [o.id for o in request.context.objects if _fits_all(tokens, o.name)]
    exact = [
        o.id
        for o in request.context.objects
        if o.name.casefold() in (" ".join(tokens), phrase.casefold().strip())
    ]
    if len(exact) == 1:
        return exact[0], []
    if len(matches) > 1:
        return None, matches[:6]
    if chosen is None or chosen not in objects:
        raise ValueError(f"target/object_id: '{chosen}' is not an object in the scene")
    return chosen, []


def _amount(raw: RawChatStep, text: str) -> dict[str, Any] | None:
    """A stated move amount kept while the target is asked (null unless it is in the words)."""
    move = raw.move
    if raw.intent != "move" or move is None or move.distance <= 0:
        return None
    if find_stated(text, move.distance * METRES_PER_UNIT[move.unit]) is None:
        return None
    if not _says(text, _DIRECTION_WORDS[move.direction]):
        return None
    return {
        "direction": move.direction,
        "distance": move.distance,
        "unit": move.unit,
        "quote": move.quote or text,
    }


def _turn(raw: RawChatStep, text: str) -> dict[str, Any] | None:
    rotate = raw.rotate
    if raw.intent != "rotate" or rotate is None or not 0 < rotate.angle_deg <= 360:
        return None
    return {
        "direction": rotate.direction,
        "angle_deg": rotate.angle_deg,
        "quote": rotate.quote or text,
    }


_CHECKS_ONLY = ProviderRun(
    service="check",
    base_url="local",
    model="none",
    mode="recorded",
    attempts=1,
    first_attempt_valid=True,
    latency_ms=0,
)


def _need(kind: str, question: str, candidates: list[str] | None = None) -> dict[str, Any]:
    return {"kind": kind, "question": question, "candidates": candidates or []}


def _edit_step(
    raw: RawChatStep, request: ChatRequest, focus: str | None
) -> tuple[ChatStep, str | None]:
    """A move or turn, through the same checks as a language edit; asks rather than guesses."""
    objects = {o.id: o for o in request.context.objects}
    text = request.request
    kept = {"move": _amount(raw, text), "rotate": _turn(raw, text)}
    target = raw.target
    if target is not None and target.reference == "named":
        chosen, candidates = _named(request, target.phrase, target.object_id)
        if chosen is None:
            names = ", ".join(objects[c].name for c in candidates)
            question = f"“{target.phrase}” could be {names}. Which one?"
            return _step(raw.intent, **kept, needs=_need("target", question, candidates)), focus
    elif focus is None:
        need = _need("reference", "Which object do you mean?")
        return _step(raw.intent, **kept, needs=need), focus
    else:
        chosen = focus
    assert chosen is not None
    context = request.context.model_copy(update={"selected_object_id": chosen})
    edit = _edit_result(
        RawEditAnswer(
            outcome="proposal",
            question=None,
            candidates=[],
            message=None,
            action=raw.intent,  # type: ignore[arg-type]
            target={"reference": "named", "object_id": chosen, "phrase": objects[chosen].name},  # type: ignore[arg-type]
            move=raw.move,
            rotate=raw.rotate,
        ),
        EditProposalRequest(request=text, context=context),
        _CHECKS_ONLY,
    )
    if edit.outcome == "proposal" and edit.intent is not None:
        step = _step(raw.intent, target_id=chosen, move=edit.intent.move, rotate=edit.intent.rotate)
        return step, chosen
    if edit.outcome == "clarification":
        kind = "move_details" if raw.intent == "move" else "rotate_details"
        need = _need(kind, edit.question or "How far, and which way?")
        return _step(raw.intent, target_id=chosen, needs=need), chosen
    return _step(None, unsupported=edit.message or "That change is not supported."), focus


def _select_step(
    raw: RawChatStep, request: ChatRequest, focus: str | None
) -> tuple[ChatStep, str | None]:
    objects = {o.id: o for o in request.context.objects}
    target = raw.target
    if target is None or (target.reference == "selected" and focus is None):
        return _step("select", needs=_need("reference", "Which object do you mean?")), focus
    if target.reference == "selected":
        return _step("select", target_id=focus), focus
    chosen, candidates = _named(request, target.phrase, target.object_id)
    if chosen is None:
        names = ", ".join(objects[c].name for c in candidates)
        question = f"“{target.phrase}” could be {names}. Which one?"
        return _step("select", needs=_need("target", question, candidates)), focus
    return _step("select", target_id=chosen), chosen


def _route_step(raw: RawChatStep, request: ChatRequest, checks: list[str]) -> ChatStep:
    objects = {o.id for o in request.context.objects}
    route = raw.route
    ends = [route.from_object_id if route else None, route.to_object_id if route else None]
    for end in ends:
        if end is not None and end not in objects:
            raise ValueError(f"route: '{end}' is not an object in the scene")
    width: float | None = None
    quote: str | None = None
    if route and route.width is not None and route.unit is not None and route.width > 0:
        metres = route.width * METRES_PER_UNIT[route.unit]
        if find_stated(request.request, metres) is not None:
            width, quote = metres, (route.quote or request.request)[:200]
        else:
            checks.append("A route width was suggested but is not in the message, so it is asked.")
    payload = {
        "from_object_id": ends[0],
        "to_object_id": ends[1],
        "width_m": width,
        "width_quote": quote,
    }
    return _step("check_route", route=payload)


def _add_step(raw: RawChatStep, request: ChatRequest, checks: list[str]) -> ChatStep:
    objects = {o.id for o in request.context.objects}
    add = raw.add
    if add is None or not add.description.strip():
        raise ValueError("add: say what to add")
    sizes: dict[str, float | None] = {}
    for axis in ("width", "depth", "height"):
        value = getattr(add, axis)
        if value is None or add.unit is None or value <= 0:
            sizes[f"{axis}_m"] = None
            continue
        metres = value * METRES_PER_UNIT[add.unit]
        if find_stated(request.request, metres) is None:
            sizes[f"{axis}_m"] = None
            checks.append(f"A {axis} was suggested but is not in the message, so it is not used.")
        else:
            sizes[f"{axis}_m"] = round(metres, 6)
    near = add.near_object_id
    if near is not None and near not in objects:
        raise ValueError(f"add/near_object_id: '{near}' is not an object in the scene")
    payload = {
        "description": add.description.strip()[:200],
        **sizes,
        "near_object_id": near,
        "side": add.side,
    }
    return _step("add_object", add=payload)


def _checked(answer: RawChatPlan, request: ChatRequest, run: ProviderRun) -> ChatResult:
    objects = {o.id for o in request.context.objects}
    raws = answer.steps
    if not raws:
        raise ValueError("steps: give at least one step")
    if len(raws) > MAX_CHAT_STEPS:
        return _result(
            run,
            "unsupported",
            message=f"That is more than {MAX_CHAT_STEPS} steps. Ask for up to "
            f"{MAX_CHAT_STEPS} at a time.",
        )
    if all(r.intent == "ask" for r in raws):
        known = [c for r in raws for c in r.candidates if c in objects]
        question = next((r.question for r in raws if r.question), None)
        question = (question or "What would you like to change or check?").strip()[:500]
        return _result(run, "clarification", question=question, candidates=known)
    if all(r.intent == "cannot" for r in raws):
        message = next((r.message for r in raws if r.message), None)
        message = (message or "That is not something this app can do.").strip()[:500]
        return _result(run, "unsupported", message=message)

    focus = request.context.selected_object_id or request.focus_object_id
    steps: list[ChatStep] = []
    checks: list[str] = []
    for raw in raws:
        if raw.intent == "ask":
            continue
        if raw.intent == "cannot":
            why = (raw.message or "That part is not supported.").strip()[:300]
            steps.append(_step(None, unsupported=why))
        elif raw.intent in ("move", "rotate"):
            step, focus = _edit_step(raw, request, focus)
            steps.append(step)
        elif raw.intent == "select":
            step, focus = _select_step(raw, request, focus)
            steps.append(step)
        elif raw.intent == "check_route":
            steps.append(_route_step(raw, request, checks))
        elif raw.intent == "add_object":
            steps.append(_add_step(raw, request, checks))
        else:
            steps.append(_step(raw.intent))
    if not steps:
        return _result(run, "clarification", question="What would you like to change or check?")
    return _result(run, "plan", steps=steps, checks=checks)


__all__ = ["PROMPT_VERSION", "interpret_chat", "recording_key"]
