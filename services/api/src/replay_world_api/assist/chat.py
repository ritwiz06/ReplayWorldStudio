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
import time
from typing import Any, Final

from pydantic import ValidationError
from replay_world_contracts import (
    ChatRequest,
    ChatResult,
    ChatTiming,
    EditProposalRequest,
    ProviderRun,
)
from replay_world_contracts.assist import MAX_CHAT_STEPS, ChatStep

from . import clauses, prompts
from .answers import (
    RawAdd,
    RawChatPlan,
    RawChatStep,
    RawCompactPlan,
    RawCompactStep,
    RawEditAnswer,
    RawMove,
    RawRotate,
    RawRoute,
    RawTarget,
    provider_schema,
)
from .edits import _DIRECTION_WORDS, _fits_all, _says, _words
from .edits import _result as _edit_result
from .lengths import METRES_PER_UNIT, find_angles, find_lengths, find_stated, same_length
from .proposals import MAX_ATTEMPTS, AssistError, describe_problems
from .provider import Provider, ProviderError

PROMPT_VERSION: Final = "chat-03"
CHAT_SCHEMA: Final = provider_schema(RawCompactPlan)


def recording_key(request: ChatRequest) -> str:
    """The message, the selection, the focus object and which objects the scene holds."""
    scene = json.dumps(
        sorted((o.id, o.name) for o in request.context.objects), separators=(",", ":")
    )
    digest = hashlib.sha256(scene.encode("utf-8")).hexdigest()[:12]
    selected = request.context.selected_object_id or "none"
    key = f"{request.request} | selected={selected} | scene={digest}"
    return f"{key} | focus={request.focus_object_id}" if request.focus_object_id else key


def _scene_text(request: ChatRequest) -> str:
    """What the model needs to interpret the supported actions (chat-03): every object's id,
    name and kind (all of them, so a second match stays visible), the selection, the object the
    conversation is about and the app state. No positions, sizes or turns: no supported action
    needs another object's geometry to be interpreted, and the browser keeps them."""
    context = request.context
    state = [k for k, v in request.state.model_dump(mode="json").items() if v is True]
    lines = [
        f"Selected: {context.selected_object_id or 'none'}. "
        f"Focus: {request.focus_object_id or 'none'}.",
        f"State: {', '.join(state) or 'none'}.",
        "Objects:",
        *(f"{o.id}: {o.name} ({o.kind})" for o in context.objects),
    ]
    return "\n".join(lines)


# A step as checked: its raw form, the words its values are read from, other possible objects.
_Item = tuple[RawChatStep, str, list[str], str]


def _parse(content: str, request: ChatRequest) -> list[_Item]:
    """Each step with the words its values must come from. A chat-03 answer is expanded here
    into the application's step types; chat-02 and chat-01 answers (older recordings) are read
    as before, with each value checked against its quote or, failing that, the message."""
    data = json.loads(content.strip())
    if (
        isinstance(data, dict)
        and isinstance(data.get("steps"), list)
        and all(isinstance(step, dict) and "do" in step for step in data["steps"])
    ):
        return [_expand(step, request) for step in RawCompactPlan.model_validate(data).steps]
    if isinstance(data, dict) and "intent" in data and "steps" not in data:
        data = {"steps": [{"add": None, **data}]}  # a chat-01 answer: one step
    message = request.request
    items: list[_Item] = []
    for raw in RawChatPlan.model_validate(data).steps:
        quote = (raw.move.quote if raw.move else raw.rotate.quote if raw.rotate else None) or ""
        # An older answer's quote is often only the number ("1 metre"). With one amount in the
        # message nothing can be mixed up, so the message is read; with several, only the quote.
        single = len(find_lengths(message)) + len(find_angles(message)) <= 1
        words = message if single else (clauses.own_words(quote, message) or "")
        said = raw.target.phrase if raw.target else (raw.question or raw.message or message)
        items.append((raw, words, [], said))
    return items


def _expand(step: RawCompactStep, request: ChatRequest) -> _Item:
    """A chat-03 step as the application's raw step, every number read from its own words."""
    clause = clauses.own_words(step.said, request.request)
    words = clause or ""
    said = step.said.strip()[:200] or request.request[:200]
    target: RawTarget | None = None
    if step.do in ("move", "rotate", "select"):
        names = clauses.name_words(words or said)
        if not names and (step.obj is None or clauses.refers_back(words or said)):
            target = RawTarget(reference="selected", object_id=step.obj, phrase=said)
        else:
            target = RawTarget(
                reference="named", object_id=step.obj, phrase=" ".join(names) or said
            )
    move = rotate = None
    if step.do == "move" and (found := clauses.move_in(words)):
        move = RawMove(direction=found[0], distance=found[1], unit=found[2], quote=words)  # type: ignore[arg-type]
    if step.do == "rotate" and (turn := clauses.turn_in(words)):
        rotate = RawRotate(direction=turn[0], angle_deg=turn[1], quote=words)  # type: ignore[arg-type]
    route = None
    if step.do == "check_route":
        width = clauses.width_in(words)
        route = RawRoute(
            from_object_id=step.obj,
            to_object_id=step.obj2,
            width=width.value if width else None,
            unit=width.unit if width else None,  # type: ignore[arg-type]
            quote=width.text if width else None,
        )
    add = None
    if step.do == "add_object":
        sizes = clauses.sizes_in(words)
        add = RawAdd(
            description=(step.what or said).strip()[:200] or said,
            width=sizes["width"].metres if "width" in sizes else None,
            depth=sizes["depth"].metres if "depth" in sizes else None,
            height=sizes["height"].metres if "height" in sizes else None,
            unit="m" if sizes else None,
            near_object_id=step.obj,
            side=clauses.side_in(words),
        )
    raw = RawChatStep(
        intent=step.do,
        question=None,
        candidates=[],
        message=None,
        target=target,
        move=move,
        rotate=rotate,
        route=route,
        add=add,
    )
    return raw, words, list(step.alts), said


#: One interactive deadline for interpreting a chat message, every attempt included (UX-05).
#: The object generator keeps its own, longer budget (``AssistSettings.timeout_s``).
DEFAULT_DEADLINE_S: Final = 30.0


def interpret_chat(
    provider: Provider, request: ChatRequest, deadline_s: float = DEFAULT_DEADLINE_S
) -> ChatResult:
    started = time.monotonic()
    messages = [
        {"role": "system", "content": prompts.CHAT_SYSTEM},
        {
            "role": "user",
            "content": prompts.chat_user_message(request.request, _scene_text(request)),
        },
    ]
    prepare_ms = _ms(started)
    provider_ms = 0
    validate_ms = 0
    request_chars = 0
    response_chars = 0
    tokens: list[tuple[int | None, int | None]] = []
    first_valid = False
    last_problem = ""
    for attempt in range(MAX_ATTEMPTS):
        remaining = deadline_s - (time.monotonic() - started)
        if remaining < 1.0:
            # A retry never starts after the deadline: the person gets the timeout, not a
            # hidden second wait.
            raise ProviderError(
                "timeout", f"No usable answer within {deadline_s:.0f} s; nothing was changed."
            )
        request_chars += sum(len(m["content"]) for m in messages)
        completion = provider.complete(
            task="chat",
            key=recording_key(request),
            messages=messages,
            schema=CHAT_SCHEMA,
            attempt=attempt,
            timeout_s=remaining,
        )
        provider_ms += completion.latency_ms
        response_chars += len(completion.content)
        tokens.append((completion.input_tokens, completion.output_tokens))
        checking = time.monotonic()
        try:
            answer = _parse(completion.content, request)
            first_valid = first_valid or attempt == 0
            run = ProviderRun(
                service=provider.service,
                base_url=provider.base_url,
                model=provider.model,
                mode=provider.mode,
                attempts=attempt + 1,
                first_attempt_valid=first_valid,
                latency_ms=provider_ms,
            )
            result = _checked(answer, request, run)
            validate_ms += _ms(checking)
            return result.model_copy(
                update={
                    "timing": ChatTiming(
                        prepare_ms=prepare_ms,
                        provider_ms=provider_ms,
                        validate_ms=validate_ms,
                        request_chars=request_chars,
                        schema_chars=len(json.dumps(CHAT_SCHEMA, separators=(",", ":"))),
                        response_chars=response_chars,
                        input_tokens=_total(t[0] for t in tokens),
                        output_tokens=_total(t[1] for t in tokens),
                    )
                }
            )
        except (ValidationError, ValueError) as exc:
            validate_ms += _ms(checking)
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


def _ms(since: float) -> int:
    return round((time.monotonic() - since) * 1000)


def _total(values: Any) -> int | None:
    """The sum when every attempt reported a count; None if any did not (never a guess)."""
    counted = list(values)
    return None if not counted or any(v is None for v in counted) else sum(counted)


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


def _named(
    request: ChatRequest, phrase: str, chosen: str | None, alts: list[str]
) -> tuple[str | None, list[str]]:
    """The one object a phrase names, or the candidates when it fits several. Every object in
    the scene is considered, so a second match is never filtered out; the model's other
    possibilities (``alts``) add candidates, never remove them."""
    objects = {o.id for o in request.context.objects}
    tokens = _words(phrase)
    matches = [o.id for o in request.context.objects if _fits_all(tokens, o.name)]
    exact = [
        o.id
        for o in request.context.objects
        if o.name.casefold() in (" ".join(tokens), phrase.casefold().strip())
    ]
    others = [a for a in alts if a in objects and a != chosen]
    if len(exact) == 1 and not others:
        return exact[0], []
    if len(matches) > 1:
        return None, list(dict.fromkeys([*matches, *others]))[:6]
    if len(matches) == 1:
        # The words name exactly one object: they win over the id the model gave.
        extra = [a for a in others if a != matches[0]]
        return (None, [matches[0], *extra][:6]) if extra else (matches[0], [])
    if chosen is not None and chosen in objects and others:
        return None, [chosen, *others][:6]
    if chosen is None or chosen not in objects:
        if len(matches) == 1:
            return matches[0], []
        if chosen is None:
            return None, []
        raise ValueError(f"target/object_id: '{chosen}' is not an object in the scene")
    return chosen, []


def _amount(raw: RawChatStep, words: str) -> dict[str, Any] | None:
    """A stated move amount kept while the target is asked (null unless it is in the step's
    own words)."""
    move = raw.move
    if raw.intent != "move" or move is None or move.distance <= 0 or not words:
        return None
    if find_stated(words, move.distance * METRES_PER_UNIT[move.unit]) is None:
        return None
    if not _says(words, _DIRECTION_WORDS[move.direction]):
        return None
    return {
        "direction": move.direction,
        "distance": move.distance,
        "unit": move.unit,
        "quote": (move.quote or words)[:200],
    }


def _turn(raw: RawChatStep, words: str) -> dict[str, Any] | None:
    rotate = raw.rotate
    if raw.intent != "rotate" or rotate is None or not 0 < rotate.angle_deg <= 360 or not words:
        return None
    return {
        "direction": rotate.direction,
        "angle_deg": rotate.angle_deg,
        "quote": (rotate.quote or words)[:200],
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


def _which(request: ChatRequest, phrase: str, candidates: list[str]) -> str:
    names = {o.id: o.name for o in request.context.objects}
    if not candidates:
        return f"Which object do you mean by “{phrase}”?"
    return f"“{phrase}” could be {', '.join(names[c] for c in candidates)}. Which one?"


def _edit_step(item: _Item, request: ChatRequest, focus: str | None) -> tuple[ChatStep, str | None]:
    """A move or turn, through the same checks as a language edit, applied to the step's own
    words; asks rather than guesses."""
    raw, words, alts, _ = item
    objects = {o.id: o for o in request.context.objects}
    kept = {"move": _amount(raw, words), "rotate": _turn(raw, words)}
    target = raw.target
    if target is not None and target.reference == "named":
        chosen, candidates = _named(request, target.phrase, target.object_id, alts)
        if chosen is None:
            need = _need("target", _which(request, target.phrase, candidates), candidates)
            return _step(raw.intent, **kept, needs=need), focus
    elif focus is None:
        need = _need("reference", "Which object do you mean?")
        return _step(raw.intent, **kept, needs=need), focus
    else:
        chosen = focus
    assert chosen is not None
    if (raw.intent == "move" and raw.move is None) or (
        raw.intent == "rotate" and raw.rotate is None
    ):
        # No amount in this step's own words: ask for it on the step, without another call.
        kind = "move_details" if raw.intent == "move" else "rotate_details"
        question = (
            "How far, and which way?" if raw.intent == "move" else "By how much, and which way?"
        )
        return _step(raw.intent, target_id=chosen, needs=_need(kind, question)), chosen
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
        # The amount is checked against this step's words only, never another step's.
        EditProposalRequest(request=words or request.request, context=context),
        _CHECKS_ONLY,
    )
    if edit.outcome == "proposal" and edit.intent is not None and (raw.move or raw.rotate):
        step = _step(raw.intent, target_id=chosen, move=edit.intent.move, rotate=edit.intent.rotate)
        return step, chosen
    if edit.outcome in ("clarification", "proposal"):
        kind = "move_details" if raw.intent == "move" else "rotate_details"
        default = (
            "How far, and which way?" if raw.intent == "move" else "By how much, and which way?"
        )
        need = _need(kind, edit.question or default)
        return _step(raw.intent, target_id=chosen, needs=need), chosen
    return _step(None, unsupported=edit.message or "That change is not supported."), focus


def _select_step(
    item: _Item, request: ChatRequest, focus: str | None
) -> tuple[ChatStep, str | None]:
    raw, _, alts, _ = item
    target = raw.target
    if target is None or (target.reference == "selected" and focus is None):
        return _step("select", needs=_need("reference", "Which object do you mean?")), focus
    if target.reference == "selected":
        return _step("select", target_id=focus), focus
    chosen, candidates = _named(request, target.phrase, target.object_id, alts)
    if chosen is None:
        need = _need("target", _which(request, target.phrase, candidates), candidates)
        return _step("select", needs=need), focus
    return _step("select", target_id=chosen), chosen


def _route_step(item: _Item, request: ChatRequest, checks: list[str]) -> ChatStep:
    raw, words, _, _ = item
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
        if words and find_stated(words, metres) is not None:
            width, quote = metres, (route.quote or words)[:200]
        else:
            checks.append("A route width was suggested but is not in the message, so it is asked.")
    payload = {
        "from_object_id": ends[0],
        "to_object_id": ends[1],
        "width_m": width,
        "width_quote": quote,
    }
    return _step("check_route", route=payload)


def _add_step(item: _Item, request: ChatRequest, checks: list[str]) -> ChatStep:
    """A new object at only the sizes the words tie to an axis ("1.5 m wide", "0.8 m deep")."""
    raw, words, _, _ = item
    objects = {o.id for o in request.context.objects}
    add = raw.add
    if add is None or not add.description.strip():
        raise ValueError("add: say what to add")
    stated = clauses.sizes_in(words or request.request)
    sizes: dict[str, float | None] = {}
    for axis in ("width", "depth", "height"):
        value = getattr(add, axis)
        if value is None or add.unit is None or value <= 0:
            sizes[f"{axis}_m"] = None
            continue
        metres = value * METRES_PER_UNIT[add.unit]
        said = stated.get(axis)
        if said is None or not same_length(said.metres, metres):
            sizes[f"{axis}_m"] = None
            checks.append(
                f"A {axis} was suggested but the message does not give it as the {axis}, "
                "so it is not used."
            )
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


_CHANGES = ("move", "rotate", "add_object")


def _checked(items: list[_Item], request: ChatRequest, run: ProviderRun) -> ChatResult:
    objects = {o.id for o in request.context.objects}
    raws = [item[0] for item in items]
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
        question = question or (
            f"I could not tell what to do with “{items[0][3]}”. Could you say it another way?"
            if items[0][3] != request.request[:200]
            else "What would you like to change or check?"
        )
        return _result(run, "clarification", question=question.strip()[:500], candidates=known)
    if all(r.intent == "cannot" for r in raws):
        message = next((r.message for r in raws if r.message), None)
        message = (
            message
            or "That is not something this app can do here: it can move, turn, select or add "
            "objects, check routes and the layout, and run a shift."
        )
        return _result(run, "unsupported", message=message.strip()[:500])

    focus = request.context.selected_object_id or request.focus_object_id
    steps: list[ChatStep] = []
    checks: list[str] = []
    for item in items:
        raw, words, _, said = item
        if raw.intent in _CHANGES and clauses.negated(words or said):
            checks.append(f"“{said}” says not to, so it is not part of the plan.")
            continue
        if raw.intent == "ask":
            # Never dropped: the plan stays visible but cannot be applied until it is answered.
            question = (raw.question or f"What do you mean by “{said}”?").strip()[:500]
            steps.append(_step(None, needs=_need("clarify", question)))
        elif raw.intent == "cannot":
            why = (raw.message or f"“{said}” is not something this app can do.").strip()[:300]
            steps.append(_step(None, unsupported=why))
        elif raw.intent in ("move", "rotate"):
            step, focus = _edit_step(item, request, focus)
            steps.append(step)
        elif raw.intent == "select":
            step, focus = _select_step(item, request, focus)
            steps.append(step)
        elif raw.intent == "check_route":
            steps.append(_route_step(item, request, checks))
        elif raw.intent == "add_object":
            steps.append(_add_step(item, request, checks))
        else:
            steps.append(_step(raw.intent))
    if not steps:
        return _result(
            run, "clarification", question="What would you like to change or check?", checks=checks
        )
    return _result(run, "plan", steps=steps, checks=checks)


__all__ = ["PROMPT_VERSION", "interpret_chat", "recording_key"]
