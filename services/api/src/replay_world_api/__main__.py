"""Run the local API: ``uv run python -m replay_world_api [--reload]``."""

from __future__ import annotations

import sys
from pathlib import Path

import replay_world_contracts
import uvicorn

from .settings import Settings


def main(argv: list[str]) -> None:
    settings = Settings.from_env()
    reload = "--reload" in argv
    # Watch only our own sources; the default (the working directory) would include .venv.
    watched = [str(Path(__file__).parent), str(Path(replay_world_contracts.__file__).parent)]
    uvicorn.run(
        "replay_world_api.app:app",
        host=settings.host,
        port=settings.port,
        reload=reload,
        reload_dirs=watched if reload else None,
    )


if __name__ == "__main__":
    main(sys.argv[1:])
