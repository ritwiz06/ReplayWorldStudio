"""IMG-03: build the models of the synthetic scenes and the manifest the renderer reads.

    pnpm --filter @replay-world/web exec node scripts/assist/run-ts.mjs \\
        scripts/img03/dump-templates.ts ../../bench-results/img-03/templates.json
    uv run --project services/api python scripts/build_img03_scenes.py

Reads docs/assist-evaluation/img-03/scenes.json. A builder template is built by the project's
own generator at exactly the scene's size (its envelope), so the model's bounds are the ground
truth; a catalog model is used at its own size. Writes bench-results/img-03/models/*.glb and
bench-results/img-03/manifest.json (git-ignored): every object's model file, position, yaw and
size in metres.
"""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path
from typing import Any, Final

from replay_world_api.objects import build_model, fit_to_envelope
from replay_world_contracts import GeometryDraft

ROOT: Final = Path(__file__).resolve().parents[1]
SCENES: Final = ROOT / "docs" / "assist-evaluation" / "img-03" / "scenes.json"
OUT: Final = ROOT / "bench-results" / "img-03"
CATALOG: Final = ROOT / "assets" / "catalog" / "models"


def main() -> int:
    templates = json.loads((OUT / "templates.json").read_text())
    catalog = {m["key"]: m for m in json.loads((CATALOG / "manifest.json").read_text())["models"]}
    models = OUT / "models"
    models.mkdir(parents=True, exist_ok=True)
    scenes = json.loads(SCENES.read_text())["scenes"]
    manifest: list[dict[str, Any]] = []
    for scene in scenes:
        objects = []
        for o in scene["objects"]:
            model = o["model"]
            if "catalog" in model:
                entry = catalog[model["catalog"]]
                src = CATALOG / Path(entry["uri"]).name
                file = f"{model['catalog']}.glb"
                shutil.copyfile(src, models / file)
                b = entry["bounds_m"]
                size = [b["max"][a] - b["min"][a] for a in "xyz"]
            else:
                w, h, d = model["size"]
                spec = dict(templates[model["template"]]["spec"])
                spec["envelope_m"] = {"x": w, "y": h, "z": d}
                fitted = fit_to_envelope(GeometryDraft.model_validate(spec))[0]
                built = build_model(fitted)
                file = f"{built.sha256}.glb"
                (models / file).write_bytes(built.glb)
                # The ground truth is the requested size: the built model must be exactly it.
                lo, hi = built.bounds.min, built.bounds.max
                size = [hi.x - lo.x, hi.y - lo.y, hi.z - lo.z]
                if any(abs(a - b) > 0.001 for a, b in zip(size, (w, h, d), strict=True)):
                    raise SystemExit(f"{scene['id']}/{o['id']}: built {size}, asked {[w, h, d]}")
                size = [w, h, d]
            objects.append(
                {
                    "id": o["id"],
                    "class": o["class"],
                    "file": f"models/{file}",
                    "position": o["position"],
                    "yaw_deg": o["yaw_deg"],
                    "size": [round(v, 6) for v in size],
                }
            )
        manifest.append({**{k: v for k, v in scene.items() if k != "objects"}, "objects": objects})
    (OUT / "manifest.json").write_text(json.dumps({"scenes": manifest}, indent=1) + "\n")
    print(
        f"Built {sum(len(s['objects']) for s in manifest)} objects in {len(manifest)} scenes",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
