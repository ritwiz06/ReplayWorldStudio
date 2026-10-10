"""The committed models, their manifest and the demo fixture agree with each other.

The GLB files are read with a minimal independent parser (not three.js), so the bounds the
catalog records are checked against the bytes themselves.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import struct
from pathlib import Path
from typing import Any

import pytest
from replay_world_contracts import GltfVisual, Project

ROOT = Path(__file__).resolve().parents[1]
MODELS = ROOT / "assets" / "catalog" / "models"
MANIFEST = json.loads((MODELS / "manifest.json").read_text())
DEMO = Project.model_validate_json(
    (ROOT / "fixtures" / "scenes" / "industrial-demo.json").read_text()
)


def read_glb(path: Path) -> dict[str, Any]:
    data = path.read_bytes()
    magic, version, length = struct.unpack_from("<4sII", data, 0)
    assert (magic, version, length) == (b"glTF", 2, len(data))
    chunk_length, chunk_type = struct.unpack_from("<I4s", data, 12)
    assert chunk_type == b"JSON"
    document: dict[str, Any] = json.loads(data[20 : 20 + chunk_length])
    return document


def position_bounds(document: dict[str, Any]) -> tuple[list[float], list[float]]:
    # The builder bakes transforms into vertices, so accessor min/max are model-space bounds.
    assert all("matrix" not in n and "translation" not in n for n in document["nodes"])
    lows, highs = [], []
    for mesh in document["meshes"]:
        for primitive in mesh["primitives"]:
            accessor = document["accessors"][primitive["attributes"]["POSITION"]]
            lows.append(accessor["min"])
            highs.append(accessor["max"])
    return (
        [min(v[i] for v in lows) for i in range(3)],
        [max(v[i] for v in highs) for i in range(3)],
    )


@pytest.mark.parametrize("model", MANIFEST["models"], ids=lambda m: m["key"])
def test_manifest_matches_each_glb(model: dict[str, Any]) -> None:
    path = ROOT / "assets" / "catalog" / model["uri"]
    assert hashlib.sha256(path.read_bytes()).hexdigest() == model["sha256"]
    document = read_glb(path)
    lo, hi = position_bounds(document)
    recorded = model["bounds_m"]
    for i, axis in enumerate("xyz"):
        assert lo[i] == pytest.approx(recorded["min"][axis], abs=1e-6)
        assert hi[i] == pytest.approx(recorded["max"][axis], abs=1e-6)
    assert document["scenes"][0]["extras"]["origin"] == "bottom_centre"
    assert len(document["materials"]) >= 4


def test_demo_catalog_names_the_committed_models() -> None:
    by_uri = {m["uri"]: m for m in MANIFEST["models"]}
    for asset in DEMO.catalog:
        assert isinstance(asset.visual, GltfVisual)
        model = by_uri[asset.visual.uri]
        assert asset.visual.sha256 == model["sha256"]
        assert asset.visual.model_bounds_m.model_dump() == model["bounds_m"]
        assert asset.rights.license == "NOASSERTION"
        assert asset.source.kind == "in_house"


def test_demo_fixture_is_what_the_builder_produces() -> None:
    script = ROOT / "scripts" / "build_demo_fixture.py"
    spec = importlib.util.spec_from_file_location("build_demo_fixture", script)
    assert spec is not None and spec.loader is not None
    builder = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(builder)
    committed = (ROOT / "fixtures" / "scenes" / "industrial-demo.json").read_text()
    assert builder.render() == committed


def test_demo_is_a_coherent_production_area() -> None:
    objects = DEMO.scene.objects
    assert 8 <= len(objects) <= 15
    kinds = [o.kind for o in objects]
    assert kinds.count("equipment") >= 6
    assert "walkway" in kinds
    uses: dict[str, int] = {}
    for o in objects:
        if o.asset_id:
            uses[o.asset_id] = uses.get(o.asset_id, 0) + 1
    assert max(uses.values()) >= 2, "models are reused across instances"
