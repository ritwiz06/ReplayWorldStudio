"""Uploaded binary glTF models (0.15.0, ENR-01's GLB part): inspect, store, and describe.

A person attaches a .glb to make an existing object easier to recognise. Before anything renders
it, this module reads the container itself (never the filename) and accepts a bounded subset of
glTF 2.0 (https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html):

* one self-contained binary file: buffers and images live in its BIN chunk; any ``uri`` (an
  external file, or data embedded as text) is refused, so nothing is ever fetched;
* static triangle meshes with materials and embedded PNG or JPEG textures;
* material extensions the browser's loader draws, and ``KHR_texture_transform``; any other
  required extension, and compressed geometry or textures, are refused with the reason;
* skins and morph targets are refused (a deformed model would be drawn in a misleading pose);
  animations are not played, and cameras and lights are ignored - each is said in the notes;
* names, extras and other metadata are data: they are never interpreted.

Limits, checked before the vertex data is read: the file size, the JSON chunk, nodes, node
depth, meshes, primitives, vertices, triangles, materials and images, and each image's decoded
size (read from its PNG or JPEG header, without decoding it).

The bounds are exact: every vertex of the default scene, through every node's complete
transform. They are the model's geometry, never a measurement of a machine.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import struct
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final

from replay_world_contracts import (
    MODEL_UNITS,
    UPLOADED_MODEL_PREFIX,
    CatalogAsset,
    UploadedAssetRequest,
    UploadedModelReport,
    corrected_point,
)

MAX_BYTES: Final = 25 * 1024 * 1024
MAX_JSON_BYTES: Final = 4 * 1024 * 1024
MAX_NODES: Final = 4000
MAX_DEPTH: Final = 32
MAX_MESHES: Final = 2000
MAX_PRIMITIVES: Final = 4000
MAX_VERTICES: Final = 500_000
MAX_TRIANGLES: Final = 1_000_000
MAX_MATERIALS: Final = 512
MAX_IMAGES: Final = 32
MAX_IMAGE_SIDE: Final = 4096
MAX_TEXTURE_PIXELS: Final = 32 * 1024 * 1024

#: Extensions the browser's glTF loader draws without extra decoders; geometry stays static.
READABLE_EXTENSIONS: Final = frozenset(
    {
        "KHR_materials_clearcoat",
        "KHR_materials_emissive_strength",
        "KHR_materials_ior",
        "KHR_materials_iridescence",
        "KHR_materials_sheen",
        "KHR_materials_specular",
        "KHR_materials_transmission",
        "KHR_materials_unlit",
        "KHR_materials_volume",
        "KHR_texture_transform",
        "KHR_lights_punctual",
    }
)
#: Compressed or quantized content needs decoders this app does not ship.
COMPRESSED: Final = {
    "KHR_draco_mesh_compression": "Draco-compressed geometry",
    "EXT_meshopt_compression": "meshopt-compressed geometry",
    "KHR_mesh_quantization": "quantized geometry",
    "KHR_texture_basisu": "Basis Universal (KTX2) textures",
    "EXT_texture_webp": "WebP textures",
    "EXT_texture_avif": "AVIF textures",
}

_FLOAT: Final = 5126
_INDEX_SIZE: Final = {5121: 1, 5123: 2, 5125: 4}
_COMPONENTS: Final = {
    "SCALAR": 1,
    "VEC2": 2,
    "VEC3": 3,
    "VEC4": 4,
    "MAT2": 4,
    "MAT3": 9,
    "MAT4": 16,
}
_COMPONENT_SIZE: Final = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}


@dataclass(frozen=True)
class UploadError(Exception):
    """The file cannot be used; ``message`` says why, for the person."""

    kind: str
    message: str

    def __str__(self) -> str:
        return self.message


def _refuse(kind: str, message: str) -> UploadError:
    return UploadError(kind, message)


Matrix = tuple[float, ...]  # 4x4, column-major as glTF writes it

_IDENTITY: Final[Matrix] = (1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)


def _multiply(a: Matrix, b: Matrix) -> Matrix:
    out = [0.0] * 16
    for col in range(4):
        for row in range(4):
            out[col * 4 + row] = sum(a[k * 4 + row] * b[col * 4 + k] for k in range(4))
    return tuple(out)


def _numbers(value: Any, count: int, where: str) -> list[float]:
    if (
        not isinstance(value, list)
        or len(value) != count
        or not all(isinstance(v, (int, float)) and math.isfinite(v) for v in value)
    ):
        raise _refuse("malformed", f"{where} must be {count} finite numbers.")
    return [float(v) for v in value]


def _node_matrix(node: dict[str, Any], index: int) -> Matrix:
    """A node's local transform: its ``matrix``, or translation x rotation x scale."""
    if "matrix" in node:
        return tuple(_numbers(node["matrix"], 16, f"Node {index}'s matrix"))
    t = _numbers(node.get("translation", [0, 0, 0]), 3, f"Node {index}'s translation")
    x, y, z, w = _numbers(node.get("rotation", [0, 0, 0, 1]), 4, f"Node {index}'s rotation")
    s = _numbers(node.get("scale", [1, 1, 1]), 3, f"Node {index}'s scale")
    norm = math.sqrt(x * x + y * y + z * z + w * w)
    if norm < 1e-9:
        raise _refuse("malformed", f"Node {index}'s rotation is not a unit quaternion.")
    x, y, z, w = x / norm, y / norm, z / norm, w / norm
    r = (
        1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w),
        2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
        2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y),
    )  # fmt: skip
    return (
        r[0] * s[0], r[1] * s[0], r[2] * s[0], 0.0,
        r[3] * s[1], r[4] * s[1], r[5] * s[1], 0.0,
        r[6] * s[2], r[7] * s[2], r[8] * s[2], 0.0,
        t[0], t[1], t[2], 1.0,
    )  # fmt: skip


def _image_size(data: bytes, mime: str, index: int) -> tuple[int, int]:
    """Width and height from a PNG or JPEG header, without decoding the image."""
    if mime == "image/png":
        if len(data) < 24 or data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
            raise _refuse("malformed", f"Image {index} is not a valid PNG.")
        width, height = struct.unpack(">II", data[16:24])
        return int(width), int(height)
    if mime == "image/jpeg":
        if data[:2] != b"\xff\xd8":
            raise _refuse("malformed", f"Image {index} is not a valid JPEG.")
        at = 2
        while at + 9 < len(data):
            if data[at] != 0xFF:
                at += 1
                continue
            marker = data[at + 1]
            if marker in (
                0xC0,
                0xC1,
                0xC2,
                0xC3,
                0xC5,
                0xC6,
                0xC7,
                0xC9,
                0xCA,
                0xCB,
                0xCD,
                0xCE,
                0xCF,
            ):
                height, width = struct.unpack(">HH", data[at + 5 : at + 9])
                return int(width), int(height)
            length = struct.unpack(">H", data[at + 2 : at + 4])[0]
            at += 2 + length
        raise _refuse("malformed", f"Image {index} has no JPEG size marker.")
    raise _refuse(
        "unsupported",
        f"Image {index} is {mime or 'of no stated type'}; only embedded PNG and JPEG textures "
        "are read.",
    )


@dataclass
class _Glb:
    gltf: dict[str, Any]
    bin: bytes


def _chunks(data: bytes) -> _Glb:
    if len(data) > MAX_BYTES:
        raise _refuse("too_large", f"The file is larger than {MAX_BYTES // 1048576} MB.")
    if len(data) < 20 or data[:4] != b"glTF":
        raise _refuse(
            "not_glb",
            "This is not a binary glTF (.glb) file: its content does not start with the glTF "
            "header, whatever its name. Export the model as .glb (glTF 2.0, binary).",
        )
    version, length = struct.unpack("<II", data[4:12])
    if version != 2:
        raise _refuse("unsupported", f"This is glTF version {version}; only glTF 2.0 is read.")
    if length != len(data):
        raise _refuse("malformed", "The file's recorded length does not match its size.")
    json_length, json_type = struct.unpack("<II", data[12:20])
    if json_type != 0x4E4F534A or 20 + json_length > len(data):
        raise _refuse("malformed", "The file's first chunk is not its JSON description.")
    if json_length > MAX_JSON_BYTES:
        raise _refuse("too_large", "The model's description is larger than 4 MB.")
    try:
        gltf = json.loads(data[20 : 20 + json_length].decode("utf-8"))
    except UnicodeDecodeError, json.JSONDecodeError:
        raise _refuse("malformed", "The model's JSON description cannot be read.") from None
    if not isinstance(gltf, dict):
        raise _refuse("malformed", "The model's JSON description is not an object.")
    binary = b""
    at = 20 + json_length
    if at + 8 <= len(data):
        chunk_length, chunk_type = struct.unpack("<II", data[at : at + 8])
        if chunk_type == 0x004E4942:
            if at + 8 + chunk_length > len(data):
                raise _refuse("malformed", "The file's binary chunk runs past its end.")
            binary = data[at + 8 : at + 8 + chunk_length]
    return _Glb(gltf, binary)


def _list(gltf: dict[str, Any], key: str) -> list[dict[str, Any]]:
    value = gltf.get(key, [])
    if not isinstance(value, list) or not all(isinstance(v, dict) for v in value):
        raise _refuse("malformed", f"'{key}' in the model's description is not a list of objects.")
    return value


def _index(value: Any, size: int, where: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or not 0 <= value < size:
        raise _refuse("malformed", f"{where} refers to something that does not exist.")
    return value


class _Reader:
    """Byte ranges of buffer views and accessors, each checked against the BIN chunk."""

    def __init__(self, glb: _Glb) -> None:
        gltf = glb.gltf
        buffers = _list(gltf, "buffers")
        for i, buffer in enumerate(buffers):
            uri = buffer.get("uri")
            if isinstance(uri, str):
                if uri.startswith("data:"):
                    raise _refuse(
                        "external",
                        f"Buffer {i} is embedded as text (a data URI). Export a binary .glb, "
                        "which keeps its data in the file's binary chunk.",
                    )
                raise _refuse(
                    "external",
                    f"The model refers to an external file ('{uri[:80]}'). Nothing is fetched from "
                    "outside the file: export a self-contained .glb with everything embedded.",
                )
        if len(buffers) > 1:
            raise _refuse("unsupported", "The model has more than one buffer; a .glb has one.")
        if buffers and int(buffers[0].get("byteLength", -1)) > len(glb.bin):
            raise _refuse("malformed", "The buffer is longer than the file's binary chunk.")
        self.bin = glb.bin
        self.views = _list(gltf, "bufferViews")
        self.accessors = _list(gltf, "accessors")
        for i, view in enumerate(self.views):
            _index(view.get("buffer"), len(buffers), f"Buffer view {i}")
            offset, length = int(view.get("byteOffset", 0)), int(view.get("byteLength", -1))
            if offset < 0 or length < 0 or offset + length > len(self.bin):
                raise _refuse("malformed", f"Buffer view {i} runs outside the file's data.")

    def view(self, index: Any, where: str) -> tuple[int, int, int | None]:
        view = self.views[_index(index, len(self.views), where)]
        stride = view.get("byteStride")
        return int(view.get("byteOffset", 0)), int(view["byteLength"]), stride

    def accessor(self, index: Any, where: str) -> dict[str, Any]:
        accessor = self.accessors[_index(index, len(self.accessors), where)]
        if "sparse" in accessor:
            raise _refuse("unsupported", f"{where} uses a sparse accessor, which is not read.")
        count = accessor.get("count")
        if not isinstance(count, int) or count < 1:
            raise _refuse("malformed", f"{where} has no elements.")
        if "bufferView" not in accessor:
            raise _refuse(
                "unsupported", f"{where} has no data (an accessor without a buffer view)."
            )
        components = _COMPONENTS.get(str(accessor.get("type")))
        size = _COMPONENT_SIZE.get(int(accessor.get("componentType", 0)))
        if components is None or size is None:
            raise _refuse("malformed", f"{where} has an unknown type.")
        offset, length, stride = self.view(accessor["bufferView"], where)
        element = components * size
        step = int(stride) if stride else element
        start = offset + int(accessor.get("byteOffset", 0))
        if step < element or start + step * (count - 1) + element > offset + length:
            raise _refuse("malformed", f"{where} runs outside its buffer view.")
        return {**accessor, "_start": start, "_step": step}

    def positions(self, index: Any, where: str) -> list[tuple[float, float, float]]:
        accessor = self.accessor(index, where)
        if accessor.get("componentType") != _FLOAT or accessor.get("type") != "VEC3":
            raise _refuse(
                "unsupported",
                f"{where} positions are not 32-bit floats (quantized geometry is not read).",
            )
        start, step, count = accessor["_start"], accessor["_step"], accessor["count"]
        unpack = struct.Struct("<3f").unpack_from
        points = [unpack(self.bin, start + i * step) for i in range(count)]
        if not all(math.isfinite(c) for p in points for c in p):
            raise _refuse("malformed", f"{where} has a position that is not a finite number.")
        return points


def inspect_glb(data: bytes, filename: str) -> UploadedModelReport:
    """Check ``data`` against the supported subset and measure it. Raises :class:`UploadError`."""
    glb = _chunks(data)
    gltf = glb.gltf
    asset = gltf.get("asset")
    if not isinstance(asset, dict) or not str(asset.get("version", "")).startswith("2."):
        raise _refuse("unsupported", "The file does not declare glTF version 2.0.")
    used = [str(e) for e in gltf.get("extensionsUsed", []) if isinstance(e, str)]
    required = [str(e) for e in gltf.get("extensionsRequired", []) if isinstance(e, str)]
    for name in sorted({*used, *required}):
        if name in COMPRESSED:
            raise _refuse(
                "unsupported",
                f"The model uses {COMPRESSED[name]} ({name}), which this app does not decode. "
                "Export it again without compression.",
            )
    for name in required:
        if name not in READABLE_EXTENSIONS:
            raise _refuse(
                "unsupported",
                f"The model requires the extension {name}, which this app does not read, so it "
                "would not be drawn as authored.",
            )
    notes = [
        f"Extension {name} is not read and is ignored."
        for name in used
        if name not in READABLE_EXTENSIONS
    ]
    if _list(gltf, "skins"):
        raise _refuse(
            "unsupported",
            "The model is skinned (a rigged character or mechanism); a static pose would be "
            "misleading, so skinned models are not used.",
        )
    meshes = _list(gltf, "meshes")
    nodes = _list(gltf, "nodes")
    materials = _list(gltf, "materials")
    images = _list(gltf, "images")
    textures = _list(gltf, "textures")
    if len(nodes) > MAX_NODES:
        raise _refuse("too_large", f"The model has {len(nodes)} nodes; the limit is {MAX_NODES}.")
    if len(meshes) > MAX_MESHES:
        raise _refuse(
            "too_large", f"The model has {len(meshes)} meshes; the limit is {MAX_MESHES}."
        )
    if len(materials) > MAX_MATERIALS:
        raise _refuse(
            "too_large", f"The model has {len(materials)} materials; the limit is {MAX_MATERIALS}."
        )
    if len(images) > MAX_IMAGES:
        raise _refuse(
            "too_large", f"The model has {len(images)} images; the limit is {MAX_IMAGES}."
        )
    if any("skin" in n for n in nodes):
        raise _refuse("unsupported", "A node of the model is skinned; skinned models are not used.")
    for i, mesh in enumerate(meshes):
        if "weights" in mesh or any("targets" in p for p in mesh.get("primitives", [])):
            raise _refuse(
                "unsupported",
                f"Mesh {i} has morph targets (shapes that blend); a fixed blend would be "
                "misleading, so morphing models are not used.",
            )
    reader = _Reader(glb)

    pixels = 0
    for i, image in enumerate(images):
        if "uri" in image:
            uri = str(image["uri"])
            raise _refuse(
                "external",
                f"Image {i} is "
                + (
                    "embedded as text (a data URI)"
                    if uri.startswith("data:")
                    else f"an external file ('{uri[:80]}')"
                )
                + ". Nothing is fetched from outside the file: export a .glb with its textures "
                "embedded.",
            )
        offset, length, _ = reader.view(image.get("bufferView"), f"Image {i}")
        width, height = _image_size(
            reader.bin[offset : offset + length], str(image.get("mimeType", "")), i
        )
        if width < 1 or height < 1 or width > MAX_IMAGE_SIDE or height > MAX_IMAGE_SIDE:
            raise _refuse(
                "too_large",
                f"Image {i} is {width} x {height} pixels; each side must be 1 to {MAX_IMAGE_SIDE}.",
            )
        pixels += width * height
    if pixels > MAX_TEXTURE_PIXELS:
        raise _refuse(
            "too_large",
            f"The textures decode to {pixels:,} pixels; the limit is {MAX_TEXTURE_PIXELS:,}.",
        )
    for i, texture in enumerate(textures):
        if "source" in texture:
            _index(texture["source"], len(images), f"Texture {i}")

    scenes = _list(gltf, "scenes")
    if scenes:
        scene = scenes[_index(gltf.get("scene", 0), len(scenes), "The default scene")]
        roots = scene.get("nodes", [])
    else:
        children = {c for n in nodes for c in n.get("children", [])}
        roots = [i for i in range(len(nodes)) if i not in children]
    if not isinstance(roots, list) or not roots:
        raise _refuse("empty", "The model's scene has no nodes, so there is nothing to draw.")

    parents: dict[int, int] = {}
    for i, node in enumerate(nodes):
        for child in node.get("children", []):
            child = _index(child, len(nodes), f"Node {i}'s child")
            if child in parents or child == i:
                raise _refuse("malformed", f"Node {child} has more than one parent, or is its own.")
            parents[child] = i

    low = [math.inf] * 3
    high = [-math.inf] * 3
    vertices = triangles = primitives = 0
    instanced_meshes: set[int] = set()

    def visit(index: int, parent: Matrix, depth: int) -> None:
        nonlocal vertices, triangles, primitives
        if depth > MAX_DEPTH:
            raise _refuse("too_large", f"The model's nodes nest deeper than {MAX_DEPTH} levels.")
        node = nodes[index]
        world = _multiply(parent, _node_matrix(node, index))
        if "mesh" in node:
            mesh_index = _index(node["mesh"], len(meshes), f"Node {index}'s mesh")
            instanced_meshes.add(mesh_index)
            for p, primitive in enumerate(meshes[mesh_index].get("primitives", [])):
                where = f"Mesh {mesh_index} primitive {p}"
                primitives += 1
                if primitives > MAX_PRIMITIVES:
                    raise _refuse(
                        "too_large", f"The model has more than {MAX_PRIMITIVES} primitives."
                    )
                mode = primitive.get("mode", 4)
                if mode not in (4, 5, 6):
                    raise _refuse(
                        "unsupported",
                        f"{where} is drawn as points or lines, not surfaces; only triangle meshes "
                        "are used.",
                    )
                if "material" in primitive:
                    _index(primitive["material"], len(materials), f"{where}'s material")
                attributes = primitive.get("attributes", {})
                if not isinstance(attributes, dict) or "POSITION" not in attributes:
                    raise _refuse("malformed", f"{where} has no positions.")
                points = reader.positions(attributes["POSITION"], where)
                vertices += len(points)
                if vertices > MAX_VERTICES:
                    raise _refuse(
                        "too_large",
                        f"The model has more than {MAX_VERTICES:,} vertices; simplify it first.",
                    )
                count = (
                    reader.accessor(primitive["indices"], f"{where}'s indices")["count"]
                    if "indices" in primitive
                    else len(points)
                )
                if (
                    "indices" in primitive
                    and int(reader.accessors[primitive["indices"]].get("componentType", 0))
                    not in _INDEX_SIZE
                ):
                    raise _refuse("malformed", f"{where}'s indices are not unsigned integers.")
                triangles += count // 3 if mode == 4 else max(count - 2, 0)
                if triangles > MAX_TRIANGLES:
                    raise _refuse(
                        "too_large",
                        f"The model has more than {MAX_TRIANGLES:,} triangles; simplify it first.",
                    )
                m = world
                for x, y, z in points:
                    for axis in range(3):
                        v = m[axis] * x + m[4 + axis] * y + m[8 + axis] * z + m[12 + axis]
                        if v < low[axis]:
                            low[axis] = v
                        if v > high[axis]:
                            high[axis] = v
        for child in node.get("children", []):
            visit(child, world, depth + 1)

    seen_roots = set()
    for root in roots:
        root = _index(root, len(nodes), "The scene")
        if root in parents or root in seen_roots:
            raise _refuse("malformed", f"Scene root node {root} is also a child or listed twice.")
        seen_roots.add(root)
        visit(root, _IDENTITY, 1)
    if triangles < 1 or not all(math.isfinite(v) for v in (*low, *high)):
        raise _refuse("empty", "The model's scene has no triangles, so there is nothing to draw.")
    for axis in range(3):
        if high[axis] - low[axis] <= 0:
            high[axis] = low[axis] + 1e-6  # a flat model: keep min < max

    if _list(gltf, "animations"):
        count = len(gltf["animations"])
        notes.append(
            f"{count} animation{'s are' if count > 1 else ' is'} not played: the model is "
            "shown at rest."
        )
    if _list(gltf, "cameras"):
        notes.append("Cameras in the file are ignored: the app's own views are used.")
    lights = (gltf.get("extensions") or {}).get("KHR_lights_punctual", {}).get("lights", [])
    if lights or any("KHR_lights_punctual" in (n.get("extensions") or {}) for n in nodes):
        notes.append("Lights in the file are ignored: the world's own lighting is used.")
    unused = len(meshes) - len(instanced_meshes)
    if unused > 0:
        notes.append(
            f"{unused} mesh{'es are' if unused > 1 else ' is'} not in the default scene and "
            "not shown."
        )

    extent = max(high[i] - low[i] for i in range(3))
    hint = None
    if extent > 100:
        hint = (
            f"As written, the model is {extent:,.0f} m across. glTF files are in metres; if it was "
            "exported in millimetres or centimetres, choose that unit."
        )
    elif extent < 0.05:
        hint = (
            f"As written, the model is only {extent * 100:.1f} cm across. glTF files are in "
            "metres; "
            "if it was exported in another unit, choose it."
        )
    sha = hashlib.sha256(data).hexdigest()
    return UploadedModelReport.model_validate(
        {
            "uri": f"{UPLOADED_MODEL_PREFIX}{sha}.glb",
            "sha256": sha,
            "bytes": len(data),
            "filename": (filename.strip() or "model.glb")[:200],
            "file_bounds": {
                "min": dict(zip("xyz", low, strict=True)),
                "max": dict(zip("xyz", high, strict=True)),
            },
            "triangles": triangles,
            "vertices": vertices,
            "nodes": len(nodes),
            "meshes": len(meshes),
            "materials": len(materials),
            "textures": len(textures),
            "texture_pixels": pixels,
            "extensions_used": sorted(set(used)),
            "notes": notes,
            "scale_hint": hint,
        }
    )


def store_upload(data: bytes, filename: str, catalog_dir: Path) -> UploadedModelReport:
    """Inspect, then store the file unchanged at ``<catalog>/uploaded/<sha256>.glb``. The same
    bytes again change nothing; nothing is stored for a file that is refused."""
    report = inspect_glb(data, filename)
    folder = catalog_dir / UPLOADED_MODEL_PREFIX.rstrip("/")
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / f"{report.sha256}.glb"
    if target.is_file() and hashlib.sha256(target.read_bytes()).hexdigest() == report.sha256:
        return report
    handle, temporary = tempfile.mkstemp(dir=folder, suffix=".part")
    try:
        with os.fdopen(handle, "wb") as out:
            out.write(data)
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return report


def _round(v: float) -> float:
    return round(v, 6) + 0.0


def uploaded_asset(request: UploadedAssetRequest, catalog_dir: Path) -> CatalogAsset:
    """A catalog asset for a stored upload, with the person's orientation, unit and fit."""
    path = catalog_dir / UPLOADED_MODEL_PREFIX.rstrip("/") / f"{request.sha256}.glb"
    if not path.is_file():
        raise _refuse("missing", "That model is not stored on this computer; attach it again.")
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != request.sha256:
        raise _refuse("changed", "The stored model does not match its hash; attach it again.")
    report = inspect_glb(data, request.filename)
    lo, hi = report.file_bounds.min, report.file_bounds.max
    corners = [
        corrected_point(request.up_axis, request.turns, (x, y, z))
        for x in (lo.x, hi.x)
        for y in (lo.y, hi.y)
        for z in (lo.z, hi.z)
    ]
    low = [min(c[i] for c in corners) for i in range(3)]
    high = [max(c[i] for c in corners) for i in range(3)]
    offset = (-(low[0] + high[0]) / 2, -low[1], -(low[2] + high[2]) / 2)
    unit = MODEL_UNITS[request.unit]
    bounds_min = [(low[i] + offset[i]) * unit for i in range(3)]
    bounds_max = [(high[i] + offset[i]) * unit for i in range(3)]
    # The kind joins the choices only when it is not equipment, so earlier ids stay the same.
    kind = "" if request.kind == "equipment" else f"|{request.kind}"
    choice = hashlib.sha256(
        f"{request.up_axis}|{request.turns}|{request.unit}|{request.fit}{kind}".encode()
    ).hexdigest()
    source_ref = (
        f"Geometric extent of the attached model '{report.filename}' as turned here; the "
        "model's geometry, not a measurement of the machine."
    )

    def length(value: float) -> dict[str, Any]:
        return {
            "value_m": _round(value),
            "origin": "inferred",
            "source_ref": source_ref,
            "review_status": "unreviewed",
            "uncertainty_m": None,
        }

    def vec(values: list[float] | tuple[float, ...]) -> dict[str, float]:
        return {"x": _round(values[0]), "y": _round(values[1]), "z": _round(values[2])}

    return CatalogAsset.model_validate(
        {
            "id": f"asset-upload-{request.sha256[:12]}-{choice[:6]}",
            "name": request.name[:200],
            "kind": request.kind,
            "visual": {
                "type": "gltf",
                "uri": report.uri,
                "sha256": report.sha256,
                "metres_per_model_unit": unit,
                "up_axis": "+Y",
                "front_axis": "+Z",
                "origin": "bottom_centre",
                "model_bounds_m": {"min": vec(bounds_min), "max": vec(bounds_max)},
                "fit": request.fit,
                "max_fit_distortion": 0.05,
                "correction": {
                    "up_axis": request.up_axis,
                    "turns": request.turns,
                    "file_bounds": report.file_bounds.model_dump(),
                    "offset": {"x": offset[0], "y": offset[1], "z": offset[2]},
                },
            },
            "nominal_dimensions": {
                "width": length(bounds_max[0] - bounds_min[0]),
                "height": length(bounds_max[1] - bounds_min[1]),
                "depth": length(bounds_max[2] - bounds_min[2]),
            },
            "source": {
                "kind": "uploaded",
                "author": "Attached by a person using this project",
                "reference": None,
            },
            "rights": {
                "license": "NOASSERTION",
                "redistribution": "unknown",
                "attribution": None,
                "terms_ref": request.note,
            },
            "generation": None,
            "upload": {
                "filename": report.filename,
                "bytes": report.bytes,
                "triangles": report.triangles,
                "note": request.note,
            },
        }
    )
