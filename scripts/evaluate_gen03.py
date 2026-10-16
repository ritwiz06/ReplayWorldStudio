"""GEN-03: run the frozen held-out set against two text models through the real API endpoints.

    uv run python scripts/evaluate_gen03.py                       run both models on every case
    uv run python scripts/evaluate_gen03.py --only descriptions   one workflow
    uv run python scripts/evaluate_gen03.py --models qwen3-30b-a3b-instruct-2507

Needs VOYAGER_API_KEY (read by the API settings from the environment or .env; never printed or
written). The inputs are the frozen files in docs/assist-evaluation/gen-03/ (committed before any
run). Each request goes through the API's own endpoint - request validation, the provider, the
checks and the response contract - with only the model ID changed between candidates; prompts,
schemas, retries, the 150 s timeout and limits are identical. Cases alternate which model goes
first. Results (every answer, timing, retries and errors) are written after each call to
docs/assist-evaluation/gen-03/results/<model>.json, so an interrupted run resumes where it
stopped; generated models for the visual review go to --models-dir (not committed). These are
LIVE results; recorded answers are never used here.
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import os
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Final
from unittest import mock

from fastapi.testclient import TestClient
from replay_world_api import app as app_module
from replay_world_api.assist import prompts
from replay_world_api.assist.provider import Completion, OpenAICompatibleProvider, Task
from replay_world_api.objects import build_model
from replay_world_api.settings import Settings
from replay_world_contracts import GeometrySpec, Project

ROOT: Final = Path(__file__).resolve().parents[1]
SET: Final = ROOT / "docs" / "assist-evaluation" / "gen-03"
BASELINE: Final = "qwen3-235b-a22b-instruct-2507"
CANDIDATE: Final = "qwen3-30b-a3b-instruct-2507"
WORKFLOWS: Final = ("descriptions", "edits", "revisions")


class Recorder:
    """The live provider, keeping every raw answer and the provider-side time of each attempt."""

    mode: Any = "live"

    def __init__(self, inner: OpenAICompatibleProvider) -> None:
        self.inner = inner
        self.service, self.base_url, self.model = inner.service, inner.base_url, inner.model
        self.calls: list[dict[str, Any]] = []

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
        started = time.monotonic()
        try:
            completion = self.inner.complete(
                task=task,
                key=key,
                messages=messages,
                schema=schema,
                attempt=attempt,
                timeout_s=timeout_s,
            )
        except Exception as exc:
            self.calls.append(
                {
                    "attempt": attempt,
                    "seconds": round(time.monotonic() - started, 2),
                    "error": str(exc),
                }
            )
            raise
        self.calls.append(
            {
                "attempt": attempt,
                "seconds": round(time.monotonic() - started, 2),
                "answer": completion.content,
            }
        )
        return completion


def edit_context(scene: Project, selected: str | None) -> dict[str, Any]:
    """What the browser sends with an edit request (apps/web/src/assist/editIntent.ts)."""
    return {
        "revision": scene.scene.revision,
        "selected_object_id": selected,
        "objects": [
            {
                "id": o.id,
                "name": o.name,
                "kind": o.kind,
                "position_m": o.transform.position_m.model_dump(),
                "rotation_y_rad": o.transform.rotation_rad.y,
                "size_m": {
                    "x": o.dimensions.width.value_m,
                    "y": o.dimensions.height.value_m,
                    "z": o.dimensions.depth.value_m,
                },
            }
            for o in scene.scene.objects
        ],
    }


def requests_for(workflow: str) -> list[tuple[str, str, dict[str, Any]]]:
    """(case id, endpoint, body) for every case of a workflow, in file order."""
    if workflow == "descriptions":
        cases = json.loads((SET / "descriptions.json").read_text())["cases"]
        return [
            (c["id"], "/api/v1/assist/object-proposals", {"description": c["text"]}) for c in cases
        ]
    if workflow == "edits":
        data = json.loads((SET / "edits.json").read_text())
        scene = Project.model_validate_json((SET / data["scene"]).read_text())
        return [
            (
                c["id"],
                "/api/v1/assist/edit-proposals",
                {"request": c["text"], "context": edit_context(scene, c["selected"])},
            )
            for c in data["cases"]
        ]
    data = json.loads((SET / "revisions.json").read_text())
    targets = data["targets"]
    return [
        (
            c["id"],
            "/api/v1/assist/model-revisions",
            {
                "name": targets[c["target"]]["name"][:80],
                "spec": targets[c["target"]]["spec"],
                "instruction": c["instruction"],
            },
        )
        for c in data["cases"]
    ]


class Candidate:
    """One model behind the real API app, with its recorder."""

    def __init__(self, settings: Settings, model: str) -> None:
        self.model = model
        self.recorder: Recorder | None = None
        assist = dataclasses.replace(settings.assist, model=model, provider="voyager")

        def provider(s: Any) -> Recorder:
            self.recorder = Recorder(OpenAICompatibleProvider(s))
            return self.recorder

        with mock.patch.object(app_module, "provider_from_settings", provider):
            self.client = TestClient(
                app_module.create_app(dataclasses.replace(settings, assist=assist))
            )

    def call(self, endpoint: str, body: dict[str, Any]) -> dict[str, Any]:
        assert self.recorder is not None
        self.recorder.calls = []
        started = time.monotonic()
        response = self.client.post(endpoint, json=body)
        wall = round(time.monotonic() - started, 2)
        payload = response.json()
        return {
            "http_status": response.status_code,
            "wall_s": wall,
            "calls": self.recorder.calls,
            "result": payload if response.status_code == 200 else None,
            "error": None if response.status_code == 200 else payload.get("detail"),
        }


def save_model(row: dict[str, Any], workflow: str, models_dir: Path, model: str, case: str) -> None:
    """Build the proposed model with the project's generator, for the visual review."""
    result = row["result"] or {}
    spec = (
        (result.get("proposal") or {}).get("spec")
        if workflow == "descriptions"
        else result.get("spec")
    )
    if not spec:
        return
    built = build_model(GeometrySpec.model_validate(spec))
    folder = models_dir / model
    folder.mkdir(parents=True, exist_ok=True)
    (folder / f"{case}.glb").write_bytes(built.glb)
    row["model_sha256"] = built.sha256
    row["triangles"] = built.triangles


def write_atomically(path: Path, report: dict[str, Any]) -> None:
    """Write the whole report to a temporary file, then rename it over the old one, so an
    interruption leaves either the previous complete file or the new one, never half of one."""
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(report, indent=1, ensure_ascii=False) + "\n")
    os.replace(temporary, path)


def commit() -> str:
    out = subprocess.run(
        ["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True, cwd=ROOT
    )
    return out.stdout.strip()


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--models", nargs="+", default=[BASELINE, CANDIDATE])
    parser.add_argument("--only", choices=WORKFLOWS, default=None)
    parser.add_argument(
        "--retry-errors",
        action="store_true",
        help="re-run cases whose recorded result is an error (by default every recorded result, "
        "errors and timeouts included, is kept as measured)",
    )
    parser.add_argument("--models-dir", type=Path, default=ROOT / "bench-results" / "gen-03-models")
    parser.add_argument(
        "--build-targets",
        action="store_true",
        help="only build the revision targets' current models (for the review sheets); no calls",
    )
    args = parser.parse_args(argv)
    if args.build_targets:
        targets = json.loads((SET / "revisions.json").read_text())["targets"]
        folder = args.models_dir / "targets"
        folder.mkdir(parents=True, exist_ok=True)
        for name, target in targets.items():
            built = build_model(GeometrySpec.model_validate(target["spec"]))
            (folder / f"{name}.glb").write_bytes(built.glb)
        print(f"Built {len(targets)} target models in {folder}", file=sys.stderr)
        return 0

    settings = Settings.from_env()
    if not settings.assist.api_key:
        print(
            "VOYAGER_API_KEY is not set; the live evaluation needs it (see README).",
            file=sys.stderr,
        )
        return 2
    out_dir = SET / "results"
    out_dir.mkdir(exist_ok=True)
    candidates = [Candidate(settings, m) for m in args.models]
    reports: dict[str, dict[str, Any]] = {}
    for c in candidates:
        path = out_dir / f"{c.model}.json"
        reports[c.model] = (
            json.loads(path.read_text())
            if path.is_file()
            else {
                "model": c.model,
                "service": settings.assist.service,
                "base_url": settings.assist.base_url,
                "prompt_versions": {
                    "objects_and_edits": prompts.PROMPT_VERSION,
                    "revisions": prompts.REVISION_PROMPT_VERSION,
                },
                "timeout_s": settings.assist.timeout_s,
                "retry_policy": "one retry after an invalid answer (API default)",
                "mode": "live, schema-guided, through the API endpoints",
                "runs": [],
                "rows": {w: {} for w in WORKFLOWS},
            }
        )
        reports[c.model]["runs"].append(
            {"started": datetime.now(UTC).isoformat(timespec="seconds"), "commit": commit()}
        )

    index = 0
    for workflow in WORKFLOWS if args.only is None else (args.only,):
        for case, endpoint, body in requests_for(workflow):
            order = candidates if index % 2 == 0 else list(reversed(candidates))
            index += 1
            for c in order:
                rows = reports[c.model]["rows"][workflow]
                if case in rows and not (args.retry_errors and rows[case]["http_status"] != 200):
                    continue  # measured in an earlier run: an error or a timeout is a result too
                earlier = rows.get(case)
                print(f"{workflow} {case} [{c.model}]…", file=sys.stderr, flush=True)
                row = c.call(endpoint, body)
                row["at"] = datetime.now(UTC).isoformat(timespec="seconds")
                save_model(row, workflow, args.models_dir, c.model, case)
                if earlier is not None:
                    row["replaces_error"] = {k: earlier[k] for k in ("http_status", "error", "at")}
                rows[case] = row
                print(f"  {row['http_status']} {row['wall_s']} s", file=sys.stderr, flush=True)
                write_atomically(out_dir / f"{c.model}.json", reports[c.model])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
