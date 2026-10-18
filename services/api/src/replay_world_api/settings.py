"""Runtime settings read from ``RWS_*`` and ``VOYAGER_*`` environment variables (see .env.example).

The process environment wins over the repository's ``.env`` file, which is read only by the
API process (the browser never sees it; Vite exposes ``VITE_``-prefixed names only). The
Voyager API key stays in this process: it is never logged, returned or sent anywhere except in
the ``Authorization`` header of requests to the configured provider.

``RWS_PUBLIC=1`` is the public preview (ADR-054): language and vision proposals are off whatever
the key (the key is not even read), each visitor's uploads live in a folder of their own under
``RWS_DATA_DIR`` and are deleted after ``RWS_RETENTION_HOURS``, requests are bounded, and the
built web app is served from ``RWS_WEB_DIR`` on the same origin.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Final, Literal

# services/api/src/replay_world_api/settings.py -> repository root
_REPO_ROOT: Final = Path(__file__).resolve().parents[4]

DEFAULT_CORS_ORIGINS: Final = (
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://127.0.0.1:4173",
    "http://localhost:4173",
)

VOYAGER_SERVICE: Final = "ASU Voyager"
VOYAGER_BASE_URL: Final = "https://openai.rc.asu.edu/v1"
DEFAULT_ASSIST_MODEL: Final = "qwen3-235b-a22b-instruct-2507"
DEFAULT_VISION_MODEL: Final = "qwen3-vl-32b-instruct"

AssistProvider = Literal["voyager", "recorded", "off"]
_PROVIDERS: Final[dict[str, AssistProvider]] = {
    "voyager": "voyager",
    "recorded": "recorded",
    "off": "off",
}

# Only these names are taken from the .env file; anything else in it is ignored.
_ENV_FILE_PREFIXES: Final = ("RWS_", "VOYAGER_")


@dataclass(frozen=True)
class AssistSettings:
    """Where language requests go. ``off`` keeps every non-AI workflow available."""

    provider: AssistProvider = "off"
    service: str = VOYAGER_SERVICE
    base_url: str = VOYAGER_BASE_URL
    model: str = DEFAULT_ASSIST_MODEL
    vision_model: str = DEFAULT_VISION_MODEL
    # repr=False keeps the key out of tracebacks, logs and debug output.
    api_key: str = field(default="", repr=False)
    timeout_s: float = 150.0
    recordings_dir: Path = _REPO_ROOT / "fixtures" / "assist" / "recorded"


@dataclass(frozen=True)
class PublicLimits:
    """What one anonymous visitor (and everyone together) may use in the public preview."""

    retention_hours: float = 24.0
    visitor_quota_mb: int = 100
    #: All visitors' files together, counted as allocated disk blocks. Sized for a 4 GB volume:
    #: about 1.1 GB stays free for the filesystem's own overhead and uploads in flight.
    storage_cap_mb: int = 2800
    #: Writes are also refused when the volume itself has less than this free, whatever its size.
    min_free_mb: int = 512
    sweep_minutes: float = 15.0
    max_body_mb: int = 25
    uploads_per_10_min: int = 40
    requests_per_minute: int = 600


@dataclass(frozen=True)
class Settings:
    host: str = "127.0.0.1"
    port: int = 8000
    cors_origins: tuple[str, ...] = DEFAULT_CORS_ORIGINS
    #: The public preview: visitor-isolated storage, limits, AI off, the web app served here.
    public: bool = False
    #: Where visitors' folders live in the public preview (the mounted volume).
    data_dir: Path = _REPO_ROOT / "data" / "public"
    #: The built web app to serve on the same origin (``apps/web/dist``), if any.
    web_dir: Path | None = None
    #: Behind a proxy that appends the client to X-Forwarded-For (a host): use its last entry.
    trust_proxy: bool = False
    limits: PublicLimits = field(default_factory=PublicLimits)
    fixtures_dir: Path = _REPO_ROOT / "fixtures"
    catalog_dir: Path = _REPO_ROOT / "assets" / "catalog"
    # Local source library for project photos (git-ignored); see docs/image-import.md.
    sources_dir: Path = _REPO_ROOT / "data" / "sources"
    assist: AssistSettings = field(default_factory=AssistSettings)

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> Settings:
        """Read settings from ``env``, or from the process environment over the ``.env`` file."""
        if env is None:
            env = {**read_env_file(_env_file_path(os.environ)), **os.environ}
        defaults = cls()
        origins = defaults.cors_origins
        if raw := env.get("RWS_CORS_ORIGINS", "").strip():
            origins = tuple(o.strip() for o in raw.split(",") if o.strip())
        if "*" in origins:
            raise ValueError("RWS_CORS_ORIGINS must list explicit origins; '*' is not allowed")
        public = env.get("RWS_PUBLIC", "").strip().lower() in ("1", "true", "yes")
        # Hosting platforms say which port to listen on in PORT.
        port = _integer(env, "RWS_API_PORT", _integer(env, "PORT", defaults.port))
        fixtures = env.get("RWS_FIXTURES_DIR", "").strip()
        catalog = env.get("RWS_CATALOG_DIR", "").strip()
        sources = env.get("RWS_SOURCES_DIR", "").strip()
        data = env.get("RWS_DATA_DIR", "").strip()
        web = env.get("RWS_WEB_DIR", "").strip()
        limits = PublicLimits(
            retention_hours=float(
                env.get("RWS_RETENTION_HOURS", "") or PublicLimits.retention_hours
            ),
            visitor_quota_mb=_integer(env, "RWS_VISITOR_QUOTA_MB", PublicLimits.visitor_quota_mb),
            storage_cap_mb=_integer(env, "RWS_STORAGE_CAP_MB", PublicLimits.storage_cap_mb),
            min_free_mb=_integer(env, "RWS_MIN_FREE_MB", PublicLimits.min_free_mb),
        )
        return cls(
            host=env.get("RWS_API_HOST", "0.0.0.0" if public else defaults.host),
            port=port,
            # The public preview is one origin: no cross-origin callers at all.
            cors_origins=() if public else origins,
            public=public,
            data_dir=Path(data) if data else defaults.data_dir,
            web_dir=Path(web) if web else None,
            trust_proxy=env.get("RWS_TRUST_PROXY", "").strip().lower() in ("1", "true", "yes"),
            limits=limits,
            fixtures_dir=Path(fixtures) if fixtures else defaults.fixtures_dir,
            catalog_dir=Path(catalog) if catalog else defaults.catalog_dir,
            sources_dir=Path(sources) if sources else defaults.sources_dir,
            # No AI in the public preview, even if a key is present: it is not read at all.
            assist=AssistSettings() if public else _assist_from_env(env),
        )


def _assist_from_env(env: Mapping[str, str]) -> AssistSettings:
    defaults = AssistSettings()
    key = env.get("VOYAGER_API_KEY", "").strip()
    name = env.get("RWS_ASSIST_PROVIDER", "").strip().lower() or ("voyager" if key else "off")
    provider = _PROVIDERS.get(name)
    if provider is None:
        raise ValueError(f"RWS_ASSIST_PROVIDER must be voyager, recorded or off, got {name!r}")
    timeout = env.get("RWS_ASSIST_TIMEOUT_S", "").strip()
    try:
        timeout_s = float(timeout) if timeout else defaults.timeout_s
    except ValueError:
        raise ValueError(f"RWS_ASSIST_TIMEOUT_S must be a number, got {timeout!r}") from None
    recordings = env.get("RWS_ASSIST_RECORDINGS_DIR", "").strip()
    return AssistSettings(
        provider=provider,
        base_url=env.get("VOYAGER_BASE_URL", "").strip().rstrip("/") or defaults.base_url,
        model=env.get("VOYAGER_MODEL", "").strip() or defaults.model,
        vision_model=env.get("VOYAGER_VISION_MODEL", "").strip() or defaults.vision_model,
        api_key=key,
        timeout_s=timeout_s,
        recordings_dir=Path(recordings) if recordings else defaults.recordings_dir,
    )


def _integer(env: Mapping[str, str], name: str, default: int) -> int:
    text = env.get(name, str(default))
    try:
        return int(text)
    except ValueError:
        raise ValueError(f"{name} must be an integer, got {text!r}") from None


def _env_file_path(environ: Mapping[str, str]) -> Path | None:
    """``RWS_ENV_FILE`` names another file, or ``none`` to read no file (tests do this)."""
    override = environ.get("RWS_ENV_FILE", "").strip()
    if override.lower() == "none":
        return None
    return Path(override) if override else _REPO_ROOT / ".env"


def read_env_file(path: Path | None) -> dict[str, str]:
    """Parse ``KEY=VALUE`` lines of a dotenv file; missing file -> {}.

    Deliberately small: comments, blank lines, optional ``export`` and surrounding quotes.
    Only ``RWS_*`` and ``VOYAGER_*`` names are returned. Values are never printed.
    """
    if path is None or not path.is_file():
        return {}
    values: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, _, value = line.removeprefix("export ").partition("=")
        name = name.strip()
        if not name.startswith(_ENV_FILE_PREFIXES):
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        values[name] = value
    return values
