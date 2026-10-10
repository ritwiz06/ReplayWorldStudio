"""Generated objects: a deterministic generator from a data-only geometry specification to a
verified binary glTF model. No code from a language model is ever executed."""

from .generator import (
    MAX_GLB_BYTES,
    MAX_TRIANGLES,
    BuiltModel,
    StoreConflictError,
    build_model,
    fit_to_envelope,
    gltf_visual,
    part_mesh,
    store_model,
)
from .glb import GeneratorError, GlbError, GlbSummary, read_glb, write_glb
from .materials import MATERIALS, MaterialSpec

__all__ = [
    "MATERIALS",
    "MAX_GLB_BYTES",
    "MAX_TRIANGLES",
    "BuiltModel",
    "GeneratorError",
    "GlbError",
    "GlbSummary",
    "MaterialSpec",
    "StoreConflictError",
    "build_model",
    "fit_to_envelope",
    "gltf_visual",
    "part_mesh",
    "read_glb",
    "store_model",
    "write_glb",
]
