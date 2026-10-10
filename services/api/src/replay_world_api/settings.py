"""Runtime settings read from ``RWS_*`` and ``VOYAGER_*`` environment variables (see .env.example).

The process environment wins over the repository's ``.env`` file, which is read only by the
API process (the browser never sees it; Vite exposes ``VITE_``-prefixed names only). The
Voyager API key stays in this process: it is never logged, returned or sent anywhere except in
the ``Authorization`` header of requests to the configured provider.
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
    # repr=False keeps the key out of tracebacks, logs and debug output.
    api_key: str = field(default="", repr=False)
    timeout_s: float = 150.0
    recordings_dir: Path = _REPO_ROOT / "fixtures" / "assist" / "recorded"


@dataclass(frozen=True)
class Settings:
    host: str = "127.0.0.1"
    port: int = 8000
    cors_origins: tuple[str, ...] = DEFAULT_CORS_ORIGINS
    fixtures_dir: Path = _REPO_ROOT / "fixtures"
    catalog_dir: Path = _REPO_ROOT / "assets" / "catalog"
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
        port = _integer(env, "RWS_API_PORT", defaults.port)
        fixtures = env.get("RWS_FIXTURES_DIR", "").strip()
        catalog = env.get("RWS_CATALOG_DIR", "").strip()
        return cls(
            host=env.get("RWS_API_HOST", defaults.host),
            port=port,
            cors_origins=origins,
            fixtures_dir=Path(fixtures) if fixtures else defaults.fixtures_dir,
            catalog_dir=Path(catalog) if catalog else defaults.catalog_dir,
            assist=_assist_from_env(env),
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
