"""GEN-04: run the frozen revision set once, on the default model, through the real API endpoint.

    uv run python scripts/evaluate_gen04.py                    the frozen run (results/<model>.json)
    uv run python scripts/evaluate_gen04.py --build-targets    the "before" models only; no calls
    uv run python scripts/evaluate_gen04.py --diagnostic NAME --cases m01 m02
                                                               a diagnostic retry, kept apart

Needs VOYAGER_API_KEY (read by the API settings from the environment or .env; never printed or
written). The inputs are docs/assist-evaluation/gen-04/revisions.json and criteria.md, committed
before any run. Requests go one at a time through the API's own endpoint (request validation, the
provider, the checks and the response contract) using the GEN-03 runner's client and recorder.
Results are written after each call, so an interrupted run resumes where it stopped and keeps every
recorded result, errors and timeouts included. A diagnostic run writes only to
results/diagnostic-<NAME>.json and never touches the frozen result.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from datetime import UTC, datetime
from pathlib import Path
from types import ModuleType
from typing import Any, Final

from replay_world_api.assist import prompts
from replay_world_api.objects import build_model
from replay_world_api.settings import Settings
from replay_world_contracts import GeometrySpec

ROOT: Final = Path(__file__).resolve().parents[1]
SET: Final = ROOT / "docs" / "assist-evaluation" / "gen-04"
DEFAULT_MODEL: Final = "qwen3-235b-a22b-instruct-2507"
ENDPOINT: Final = "/api/v1/assist/model-revisions"


def _gen03() -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        "evaluate_gen03", ROOT / "scripts" / "evaluate_gen03.py"
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules.setdefault("evaluate_gen03", module)
    spec.loader.exec_module(module)
    return module


gen03 = _gen03()


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


def new_report(settings: Settings, model: str, kind: str) -> dict[str, Any]:
    return {
        "model": model,
        "kind": kind,
        "service": settings.assist.service,
        "base_url": settings.assist.base_url,
        "prompt_version": prompts.REVISION_PROMPT_VERSION,
        "timeout_s": settings.assist.timeout_s,
        "retry_policy": "one retry after an invalid answer; at most one openness feedback retry",
        "mode": "live, schema-guided, through the API endpoint, sequential (one request at a time)",
        "runs": [],
        "rows": {},
    }


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
        row = candidate.call(ENDPOINT, body)
        row["at"] = datetime.now(UTC).isoformat(timespec="seconds")
        gen03.save_model(row, "revisions", models_dir, candidate.model, case)
        rows[case] = row
        print(f"  {row['http_status']} {row['wall_s']} s", file=sys.stderr, flush=True)
        gen03.write_atomically(path, report)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--models-dir", type=Path, default=ROOT / "bench-results" / "gen-04-models")
    parser.add_argument("--build-targets", action="store_true")
    parser.add_argument("--diagnostic", metavar="NAME", help="a separate diagnostic run")
    parser.add_argument("--cases", nargs="+", help="with --diagnostic: only these case ids")
    args = parser.parse_args(argv)
    data = json.loads((SET / "revisions.json").read_text())
    if args.build_targets:
        folder = args.models_dir / "targets"
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
    out_dir = SET / "results"
    out_dir.mkdir(exist_ok=True)
    kind = f"diagnostic-{args.diagnostic}" if args.diagnostic else "frozen"
    path = out_dir / (f"{kind}.json" if args.diagnostic else f"{args.model}.json")
    report = (
        json.loads(path.read_text()) if path.is_file() else new_report(settings, args.model, kind)
    )
    report["runs"].append(
        {"started": datetime.now(UTC).isoformat(timespec="seconds"), "commit": gen03.commit()}
    )
    models_dir = args.models_dir / kind if args.diagnostic else args.models_dir
    run(gen03.Candidate(settings, args.model), data, report, path, models_dir, args.cases)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
