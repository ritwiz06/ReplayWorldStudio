"""Turn a geometry specification into a verified, content-addressed GLB model.

The specification is plain data (approved shapes, boxes, materials) validated by the contract;
nothing in it is ever executed. The steps are:

1. :func:`fit_to_envelope` maps a draft's parts onto its envelope, so the parts' union is the
   envelope: centred on X and Z, standing on Y = 0. It reports, in plain words, any noticeable
   scaling and any part it had to thicken.
2. :func:`build_model` meshes every part, merges them per material and writes a GLB. The bytes
   are then read back by an independent reader, and the model is refused unless its bounds
   are the envelope with the origin at the bottom-centre. Identical specifications give
   identical bytes, so the sha256 names the model.
3. :func:`gltf_visual` describes the model as a contract ``GltfVisual``, and
   :func:`store_model` writes it once, atomically, under ``generated/<sha256>.glb`` in the
   catalog library.
"""

from __future__ import annotations

import contextlib
import hashlib
import math
import os
import re
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Final, assert_never

from replay_world_contracts import (
    GENERATED_MODEL_PREFIX,
    GENERATOR_VERSION,
    Extent3,
    GeometryDraft,
    GeometryPart,
    GeometrySpec,
    GltfVisual,
    ModelBounds,
    Vec3,
)
from replay_world_contracts.models import (
    CATALOG_PATH_PATTERN,
    GEOMETRY_MIN_PART_M,
    MODEL_ORIGIN_TOLERANCE_M,
    parts_bounds,
)

from . import mesh as shapes
from .glb import GeneratorError, read_glb, write_glb
from .mesh import Mesh

MAX_TRIANGLES: Final = 200_000
MAX_GLB_BYTES: Final = 8 * 1024 * 1024
SCALE_NOTE_THRESHOLD: Final = 0.02
"""Scaling an axis by more than this fraction is reported to the user."""
FITTED_TOLERANCE_M: Final = 5e-6
"""An axis whose parts already span the envelope this closely is left unscaled. It absorbs
the micron rounding of a previous fit, which makes fitting idempotent."""
MAX_FIT_DISTORTION: Final = 0.05
"""As for the curated catalog models (scripts/build_demo_fixture.py)."""

_FACE_GRID: Final = 500_000
"""Fitted part faces are snapped to 1 / 500 000 m (2 µm), so every centre and size is a whole
number of microns and a face on the envelope stays exactly on it."""

_AXES: Final = (("x", "width (X)"), ("y", "height (Y)"), ("z", "depth (Z)"))
_CATALOG_PATH: Final = re.compile(CATALOG_PATH_PATTERN)


class StoreConflictError(GeneratorError):
    """A different file already exists where a content-addressed model belongs."""


@dataclass(frozen=True)
class BuiltModel:
    """A generated model and what verifying its bytes established."""

    glb: bytes = field(repr=False)
    sha256: str
    uri: str
    bounds: ModelBounds
    triangles: int
    materials: tuple[str, ...]

    @property
    def size_bytes(self) -> int:
        return len(self.glb)


def _q(value: float) -> float:
    return round(value, 6) + 0.0


def _snap(value: float) -> float:
    return round(value * _FACE_GRID) / _FACE_GRID + 0.0


def _target(axis: str, envelope: Extent3) -> tuple[float, float]:
    extent: float = getattr(envelope, axis)
    return (0.0, extent) if axis == "y" else (-extent / 2, extent / 2)


def _factor(scale: float) -> str:
    return f"{scale:.3g}"


def fit_to_envelope(draft: GeometryDraft) -> tuple[GeometrySpec, Vec3, list[str]]:
    """Scale and move the parts so their union is exactly the envelope.

    Each axis is mapped affinely (one scale and one offset for all parts), so proportions on
    an axis are kept. A part that ends up thinner than the contract minimum is grown to it,
    moved inward if needed so it stays inside the envelope. Centres and sizes are whole
    microns (the faces of rescaled parts are snapped to 2 µm, so they stay consistent).
    Returns the strict specification, the scale applied per axis and notes for the user.
    Fitting an already fitted specification changes nothing.
    """
    lo, hi = parts_bounds(draft.parts)
    mapping: dict[str, tuple[float, float] | None] = {}
    scales: dict[str, float] = {}
    notes: list[str] = []
    for axis, name in _AXES:
        t0, t1 = _target(axis, draft.envelope_m)
        low, high = getattr(lo, axis), getattr(hi, axis)
        if abs(low - t0) <= FITTED_TOLERANCE_M and abs(high - t1) <= FITTED_TOLERANCE_M:
            mapping[axis], scales[axis] = None, 1.0
            continue
        if not math.isfinite(high - low):  # finite coordinates whose span overflows
            raise GeneratorError(f"the parts span too far in {name} to be fitted")
        scale = (t1 - t0) / (high - low)
        mapping[axis], scales[axis] = (low, scale), scale
        if abs(scale - 1) > SCALE_NOTE_THRESHOLD:
            notes.append(
                f"Parts were scaled \N{MULTIPLICATION SIGN}{_factor(scale)} in {name} to fit the "
                f"{t1 - t0:.3f} m envelope."
            )

    parts: list[dict[str, Any]] = []
    for part in draft.parts:
        center: dict[str, float] = {}
        size: dict[str, float] = {}
        thickened: list[str] = []
        for axis, name in _AXES:
            c, s = getattr(part.center_m, axis), getattr(part.size_m, axis)
            axis_map = mapping[axis]
            if axis_map is not None:
                origin, scale = axis_map
                t0 = _target(axis, draft.envelope_m)[0]
                # Map the faces, not centre and size, so a part on an extreme lands on it.
                low = _snap(t0 + (c - s / 2 - origin) * scale)
                high = _snap(t0 + (c + s / 2 - origin) * scale)
                c, s = (low + high) / 2, high - low
            if _q(s) < GEOMETRY_MIN_PART_M:
                t0, t1 = _target(axis, draft.envelope_m)
                s = GEOMETRY_MIN_PART_M
                c = min(max(c, t0 + s / 2), t1 - s / 2)
                thickened.append(name)
            center[axis], size[axis] = _q(c), _q(s)
        if thickened:
            notes.append(
                f"Part '{part.label}' was thickened to the {GEOMETRY_MIN_PART_M * 1000:g} mm "
                f"minimum in {' and '.join(thickened)}."
            )
        parts.append(part.model_dump() | {"center_m": center, "size_m": size})

    spec = GeometrySpec.model_validate(
        {"format": draft.format, "envelope_m": draft.envelope_m.model_dump(), "parts": parts}
    )
    scale_applied = Vec3(x=_q(scales["x"]), y=_q(scales["y"]), z=_q(scales["z"]))
    return spec, scale_applied, notes


def part_mesh(part: GeometryPart) -> Mesh:
    """The mesh of one part, filling its box in the object frame."""
    center = (part.center_m.x, part.center_m.y, part.center_m.z)
    size = (part.size_m.x, part.size_m.y, part.size_m.z)
    match part.shape:
        case "box":
            return shapes.box(center, size)
        case "rounded_box":
            return shapes.rounded_box(center, size)
        case "cylinder":
            if part.axis is None:  # the contract requires it; checked for the type checker
                raise GeneratorError(f"cylinder part '{part.id}' has no axis")
            return shapes.cylinder(center, size, part.axis)
        case "frustum":
            if part.taper is None or part.narrow_end is None:
                raise GeneratorError(f"frustum part '{part.id}' has no taper or narrow end")
            return shapes.frustum(center, size, part.taper, part.narrow_end)
        case "sphere":
            return shapes.sphere(center, size)
        case _:
            assert_never(part.shape)


def _check_bounds(low: tuple[float, ...], high: tuple[float, ...], envelope: Extent3) -> None:
    for i, (axis, name) in enumerate(_AXES):
        t0, t1 = _target(axis, envelope)
        if abs(low[i] - t0) > MODEL_ORIGIN_TOLERANCE_M or abs(high[i] - t1) > (
            MODEL_ORIGIN_TOLERANCE_M
        ):
            raise GeneratorError(
                f"the model spans {low[i]:.4f}..{high[i]:.4f} m in {name}, but its envelope is "
                f"{t0:.4f}..{t1:.4f} m; fit the parts to the envelope first"
            )


SUPPORTED_GENERATORS: Final = (GENERATOR_VERSION,)
"""Generator versions this build can reproduce byte for byte. A rebuild uses the version the
asset records; a future output change adds a new version here and keeps the old path."""


def build_model(spec: GeometrySpec, generator: str = GENERATOR_VERSION) -> BuiltModel:
    """Mesh, merge per material, write and verify the model for ``spec``.

    ``spec`` should come from :func:`fit_to_envelope`: the contract accepts parts within 1 mm
    of the envelope, but the model's origin must be the bottom-centre within 0.1 mm.
    ``generator`` is the version the asset records (a rebuild must reproduce that version's
    bytes); an unknown version is refused rather than built differently. Display-only aids in
    the review (edge lines on transparent parts, highlights) are drawn by the viewer and never
    change these bytes.
    """
    if generator not in SUPPORTED_GENERATORS:
        raise GeneratorError(
            f"this build cannot reproduce generator {generator!r} (it supports "
            f"{', '.join(SUPPORTED_GENERATORS)}), so the model is not rebuilt"
        )
    groups: dict[str, list[Mesh]] = {}
    for part in spec.parts:  # materials in order of first use
        groups.setdefault(part.material, []).append(part_mesh(part))
    merged = [(material, shapes.merge(meshes)) for material, meshes in groups.items()]
    triangles = sum(m.triangles for _, m in merged)
    if triangles > MAX_TRIANGLES:
        raise GeneratorError(
            f"the model would have {triangles} triangles; the limit is {MAX_TRIANGLES}"
        )
    glb = write_glb(merged)
    if len(glb) > MAX_GLB_BYTES:
        raise GeneratorError(
            f"the model would be {len(glb)} bytes; the limit is {MAX_GLB_BYTES} bytes"
        )

    summary = read_glb(glb)
    if summary.triangles != triangles or summary.materials != tuple(groups):
        raise GeneratorError("the written model does not read back as it was built")
    _check_bounds(summary.min, summary.max, spec.envelope_m)
    sha256 = hashlib.sha256(glb).hexdigest()
    return BuiltModel(
        glb=glb,
        sha256=sha256,
        uri=f"{GENERATED_MODEL_PREFIX}{sha256}.glb",
        bounds=ModelBounds(
            min=Vec3(x=summary.min[0], y=summary.min[1], z=summary.min[2]),
            max=Vec3(x=summary.max[0], y=summary.max[1], z=summary.max[2]),
        ),
        triangles=summary.triangles,
        materials=summary.materials,
    )


def gltf_visual(model: BuiltModel) -> GltfVisual:
    """The contract visual for a generated model, as the curated catalog records its own."""

    def rounded(v: Vec3) -> Vec3:
        return Vec3(x=_q(v.x), y=_q(v.y), z=_q(v.z))

    return GltfVisual(
        type="gltf",
        uri=model.uri,
        sha256=model.sha256,
        metres_per_model_unit=1.0,
        up_axis="+Y",
        front_axis="+Z",
        origin="bottom_centre",
        model_bounds_m=ModelBounds(min=rounded(model.bounds.min), max=rounded(model.bounds.max)),
        fit="scale_to_dimensions",
        max_fit_distortion=MAX_FIT_DISTORTION,
        correction=None,
    )


def store_model(model: BuiltModel, catalog_dir: Path) -> Path:
    """Write the model to ``<catalog_dir>/<model.uri>`` and return the file's path.

    The write is atomic (a temporary file in the same folder, then a rename) and idempotent:
    storing the same model again leaves the existing file alone. A different file already at
    that path is never replaced (:class:`StoreConflictError`), and nothing is written if the
    folder resolves outside the catalog library.
    """
    expected_uri = f"{GENERATED_MODEL_PREFIX}{model.sha256}.glb"
    if hashlib.sha256(model.glb).hexdigest() != model.sha256 or model.uri != expected_uri:
        raise GeneratorError("the model's bytes, sha256 and uri do not agree")
    if not _CATALOG_PATH.fullmatch(model.uri):
        raise GeneratorError(f"'{model.uri}' is not a catalog path")

    folder = catalog_dir / GENERATED_MODEL_PREFIX.rstrip("/")
    folder.mkdir(parents=True, exist_ok=True)
    root = catalog_dir.resolve()
    real_folder = folder.resolve()
    if not real_folder.is_relative_to(root):
        raise GeneratorError(f"'{GENERATED_MODEL_PREFIX}' resolves outside the catalog library")
    target = real_folder / model.uri.removeprefix(GENERATED_MODEL_PREFIX)

    if target.exists() or target.is_symlink():
        existing = target.resolve()
        same = existing.is_relative_to(root) and existing.is_file()
        if same and existing.read_bytes() == model.glb:
            return target
        raise StoreConflictError(
            f"'{model.uri}' already exists in the catalog library with different content; "
            "it was not replaced"
        )

    fd, temporary = tempfile.mkstemp(dir=real_folder, prefix=".", suffix=".glb.tmp")
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(model.glb)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, 0o644)  # mkstemp creates 0600; catalog files are plain readable
        os.replace(temporary, target)
    except BaseException:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(temporary)
        raise
    return target
