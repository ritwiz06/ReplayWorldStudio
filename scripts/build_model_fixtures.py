"""Small binary glTF files with known answers, for the model-upload tests (ENR-01).

    uv run python scripts/build_model_fixtures.py          # check the committed files (default)
    uv run python scripts/build_model_fixtures.py --write  # write them

Each file is built from code below, byte for byte the same every time, and is written to
fixtures/models/. The expected bounds are in the comments below and in the tests. They are
synthetic shapes (boxes), not models of any machine.
"""

from __future__ import annotations

import argparse
import json
import math
import struct
import sys
import zlib
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "fixtures" / "models"


def pad(data: bytes, fill: bytes) -> bytes:
    return data + fill * (-len(data) % 4)


def glb(gltf: dict[str, Any], binary: bytes | None) -> bytes:
    text = pad(json.dumps(gltf, separators=(",", ":")).encode(), b" ")
    chunks = struct.pack("<II", len(text), 0x4E4F534A) + text
    if binary is not None:
        data = pad(binary, b"\x00")
        chunks += struct.pack("<II", len(data), 0x004E4942) + data
    return b"glTF" + struct.pack("<II", 2, 12 + len(chunks)) + chunks


def box(
    lo: tuple[float, float, float], hi: tuple[float, float, float]
) -> tuple[list[float], list[int], list[float]]:
    """Eight corners, twelve triangles, and UVs (one per corner)."""
    corners = [(x, y, z) for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    indices = [i for a, b, c, d in faces for i in (a, b, c, a, c, d)]
    uvs = [v for i in range(8) for v in ((i >> 2) & 1, (i >> 1) & 1)]
    return [c for p in corners for c in p], indices, [float(u) for u in uvs]


def mesh_file(
    parts: list[tuple[tuple[float, float, float], tuple[float, float, float]]],
    nodes: list[dict[str, Any]],
    *,
    texture: bytes | None = None,
    extra: dict[str, Any] | None = None,
) -> bytes:
    """One mesh per part (mesh i used by the node that names it), POSITION + indices (+ UVs)."""
    binary = b""
    views: list[dict[str, Any]] = []
    accessors: list[dict[str, Any]] = []
    meshes: list[dict[str, Any]] = []
    for lo, hi in parts:
        positions, indices, uvs = box(lo, hi)
        attributes: dict[str, int] = {}
        for data, kind, count, fmt in (
            (positions, "VEC3", 8, "<24f"),
            (uvs if texture else None, "VEC2", 8, "<16f"),
        ):
            if data is None:
                continue
            raw = struct.pack(fmt, *data)
            views.append({"buffer": 0, "byteOffset": len(binary), "byteLength": len(raw)})
            binary = pad(binary + raw, b"\x00")
            accessor: dict[str, Any] = {
                "bufferView": len(views) - 1,
                "componentType": 5126,
                "count": count,
                "type": kind,
            }
            if kind == "VEC3":
                accessor["min"] = list(lo)
                accessor["max"] = list(hi)
            accessors.append(accessor)
            attributes["POSITION" if kind == "VEC3" else "TEXCOORD_0"] = len(accessors) - 1
        raw = struct.pack(f"<{len(indices)}H", *indices)
        views.append({"buffer": 0, "byteOffset": len(binary), "byteLength": len(raw)})
        binary = pad(binary + raw, b"\x00")
        accessors.append(
            {
                "bufferView": len(views) - 1,
                "componentType": 5123,
                "count": len(indices),
                "type": "SCALAR",
            }
        )
        meshes.append(
            {
                "primitives": [
                    {"attributes": attributes, "indices": len(accessors) - 1, "material": 0}
                ]
            }
        )
    material: dict[str, Any] = {
        "name": "painted steel",
        "pbrMetallicRoughness": {
            "baseColorFactor": [0.42, 0.55, 0.68, 1],
            "metallicFactor": 0.3,
            "roughnessFactor": 0.6,
        },
    }
    gltf: dict[str, Any] = {
        "asset": {"version": "2.0", "generator": "Replay World Studio test fixture"},
        "scene": 0,
    }
    if texture is not None:
        views.append({"buffer": 0, "byteOffset": len(binary), "byteLength": len(texture)})
        binary = pad(binary + texture, b"\x00")
        gltf["images"] = [{"bufferView": len(views) - 1, "mimeType": "image/png"}]
        gltf["textures"] = [{"source": 0}]
        material["pbrMetallicRoughness"] = {
            "baseColorTexture": {"index": 0},
            "metallicFactor": 0,
            "roughnessFactor": 0.8,
        }
    gltf.update(
        {
            "scenes": [{"nodes": [i for i, n in enumerate(nodes) if not n.pop("_child", False)]}],
            "nodes": nodes,
            "meshes": meshes,
            "materials": [material],
            "accessors": accessors,
            "bufferViews": views,
            "buffers": [{"byteLength": len(binary)}],
            **(extra or {}),
        }
    )
    return glb(gltf, binary)


def png(width: int, height: int, colours: list[tuple[int, int, int]]) -> bytes:
    rows = b"".join(
        b"\x00" + bytes(c for x in range(width) for c in colours[(x + y) % len(colours)])
        for y in range(height)
    )

    def chunk(kind: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
        )

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(rows, 9))
        + chunk(b"IEND", b"")
    )


def files() -> dict[str, bytes]:
    half = math.sqrt(0.5)
    out = {
        # Known bounds (file units): (2, 0, 3) to (3, 1.5, 4); the origin is far from the model.
        "off-centre.glb": mesh_file([((2, 0, 3), (3, 1.5, 4))], [{"mesh": 0}]),
        # A root node (translated +1 x, turned +90 degrees about +Y, scaled 2) with a child
        # (raised 0.5) holding a box x 0..1, y -0.5..0.5, z -0.5..0.5. Exact bounds: (0, 0, -2)
        # to (2, 2, 0). The accessor min/max describe only the untransformed box.
        "nested.glb": mesh_file(
            [((0, -0.5, -0.5), (1, 0.5, 0.5))],
            [
                {
                    "translation": [1, 0, 0],
                    "rotation": [0, half, 0, half],
                    "scale": [2, 2, 2],
                    "children": [1],
                },
                {"translation": [0, 0.5, 0], "mesh": 0, "_child": True},
            ],
        ),
        # A textured box (a 4 x 4 embedded PNG): (-0.5, 0, -0.5) to (0.5, 1, 0.5).
        "textured.glb": mesh_file(
            [((-0.5, 0, -0.5), (0.5, 1, 0.5))],
            [{"mesh": 0}],
            texture=png(4, 4, [(230, 180, 40), (40, 40, 48)]),
        ),
        # Tall and thin: 0.4 x 2.5 x 0.4 m, nothing like a machine's envelope.
        "tall-thin.glb": mesh_file([((-0.2, 0, -0.2), (0.2, 2.5, 0.2))], [{"mesh": 0}]),
        # Authored with +Z up: 1.2 x 0.8 x 2.0 (x, y, z); upright it is 2.0 m high.
        "z-up.glb": mesh_file([((-0.6, -0.4, 0), (0.6, 0.4, 2.0))], [{"mesh": 0}]),
        # Exported in millimetres: 1200 x 1000 x 800 units.
        "millimetres.glb": mesh_file([((-600, 0, -400), (600, 1000, 400))], [{"mesh": 0}]),
        # Requires Draco compression: refused, with the reason.
        "draco-required.glb": mesh_file(
            [((-0.5, 0, -0.5), (0.5, 1, 0.5))],
            [{"mesh": 0}],
            extra={
                "extensionsUsed": ["KHR_draco_mesh_compression"],
                "extensionsRequired": ["KHR_draco_mesh_compression"],
            },
        ),
        # Skinned: refused (a static pose would be misleading).
        "skinned.glb": mesh_file(
            [((-0.5, 0, -0.5), (0.5, 1, 0.5))],
            [{"mesh": 0, "skin": 0}],
            extra={"skins": [{"joints": [0]}]},
        ),
    }
    # Refers to an external buffer file: refused, nothing fetched.
    out["external-buffer.glb"] = glb(
        {
            "asset": {"version": "2.0"},
            "scenes": [{"nodes": [0]}],
            "nodes": [{"mesh": 0}],
            "meshes": [{"primitives": [{"attributes": {"POSITION": 0}}]}],
            "accessors": [{"bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3"}],
            "bufferViews": [{"buffer": 0, "byteLength": 36}],
            "buffers": [{"uri": "machine.bin", "byteLength": 36}],
        },
        None,
    )
    # Malformed: an accessor longer than its buffer view.
    good = mesh_file([((-0.5, 0, -0.5), (0.5, 1, 0.5))], [{"mesh": 0}])
    length = struct.unpack("<I", good[12:16])[0]
    gltf = json.loads(good[20 : 20 + length])
    gltf["accessors"][0]["count"] = 800
    binary_at = 20 + length
    binary = good[binary_at + 8 :]
    out["malformed.glb"] = glb(gltf, binary)
    return out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true", help="write the files (default: check)")
    args = parser.parse_args()
    stale = []
    for name, data in files().items():
        path = OUT / name
        if args.write:
            OUT.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        elif not path.is_file() or path.read_bytes() != data:
            stale.append(name)
    if stale:
        sys.exit(f"Model fixtures differ from their build: {', '.join(stale)}. Run with --write.")
    print("Model fixtures written." if args.write else "Model fixtures are up to date.")


if __name__ == "__main__":
    main()
