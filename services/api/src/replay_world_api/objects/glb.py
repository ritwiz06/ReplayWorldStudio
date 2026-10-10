"""A minimal, deterministic binary glTF 2.0 (.glb) writer, and an independent reader.

The writer emits one node, mesh and material per material group, each with a single indexed
TRIANGLES primitive (POSITION and NORMAL). Everything is baked into the vertices: nodes carry
no transforms, so the POSITION accessors' min/max are the model's bounds. The output depends
only on its input: JSON keys keep insertion order, separators are fixed and no timestamp or
random value is written, so identical input gives identical bytes (and sha256).

The reader does not share code with the writer. It checks the container layout and refuses
anything a generated model never contains - external or embedded files, textures,
extensions, animations, skins, node transforms, non-triangle primitives - and recomputes the
bounds from the vertex data to confirm the recorded min/max.
"""

from __future__ import annotations

import json
import struct
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Final

from replay_world_contracts import GENERATOR_VERSION

from .materials import MATERIALS, MaterialSpec
from .mesh import Mesh, Point

MAGIC: Final = b"glTF"
JSON_CHUNK: Final = b"JSON"
BIN_CHUNK: Final = b"BIN\x00"

FLOAT: Final = 5126
UNSIGNED_BYTE: Final = 5121
UNSIGNED_SHORT: Final = 5123
UNSIGNED_INT: Final = 5125
ARRAY_BUFFER: Final = 34962
ELEMENT_ARRAY_BUFFER: Final = 34963
TRIANGLES: Final = 4

SCENE_EXTRAS: Final[dict[str, str]] = {
    "units": "metres",
    "up_axis": "+Y",
    "front_axis": "+Z",
    "origin": "bottom_centre",
    "generator": GENERATOR_VERSION,
}

# Never part of a generated model; the reader refuses a file that has any of them.
_FORBIDDEN_TOP_LEVEL: Final = (
    "images",
    "textures",
    "samplers",
    "animations",
    "skins",
    "cameras",
    "extensions",
    "extensionsUsed",
    "extensionsRequired",
)
_NODE_TRANSFORMS: Final = ("matrix", "translation", "rotation", "scale")
_INDEX_FORMATS: Final = {UNSIGNED_BYTE: "B", UNSIGNED_SHORT: "H", UNSIGNED_INT: "I"}


class GeneratorError(ValueError):
    """Base of every object-generator failure the caller should report as a bad request:
    a limit exceeded, a model that fails verification, or a storage conflict."""


class GlbError(GeneratorError):
    """The bytes are not a GLB this project writes (or the input cannot be written as one)."""


def srgb_to_linear(hex_colour: str) -> tuple[float, float, float]:
    """Convert '#rrggbb' to linear RGB with the standard sRGB transfer function."""
    if len(hex_colour) != 7 or not hex_colour.startswith("#"):
        raise GlbError(f"colour '{hex_colour}' is not '#rrggbb'")
    channels = (int(hex_colour[i : i + 2], 16) / 255 for i in (1, 3, 5))
    r, g, b = (c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in channels)
    return (r, g, b)


def _r6(value: float) -> float:
    return round(value, 6) + 0.0


def _material(name: str, spec: MaterialSpec) -> dict[str, Any]:
    alpha = 1.0 if spec.opacity is None else spec.opacity
    material: dict[str, Any] = {
        "name": name,
        "pbrMetallicRoughness": {
            "baseColorFactor": [*(_r6(c) for c in srgb_to_linear(spec.color_srgb)), alpha],
            "metallicFactor": spec.metalness,
            "roughnessFactor": spec.roughness,
        },
    }
    if spec.emissive_srgb is not None:
        material["emissiveFactor"] = [
            min(1.0, _r6(c * spec.emissive_intensity)) for c in srgb_to_linear(spec.emissive_srgb)
        ]
    if spec.opacity is not None:
        material["alphaMode"] = "BLEND"
    material["doubleSided"] = False
    return material


def _pad(data: bytes | bytearray, filler: bytes) -> bytes:
    return bytes(data) + filler * (-len(data) % 4)


def write_glb(groups: Sequence[tuple[str, Mesh]], scene_name: str = "generated") -> bytes:
    """Write one node/mesh/material per ``(material key, mesh)`` group, in the given order."""
    if not groups:
        raise GlbError("a model needs at least one mesh")
    binary = bytearray()
    views: list[dict[str, Any]] = []
    accessors: list[dict[str, Any]] = []

    def view(data: bytes, target: int) -> int:
        views.append(
            {"buffer": 0, "byteOffset": len(binary), "byteLength": len(data), "target": target}
        )
        binary.extend(_pad(data, b"\x00"))  # every view starts 4-byte aligned
        return len(views) - 1

    def accessor(spec: dict[str, Any]) -> int:
        accessors.append(spec)
        return len(accessors) - 1

    nodes: list[dict[str, Any]] = []
    meshes: list[dict[str, Any]] = []
    materials: list[dict[str, Any]] = []
    for index, (name, mesh) in enumerate(groups):
        spec = MATERIALS.get(name)
        if spec is None:
            raise GlbError(f"unknown material '{name}'")
        count = len(mesh.positions)
        if count == 0 or not mesh.indices or len(mesh.indices) % 3:
            raise GlbError(f"the '{name}' mesh has no complete triangles")
        positions = struct.pack(f"<{3 * count}f", *(c for p in mesh.positions for c in p))
        # min/max must describe the float32 values actually stored, not the float64 input.
        stored = struct.unpack(f"<{3 * count}f", positions)
        position = accessor(
            {
                "bufferView": view(positions, ARRAY_BUFFER),
                "componentType": FLOAT,
                "count": count,
                "type": "VEC3",
                "min": [min(stored[k::3]) for k in range(3)],
                "max": [max(stored[k::3]) for k in range(3)],
            }
        )
        normals = struct.pack(f"<{3 * count}f", *(c for n in mesh.normals for c in n))
        normal = accessor(
            {
                "bufferView": view(normals, ARRAY_BUFFER),
                "componentType": FLOAT,
                "count": count,
                "type": "VEC3",
            }
        )
        # 65535 is reserved (primitive restart), so 16-bit indices serve up to 65535 vertices.
        component, fmt = (UNSIGNED_SHORT, "H") if count < 65536 else (UNSIGNED_INT, "I")
        indices = accessor(
            {
                "bufferView": view(
                    struct.pack(f"<{len(mesh.indices)}{fmt}", *mesh.indices),
                    ELEMENT_ARRAY_BUFFER,
                ),
                "componentType": component,
                "count": len(mesh.indices),
                "type": "SCALAR",
            }
        )
        materials.append(_material(name, spec))
        meshes.append(
            {
                "name": name,
                "primitives": [
                    {
                        "attributes": {"POSITION": position, "NORMAL": normal},
                        "indices": indices,
                        "material": index,
                        "mode": TRIANGLES,
                    }
                ],
            }
        )
        nodes.append({"name": name, "mesh": index})

    document = {
        "asset": {"version": "2.0", "generator": GENERATOR_VERSION},
        "scene": 0,
        "scenes": [{"name": scene_name, "nodes": list(range(len(nodes))), "extras": SCENE_EXTRAS}],
        "nodes": nodes,
        "meshes": meshes,
        "materials": materials,
        "accessors": accessors,
        "bufferViews": views,
        "buffers": [{"byteLength": len(binary)}],
    }
    text = json.dumps(document, separators=(",", ":"), allow_nan=False).encode("utf-8")
    json_chunk = _pad(text, b" ")
    bin_chunk = _pad(binary, b"\x00")
    total = 12 + 8 + len(json_chunk) + 8 + len(bin_chunk)
    return b"".join(
        (
            struct.pack("<4sII", MAGIC, 2, total),
            struct.pack("<I4s", len(json_chunk), JSON_CHUNK),
            json_chunk,
            struct.pack("<I4s", len(bin_chunk), BIN_CHUNK),
            bin_chunk,
        )
    )


@dataclass(frozen=True)
class GlbSummary:
    """What :func:`read_glb` established about a file."""

    min: Point
    max: Point
    triangles: int
    vertices: int
    materials: tuple[str, ...]
    generator: str


def _items(document: dict[str, Any], key: str) -> list[Any]:
    value = document.get(key, [])
    if not isinstance(value, list):
        raise GlbError(f"'{key}' is not a list")
    return value


def _object(items: list[Any], index: Any, what: str) -> dict[str, Any]:
    if not isinstance(index, int) or isinstance(index, bool) or not 0 <= index < len(items):
        raise GlbError(f"{what} index {index!r} does not exist")
    item = items[index]
    if not isinstance(item, dict):
        raise GlbError(f"{what} {index} is not an object")
    return item


def _count(value: Any, what: str, minimum: int = 0) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < minimum:
        raise GlbError(f"{what} must be an integer >= {minimum}, not {value!r}")
    return value


def _vec3(value: Any, what: str) -> tuple[float, float, float]:
    if (
        not isinstance(value, list)
        or len(value) != 3
        or not all(isinstance(v, int | float) and not isinstance(v, bool) for v in value)
    ):
        raise GlbError(f"{what} must be three numbers")
    return (float(value[0]), float(value[1]), float(value[2]))


def _refuse_keys(node: Any, path: str) -> None:
    """Refuse file references and extensions anywhere, and texture slots (there are no
    textures). ``extras`` is free-form application data and is not inspected."""
    if isinstance(node, dict):
        for key, value in node.items():
            if key in ("uri", "extensions") or key.endswith("Texture"):
                raise GlbError(f"'{key}' at {path or 'the top level'} is not allowed")
            if key != "extras":
                _refuse_keys(value, f"{path}/{key}")
    elif isinstance(node, list):
        for i, value in enumerate(node):
            _refuse_keys(value, f"{path}/{i}")


def _chunks(data: bytes) -> tuple[bytes, bytes]:
    if len(data) < 12:
        raise GlbError("too short to be a GLB file")
    magic, version, length = struct.unpack_from("<4sII", data, 0)
    if magic != MAGIC:
        raise GlbError("not a GLB file (bad magic)")
    if version != 2:
        raise GlbError(f"GLB version {version} is not 2")
    if length != len(data):
        raise GlbError(f"header says {length} bytes but the file has {len(data)}")
    chunks: list[tuple[bytes, bytes]] = []
    offset = 12
    while offset < len(data):
        if offset + 8 > len(data):
            raise GlbError("truncated chunk header")
        size, kind = struct.unpack_from("<I4s", data, offset)
        start, end = offset + 8, offset + 8 + size
        if size % 4 or end > len(data):
            raise GlbError(f"chunk at byte {offset} is misaligned or runs past the end")
        chunks.append((kind, data[start:end]))
        offset = end
    kinds = [kind for kind, _ in chunks]
    if kinds not in ([JSON_CHUNK], [JSON_CHUNK, BIN_CHUNK]):
        raise GlbError(f"expected a JSON chunk and at most one BIN chunk, found {kinds}")
    return chunks[0][1], chunks[1][1] if len(chunks) == 2 else b""


def _accessor_values(
    document: dict[str, Any],
    binary: bytes,
    buffer_length: int,
    index: Any,
    kind: str,
    formats: dict[int, str],
) -> tuple[dict[str, Any], tuple[Any, ...]]:
    """Decode a tightly packed accessor of ``kind`` ('VEC3' or 'SCALAR')."""
    accessor = _object(_items(document, "accessors"), index, "accessor")
    if "sparse" in accessor:
        raise GlbError(f"accessor {index} is sparse")
    if accessor.get("type") != kind:
        raise GlbError(f"accessor {index} is {accessor.get('type')!r}, expected {kind}")
    fmt = formats.get(accessor.get("componentType", -1))
    if fmt is None:
        raise GlbError(f"accessor {index} has an unexpected component type")
    count = _count(accessor.get("count"), f"accessor {index} count", 1)
    view = _object(_items(document, "bufferViews"), accessor.get("bufferView"), "bufferView")
    if view.get("buffer") != 0:
        raise GlbError(f"accessor {index} does not read the GLB's own buffer")
    components = 3 if kind == "VEC3" else 1
    element = components * struct.calcsize(f"<{fmt}")
    if view.get("byteStride", element) != element:
        raise GlbError(f"accessor {index} is interleaved")
    view_start = _count(view.get("byteOffset", 0), "bufferView byteOffset")
    view_end = view_start + _count(view.get("byteLength"), "bufferView byteLength", 1)
    start = view_start + _count(accessor.get("byteOffset", 0), "accessor byteOffset")
    end = start + count * element
    if view_end > buffer_length or end > view_end:
        raise GlbError(f"accessor {index} reads past the end of its data")
    return accessor, struct.unpack_from(f"<{count * components}{fmt}", binary, start)


def read_glb(data: bytes) -> GlbSummary:
    """Verify ``data`` is a self-contained triangle-mesh GLB and summarise it.

    Raises :class:`GlbError` for anything else.
    """
    text, binary = _chunks(data)
    try:
        document = json.loads(text.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise GlbError(f"the JSON chunk is not valid JSON: {exc}") from exc
    if not isinstance(document, dict):
        raise GlbError("the JSON chunk is not an object")
    asset = document.get("asset")
    if not isinstance(asset, dict) or asset.get("version") != "2.0":
        raise GlbError("asset.version must be '2.0'")
    for key in _FORBIDDEN_TOP_LEVEL:
        if key in document:
            raise GlbError(f"a generated model has no '{key}'")
    _refuse_keys(document, "")

    buffers = _items(document, "buffers")
    if len(buffers) > 1:
        raise GlbError("only the GLB's own binary buffer is allowed")
    buffer_length = 0
    if buffers:
        buffer = _object(buffers, 0, "buffer")
        buffer_length = _count(buffer.get("byteLength"), "buffer byteLength", 1)
        if not buffer_length <= len(binary) < buffer_length + 4:
            raise GlbError("buffer byteLength does not match the BIN chunk")

    for i, node in enumerate(_items(document, "nodes")):
        if not isinstance(node, dict) or any(key in node for key in _NODE_TRANSFORMS):
            raise GlbError(f"node {i} has a transform; generated models bake them in")

    lows: list[tuple[float, float, float]] = []
    highs: list[tuple[float, float, float]] = []
    triangles = vertices = 0
    float_vec = {FLOAT: "f"}
    for m, mesh in enumerate(_items(document, "meshes")):
        primitives = mesh.get("primitives") if isinstance(mesh, dict) else None
        if not isinstance(primitives, list) or not primitives:
            raise GlbError(f"mesh {m} has no primitives")
        for primitive in primitives:
            if not isinstance(primitive, dict) or primitive.get("mode", TRIANGLES) != TRIANGLES:
                raise GlbError(f"mesh {m} has a primitive that is not TRIANGLES")
            attributes = primitive.get("attributes")
            if not isinstance(attributes, dict) or "POSITION" not in attributes:
                raise GlbError(f"mesh {m} has a primitive without POSITION")
            accessor, values = _accessor_values(
                document, binary, buffer_length, attributes["POSITION"], "VEC3", float_vec
            )
            count = len(values) // 3
            low = _vec3(accessor.get("min"), "POSITION min")
            high = _vec3(accessor.get("max"), "POSITION max")
            actual_low = tuple(min(values[k::3]) for k in range(3))
            actual_high = tuple(max(values[k::3]) for k in range(3))
            if low != actual_low or high != actual_high:
                raise GlbError(f"mesh {m}: POSITION min/max do not match the vertex data")
            lows.append(low)
            highs.append(high)
            if "NORMAL" in attributes:
                _, normals = _accessor_values(
                    document, binary, buffer_length, attributes["NORMAL"], "VEC3", float_vec
                )
                if len(normals) != len(values):
                    raise GlbError(f"mesh {m}: NORMAL and POSITION counts differ")
            if "indices" in primitive:
                _, indices = _accessor_values(
                    document, binary, buffer_length, primitive["indices"], "SCALAR", _INDEX_FORMATS
                )
                if len(indices) % 3 or max(indices) >= count:
                    raise GlbError(f"mesh {m}: indices are not whole triangles of its vertices")
                triangles += len(indices) // 3
            else:
                if count % 3:
                    raise GlbError(f"mesh {m}: vertex count is not whole triangles")
                triangles += count // 3
            vertices += count
    if not lows:
        raise GlbError("the file has no geometry")

    names = []
    for i, material in enumerate(_items(document, "materials")):
        name = material.get("name") if isinstance(material, dict) else None
        if not isinstance(name, str) or not name:
            raise GlbError(f"material {i} has no name")
        names.append(name)
    generator = asset.get("generator")
    return GlbSummary(
        min=(min(v[0] for v in lows), min(v[1] for v in lows), min(v[2] for v in lows)),
        max=(max(v[0] for v in highs), max(v[1] for v in highs), max(v[2] for v in highs)),
        triangles=triangles,
        vertices=vertices,
        materials=tuple(names),
        generator=generator if isinstance(generator, str) else "",
    )
