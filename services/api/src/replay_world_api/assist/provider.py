"""Language-model providers behind one small interface.

``OpenAICompatibleProvider`` calls a chat-completions endpoint (ASU Voyager by default) with a
JSON Schema ``response_format``, so a vLLM server can constrain decoding to the schema. The
answer is still parsed and validated by the caller: schema-guided decoding is a help, not a
guarantee.

``RecordedProvider`` replays answers that a live model gave earlier (saved by
``scripts/evaluate_assist.py --record``). It exists so tests and the browser suite run offline
and deterministically; every result it produces is labelled ``recorded`` and must never be
presented as live AI.

Errors never include the API key, request headers or the user's text.
"""

from __future__ import annotations

import json
import time
import unicodedata
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final, Literal, Protocol

from ..settings import AssistSettings

Task = Literal["object", "edit", "image", "revision", "plan", "setup", "chat", "appearance"]

MAX_OUTPUT_TOKENS: Final = 4096


@dataclass(frozen=True)
class Completion:
    content: str
    latency_ms: int
    # Token counts as the provider reports them (OpenAI-style ``usage``); None when it reports
    # none, as a recording made before UX-05 does. Never estimated.
    input_tokens: int | None = None
    output_tokens: int | None = None


@dataclass(frozen=True)
class ProviderError(Exception):
    """The provider could not answer. ``message`` is safe to show to the user."""

    kind: Literal["unavailable", "timeout", "http", "malformed", "not_recorded"]
    message: str

    def __str__(self) -> str:
        return self.message


class Provider(Protocol):
    service: str
    base_url: str
    model: str
    mode: Literal["live", "recorded"]

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
        """Return the model's raw text for ``messages``.

        ``key`` identifies the request for recordings (the description, the edit request and
        selection, or the specification's hash and the revision instruction); ``attempt``
        counts from 0 and is only used to replay retries. ``timeout_s`` is what is left of the
        caller's time budget; a live provider waits no longer than that (nor its own limit).
        """
        ...


class OpenAICompatibleProvider:
    """Chat completions over HTTPS with a bearer key, temperature 0 and a JSON Schema."""

    mode: Literal["live", "recorded"] = "live"

    def __init__(
        self, settings: AssistSettings, *, guided: bool = True, model: str | None = None
    ) -> None:
        if not settings.api_key:
            raise ValueError("an API key is required for the live provider")
        self.service = settings.service
        self.base_url = settings.base_url
        self.model = model or settings.model
        self._key = settings.api_key
        self._guided = guided  # False only to measure adherence without schema guidance
        self._timeout_s = settings.timeout_s

    def __repr__(self) -> str:  # never show the key
        return f"OpenAICompatibleProvider(base_url={self.base_url!r}, model={self.model!r})"

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
        body: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": 0,
            "max_tokens": MAX_OUTPUT_TOKENS,
        }
        if self._guided:
            body["response_format"] = {
                "type": "json_schema",
                "json_schema": {"name": f"rws_{task}_proposal", "strict": True, "schema": schema},
            }
        request = urllib.request.Request(
            f"{self.base_url}/chat/completions",
            data=json.dumps(body).encode(),
            headers={
                "Authorization": f"Bearer {self._key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            method="POST",
        )
        started = time.monotonic()
        limit = self._timeout_s if timeout_s is None else max(min(timeout_s, self._timeout_s), 1.0)
        try:
            with urllib.request.urlopen(request, timeout=limit) as response:
                payload: Any = json.load(response)
        except urllib.error.HTTPError as exc:
            hint = {
                401: "The API key was refused; check VOYAGER_API_KEY in .env.",
                403: "The API key is not allowed to use this model.",
                404: f"Model '{self.model}' or the endpoint was not found; check VOYAGER_MODEL.",
                429: "The provider is rate-limiting requests; try again shortly.",
            }.get(exc.code, "The provider returned an error.")
            raise ProviderError(
                "http", f"{self.service} answered HTTP {exc.code}. {hint}"
            ) from None
        except TimeoutError:
            raise ProviderError(
                "timeout", f"{self.service} did not answer within {limit:.0f} s."
            ) from None
        except (urllib.error.URLError, OSError) as exc:
            if isinstance(getattr(exc, "reason", None), TimeoutError):
                raise ProviderError(
                    "timeout", f"{self.service} did not answer within {limit:.0f} s."
                ) from None
            raise ProviderError(
                "unavailable", f"Could not reach {self.service} at {self.base_url}."
            ) from None
        except json.JSONDecodeError:
            raise ProviderError("malformed", f"{self.service} returned a non-JSON body.") from None
        latency_ms = round((time.monotonic() - started) * 1000)
        try:
            content = payload["choices"][0]["message"]["content"]
        except KeyError, IndexError, TypeError:
            raise ProviderError(
                "malformed", f"{self.service} returned no message content."
            ) from None
        if not isinstance(content, str):
            raise ProviderError("malformed", f"{self.service} returned no text content.")
        usage = payload.get("usage") if isinstance(payload, dict) else None
        usage = usage if isinstance(usage, dict) else {}

        def count(name: str) -> int | None:
            value = usage.get(name)
            return value if isinstance(value, int) and value >= 0 else None

        return Completion(
            content=content,
            latency_ms=latency_ms,
            input_tokens=count("prompt_tokens"),
            output_tokens=count("completion_tokens"),
        )


def recording_key(task: Task, key: str) -> str:
    """Normalised lookup key: same words, case and spacing differences ignored."""
    text = " ".join(unicodedata.normalize("NFC", key).split()).casefold()
    return f"{task}:{text}"


class RecordedProvider:
    """Replays saved live answers. Offline test fixture only - never live AI."""

    mode: Literal["live", "recorded"] = "recorded"

    def __init__(
        self,
        settings: AssistSettings,
        tasks: tuple[Task, ...] = ("object", "edit", "image", "revision"),
    ) -> None:
        self.service = settings.service
        self.base_url = settings.base_url
        self._recordings: dict[str, list[str]] = {}
        self._delays: dict[str, int] = {}
        self._usage: dict[str, list[tuple[int | None, int | None]]] = {}
        models: set[str] = set()
        directory = settings.recordings_dir
        for path in sorted(directory.glob("*.json")) if directory.is_dir() else []:
            data = json.loads(path.read_text(encoding="utf-8"))
            if data["task"] not in tasks:
                continue
            self._recordings[recording_key(data["task"], data["key"])] = list(data["responses"])
            # A test recording may replay a slow provider (UX-05): its wait, then its answer, or
            # a timeout when the wait exceeds what is left of the deadline.
            delay = data.get("replay_delay_ms")
            if isinstance(delay, int) and delay > 0:
                self._delays[recording_key(data["task"], data["key"])] = delay
            usage = data.get("usage")
            if isinstance(usage, list):
                self._usage[recording_key(data["task"], data["key"])] = [
                    (u.get("input_tokens"), u.get("output_tokens"))
                    if isinstance(u, dict)
                    else (None, None)
                    for u in usage
                ]
            if not data.get("test_only"):  # a synthetic test fixture names no model
                models.add(str(data["model"]))
        # Recordings name the model that produced them; a mixed set reports all of them.
        self.model = " + ".join(sorted(models)) or settings.model

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
        found = recording_key(task, key)
        responses = self._recordings.get(found)
        if not responses and " | focus=" in key:
            # A chat answer recorded without a focus object also answers the same message with
            # one: the focus only resolves "it"/"that", and the checks resolve it the same way.
            found = recording_key(task, key.split(" | focus=")[0])
            responses = self._recordings.get(found)
        if not responses:
            raise ProviderError(
                "not_recorded",
                "The offline test provider has no recorded answer for this request. Configure "
                "VOYAGER_API_KEY for live proposals, or use the object builder.",
            )
        delay_ms = self._delays.get(found, 0)
        if delay_ms:
            limit_s = timeout_s if timeout_s is not None else delay_ms / 1000
            time.sleep(min(delay_ms / 1000, limit_s))
            if delay_ms / 1000 > limit_s:
                raise ProviderError(
                    "timeout", f"{self.service} did not answer within {limit_s:.0f} s."
                )
        index = min(attempt, len(responses) - 1)
        usage = self._usage.get(found, [])
        tokens = usage[index] if index < len(usage) else (None, None)
        return Completion(
            content=responses[index],
            latency_ms=delay_ms,
            input_tokens=tokens[0],
            output_tokens=tokens[1],
        )


def provider_from_settings(settings: AssistSettings) -> Provider | None:
    if settings.provider == "voyager" and settings.api_key:
        return OpenAICompatibleProvider(settings)
    if settings.provider == "recorded":
        return RecordedProvider(settings, tasks=("object", "edit", "revision", "setup", "chat"))
    return None


def vision_provider_from_settings(settings: AssistSettings) -> Provider | None:
    """The provider for photos: same service, the vision-capable model."""
    if settings.provider == "voyager" and settings.api_key:
        return OpenAICompatibleProvider(settings, model=settings.vision_model)
    if settings.provider == "recorded":
        return RecordedProvider(settings, tasks=("image", "plan", "appearance"))
    return None


def recordings_path(directory: Path, task: Task, slug: str) -> Path:
    return directory / f"{task}-{slug}.json"
