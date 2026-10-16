"""GEN-06/07: recorded answers for the revision-review inspection (development regressions).

    uv run python scripts/build_inspection_recordings.py TEMPLATES.json

TEMPLATES.json is the app's builder templates (apps/web/src/assist/templates.ts, dumped as
{key: {spec}}). For each inspection case, this writes:

* ``fixtures/assist/recorded/revision-inspect-<label>.json``, keyed exactly as the improve
  dialog asks about an object made in the builder from that template, and
* ``apps/web/e2e/inspection-cases.json``, which the inspection and review browser tests read.

The answers are either GEN-05 frozen-run or pilot answers for builder targets, reused as
development regressions (never as a held-out set), or synthetic answers written here for
cases GEN-05 had only on photo-made or described targets (a glass top, a glass back panel, a
valve under a tank, a bracket behind a screen). Each recording says which. Replayed offline,
they are labelled "recorded" and are never live AI.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Final

from replay_world_api.assist.revisions import revision_key
from replay_world_api.objects import fit_to_envelope
from replay_world_contracts import GeometryDraft, ModelRevisionProposalRequest

ROOT: Final = Path(__file__).resolve().parents[1]
GEN05: Final = ROOT / "docs" / "assist-evaluation" / "gen-05"
PILOT: Final = ROOT / "docs" / "assist-evaluation" / "gen-05-pilot"
NAMES: Final = {
    "rack": "Shelving rack",
    "table": "Workbench",
    "sofa": "Sofa",
    "chair": "Chair",
    "screen": "Screen on a stand",
    "tank": "Tank",
}


def part(
    pid: str,
    label: str,
    shape: str,
    material: str,
    center: tuple[float, ...],
    size: tuple[float, ...],
    **extra: Any,
) -> dict[str, Any]:
    return {
        "id": pid,
        "label": label,
        "shape": shape,
        "material": material,
        "center_m": dict(zip("xyz", center, strict=True)),
        "size_m": dict(zip("xyz", size, strict=True)),
        "axis": extra.get("axis", "y"),
        "taper": None,
        "narrow_end": None,
        "basis": "inferred",
    }


def synthetic(
    envelope: dict[str, float],
    summary: str,
    change: list[dict[str, Any]] | None = None,
    add: list[dict[str, Any]] | None = None,
) -> str:
    return json.dumps(
        {
            "outcome": "revision",
            "message": None,
            "summary": summary,
            "envelope_m": envelope,
            "remove": [],
            "change": change or [],
            "add": add or [],
            "repeat": [],
            "not_representable": [],
        }
    )


def frozen_answer(folder: Path, case: str, last: bool = True) -> str:
    rows = json.loads((folder / "results" / "qwen3-235b-a22b-instruct-2507.json").read_text())[
        "rows"
    ]
    answers: list[str] = [str(c["answer"]) for c in rows[case]["calls"] if "answer" in c]
    return answers[-1] if last else answers[0]


def _described_conveyor() -> dict[str, Any]:
    """The guarded conveyor the browser tests describe, as the asset store fits it."""
    import dataclasses

    from fastapi.testclient import TestClient
    from replay_world_api import app as app_module
    from replay_world_api.settings import Settings

    settings = Settings.from_env()
    settings = dataclasses.replace(
        settings, assist=dataclasses.replace(settings.assist, provider="recorded")
    )
    client = TestClient(app_module.create_app(settings))
    proposal = client.post(
        "/api/v1/assist/object-proposals",
        json={"description": "a guarded conveyor about 2.2 m long with a control screen"},
    ).json()["proposal"]
    spec = fit_to_envelope(GeometryDraft.model_validate(proposal["spec"]))[0].model_dump(
        mode="json"
    )
    belt = next(p for p in spec["parts"] if "belt" in p["label"])
    below = belt["center_m"]["y"] - belt["size_m"]["y"] / 2
    return {"name": proposal["name"], "spec": spec, "tray_y": round(below - 0.15, 3)}


def main(argv: list[str]) -> int:
    templates = json.loads(Path(argv[0]).read_text())
    gen05 = {c["id"]: c for c in json.loads((GEN05 / "revisions.json").read_text())["cases"]}
    pilot = {c["id"]: c for c in json.loads((PILOT / "revisions.json").read_text())["cases"]}

    def base(key: str) -> dict[str, Any]:
        return fit_to_envelope(GeometryDraft.model_validate(templates[key]["spec"]))[0].model_dump(
            mode="json"
        )

    table, rack, tank, screen = base("table"), base("rack"), base("tank"), base("screen")
    top = next(p for p in table["parts"] if p["id"] == "top")
    cases: list[dict[str, Any]] = [
        {
            "label": "glass-top",
            "template": "table",
            "instruction": "give it a clear glass top on the same frame",
            "origin": "synthetic (GEN-05 t01 had a photo-made table)",
            "answer": synthetic(
                table["envelope_m"],
                "Made the top clear glass.",
                change=[top | {"material": "glass_clear", "axis": "y", "basis": "inferred"}],
            ),
        },
        {
            "label": "glass-back",
            "template": "rack",
            "instruction": "add a glass back panel behind the shelves",
            "origin": "synthetic (GEN-05 t03 had a photo-made bookshelf)",
            "answer": synthetic(
                rack["envelope_m"],
                "Added a glass back panel.",
                add=[
                    part(
                        "back-glass",
                        "glass back panel",
                        "box",
                        "glass_clear",
                        (0, 1.0, -0.29),
                        (1.74, 1.9, 0.01),
                    )
                ],
            ),
        },
        {
            "label": "clear-sides",
            "template": "rack",
            "instruction": gen05["t02"]["instruction"],
            "origin": "GEN-05 frozen answer t02 (development regression)",
            "answer": frozen_answer(GEN05, "t02"),
        },
        {
            "label": "status-lamp",
            "template": "rack",
            "instruction": gen05["v03"]["instruction"],
            "origin": "GEN-05 frozen answer v03 (development regression)",
            "answer": frozen_answer(GEN05, "v03"),
        },
        {
            "label": "label-holders",
            "template": "rack",
            "instruction": gen05["p02"]["instruction"],
            "origin": "GEN-05 frozen answer p02 (development regression)",
            "answer": frozen_answer(GEN05, "p02"),
        },
        {
            "label": "blue-armrests",
            "template": "sofa",
            "instruction": gen05["e03"]["instruction"],
            "origin": "GEN-05 frozen answer e03 (development regression)",
            "answer": frozen_answer(GEN05, "e03"),
        },
        {
            "label": "throw-pillows",
            "template": "sofa",
            "instruction": gen05["v06"]["instruction"],
            "origin": "GEN-05 frozen answer v06 (development regression)",
            "answer": frozen_answer(GEN05, "v06"),
        },
        {
            "label": "slatted-back",
            "template": "chair",
            "instruction": gen05["o05"]["instruction"],
            "origin": "GEN-05 frozen answer o05 (development regression)",
            "answer": frozen_answer(GEN05, "o05"),
        },
        {
            "label": "tiny-light",
            "template": "screen",
            "instruction": pilot["p1"]["instruction"],
            "origin": "GEN-05 pilot first answer p1 (development example)",
            "answer": frozen_answer(PILOT, "p1", last=False),
        },
        {
            "label": "valve-under",
            "template": "tank",
            "instruction": "add a red drain valve at the bottom of the cone",
            "origin": "synthetic (GEN-05 p04 had a described tank)",
            "answer": synthetic(
                tank["envelope_m"],
                "Added a red drain valve under the cone.",
                add=[
                    part(
                        "valve",
                        "drain valve",
                        "cylinder",
                        "estop_red",
                        (0, 0.06, 0),
                        (0.12, 0.08, 0.12),
                    )
                ],
            ),
        },
        {
            "label": "bracket-behind",
            "template": "screen",
            "instruction": "add a white wall bracket behind the screen",
            "origin": "synthetic (GEN-05 p03 had a photo-made TV)",
            "answer": synthetic(
                screen["envelope_m"],
                "Added a white wall bracket behind the screen.",
                add=[
                    part(
                        "bracket",
                        "wall bracket",
                        "box",
                        "paint_white",
                        (0, 1.1, -0.06),
                        (0.3, 0.3, 0.05),
                    )
                ],
            ),
        },
    ]
    # The review journey (e2e/review.spec.ts): an object saved before GEN-06, and a described one.
    legacy = json.loads(
        (ROOT / "fixtures" / "legacy" / "generated-0.7.0-pre-gen06.json").read_text()
    )
    legacy_asset = next(
        a for a in legacy["catalog"] if a["id"].startswith("asset-gen-display-rack")
    )
    described = _described_conveyor()
    review = [
        {
            "label": "legacy-sign",
            "spec": legacy_asset["generation"]["spec"],
            "name": legacy_asset["name"],
            "instruction": "add a white sign on the back of the rack",
            "origin": "synthetic (review journey)",
            "answer": synthetic(
                legacy_asset["generation"]["spec"]["envelope_m"],
                "Added a white sign on the back.",
                add=[
                    part("sign", "sign", "box", "paint_white", (0, 1.54, -0.295), (0.6, 0.3, 0.01))
                ],
            ),
        },
        {
            "label": "described-tray",
            "spec": described["spec"],
            "name": described["name"],
            "instruction": "add a cable tray under the belt",
            "origin": "synthetic (review journey)",
            "answer": synthetic(
                described["spec"]["envelope_m"],
                "Added a cable tray under the belt.",
                add=[
                    part(
                        "tray",
                        "cable tray",
                        "box",
                        "plastic_grey",
                        (0, described["tray_y"], 0),
                        (1.2, 0.04, 0.3),
                    )
                ],
            ),
        },
    ]
    out = []
    directory = ROOT / "fixtures" / "assist" / "recorded"
    for case in review:
        request = ModelRevisionProposalRequest.model_validate(
            {"name": case["name"][:80], "spec": case["spec"], "instruction": case["instruction"]}
        )
        record = {
            "task": "revision",
            "key": revision_key(request),
            "service": "ASU Voyager",
            "model": "qwen3-235b-a22b-instruct-2507",
            "prompt_version": "gen-05.1",
            "recorded_at": "2026-10-16",
            "note": f"Review journey case ({case['origin']}); replayed by the offline test "
            "provider, never live AI.",
            "responses": [case["answer"]],
        }
        (directory / f"revision-review-{case['label']}.json").write_text(
            json.dumps(record, indent=2, ensure_ascii=False) + "\n"
        )
    for case in cases:
        spec = base(case["template"])
        request = ModelRevisionProposalRequest.model_validate(
            {"name": NAMES[case["template"]], "spec": spec, "instruction": case["instruction"]}
        )
        record = {
            "task": "revision",
            "key": revision_key(request),
            "service": "ASU Voyager",
            "model": "qwen3-235b-a22b-instruct-2507",
            "prompt_version": "gen-05.1",
            "recorded_at": "2026-10-16",
            "note": f"Inspection case ({case['origin']}); replayed by the offline test provider, "
            "never live AI.",
            "responses": [case["answer"]],
        }
        (directory / f"revision-inspect-{case['label']}.json").write_text(
            json.dumps(record, indent=2, ensure_ascii=False) + "\n"
        )
        out.append(
            {k: case[k] for k in ("label", "template", "instruction", "origin")}
            | {"name": NAMES[case["template"]]}
        )
    (ROOT / "apps" / "web" / "e2e" / "inspection-cases.json").write_text(
        json.dumps(out, indent=1, ensure_ascii=False) + "\n"
    )
    print(f"Wrote {len(cases)} inspection recordings", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
