"""Chat message -> one bounded, typed action (UX-03, AGT-01).

The language model only interprets the words. This module checks the interpretation before the
browser sees it, with the same rules as a language edit:

* move and rotate go through the edit checks (the target must be an object in the scene, the
  selection must fit the words, a distance or angle and a direction must be in the message);
* "select" and the ends of a route must be objects in the scene, and words that fit several
  objects become a question;
* a route width counts only when the message states it with its unit.

The browser then checks the action's prerequisites (a process to run, a run to compare) and the
scene revision, and performs it with its own deterministic code. Nothing here changes a project.
"""

from __future__ import annotations

import hashlib
import json
from typing import Final

from pydantic import ValidationError
from replay_world_contracts import (
    ChatRequest,
    ChatResult,
    EditProposalRequest,
    ProviderRun,
)
from replay_world_contracts.assist import ChatRoute

from . import prompts
from .answers import RawChatAnswer, RawEditAnswer, provider_schema
from .edits import _context_json, _fits_all, _result, _words
from .lengths import METRES_PER_UNIT, find_stated
from .proposals import MAX_ATTEMPTS, AssistError, describe_problems
from .provider import Provider

PROMPT_VERSION: Final = "chat-01"
CHAT_SCHEMA: Final = provider_schema(RawChatAnswer)


def recording_key(request: ChatRequest) -> str:
    """The message, the selection and which objects the scene holds (by id and name)."""
    scene = json.dumps(
        sorted((o.id, o.name) for o in request.context.objects), separators=(",", ":")
    )
    digest = hashlib.sha256(scene.encode("utf-8")).hexdigest()[:12]
    selected = request.context.selected_object_id or "none"
    return f"{request.request} | selected={selected} | scene={digest}"


def _state_json(request: ChatRequest) -> str:
    return json.dumps(request.state.model_dump(mode="json"), separators=(",", ":"))


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
            answer = RawChatAnswer.model_validate_json(completion.content.strip())
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
        f"{provider.service} ({provider.model}) did not return a usable answer after "
        f"{MAX_ATTEMPTS} attempts. Last problem: {last_problem[:300]}",
    )


def _result_of(
    run: ProviderRun,
    *,
    outcome: str,
    action: str | None = None,
    question: str | None = None,
    candidates: list[str] | None = None,
    message: str | None = None,
    checks: list[str] | None = None,
    **payload: object,
) -> ChatResult:
    return ChatResult.model_validate(
        {
            "outcome": outcome,
            "action": action,
            "edit": payload.get("edit"),
            "route": payload.get("route"),
            "object_id": payload.get("object_id"),
            "question": question,
            "candidates": candidates or [],
            "message": message,
            "checks": checks or [],
            "provider": run,
        }
    )


def _matches(request: ChatRequest, phrase: str) -> list[str]:
    tokens = _words(phrase)
    return [o.id for o in request.context.objects if _fits_all(tokens, o.name)]


def _checked(answer: RawChatAnswer, request: ChatRequest, run: ProviderRun) -> ChatResult:
    objects = {o.id: o for o in request.context.objects}
    text = request.request
    if answer.intent == "cannot":
        message = (answer.message or "").strip() or "That is not something this app can do."
        return _result_of(run, outcome="unsupported", message=message[:500])
    if answer.intent == "ask":
        question = (answer.question or "").strip() or "Which object, and what change?"
        known = [c for c in answer.candidates if c in objects]
        return _result_of(run, outcome="clarification", question=question[:500], candidates=known)
    action = answer.intent
    target = answer.target
    unresolved = target is None or (
        target.reference == "named" and (target.object_id or "") not in objects
    )
    if action in ("move", "rotate", "select") and unresolved and answer.question:
        known = [c for c in answer.candidates if c in objects]
        return _result_of(
            run, outcome="clarification", question=answer.question.strip()[:500], candidates=known
        )

    if action in ("move", "rotate"):
        edit = _result(
            RawEditAnswer(
                outcome="proposal",
                question=None,
                candidates=[],
                message=None,
                action=action,
                target=answer.target,
                move=answer.move,
                rotate=answer.rotate,
            ),
            EditProposalRequest(request=text, context=request.context),
            run,
        )
        if edit.outcome == "proposal":
            return _result_of(run, outcome="action", action=action, edit=edit.intent)
        if edit.outcome == "clarification":
            return _result_of(
                run,
                outcome="clarification",
                question=edit.question,
                candidates=edit.candidates,
                checks=edit.checks,
            )
        return _result_of(run, outcome="unsupported", message=edit.message)

    if action == "select":
        target = answer.target
        if target is None:
            raise ValueError("select: name the object")
        if target.reference == "selected":
            chosen = request.context.selected_object_id
            if chosen is None:
                return _result_of(run, outcome="clarification", question="Which object?")
            return _result_of(run, outcome="action", action="select", object_id=chosen)
        matches = _matches(request, target.phrase)
        exact = [
            o.id
            for o in request.context.objects
            if o.name.casefold() == " ".join(_words(target.phrase))
        ]
        if len(matches) > 1 and len(exact) != 1:
            names = ", ".join(objects[i].name for i in matches[:6])
            return _result_of(
                run,
                outcome="clarification",
                question=f"“{target.phrase}” could be {names}. Which one?",
                candidates=matches[:6],
            )
        if target.object_id not in objects:
            raise ValueError(
                f"target/object_id: '{target.object_id}' is not an object in the scene"
            )
        return _result_of(run, outcome="action", action="select", object_id=target.object_id)

    if action == "check_route":
        raw = answer.route
        ends = [raw.from_object_id if raw else None, raw.to_object_id if raw else None]
        for end in ends:
            if end is not None and end not in objects:
                raise ValueError(f"route: '{end}' is not an object in the scene")
        width: float | None = None
        quote: str | None = None
        checks: list[str] = []
        if raw and raw.width is not None and raw.unit is not None and raw.width > 0:
            metres = raw.width * METRES_PER_UNIT[raw.unit]
            if find_stated(text, metres) is not None:
                width, quote = metres, (raw.quote or text)[:200]
            else:
                checks.append("A width was suggested but is not in the message, so it is asked.")
        route = ChatRoute(
            from_object_id=ends[0], to_object_id=ends[1], width_m=width, width_quote=quote
        )
        return _result_of(run, outcome="action", action="check_route", route=route, checks=checks)

    return _result_of(run, outcome="action", action=action)


__all__ = ["PROMPT_VERSION", "interpret_chat", "recording_key"]
