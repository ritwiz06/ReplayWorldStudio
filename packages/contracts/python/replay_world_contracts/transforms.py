"""Source-plan <-> world coordinate conversion for :class:`SourceToWorldTransform`."""

from __future__ import annotations

import math
from typing import Final

from .models import LengthUnit, SourceToWorldTransform, Vec3

METRES_PER_UNIT: Final[dict[LengthUnit, float]] = {
    "m": 1.0,
    "cm": 0.01,
    "mm": 0.001,
    "in": 0.0254,
    "ft": 0.3048,
}
"""Exact definitional conversion factors for declared source length units."""


def source_point_to_world(t: SourceToWorldTransform, u: float, v: float) -> Vec3:
    """Map a source plan point (u, v), in source units, to a world point in metres."""
    if not (math.isfinite(u) and math.isfinite(v)):
        raise ValueError(f"source point must be finite, got ({u}, {v})")
    s = t.metres_per_source_unit
    # Axis convention: plan +X -> world +X, plan +Y (up the sheet) -> world -Z.
    x0, z0 = u * s, -v * s
    c, sn = math.cos(t.rotation_about_world_y_rad), math.sin(t.rotation_about_world_y_rad)
    # Right-handed rotation about +Y: x' = c*x + s*z, z' = -s*x + c*z.
    x1 = c * x0 + sn * z0
    z1 = -sn * x0 + c * z0
    return Vec3(x=x1 + t.translation_m.x, y=t.translation_m.y, z=z1 + t.translation_m.z)


def world_point_to_source(t: SourceToWorldTransform, p: Vec3) -> tuple[float, float]:
    """Inverse of :func:`source_point_to_world` for points on the plan's floor plane."""
    s = t.metres_per_source_unit
    x1, z1 = p.x - t.translation_m.x, p.z - t.translation_m.z
    c, sn = math.cos(t.rotation_about_world_y_rad), math.sin(t.rotation_about_world_y_rad)
    x0 = c * x1 - sn * z1
    z0 = sn * x1 + c * z1
    return (x0 / s, -z0 / s)
