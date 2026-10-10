"""Triangle meshes for the approved part shapes, in pure Python.

Every primitive fills its part's axis-aligned box exactly: the mesh's bounding box is
``center ± size / 2`` on every axis. Round shapes therefore use segment counts that are
multiples of four, so the quarter-turn vertices (the extremes) are on the box faces, and
those vertices are placed with exact 0/±1 rather than ``cos``/``sin`` results.

Coordinates are metres in the object frame (+Y up, front +Z). Triangles wind
counter-clockwise seen from outside, as glTF requires for front faces, and every normal is a
unit vector. All positions and normals are rounded to 1e-6 (a micron grid), so the output does
not depend on the last bit of a platform's ``cos``/``sin``.

Round bodies are built in a local frame (u, v, w) with w along the body's axis and mapped to
the object frame by a cyclic permutation of (x, y, z). A cyclic permutation is a proper
rotation, so it never mirrors the mesh and the winding stays outward.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Sequence
from itertools import pairwise
from typing import Final, Literal, NamedTuple

type Point = tuple[float, float, float]
type AxisName = Literal["x", "y", "z"]

ROUND_SEGMENTS: Final = 32
"""Segments around a cylinder, frustum or sphere (a multiple of 4: the extremes are hit)."""
SPHERE_RINGS: Final = 16
"""Latitude bands of a sphere (even: the equator is a vertex ring)."""
ROUNDED_BOX_SEGMENTS: Final = 2
"""Segments per rounded edge, as in three.js ``RoundedBoxGeometry``."""
ROUNDED_RADIUS_MAX_M: Final = 0.015
ROUNDED_RADIUS_FRACTION: Final = 0.25
"""Edge radius of a rounded box: this fraction of its smallest side, at most 15 mm."""
APEX_RADIUS_M: Final = 5e-5
"""A frustum end narrower than this (radius) is drawn as a point: a cap 0.1 mm across is
invisible, and on the micron grid its triangles would collapse."""


class Mesh(NamedTuple):
    """An indexed triangle list. ``indices`` holds three vertex indices per triangle."""

    positions: tuple[Point, ...]
    normals: tuple[Point, ...]
    indices: tuple[int, ...]

    @property
    def triangles(self) -> int:
        return len(self.indices) // 3


def _q(value: float) -> float:
    """Snap to the micron grid; ``+ 0.0`` turns -0.0 into 0.0 so equal values serialise alike."""
    return round(value, 6) + 0.0


def _unit(x: float, y: float, z: float) -> Point:
    length = math.hypot(x, y, z)
    return (x / length, y / length, z / length)


def _circle(segments: int) -> list[tuple[float, float]]:
    """(cos, sin) of ``segments`` equal steps around a turn, exact at the quarter turns."""
    quarter = ((1.0, 0.0), (0.0, 1.0), (-1.0, 0.0), (0.0, -1.0))
    points = []
    for i in range(segments):
        if (4 * i) % segments == 0:
            points.append(quarter[4 * i // segments])
        else:
            angle = 2 * math.pi * i / segments
            points.append((math.cos(angle), math.sin(angle)))
    return points


class _Builder:
    """Collects vertices in a local frame and stores them in the object frame."""

    def __init__(self, center: Point, axis: int = 2) -> None:
        self._center = center
        # Local (u, v, w) -> object axes: w is ``axis``, u and v follow cyclically.
        self._slots = ((axis + 1) % 3, (axis + 2) % 3, axis)
        self._positions: list[Point] = []
        self._normals: list[Point] = []
        self._indices: list[int] = []

    def _to_object(self, local: Sequence[float]) -> list[float]:
        out = [0.0, 0.0, 0.0]
        for value, slot in zip(local, self._slots, strict=True):
            out[slot] = value
        return out

    def vertex(self, local_position: Sequence[float], local_normal: Sequence[float]) -> int:
        p = self._to_object(local_position)
        n = self._to_object(local_normal)
        c = self._center
        self._positions.append((_q(c[0] + p[0]), _q(c[1] + p[1]), _q(c[2] + p[2])))
        self._normals.append((_q(n[0]), _q(n[1]), _q(n[2])))
        return len(self._positions) - 1

    @property
    def count(self) -> int:
        return len(self._positions)

    def triangle(self, a: int, b: int, c: int) -> None:
        self._indices.extend((a, b, c))

    def mesh(self) -> Mesh:
        return Mesh(tuple(self._positions), tuple(self._normals), tuple(self._indices))


def box(center: Point, size: Point) -> Mesh:
    """A box with flat faces: 24 vertices (4 per face), 12 triangles."""
    half = [s / 2 for s in size]
    b = _Builder(center)
    for k in range(3):
        for sign in (1.0, -1.0):
            # Tangents with t1 x t2 = the face normal, so the corner order below is CCW.
            t1, t2 = (k + 1) % 3, (k + 2) % 3
            if sign < 0:
                t1, t2 = t2, t1
            normal = [0.0, 0.0, 0.0]
            normal[k] = sign
            corners = []
            for s1, s2 in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                p = [0.0, 0.0, 0.0]
                p[k] = sign * half[k]
                p[t1] = s1 * half[t1]
                p[t2] = s2 * half[t2]
                corners.append(b.vertex(p, normal))
            b.triangle(corners[0], corners[1], corners[2])
            b.triangle(corners[0], corners[2], corners[3])
    return b.mesh()


# three.js BoxGeometry planes: (u, v, w, udir, vdir, sign of w) for +x, -x, +y, -y, +z, -z.
_BOX_PLANES: Final = (
    (2, 1, 0, -1, -1, 1),
    (2, 1, 0, 1, -1, -1),
    (0, 2, 1, 1, 1, 1),
    (0, 2, 1, 1, -1, -1),
    (0, 1, 2, 1, -1, 1),
    (0, 1, 2, -1, -1, -1),
)


def rounded_radius(size: Point) -> float:
    return min(ROUNDED_RADIUS_FRACTION * min(size), ROUNDED_RADIUS_MAX_M)


def rounded_box(center: Point, size: Point) -> Mesh:
    """A box with rounded edges and corners: a port of three.js ``RoundedBoxGeometry``.

    three.js subdivides a unit cube into ``2 * segments + 1`` steps per edge, then moves every
    vertex to ``sign * (half - r) + n * r`` with ``n = normalize(p - sign * halfStep)``. Here
    the unit-cube grid is held in integers (odd multiples of a tenth for five steps), so the
    normal is computed without rounding error, and the position is written as
    ``sign * half + (n - sign) * r`` so a face centre lands exactly on the box face.
    """
    steps = 2 * ROUNDED_BOX_SEGMENTS + 1
    half = [s / 2 for s in size]
    r = rounded_radius(size)
    b = _Builder(center)
    for u, v, w, udir, vdir, wsign in _BOX_PLANES:
        base = b.count
        for iy in range(steps + 1):
            for ix in range(steps + 1):
                grid = [0, 0, 0]
                grid[u] = (2 * ix - steps) * udir
                grid[v] = (2 * iy - steps) * vdir
                grid[w] = steps * wsign
                signs = [1 if g > 0 else -1 for g in grid]
                normal = _unit(*(g - s for g, s in zip(grid, signs, strict=True)))
                position = [signs[i] * half[i] + (normal[i] - signs[i]) * r for i in range(3)]
                b.vertex(position, normal)
        row = steps + 1
        for iy in range(steps):
            for ix in range(steps):
                a_ = base + ix + row * iy
                b_ = base + ix + row * (iy + 1)
                c_ = base + ix + 1 + row * (iy + 1)
                d_ = base + ix + 1 + row * iy
                b.triangle(a_, b_, d_)
                b.triangle(b_, c_, d_)
    return b.mesh()


def _round_body(center: Point, size: Point, axis: int, s_low: float, s_high: float) -> Mesh:
    """A (possibly elliptical, possibly tapered) round body along ``axis``.

    The cross-section at the low end is scaled by ``s_low`` and at the high end by ``s_high``
    (1 is the full box). The side normal of a circular frustum with unit radii is
    ``(cos t, sin t, (s_low - s_high) / height)``; scaling the cross-section by (A, B) maps
    normals by the inverse scale, giving ``(cos t / A, sin t / B, slope)`` before normalising.
    """
    u_axis, v_axis = (axis + 1) % 3, (axis + 2) % 3
    ra, rb, half_h = size[u_axis] / 2, size[v_axis] / 2, size[axis] / 2
    slope = (s_low - s_high) / size[axis]
    ring = _circle(ROUND_SEGMENTS)
    # An apex gets one vertex per side triangle, with the normal of that triangle's mid-angle.
    mids = _circle(2 * ROUND_SEGMENTS)[1::2]
    b = _Builder(center, axis)

    def side_normal(c: float, s: float) -> Point:
        return _unit(c / ra, s / rb, slope)

    def end(scale: float, w: float) -> tuple[list[int], bool]:
        if scale * min(ra, rb) < APEX_RADIUS_M:
            return [b.vertex((0.0, 0.0, w), side_normal(c, s)) for c, s in mids], True
        return [
            b.vertex((ra * scale * c, rb * scale * s, w), side_normal(c, s)) for c, s in ring
        ], False

    low, low_apex = end(s_low, -half_h)
    high, high_apex = end(s_high, half_h)
    n = ROUND_SEGMENTS
    for i in range(n):
        j = (i + 1) % n
        if high_apex:
            b.triangle(low[i], low[j], high[i])
        elif low_apex:
            b.triangle(low[i], high[j], high[i])
        else:
            b.triangle(low[i], low[j], high[j])
            b.triangle(low[i], high[j], high[i])

    for scale, w, sign, apex in (
        (s_low, -half_h, -1.0, low_apex),
        (s_high, half_h, 1.0, high_apex),
    ):
        if apex:
            continue
        normal = (0.0, 0.0, sign)
        hub = b.vertex((0.0, 0.0, w), normal)
        rim = [b.vertex((ra * scale * c, rb * scale * s, w), normal) for c, s in ring]
        for i in range(n):
            j = (i + 1) % n
            if sign > 0:
                b.triangle(hub, rim[i], rim[j])
            else:
                b.triangle(hub, rim[j], rim[i])
    return b.mesh()


def cylinder(center: Point, size: Point, axis: AxisName) -> Mesh:
    """A capped cylinder along ``axis``; elliptical when the two cross extents differ."""
    return _round_body(center, size, "xyz".index(axis), 1.0, 1.0)


def frustum(center: Point, size: Point, taper: float, narrow_end: Literal["top", "bottom"]) -> Mesh:
    """An upright frustum: the wide end fills the box, the narrow end is ``taper`` times as
    wide. A taper of 0 is a cone, whose point gets no cap."""
    low, high = (1.0, taper) if narrow_end == "top" else (taper, 1.0)
    return _round_body(center, size, 1, low, high)


def sphere(center: Point, size: Point) -> Mesh:
    """A UV sphere (poles on Y) stretched into the ellipsoid that fills the box."""
    axis = 1
    ra, rb, rc = size[(axis + 1) % 3] / 2, size[(axis + 2) % 3] / 2, size[axis] / 2
    ring = _circle(ROUND_SEGMENTS)
    # Latitude j of SPHERE_RINGS is the angle pi * j / rings from the north pole.
    latitudes = _circle(2 * SPHERE_RINGS)
    b = _Builder(center, axis)
    north = b.vertex((0.0, 0.0, rc), (0.0, 0.0, 1.0))
    rows: list[list[int]] = []
    for j in range(1, SPHERE_RINGS):
        cos_phi, sin_phi = latitudes[j]
        rows.append(
            [
                b.vertex(
                    (ra * sin_phi * c, rb * sin_phi * s, rc * cos_phi),
                    _unit(sin_phi * c / ra, sin_phi * s / rb, cos_phi / rc),
                )
                for c, s in ring
            ]
        )
    south = b.vertex((0.0, 0.0, -rc), (0.0, 0.0, -1.0))
    n = ROUND_SEGMENTS
    for i in range(n):
        j = (i + 1) % n
        b.triangle(north, rows[0][i], rows[0][j])
        for upper, lower in pairwise(rows):
            b.triangle(upper[i], lower[i], lower[j])
            b.triangle(upper[i], lower[j], upper[j])
        b.triangle(south, rows[-1][j], rows[-1][i])
    return b.mesh()


def merge(meshes: Iterable[Mesh]) -> Mesh:
    """Concatenate meshes, sharing vertices whose position and normal are identical.

    Vertices keep the order of their first use, so the result is deterministic. A triangle
    that welding would collapse (two equal corners) is dropped.
    """
    seen: dict[tuple[Point, Point], int] = {}
    positions: list[Point] = []
    normals: list[Point] = []
    indices: list[int] = []
    for mesh in meshes:
        remap: list[int] = []
        for key in zip(mesh.positions, mesh.normals, strict=True):
            index = seen.get(key)
            if index is None:
                index = seen[key] = len(positions)
                positions.append(key[0])
                normals.append(key[1])
            remap.append(index)
        for t in range(0, len(mesh.indices), 3):
            a, b, c = (remap[i] for i in mesh.indices[t : t + 3])
            if a != b and b != c and a != c:
                indices.extend((a, b, c))
    return Mesh(tuple(positions), tuple(normals), tuple(indices))
