"""The public preview's boundaries (ADR-054): each anonymous visitor's files in a folder of their
own, deleted after the retention period, bounded storage and requests, and the built web app
served on the same origin.

A visitor is a random token in an HttpOnly cookie. Their folder is named by a hash of that
token, so the token itself is never written to disk. Every file a visitor uploads or generates
is read and written only inside their folder: knowing a file's content hash gives no access to
another visitor's copy, even of identical bytes. The synthetic fixtures (the sample plans) are
the only files shared, read-only. Nothing here logs request bodies or file content.
"""

from __future__ import annotations

import hashlib
import secrets
import shutil
import threading
import time
from collections import deque
from collections.abc import Awaitable, Callable, MutableMapping
from contextvars import ContextVar
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final

from fastapi import HTTPException, Request

from .settings import Settings

COOKIE: Final = "rws_visitor"
COOKIE_MAX_AGE_S: Final = 30 * 24 * 3600
_TOKEN_CHARS: Final = frozenset("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_")


@dataclass(frozen=True)
class VisitorDirs:
    """Where one visitor's files go: source files, and generated models (``generated/``)."""

    root: Path
    sources: Path
    catalog: Path


#: This request's visitor folders (public preview), or None for the local, shared library.
CURRENT: ContextVar[VisitorDirs | None] = ContextVar("rws_visitor_dirs", default=None)


def _valid(token: str | None) -> bool:
    return token is not None and 20 <= len(token) <= 64 and set(token) <= _TOKEN_CHARS


def visitor_token(request: Request) -> str:
    """The visitor's token (from the cookie, or a new one set by the middleware)."""
    token = getattr(request.state, "visitor", None)
    if not isinstance(token, str):
        raise HTTPException(status_code=500, detail="No visitor for this request.")
    return token


def visitor_dirs(settings: Settings, request: Request) -> VisitorDirs:
    folder = hashlib.sha256(visitor_token(request).encode()).hexdigest()[:32]
    root = settings.data_dir / "visitors" / folder
    return VisitorDirs(root=root, sources=root / "sources", catalog=root / "catalog")


def _size(path: Path) -> int:
    if not path.is_dir():
        return 0
    return sum(f.stat().st_size for f in path.rglob("*") if f.is_file() and not f.is_symlink())


def ensure_room(settings: Settings, request: Request, incoming: int) -> None:
    """Refuse a write that would exceed the visitor's quota or the preview's storage cap."""
    if not settings.public:
        return
    limits = settings.limits
    mine = _size(visitor_dirs(settings, request).root)
    if mine + incoming > limits.visitor_quota_mb * 1024 * 1024:
        raise HTTPException(
            status_code=413,
            detail=f"This preview keeps at most {limits.visitor_quota_mb} MB per visitor. Files "
            f"are deleted {limits.retention_hours:g} hours after upload; try again later.",
        )
    if _size(settings.data_dir / "visitors") + incoming > limits.storage_cap_mb * 1024 * 1024:
        raise HTTPException(
            status_code=507,
            detail="The preview's storage is full right now. Please try again later.",
        )


def sweep(data_dir: Path, retention_hours: float, now: float | None = None) -> int:
    """Delete visitors' files older than the retention period, then empty folders. Returns how
    many files were deleted."""
    root = data_dir / "visitors"
    if not root.is_dir():
        return 0
    cutoff = (now if now is not None else time.time()) - retention_hours * 3600
    deleted = 0
    for path in sorted(root.rglob("*"), key=lambda p: len(p.parts), reverse=True):
        try:
            if path.is_symlink() or path.is_file():
                if path.lstat().st_mtime < cutoff:
                    path.unlink()
                    deleted += 1
            elif path.is_dir() and not any(path.iterdir()):
                path.rmdir()
        except FileNotFoundError:
            continue
    return deleted


def start_sweeper(settings: Settings, every_s: float = 900.0) -> threading.Event:
    """Sweep now and then every ``every_s`` seconds in a daemon thread; set the event to stop."""
    stop = threading.Event()

    def run() -> None:
        while True:
            sweep(settings.data_dir, settings.limits.retention_hours)
            if stop.wait(every_s):
                return

    threading.Thread(target=run, name="rws-sweeper", daemon=True).start()
    return stop


class RateLimiter:
    """Sliding-window counts per client, in memory (one process, one replica)."""

    def __init__(self) -> None:
        self._hits: dict[tuple[str, str], deque[float]] = {}
        self._lock = threading.Lock()

    def allow(self, client: str, bucket: str, limit: int, window_s: float) -> bool:
        now = time.monotonic()
        with self._lock:
            hits = self._hits.setdefault((client, bucket), deque())
            while hits and hits[0] <= now - window_s:
                hits.popleft()
            if len(hits) >= limit:
                return False
            hits.append(now)
            if len(self._hits) > 50_000:  # forget idle clients
                for key in [k for k, v in self._hits.items() if not v]:
                    del self._hits[key]
            return True


def client_of(request: Request, trust_proxy: bool) -> str:
    if trust_proxy:
        forwarded = request.headers.get("x-forwarded-for", "")
        if forwarded:
            return forwarded.split(",")[-1].strip()
    return request.client.host if request.client else "unknown"


WRITES: Final = (
    "/api/v1/sources/",
    "/api/v1/catalog/generated-models",
    "/api/v1/catalog/generated-assets",
)


def public_middleware(
    settings: Settings,
) -> Callable[[Request, Callable[[Request], Awaitable[Any]]], Awaitable[Any]]:
    """Visitor cookie, request rates, body size and security headers, for the public preview."""
    limiter = RateLimiter()
    limits = settings.limits

    async def middleware(request: Request, call_next: Callable[[Request], Awaitable[Any]]) -> Any:
        from fastapi.responses import JSONResponse

        client = client_of(request, settings.trust_proxy)
        if not limiter.allow(client, "all", limits.requests_per_minute, 60):
            return JSONResponse({"detail": "Too many requests; please slow down."}, 429)
        writing = request.method == "POST" and request.url.path.startswith(WRITES)
        if writing and not limiter.allow(client, "write", limits.uploads_per_10_min, 600):
            return JSONResponse(
                {"detail": "Too many uploads in a short time; please wait a few minutes."}, 429
            )
        length = request.headers.get("content-length")
        if request.method == "POST" and not (length and length.isdigit()):
            # Browsers always say how long a body is; an unbounded stream is not accepted.
            return JSONResponse({"detail": "A request body needs a Content-Length."}, 411)
        if length and length.isdigit() and int(length) > limits.max_body_mb * 1024 * 1024:
            return JSONResponse(
                {"detail": f"Requests are limited to {limits.max_body_mb} MB."}, 413
            )
        token = request.cookies.get(COOKIE)
        fresh = not _valid(token)
        request.state.visitor = secrets.token_urlsafe(24) if fresh else token
        CURRENT.set(visitor_dirs(settings, request))
        response = await call_next(request)
        if fresh:
            secure = request.headers.get("x-forwarded-proto", request.url.scheme) == "https"
            response.set_cookie(
                COOKIE,
                request.state.visitor,
                max_age=COOKIE_MAX_AGE_S,
                httponly=True,
                samesite="lax",
                secure=secure,
                path="/",
            )
        headers: MutableMapping[str, str] = response.headers
        headers.setdefault("X-Content-Type-Options", "nosniff")
        headers.setdefault("Referrer-Policy", "same-origin")
        headers.setdefault("X-Frame-Options", "DENY")
        headers.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; "
            # 'unsafe-eval': the contract validator (Ajv) compiles its schemas at run time.
            "script-src 'self' 'unsafe-eval'; connect-src 'self' blob: data:; "
            "worker-src 'self' blob:; "
            "frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
        )
        return response

    return middleware


def clear_visitor(settings: Settings, request: Request) -> None:
    """Delete everything this visitor stored now (the "delete my files" button)."""
    shutil.rmtree(visitor_dirs(settings, request).root, ignore_errors=True)
