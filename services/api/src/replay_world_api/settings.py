"""Runtime settings read from ``RWS_*`` environment variables (see .env.example)."""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Final

# services/api/src/replay_world_api/settings.py -> repository root
_REPO_ROOT: Final = Path(__file__).resolve().parents[4]

DEFAULT_CORS_ORIGINS: Final = (
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://127.0.0.1:4173",
    "http://localhost:4173",
)


@dataclass(frozen=True)
class Settings:
    host: str = "127.0.0.1"
    port: int = 8000
    cors_origins: tuple[str, ...] = DEFAULT_CORS_ORIGINS
    fixtures_dir: Path = _REPO_ROOT / "fixtures"

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> Settings:
        env = os.environ if env is None else env
        defaults = cls()
        origins = defaults.cors_origins
        if raw := env.get("RWS_CORS_ORIGINS", "").strip():
            origins = tuple(o.strip() for o in raw.split(",") if o.strip())
        if "*" in origins:
            raise ValueError("RWS_CORS_ORIGINS must list explicit origins; '*' is not allowed")
        port_text = env.get("RWS_API_PORT", str(defaults.port))
        try:
            port = int(port_text)
        except ValueError:
            raise ValueError(f"RWS_API_PORT must be an integer, got {port_text!r}") from None
        fixtures = env.get("RWS_FIXTURES_DIR", "").strip()
        return cls(
            host=env.get("RWS_API_HOST", defaults.host),
            port=port,
            cors_origins=origins,
            fixtures_dir=Path(fixtures) if fixtures else defaults.fixtures_dir,
        )
