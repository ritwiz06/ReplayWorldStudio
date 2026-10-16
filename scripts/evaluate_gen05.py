"""GEN-05: run a frozen revision set once, on the default model, through the real API endpoint.

    uv run python scripts/evaluate_gen05.py [--set DIR]              the run (results/<model>.json)
    uv run python scripts/evaluate_gen05.py --set DIR --build-targets  "before" models; no calls
    uv run python scripts/evaluate_gen05.py --diagnostic NAME --cases ID ...
                                                                    a diagnostic retry, kept apart

The default set is docs/assist-evaluation/gen-05 (frozen before any run); the pilot uses
docs/assist-evaluation/gen-05-pilot (development examples only). Needs VOYAGER_API_KEY (read by
the API settings; never printed or written). Requests go one at a time through the API's own
endpoint, which applies the whole-request budget, the shared retry and the visibility checks.

Run conditions are recorded, not assumed: on macOS the script keeps the computer awake
(``caffeinate -i -w <pid>``) for as long as it runs, and every row records both the request
timer (monotonic ``wall_s``) and the real elapsed time (``clock_s``). A difference of more than
5 s means the host paused during the request; the row is marked ``run_fault`` and reported
separately, never reclassified. Results are written after each call, so an interrupted run
resumes and keeps every recorded result, errors and timeouts included.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import platform
import shutil
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from types import ModuleType
from typing import Any, Final

from replay_world_api.assist import prompts
from replay_world_api.assist.revisions import BUDGET_S
from replay_world_api.objects import build_model
from replay_world_api.settings import Settings
from replay_world_contracts import GeometrySpec

ROOT: Final = Path(__file__).resolve().parents[1]
DEFAULT_SET: Final = ROOT / "docs" / "assist-evaluation" / "gen-05"
DEFAULT_MODEL: Final = "qwen3-235b-a22b-instruct-2507"
ENDPOINT: Final = "/api/v1/assist/model-revisions"
PAUSE_S: Final = 5.0


def _load(name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules.setdefault(name, module)
    spec.loader.exec_module(module)
    return module


gen03 = _load("evaluate_gen03")


def requests(
    data: dict[str, Any], only: list[str] | None = None
) -> list[tuple[str, dict[str, Any]]]:
    """(case id, body) for each case, in file order, exactly as the improve dialog sends them."""
    targets = data["targets"]
    return [
        (
            c["id"],
            {
                "name": targets[c["target"]]["name"][:80],
                "spec": targets[c["target"]]["spec"],
                "instruction": c["instruction"],
            },
        )
        for c in data["cases"]
        if only is None or c["id"] in only
    ]


def keep_awake() -> str:
    """Prevent idle and system sleep while this process runs (macOS); say what was done."""
    if platform.system() == "Darwin" and shutil.which("caffeinate"):
        subprocess.Popen(["caffeinate", "-i", "-w", str(os.getpid())])
        return "caffeinate -i -w <pid> (macOS idle and system sleep prevented)"
    return "not managed (no caffeinate); pauses are detected from the two clocks"


def timed(candidate: Any, body: dict[str, Any]) -> dict[str, Any]:
    """One request, with the request timer and the real clock side by side."""
    started_at = datetime.now(UTC)
    clock = time.time()
    row: dict[str, Any] = candidate.call(ENDPOINT, body)
    row["clock_s"] = round(time.time() - clock, 2)
    row["started_at"] = started_at.isoformat(timespec="seconds")
    row["at"] = datetime.now(UTC).isoformat(timespec="seconds")
    pause = row["clock_s"] - row["wall_s"]
    if pause > PAUSE_S:
        row["run_fault"] = (
            f"host paused for about {pause:.0f} s during this request (real time "
            f"{row['clock_s']:.0f} s, request timer {row['wall_s']:.0f} s)"
        )
    return row


def run(
    candidate: Any,
    data: dict[str, Any],
    report: dict[str, Any],
    path: Path,
    models_dir: Path,
    only: list[str] | None = None,
) -> None:
    """Call every case not yet measured, writing the report after each call."""
    rows = report["rows"]
    for case, body in requests(data, only):
        if case in rows:
            continue  # measured in an earlier run: an error or a timeout is a result too
        print(f"revision {case}…", file=sys.stderr, flush=True)
        row = timed(candidate, body)
        gen03.save_model(row, "revisions", models_dir, candidate.model, case)
        rows[case] = row
        fault = f"  RUN FAULT: {row['run_fault']}" if "run_fault" in row else ""
        print(f"  {row['http_status']} {row['wall_s']} s{fault}", file=sys.stderr, flush=True)
        gen03.write_atomically(path, report)


def new_report(settings: Settings, model: str, kind: str, awake: str) -> dict[str, Any]:
    return {
        "model": model,
        "kind": kind,
        "service": settings.assist.service,
        "base_url": settings.assist.base_url,
        "prompt_version": prompts.REVISION_PROMPT_VERSION,
        "budget_s": settings.assist.timeout_s,
        "retry_policy": "at most one shared retry (invalid answer, not open, or added parts not "
        "visible), only while the whole-request budget can cover it",
        "mode": "live, schema-guided, through the API endpoint, sequential (one request at a time)",
        "keep_awake": awake,
        "runs": [],
        "rows": {},
    }


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--set", type=Path, default=DEFAULT_SET)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--models-dir", type=Path, default=None)
    parser.add_argument("--build-targets", action="store_true")
    parser.add_argument("--diagnostic", metavar="NAME", help="a separate diagnostic run")
    parser.add_argument("--cases", nargs="+", help="with --diagnostic: only these case ids")
    args = parser.parse_args(argv)
    data = json.loads((args.set / "revisions.json").read_text())
    models_dir = args.models_dir or ROOT / "bench-results" / f"{args.set.name}-models"
    if args.build_targets:
        folder = models_dir / "targets"
        folder.mkdir(parents=True, exist_ok=True)
        for name, target in data["targets"].items():
            built = build_model(GeometrySpec.model_validate(target["spec"]))
            (folder / f"{name}.glb").write_bytes(built.glb)
        print(f"Built {len(data['targets'])} target models in {folder}", file=sys.stderr)
        return 0
    if args.cases and not args.diagnostic:
        parser.error("--cases is only for a --diagnostic run; the frozen run covers every case")

    settings = Settings.from_env()
    if not settings.assist.api_key:
        print("VOYAGER_API_KEY is not set; the live evaluation needs it.", file=sys.stderr)
        return 2
    if settings.assist.timeout_s != BUDGET_S:
        print(
            f"Note: the budget is {settings.assist.timeout_s:g} s (not {BUDGET_S:g} s).",
            file=sys.stderr,
        )
    awake = keep_awake()
    out_dir = args.set / "results"
    out_dir.mkdir(exist_ok=True)
    kind = f"diagnostic-{args.diagnostic}" if args.diagnostic else "frozen"
    path = out_dir / (f"{kind}.json" if args.diagnostic else f"{args.model}.json")
    report = (
        json.loads(path.read_text())
        if path.is_file()
        else new_report(settings, args.model, kind, awake)
    )
    report["runs"].append(
        {
            "started": datetime.now(UTC).isoformat(timespec="seconds"),
            "commit": gen03.commit(),
            "keep_awake": awake,
        }
    )
    target_dir = models_dir / kind if args.diagnostic else models_dir
    run(gen03.Candidate(settings, args.model), data, report, path, target_dir, args.cases)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
