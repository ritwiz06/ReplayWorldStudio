"""GEN-09: the GEN-08 glass-door (t2) and floating-frame (p3) failures as browser regressions.

    uv run --project services/api python scripts/build_gen09_regressions.py

Writes

* ``fixtures/gen09/gen08-regressions.json``: a saved project holding the two GEN-08 targets (the
  builder cabinet and the photo-made left machine, rebuilt here from their recorded geometry as
  builder assets) placed in the foundation scene; their model files are rebuilt on open;
* ``fixtures/assist/recorded/revision-gen09-<label>.json``: recorded answers keyed exactly as the
  improve dialog asks about those objects, and
* ``apps/web/e2e/gen09-cases.json``: what the browser test (e2e/gen09-regressions.spec.ts) reads.

The t2 and p3 answers are the GEN-08 frozen-run answers, reused as development regressions; the
GEN-08 results are not rescored. The two controls (glass added on purpose as a cover, and a
beacon mounted on a post) are synthetic answers written here. When the checks ask again, the
offline provider replays the same answer (the model "repeated itself"). Replayed offline, every
answer is labelled "recorded" and is never live AI.
"""

from __future__ import annotations

import copy
import json
import sys
import tempfile
from pathlib import Path
from typing import Any, Final

from replay_world_api.assist.revisions import revision_key
from replay_world_api.generated_assets import create_generated_asset
from replay_world_contracts import GeneratedAssetRequest, ModelRevisionProposalRequest, Project

ROOT: Final = Path(__file__).resolve().parents[1]
GEN08: Final = ROOT / "docs" / "assist-evaluation" / "gen-08"
OUT: Final = ROOT / "fixtures" / "gen09" / "gen08-regressions.json"
RECORDED: Final = ROOT / "fixtures" / "assist" / "recorded"


def part(
    pid: str,
    label: str,
    material: str,
    center: tuple[float, ...],
    size: tuple[float, ...],
    shape: str = "box",
) -> dict[str, Any]:
    return {
        "id": pid,
        "label": label,
        "shape": shape,
        "material": material,
        "center_m": dict(zip("xyz", center, strict=True)),
        "size_m": dict(zip("xyz", size, strict=True)),
        "axis": "y",
        "taper": None,
        "narrow_end": None,
        "basis": "inferred",
    }


def synthetic(envelope: dict[str, float], summary: str, add: list[dict[str, Any]]) -> str:
    return json.dumps(
        {
            "outcome": "revision",
            "message": None,
            "summary": summary,
            "envelope_m": envelope,
            "remove": [],
            "change": [],
            "add": add,
            "repeat": [],
            "not_representable": [],
        }
    )


def frozen(case_id: str) -> str:
    rows = json.loads((GEN08 / "results" / "qwen3-235b-a22b-instruct-2507.json").read_text())[
        "rows"
    ]
    return str([c["answer"] for c in rows[case_id]["calls"] if "answer" in c][-1])


def asset_for(target: dict[str, Any], catalog: Path) -> Any:
    entered = {"basis": "entered", "quote": None, "confirmed": True, "source_ref": None}
    origin = "the photo-made" if target["origin"] == "photo" else "the builder"
    request = GeneratedAssetRequest.model_validate(
        {
            "name": target["name"],
            "kind": "equipment",
            "method": "builder",
            "description": None,
            "language_model": None,
            "spec": target["spec"],
            "dimensions": {"width": entered, "height": entered, "depth": entered},
            "stated_facts": [],
            "inferred_facts": [f"The geometry of {origin} GEN-08 target, as a GEN-09 regression"],
            "not_modelled": [],
        }
    )
    return create_generated_asset(request, catalog)


def main() -> int:
    data = json.loads((GEN08 / "revisions.json").read_text())
    cases = {c["id"]: c for c in data["cases"]}
    targets = data["targets"]
    with tempfile.TemporaryDirectory() as catalog:
        cabinet = asset_for(targets["builder-cabinet"], Path(catalog))
        machine = asset_for(targets["factory-left-machine"], Path(catalog))
    c_env = cabinet.generation.spec.envelope_m.model_dump()
    m_env = machine.generation.spec.envelope_m.model_dump()
    body = next(p for p in machine.generation.spec.parts if p.id == "body")
    body_top = body.center_m.y + body.size_m.y / 2  # the beacon post stands on it
    regressions = [
        {
            "label": "gen08-t2",
            "asset": cabinet,
            "instruction": cases["t2"]["instruction"],
            "origin": "GEN-08 frozen answer t2 (development regression)",
            "answer": frozen("t2"),
            "expect": {"backed_glass": True},
        },
        {
            "label": "gen08-p3",
            "asset": machine,
            "instruction": cases["p3"]["instruction"],
            "origin": "GEN-08 frozen answer p3 (development regression)",
            "answer": frozen("p3"),
            "expect": {"floating_kept": True},
        },
        {
            "label": "backed-cover",
            "asset": cabinet,
            "instruction": "add a clear glass cover over the front to protect the door",
            "origin": "synthetic (glass in front of a solid part on purpose)",
            "answer": synthetic(
                c_env,
                "Added a clear glass cover over the front.",
                [part("cover", "glass cover", "glass_clear", (0, 1.0, 0.2025), (0.58, 1.74, 0.01))],
            ),
            "expect": {"backed_glass": False},
        },
        {
            "label": "mounted-beacon",
            "asset": machine,
            "instruction": "add an orange beacon on a short post on top of the machine",
            "origin": "synthetic (equipment mounted on the machine, not standing on the floor)",
            "answer": synthetic(
                m_env,
                "Added an orange beacon on a short post on top.",
                [
                    part(
                        "post",
                        "beacon post",
                        "steel_dark",
                        (0.8, body_top + 0.06, 0),
                        (0.04, 0.12, 0.04),
                        "cylinder",
                    ),
                    part(
                        "beacon",
                        "orange beacon",
                        "signal_amber",
                        (0.8, body_top + 0.165, 0),
                        (0.09, 0.09, 0.09),
                        "cylinder",
                    ),
                ],
            ),
            "expect": {"floating_kept": False, "floating": False, "unrelated_change": False},
        },
    ]
    for case in regressions:
        asset = case["asset"]
        request = ModelRevisionProposalRequest.model_validate(
            {
                "name": asset.name[:80],
                "spec": asset.generation.spec.model_dump(mode="json"),
                "instruction": case["instruction"],
            }
        )
        record = {
            "task": "revision",
            "key": revision_key(request),
            "service": "ASU Voyager",
            "model": "qwen3-235b-a22b-instruct-2507",
            "prompt_version": "gen-05.1",
            "recorded_at": "2026-10-16",
            "note": f"GEN-09 regression ({case['origin']}); replayed by the offline test "
            "provider, never live AI.",
            "responses": [case["answer"]],
        }
        (RECORDED / f"revision-gen09-{case['label']}.json").write_text(
            json.dumps(record, indent=2, ensure_ascii=False) + "\n"
        )

    project = json.loads((ROOT / "fixtures" / "scenes" / "foundation-scene.json").read_text())
    project["id"] = "proj-gen09-regressions"
    project["name"] = "GEN-09 regressions (GEN-08 t2 and p3 targets)"
    template = next(o for o in project["scene"]["objects"] if o["asset_id"])
    for asset, oid, x in ((cabinet, "obj-cabinet", 3.0), (machine, "obj-left-machine", 6.0)):
        project["catalog"].append(asset.model_dump(mode="json"))
        placed = copy.deepcopy(template)
        placed |= {
            "id": oid,
            "name": asset.name,
            "kind": "equipment",
            "asset_id": asset.id,
            "dimensions": asset.nominal_dimensions.model_dump(mode="json"),
            "parameters": [],
        }
        placed["transform"]["position_m"] = {"x": x, "y": 0.0, "z": 3.0}
        project["scene"]["objects"].append(placed)
    Project.model_validate(project)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(project, indent=2, ensure_ascii=False) + "\n")
    listed = [
        {
            "label": c["label"],
            "name": c["asset"].name,
            "instruction": c["instruction"],
            "origin": c["origin"],
            "expect": c["expect"],
        }
        for c in regressions
    ]
    (ROOT / "apps" / "web" / "e2e" / "gen09-cases.json").write_text(
        json.dumps(listed, indent=1, ensure_ascii=False) + "\n"
    )
    print(f"Wrote {OUT.relative_to(ROOT)} and {len(regressions)} recordings", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
