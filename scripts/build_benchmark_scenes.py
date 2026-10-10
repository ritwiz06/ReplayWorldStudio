"""Build synthetic benchmark scenes: the industrial demo plus N added catalog instances.

    uv run python scripts/build_benchmark_scenes.py OUT_DIR [N ...]   (default N: 15 45 105)

Each scene is what the editor would produce: the demo's floor slab is resized and moved so
every new instance stands on it, and each instance is added from the catalog at its nominal
size and evidence. Every change has its edit record (contract 0.4.0), so the files open
through the normal API check. The scenes keep the demonstration label: they exist to measure
rendering, not to describe a real layout, and nothing in them is engineering data.
"""

from __future__ import annotations

import copy
import json
import math
import sys
from pathlib import Path
from typing import Any, Final

from replay_world_contracts import Project

ROOT: Final = Path(__file__).resolve().parents[1]
DEMO: Final = ROOT / "fixtures" / "scenes" / "industrial-demo.json"
EDIT_REF: Final = (
    "Entered in the editor; the previous value and its evidence are in the scene edit log"
)
DEFAULT_COUNTS: Final = (15, 45, 105)

# Instances fill a grid south of the walkway: 6 columns of 3.4 m by rows of 2.3 m, which
# fits the largest footprint (3.0 m conveyor, 1.89 m deep machine cell) with an aisle.
COLUMNS: Final = 6
CELL_X: Final = 3.4
CELL_Z: Final = 2.3
FIRST_ROW_Z: Final = 3.75
STAGED_PALLET_CELL: Final = (0, 5)  # row, column already used by the demo's staged pallet
FLOOR_MARGIN_M: Final = 0.6


def _edited_length(value: float) -> dict[str, Any]:
    return {
        "value_m": value,
        "origin": "user_supplied",
        "source_ref": EDIT_REF,
        "review_status": "unreviewed",
        "uncertainty_m": None,
    }


def _cells(count: int) -> list[tuple[float, float]]:
    cells: list[tuple[float, float]] = []
    row = 0
    while len(cells) < count:
        for column in range(COLUMNS):
            if (row, column) == STAGED_PALLET_CELL:
                continue
            x = round(-CELL_X * (COLUMNS - 1) / 2 + column * CELL_X, 4)
            cells.append((x, round(FIRST_ROW_Z + row * CELL_Z, 4)))
            if len(cells) == count:
                break
        row += 1
    return cells


def build(count: int) -> Project:
    doc: dict[str, Any] = json.loads(DEMO.read_text())
    scene = doc["scene"]
    objects: list[dict[str, Any]] = scene["objects"]
    log: list[dict[str, Any]] = scene["edit_log"]
    revision = scene["revision"]
    cells = _cells(count)

    # Extend the floor southwards (resize, then move) so the north edge stays at the wall.
    floor = next(o for o in objects if o["id"] == "obj-floor")
    old_depth = floor["dimensions"]["depth"]
    old_transform = copy.deepcopy(floor["transform"])
    north = old_transform["position_m"]["z"] - old_depth["value_m"] / 2
    last_row_edge = max(z for _, z in cells) + CELL_Z / 2
    south = max(old_transform["position_m"]["z"] + old_depth["value_m"] / 2, last_row_edge)
    south = math.ceil((south + FLOOR_MARGIN_M) * 10) / 10
    depth = round(south - north, 4)
    if depth != old_depth["value_m"]:
        revision += 1
        new_depth = _edited_length(depth)
        floor["dimensions"]["depth"] = new_depth
        log.append(
            {
                "type": "object_edited",
                "revision": revision,
                "object_id": "obj-floor",
                "transform": None,
                "dimensions": [{"axis": "depth", "before": old_depth, "after": new_depth}],
            }
        )
        revision += 1
        new_transform = copy.deepcopy(old_transform)
        new_transform["position_m"]["z"] = round((north + south) / 2, 4)
        floor["transform"] = new_transform
        log.append(
            {
                "type": "object_edited",
                "revision": revision,
                "object_id": "obj-floor",
                "transform": {"before": old_transform, "after": new_transform},
                "dimensions": [],
            }
        )

    catalog = doc["catalog"]
    used_ids = {o["id"] for o in objects}
    used_names = {o["name"] for o in objects}
    for index, (x, z) in enumerate(cells):
        asset = catalog[index % len(catalog)]
        base = "obj-" + asset["id"].removeprefix("asset-")
        object_id = base if base not in used_ids else None
        n = 2
        while object_id is None:
            if f"{base}-{n}" not in used_ids:
                object_id = f"{base}-{n}"
            n += 1
        name = asset["name"]
        n = 2
        while name in used_names:
            name = f"{asset['name']} ({n})"
            n += 1
        used_ids.add(object_id)
        used_names.add(name)
        revision += 1
        objects.append(
            {
                "id": object_id,
                "name": name,
                "kind": asset["kind"],
                "asset_id": asset["id"],
                "transform": {
                    "position_m": {"x": x, "y": 0.0, "z": z},
                    "rotation_rad": {"order": "XYZ", "x": 0.0, "y": 0.0, "z": 0.0},
                },
                "dimensions": copy.deepcopy(asset["nominal_dimensions"]),
                "parameters": [],
            }
        )
        log.append(
            {
                "type": "object_added",
                "revision": revision,
                "object_id": object_id,
                "asset_id": asset["id"],
                "duplicate_of": None,
            }
        )

    scene["revision"] = revision
    doc["name"] = f"Industrial demo + {count} instances (synthetic benchmark)"
    doc["fixture"] = {
        "kind": "demonstration",
        "note": (
            f"Synthetic benchmark layout (WRL-04): the industrial demonstration plus {count} "
            "catalog instances on an extended floor, generated by "
            "scripts/build_benchmark_scenes.py to measure rendering. Illustrative only - not "
            "verified engineering data or real products, and not checked for clearance."
        ),
    }
    return Project.model_validate(doc)


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 2
    out = Path(argv[0])
    counts = [int(a) for a in argv[1:]] or list(DEFAULT_COUNTS)
    out.mkdir(parents=True, exist_ok=True)
    for count in counts:
        project = build(count)
        path = out / f"industrial-demo-plus-{count}.json"
        path.write_text(project.model_dump_json(indent=2) + "\n")
        print(f"Wrote {path} ({len(project.scene.objects)} objects)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
