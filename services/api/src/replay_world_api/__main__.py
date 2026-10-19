"""Run the local API: ``uv run python -m replay_world_api [--reload]``."""

from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

import replay_world_contracts
import uvicorn

from .settings import Settings


def main(argv: list[str]) -> None:
    settings = Settings.from_env()
    if settings.public:
        _check_public(settings)
    reload = "--reload" in argv
    # Watch only our own sources; the default (the working directory) would include .venv.
    watched = [str(Path(__file__).parent), str(Path(replay_world_contracts.__file__).parent)]
    uvicorn.run(
        "replay_world_api.app:app",
        host=settings.host,
        port=settings.port,
        reload=reload,
        reload_dirs=watched if reload else None,
        # The public preview logs no request lines: their query strings hold uploads' names.
        access_log=not settings.public,
    )


def _check_public(settings: Settings) -> None:
    """The public preview never serves HTTP as root, and says how it is set up (no secrets)."""
    uid = os.geteuid()
    if uid == 0:
        sys.exit(
            "Refusing to run the public preview as root. Start it through the image's entrypoint "
            "(it gives /data to the user rws and drops privileges) or with --user 10001."
        )
    data = settings.data_dir
    data.mkdir(parents=True, exist_ok=True)
    if not os.access(data, os.W_OK):
        sys.exit(f"The data folder {data} is not writable by uid {uid}.")
    limits = settings.limits
    usage = shutil.disk_usage(data)
    gb = 1000**3
    print(
        f"Public preview: running as uid {uid}; data in {data} "
        f"({'a mounted volume' if os.path.ismount(data) else 'NOT a mounted volume'}, "
        f"{usage.total / gb:.1f} GB, {usage.free / gb:.1f} GB free); "
        f"storage cap {limits.storage_cap_mb} MB, refusing writes below {limits.min_free_mb} MB "
        f"free; files deleted {limits.retention_hours:g} h after they are stored "
        f"(checked at start and every {limits.sweep_minutes:g} min); AI off.",
        file=sys.stderr,
        flush=True,
    )
    if (limits.storage_cap_mb + limits.min_free_mb) * 1024 * 1024 > usage.total:
        print(
            "Warning: the storage cap and free-space floor exceed this volume; uploads will be "
            "refused when free space falls below the floor.",
            file=sys.stderr,
            flush=True,
        )


if __name__ == "__main__":
    main(sys.argv[1:])
