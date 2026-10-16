"""Make fixtures/legacy/generated-0.7.0-pre-gen06.json: a saved project with a generated asset
(a shelving rack with a clear plastic side panel) made by the code before GEN-06.

Run it against the pre-GEN-06 checkout, so the asset and its recorded sha256 come from the old
generator (the current packages are shadowed by the old ones on PYTHONPATH):

    git worktree add /tmp/rws-pre-gen06 0849030
    PYTHONPATH=/tmp/rws-pre-gen06/services/api/src:/tmp/rws-pre-gen06/packages/contracts/python \\
        uv run python scripts/build_legacy_generated_fixture.py TEMPLATES.json

TEMPLATES.json is the app's builder templates (apps/web/src/assist/templates.ts, dumped). The
script refuses to run unless the imported API package is the old checkout's. The browser test
(e2e/review.spec.ts) opens this project with the current app: it must validate, rebuild the
missing model file to the recorded sha256, and be improved, applied, undone, saved and reopened.
"""

from __future__ import annotations

import copy
import json
import sys
import tempfile
from pathlib import Path
from typing import Final

import replay_world_api
from replay_world_api.generated_assets import create_generated_asset
from replay_world_contracts import GeneratedAssetRequest, GltfVisual, Project

ROOT: Final = Path(__file__).resolve().parents[1]
OUT: Final = ROOT / "fixtures" / "legacy" / "generated-0.7.0-pre-gen06.json"


def main(argv: list[str]) -> int:
    where = Path(replay_world_api.__file__).resolve()
    if ROOT in where.parents:
        print(
            f"Refusing: replay_world_api comes from this checkout ({where}), not the old one.",
            file=sys.stderr,
        )
        return 2
    rack = json.loads(Path(argv[0]).read_text())["rack"]["spec"]
    panel = {
        "id": "side-panel",
        "label": "clear side panel",
        "shape": "box",
        "material": "polycarbonate",
        "center_m": {"x": -0.89, "y": 1.0, "z": 0.0},
        "size_m": {"x": 0.02, "y": 1.8, "z": 0.54},
        "axis": None,
        "taper": None,
        "narrow_end": None,
        "basis": "entered",
    }
    spec = {**rack, "parts": [*rack["parts"], panel]}
    entered = {"basis": "entered", "quote": None, "confirmed": True, "source_ref": None}
    request = GeneratedAssetRequest.model_validate(
        {
            "name": "Display rack",
            "kind": "equipment",
            "method": "builder",
            "description": None,
            "language_model": None,
            "spec": spec,
            "dimensions": {"width": entered, "height": entered, "depth": entered},
            "stated_facts": [],
            "inferred_facts": [
                "Drawn with the rack shape family",
                "A clear side panel added in the builder",
            ],
            "not_modelled": [],
        }
    )
    with tempfile.TemporaryDirectory() as catalog:
        asset = create_generated_asset(request, Path(catalog))
    project = json.loads((ROOT / "fixtures" / "scenes" / "foundation-scene.json").read_text())
    project["id"] = "proj-legacy-generated"
    project["name"] = "Legacy generated asset (saved before GEN-06)"
    project["catalog"].append(asset.model_dump(mode="json"))
    template = next(o for o in project["scene"]["objects"] if o["asset_id"])
    placed = copy.deepcopy(template)
    placed |= {
        "id": "obj-display-rack",
        "name": "Display rack",
        "kind": "equipment",
        "asset_id": asset.id,
        "dimensions": asset.nominal_dimensions.model_dump(mode="json"),
        "parameters": [],
    }
    placed["transform"]["position_m"] = {"x": 3.0, "y": 0.0, "z": 3.0}
    project["scene"]["objects"].append(placed)
    Project.model_validate(project)  # the old contracts accept it
    assert isinstance(asset.visual, GltfVisual)
    OUT.write_text(json.dumps(project, indent=2, ensure_ascii=False) + "\n")
    print(
        f"Wrote {OUT.relative_to(ROOT)} with {asset.id} (sha256 {asset.visual.sha256}) "
        f"from {where}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
