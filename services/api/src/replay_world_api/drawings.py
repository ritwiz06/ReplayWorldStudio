"""Read a bounded subset of ASCII DXF into a floor plan and layout objects (IMP-01, IMP-02).

Supported (``rws-dxf/1``), in model space and inside block definitions:

* ``LINE``;
* ``LWPOLYLINE`` and 2D ``POLYLINE``, open or closed; arc segments (bulges) are drawn as straight
  segments of at most 10 degrees;
* ``CIRCLE`` (a 32-sided closed outline whose footprint is the square around it) and ``ARC``
  (an open line of 10-degree segments);
* ``INSERT`` of a block, with its insertion point, base point, X/Y scale (mirroring included),
  rotation and nested inserts (at most 8 deep), drawn in the plan (extrusion +Z or -Z);
* ``TEXT``, ``MTEXT`` and block ``ATTRIB`` values, used only to name things;
* the header's ``$INSUNITS`` (inches, feet, millimetres, centimetres, metres), ``$MEASUREMENT``
  and ``$ACADVER``, and each block's own insertion units.

Everything else is reported, never silently dropped: ellipses, splines, hatches, solids, 3D
entities, curve-fitted polylines, array inserts (``MINSERT``), external references and anything
not drawn in the plan are listed as layout geometry that was not imported; dimensions, leaders
and other annotation are listed as not used. Open lines stay on the plan but do not become
objects. Binary DXF and DWG files are refused with the route to an ASCII DXF export.

Layout objects are drawn deterministically and only proposed: the largest closed outline
covering most of the drawing is proposed as the floor, and the review (IMP-02) decides. Every
other closed outline and every top-level block insert is one object whose footprint rectangle
comes from the drawing, marked ``exact`` or ``enclosing`` (approximate). Names come from a block
attribute, a text inside the outline (only the smallest outline holding it, and never an outline
that holds other objects), the block name or the layer, in that order; kinds from layer names
(walkways, keep-clear zones, columns and walls) and are otherwise equipment. Text read from the
file is content, never an instruction. Error messages never echo file content beyond entity
types, handles, layer and block names.
"""

from __future__ import annotations

import hashlib
import math
import re
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Any, Final, Literal

from replay_world_contracts import (
    MAX_DRAWING_BYTES,
    METRES_PER_UNIT,
    DrawingAnalysis,
    DrawingFile,
    DrawingImport,
    DrawingObject,
    DrawingRef,
    DrawingUnits,
    OmittedShape,
    PlanLabel,
    PlanLine,
    PlanPoint,
    Project,
    SkippedEntities,
)
from replay_world_contracts.models import (
    MAX_DRAWING_LABELS,
    MAX_DRAWING_LINES,
    MAX_DRAWING_OBJECTS,
    DrawingEntity,
    LengthUnit,
    ObjectKind,
)

from .photos import PhotoError, sanitise_filename, write_library_file

READER: Final = "rws-dxf/1"
DRAWING_FOLDER: Final = "drawings"
MAX_PAIRS: Final = 2_000_000
MAX_NESTING: Final = 8
MAX_POINTS_PER_LINE: Final = 2000
MAX_LABEL_CHARS: Final = 120
#: A closed outline is the floor when it is the largest and covers this share of the drawing.
FLOOR_SHARE: Final = 0.4
#: A plausible floor layout, in metres across its larger side.
PLAUSIBLE_SIZE_M: Final = (1.0, 2000.0)

EXPORT_ROUTE: Final = (
    "In your CAD program choose Save As (or Export) > DXF, AutoCAD 2000 or later, ASCII format, "
    "then upload the .dxf file."
)

DrawingErrorKind = Literal[
    "dwg", "binary", "not_dxf", "corrupt", "too_large", "too_complex", "empty", "unsafe"
]

INSUNITS: Final[dict[int, LengthUnit]] = {1: "in", 2: "ft", 4: "mm", 5: "cm", 6: "m"}
INSUNITS_NAME: Final[dict[int, str]] = {
    0: "unitless",
    1: "inches",
    2: "feet",
    3: "miles",
    4: "millimetres",
    5: "centimetres",
    6: "metres",
    7: "kilometres",
    8: "microinches",
    9: "mils",
    10: "yards",
    11: "ångströms",
    12: "nanometres",
    13: "microns",
    14: "decimetres",
    15: "decametres",
    16: "hectometres",
    17: "gigametres",
    18: "astronomical units",
    19: "light years",
    20: "parsecs",
    21: "US survey feet",
}
UNIT_NAME: Final[dict[str, str]] = {
    "mm": "millimetres",
    "cm": "centimetres",
    "m": "metres",
    "in": "inches",
    "ft": "feet",
}
IMPERIAL: Final = frozenset({"in", "ft"})

ANNOTATION: Final[dict[str, str]] = {
    "DIMENSION": "Dimensions are annotation; the geometry itself is read.",
    "ARC_DIMENSION": "Dimensions are annotation; the geometry itself is read.",
    "LARGE_RADIAL_DIMENSION": "Dimensions are annotation; the geometry itself is read.",
    "LEADER": "Leaders are annotation.",
    "MLEADER": "Leaders are annotation.",
    "MULTILEADER": "Leaders are annotation.",
    "TOLERANCE": "Tolerances are annotation.",
    "POINT": "Points have no size.",
    "VIEWPORT": "Viewports belong to sheets, not the model.",
    "ATTDEF": "Attribute definitions are templates; instance values are read.",
    "ACAD_TABLE": "Tables are annotation.",
    "TABLE": "Tables are annotation.",
    "RTEXT": "Text is read only from TEXT, MTEXT and block attributes.",
    "ARCALIGNEDTEXT": "Text is read only from TEXT, MTEXT and block attributes.",
}
UNSUPPORTED: Final[dict[str, str]] = {
    "ELLIPSE": "Ellipses are not in the supported subset.",
    "SPLINE": "Splines are not in the supported subset.",
    "HATCH": "Hatches (filled areas) are not in the supported subset.",
    "SOLID": "2D solids are not in the supported subset.",
    "TRACE": "Traces are not in the supported subset.",
    "3DFACE": "3D faces are not in the supported subset.",
    "3DSOLID": "3D solids are not in the supported subset.",
    "BODY": "3D bodies are not in the supported subset.",
    "REGION": "Regions are not in the supported subset.",
    "MESH": "Meshes are not in the supported subset.",
    "SURFACE": "Surfaces are not in the supported subset.",
    "XLINE": "Construction lines (infinite) are not in the supported subset.",
    "RAY": "Rays (infinite) are not in the supported subset.",
    "IMAGE": "Raster images are not read.",
    "WIPEOUT": "Wipeouts are not read.",
    "OLE2FRAME": "Embedded objects are not read.",
    "UNDERLAY": "Underlays (PDF or DWF) are not read.",
    "PDFUNDERLAY": "PDF underlays are not read.",
    "DWFUNDERLAY": "DWF underlays are not read.",
    "DGNUNDERLAY": "DGN underlays are not read.",
}
NAME_TAGS: Final = frozenset(
    {"NAME", "LABEL", "TAG", "ID", "EQUIPMENT", "EQUIPMENT_NAME", "DESCRIPTION", "TITLE"}
)

_WALKWAY: Final = re.compile(r"walk|aisle|path|route|corridor|gangway|circulation", re.I)
_KEEP_CLEAR: Final = re.compile(r"keep.?clear|no.?go|hazard|exclusion|clearance|egress", re.I)
_STRUCTURE: Final = re.compile(r"\bcol(umn)?s?\b|column|pillar|wall|struct", re.I)
_MTEXT_CODE: Final = re.compile(r"\\[A-Za-z][^;\\{}]*;|\\[PpNn~]|[{}]")


@dataclass(frozen=True)
class DrawingError(Exception):
    """A drawing was refused. ``message`` is safe to show to the user."""

    kind: DrawingErrorKind
    message: str


# --- Group codes -----------------------------------------------------------------------------


@dataclass
class Entity:
    type: str
    groups: list[tuple[int, str]]
    children: list[Entity] = field(default_factory=list)

    def first(self, code: int, default: str | None = None) -> str | None:
        return next((v for c, v in self.groups if c == code), default)

    def number(self, code: int, default: float = 0.0) -> float:
        value = self.first(code)
        if value is None:
            return default
        return _float(value)

    @property
    def handle(self) -> str | None:
        value = (self.first(5) or "").strip().upper()
        return value if re.fullmatch(r"[0-9A-F]{1,16}", value) else None

    @property
    def layer(self) -> str:
        return _clean_name(self.first(8) or "0") or "0"

    @property
    def paper_space(self) -> bool:
        return (self.first(67) or "0").strip() == "1"


def _float(value: str) -> float:
    try:
        number = float(value)
    except ValueError:
        raise DrawingError(
            "corrupt", "The drawing has a coordinate that is not a number."
        ) from None
    if not math.isfinite(number):
        raise DrawingError("corrupt", "The drawing has a coordinate that is not a finite number.")
    return number


def _int(value: str | None, default: int = 0) -> int:
    if value is None:
        return default
    try:
        return int(value.strip())
    except ValueError:
        return default


def _clean_name(text: str) -> str:
    """A layer or block name or a label: printable, single-line, at most 120 characters."""
    cleaned = "".join(ch if ch.isprintable() else " " for ch in text).strip()
    return " ".join(cleaned.split())[:MAX_LABEL_CHARS]


def _decode(data: bytes, filename: str) -> str:
    if len(data) > MAX_DRAWING_BYTES:
        raise DrawingError(
            "too_large",
            f"The drawing is {len(data) / 1048576:.1f} MB; the limit is "
            f"{MAX_DRAWING_BYTES // 1048576} MB. Export only the floor-layout layers.",
        )
    if not data.strip():
        raise DrawingError("empty", "The file is empty.")
    version = re.match(rb"AC10(\d\d)", data[:6])
    if version or filename.lower().endswith(".dwg"):
        named = f" (AutoCAD format AC10{version.group(1).decode()})" if version else ""
        raise DrawingError(
            "dwg",
            f"This is a DWG file{named}. DWG can't be read yet - it is planned. {EXPORT_ROUTE}",
        )
    if data.startswith(b"AutoCAD Binary DXF"):
        raise DrawingError(
            "binary", f"This is a binary DXF; only ASCII DXF is read. {EXPORT_ROUTE}"
        )
    if b"\x00" in data[:4096]:
        raise DrawingError("not_dxf", f"This file is not a text DXF drawing. {EXPORT_ROUTE}")
    if data.startswith(b"\xef\xbb\xbf"):
        data = data[3:]
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return data.decode("cp1252", errors="replace")  # drawings before AutoCAD 2007


def _pairs(text: str) -> list[tuple[int, str]]:
    lines = text.splitlines()
    if len(lines) // 2 > MAX_PAIRS:
        raise DrawingError(
            "too_complex", "The drawing is too large to read. Export only the floor-layout layers."
        )
    pairs: list[tuple[int, str]] = []
    for i in range(0, len(lines) - 1, 2):
        try:
            code = int(lines[i].strip())
        except ValueError:
            raise DrawingError(
                "not_dxf" if not pairs else "corrupt",
                f"Line {i + 1} should hold a DXF group code but does not; "
                + ("this is not a DXF drawing." if not pairs else "the file may be damaged."),
            ) from None
        pairs.append((code, lines[i + 1].strip() if code not in (1, 3) else lines[i + 1]))
    body = [p for p in pairs if p[0] != 999]
    if not body or body[0] != (0, "SECTION"):
        raise DrawingError("not_dxf", f"This file is not a DXF drawing. {EXPORT_ROUTE}")
    if (0, "EOF") not in body:
        raise DrawingError(
            "corrupt", "The drawing ends before its EOF marker; the file may be truncated."
        )
    return body


def _sections(pairs: list[tuple[int, str]]) -> dict[str, list[tuple[int, str]]]:
    sections: dict[str, list[tuple[int, str]]] = {}
    i = 0
    while i < len(pairs):
        if pairs[i] == (0, "SECTION") and i + 1 < len(pairs) and pairs[i + 1][0] == 2:
            name = pairs[i + 1][1].upper()
            j = i + 2
            while j < len(pairs) and pairs[j] != (0, "ENDSEC"):
                j += 1
            sections[name] = pairs[i + 2 : j]
            i = j + 1
        else:
            i += 1
    return sections


def _split(pairs: list[tuple[int, str]]) -> Iterator[Entity]:
    """Group pairs into entities, attaching VERTEX and ATTRIB records to their owner."""
    current: Entity | None = None
    owner: Entity | None = None
    for code, value in pairs:
        if code == 0:
            if current is not None:
                if owner is not None and current.type in ("VERTEX", "ATTRIB"):
                    owner.children.append(current)
                elif current.type != "SEQEND":
                    if owner is not None:
                        yield owner
                        owner = None
                    if current.type == "POLYLINE" or (
                        current.type == "INSERT" and current.first(66, "0") == "1"
                    ):
                        owner = current
                    else:
                        yield current
                else:
                    if owner is not None:
                        yield owner
                    owner = None
            current = Entity(value.strip().upper(), [])
        elif current is not None:
            current.groups.append((code, value))
    if current is not None and current.type not in ("SEQEND", "VERTEX", "ATTRIB"):
        if owner is not None:
            yield owner
            owner = None
        yield current
    if owner is not None:
        yield owner


# --- Geometry --------------------------------------------------------------------------------

Point = tuple[float, float]
#: 2D affine map (a, b, c, d, e, f): x' = a x + b y + e, y' = c x + d y + f.
Affine = tuple[float, float, float, float, float, float]
IDENTITY: Final[Affine] = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)
MIRROR_X: Final[Affine] = (-1.0, 0.0, 0.0, 1.0, 0.0, 0.0)


def _apply(m: Affine, p: Point) -> Point:
    a, b, c, d, e, f = m
    return (a * p[0] + b * p[1] + e, c * p[0] + d * p[1] + f)


def _compose(outer: Affine, inner: Affine) -> Affine:
    a1, b1, c1, d1, e1, f1 = outer
    a2, b2, c2, d2, e2, f2 = inner
    return (
        a1 * a2 + b1 * c2,
        a1 * b2 + b1 * d2,
        c1 * a2 + d1 * c2,
        c1 * b2 + d1 * d2,
        a1 * e2 + b1 * f2 + e1,
        c1 * e2 + d1 * f2 + f1,
    )


def _ocs(entity: Entity) -> Affine | None:
    """The map from the entity's object coordinate system to the plan, or None if it is not
    drawn in the plan (only +Z and -Z extrusions are)."""
    nx, ny, nz = entity.number(210), entity.number(220), entity.number(230, 1.0)
    if abs(nx) > 1e-9 or abs(ny) > 1e-9:
        return None
    if abs(nz - 1) < 1e-9:
        return IDENTITY
    if abs(nz + 1) < 1e-9:
        return MIRROR_X  # the arbitrary-axis rule gives OCS X = -WCS X for a -Z extrusion
    return None


def _xy(entity: Entity, x_code: int, y_code: int) -> Point:
    return (entity.number(x_code), entity.number(y_code))


ARC_STEP_RAD: Final = math.pi / 18
"""Arcs are drawn as straight segments of at most 10 degrees; circles as 32 sides."""
CIRCLE_SIDES: Final = 32


def _arc_points(cx: float, cy: float, r: float, start: float, sweep: float) -> list[Point]:
    """Points along an arc from ``start`` (radians, counter-clockwise) through ``sweep``."""
    n = max(2, math.ceil(abs(sweep) / ARC_STEP_RAD))
    return [
        (cx + r * math.cos(start + sweep * i / n), cy + r * math.sin(start + sweep * i / n))
        for i in range(n + 1)
    ]


def _bulged(points: list[Point], bulges: list[float], closed: bool) -> list[Point]:
    """A polyline's vertices with each arc segment (non-zero bulge) drawn as short segments."""
    out: list[Point] = []
    count = len(points) if closed else len(points) - 1
    for i in range(len(points)):
        out.append(points[i])
        if i >= count or bulges[i] == 0:
            continue
        (x1, y1), (x2, y2) = points[i], points[(i + 1) % len(points)]
        b = bulges[i]
        dx, dy = x2 - x1, y2 - y1
        # The centre lies on the chord's left normal for a counter-clockwise (positive) bulge.
        k = (1 - b * b) / (4 * b)
        cx, cy = (x1 + x2) / 2 - k * dy, (y1 + y2) / 2 + k * dx
        r = math.hypot(x1 - cx, y1 - cy)
        start = math.atan2(y1 - cy, x1 - cx)
        out.extend(_arc_points(cx, cy, r, start, 4 * math.atan(b))[1:-1])
    return out


def _polygon_area(points: list[Point]) -> float:
    return 0.5 * abs(
        sum(
            points[i][0] * points[(i + 1) % len(points)][1]
            - points[(i + 1) % len(points)][0] * points[i][1]
            for i in range(len(points))
        )
    )


def _inside(p: Point, polygon: list[Point]) -> bool:
    inside = False
    for i in range(len(polygon)):
        (x1, y1), (x2, y2) = polygon[i], polygon[(i + 1) % len(polygon)]
        if (y1 > p[1]) != (y2 > p[1]):
            x = x1 + (p[1] - y1) * (x2 - x1) / (y2 - y1)
            if p[0] < x:
                inside = not inside
    return inside


def _hull(points: list[Point]) -> list[Point]:
    pts = sorted(set(points))
    if len(pts) <= 2:
        return pts

    def cross(o: Point, a: Point, b: Point) -> float:
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower: list[Point] = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper: list[Point] = []
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


@dataclass(frozen=True)
class Footprint:
    centre: Point
    width: float
    depth: float
    rotation: float
    exact: bool


def _rect_along(points: list[Point], angle: float) -> Footprint:
    ux, uy = math.cos(angle), math.sin(angle)
    us = [p[0] * ux + p[1] * uy for p in points]
    vs = [-p[0] * uy + p[1] * ux for p in points]
    u0, u1, v0, v1 = min(us), max(us), min(vs), max(vs)
    cu, cv = (u0 + u1) / 2, (v0 + v1) / 2
    return Footprint((cu * ux - cv * uy, cu * uy + cv * ux), u1 - u0, v1 - v0, angle, False)


def _normalise(angle: float, quarter: bool) -> float:
    """An angle in (-pi, pi], or in (-pi/4, pi/4] when a quarter turn changes nothing."""
    span = math.pi / 2 if quarter else 2 * math.pi
    half = span / 2
    a = (angle + half) % span - half
    return half if math.isclose(a, -half, abs_tol=1e-12) else a


def _footprint_of_outline(points: list[Point]) -> Footprint:
    """The drawn rectangle exactly, or the smallest rectangle enclosing another outline."""
    if len(points) == 4:
        edges = [
            (points[(i + 1) % 4][0] - points[i][0], points[(i + 1) % 4][1] - points[i][1])
            for i in range(4)
        ]
        lengths = [math.hypot(*e) for e in edges]
        if min(lengths) > 0 and all(
            abs(edges[i][0] * edges[(i + 1) % 4][0] + edges[i][1] * edges[(i + 1) % 4][1])
            <= 1e-6 * lengths[i] * lengths[(i + 1) % 4]
            for i in range(4)
        ):
            angle = _normalise(math.atan2(edges[0][1], edges[0][0]), quarter=True)
            rect = _rect_along(points, angle)
            return Footprint(rect.centre, rect.width, rect.depth, angle, True)
    hull = _hull(points)
    best: Footprint | None = None
    for i in range(len(hull)):
        dx = hull[(i + 1) % len(hull)][0] - hull[i][0]
        dy = hull[(i + 1) % len(hull)][1] - hull[i][1]
        if dx == 0 and dy == 0:
            continue
        rect = _rect_along(hull, _normalise(math.atan2(dy, dx), quarter=True))
        if best is None or rect.width * rect.depth < best.width * best.depth - 1e-12:
            best = rect
    return best or _rect_along(points, 0.0)


# --- Reading ---------------------------------------------------------------------------------


@dataclass
class Primitive:
    """A straight-segment line in some coordinate frame, with the entity it came from."""

    points: list[Point]
    closed: bool
    ref: DrawingRef


@dataclass
class Skips:
    groups: dict[tuple[str, str, bool, str], list[str | None]] = field(default_factory=dict)

    def add(self, entity: str, layer: str, handle: str | None, reason: str, layout: bool) -> None:
        self.groups.setdefault((entity, layer, layout, reason), []).append(handle)

    def records(self) -> list[SkippedEntities]:
        return [
            SkippedEntities(
                entity=entity,
                layer=layer,
                count=len(handles),
                handles=[h for h in handles if h][:10],
                layout=layout,
                reason=reason,
            )
            for (entity, layer, layout, reason), handles in sorted(
                self.groups.items(), key=lambda kv: (not kv[0][2], kv[0][0], kv[0][1])
            )
        ]


@dataclass
class Block:
    name: str
    base: Point
    flags: int
    xref: bool
    entities: list[Entity]


@dataclass
class Reader:
    blocks: dict[str, Block]
    block_units: dict[str, int]
    header_unit: int | None
    skips: Skips = field(default_factory=Skips)
    omitted: list[OmittedShape] = field(default_factory=list)
    #: The block being expanded, if any: omitted shapes inside blocks have no plan position.
    _in_block: str | None = None
    warnings: list[str] = field(default_factory=list)
    _expanded: dict[str, list[Primitive]] = field(default_factory=dict)
    _count: int = 0
    _unit_warned: set[str] = field(default_factory=set)

    def count(self, n: int) -> None:
        self._count += n
        if self._count > MAX_DRAWING_LINES:
            raise DrawingError(
                "too_complex",
                f"The drawing has more than {MAX_DRAWING_LINES} lines and polylines once its "
                "blocks are expanded; this version reads up to that many. Export only the "
                "floor-layout layers, or freeze detail layers before exporting.",
            )

    def primitive(self, entity: Entity, block: str | None) -> Primitive | None:
        """A LINE, polyline, circle or arc as straight segments in its own frame, or None
        (skipped). Arc segments, arcs and circles are approximated by short straight segments."""
        kind = entity.type
        ref_entity: DrawingEntity
        if kind == "LINE":
            ref_entity = "LINE"
            points = [_xy(entity, 10, 20), _xy(entity, 11, 21)]
            closed = False
        elif kind in ("CIRCLE", "ARC"):
            ref_entity = "CIRCLE" if kind == "CIRCLE" else "ARC"
            ocs = _ocs(entity)
            if ocs is None:
                self.skip(entity, "Not drawn in the plan (tilted extrusion).", True)
                return None
            cx, cy = _xy(entity, 10, 20)
            r = entity.number(40)
            if r <= 0:
                self.skip(entity, "Degenerate: its radius is zero.", True)
                return None
            if kind == "CIRCLE":
                step = 2 * math.pi / CIRCLE_SIDES
                local = [
                    (cx + r * math.cos(i * step), cy + r * math.sin(i * step))
                    for i in range(CIRCLE_SIDES)
                ]
                closed = True
            else:
                start = math.radians(entity.number(50))
                end = math.radians(entity.number(51))
                sweep = (end - start) % (2 * math.pi) or 2 * math.pi
                local = _arc_points(cx, cy, r, start, sweep)
                closed = False
            points = [_apply(ocs, q) for q in local]
        elif kind == "LWPOLYLINE":
            ref_entity = "LWPOLYLINE"
            ocs = _ocs(entity)
            if ocs is None:
                self.skip(entity, "Not drawn in the plan (tilted extrusion).", True)
                return None
            xs = [_float(v) for c, v in entity.groups if c == 10]
            ys = [_float(v) for c, v in entity.groups if c == 20]
            # A bulge (code 42) belongs to the vertex before it.
            bulges: list[float] = []
            for c, v in entity.groups:
                if c == 10:
                    bulges.append(0.0)
                elif c == 42 and bulges:
                    bulges[-1] = _float(v)
            closed = _int(entity.first(70)) & 1 == 1
            local = list(zip(xs, ys, strict=False))
            if any(bulges):
                local = _bulged(local, bulges[: len(local)], closed)
            points = [_apply(ocs, p) for p in local]
        elif kind == "POLYLINE":
            ref_entity = "POLYLINE"
            flags = _int(entity.first(70))
            if flags & (8 | 16 | 64):
                self.skip(
                    entity, "3D polylines, meshes and polyface meshes are not supported.", True
                )
                return None
            if flags & (2 | 4):
                self.skip(entity, "Curve-fitted (smoothed) polylines are not supported.", True)
                return None
            ocs = _ocs(entity)
            if ocs is None:
                self.skip(entity, "Not drawn in the plan (tilted extrusion).", True)
                return None
            vertices = [
                v for v in entity.children if v.type == "VERTEX" and not _int(v.first(70)) & 16
            ]
            closed = flags & 1 == 1
            local = [_xy(v, 10, 20) for v in vertices]
            vertex_bulges = [_float(v.first(42) or "0") for v in vertices]
            if any(vertex_bulges):
                local = _bulged(local, vertex_bulges, closed)
            points = [_apply(ocs, q) for q in local]
        else:
            return None
        deduped = [p for i, p in enumerate(points) if i == 0 or p != points[i - 1]]
        if closed and len(deduped) > 1 and deduped[0] == deduped[-1]:
            deduped.pop()
        if len(deduped) < 2:
            self.skip(entity, "Degenerate: it has no length.", True)
            return None
        if len(deduped) > MAX_POINTS_PER_LINE:
            self.skip(entity, f"More than {MAX_POINTS_PER_LINE} vertices.", True)
            return None
        ref = DrawingRef(handle=entity.handle, layer=entity.layer, entity=ref_entity, block=block)
        return Primitive(deduped, closed and len(deduped) >= 3, ref)

    def skip(self, entity: Entity, reason: str, layout: bool) -> None:
        self.skips.add(entity.type, entity.layer, entity.handle, reason, layout)
        if not layout:
            return
        extent = None if self._in_block is not None else _extent(entity)
        if len(self.omitted) >= MAX_DRAWING_OBJECTS:
            extent = None  # beyond the record's limit: kept only as "somewhere"
            if self.omitted[-1].min is None and self.omitted[-1].entity == "(more)":
                return
            self.omitted.append(
                OmittedShape(entity="(more)", handle=None, layer=entity.layer, min=None, max=None)
            )
            return
        lo, hi = extent if extent else (None, None)
        self.omitted.append(
            OmittedShape(
                entity=entity.type,
                handle=entity.handle,
                layer=entity.layer,
                min=PlanPoint(x=lo[0], y=lo[1]) if lo else None,
                max=PlanPoint(x=hi[0], y=hi[1]) if hi else None,
            )
        )

    def classify_other(self, entity: Entity) -> None:
        kind = entity.type
        if kind in ANNOTATION:
            self.skip(entity, ANNOTATION[kind], False)
        elif kind in UNSUPPORTED:
            self.skip(entity, UNSUPPORTED[kind], True)
        elif kind not in ("TEXT", "MTEXT", "ATTRIB", "SEQEND", "VERTEX"):
            self.skip(entity, f"{kind} is not in the supported subset.", True)

    def insert_transform(self, entity: Entity) -> tuple[Affine, Block] | None:
        name = _clean_name(entity.first(2) or "")
        block = self.blocks.get(name.upper())
        if block is None:
            self.skip(entity, f"Its block '{name}' is not defined in the drawing.", True)
            return None
        if block.xref:
            self.skip(entity, f"Block '{name}' is an external reference; it is not read.", True)
            return None
        if _int(entity.first(70), 1) > 1 or _int(entity.first(71), 1) > 1:
            self.skip(entity, "Array inserts (MINSERT) are not supported.", True)
            return None
        ocs = _ocs(entity)
        if ocs is None:
            self.skip(entity, "Not drawn in the plan (tilted extrusion).", True)
            return None
        sx, sy = entity.number(41, 1.0), entity.number(42, 1.0)
        if sx == 0 or sy == 0:
            self.skip(entity, "Its scale is zero.", True)
            return None
        theta = math.radians(entity.number(50))
        cos, sin = math.cos(theta), math.sin(theta)
        ix, iy = _xy(entity, 10, 20)
        bx, by = block.base
        local: Affine = (
            cos * sx,
            -sin * sy,
            sin * sx,
            cos * sy,
            ix - (cos * sx * bx - sin * sy * by),
            iy - (sin * sx * bx + cos * sy * by),
        )
        return _compose(ocs, local), block

    def expand(self, block: Block, depth: int) -> list[Primitive]:
        """Every straight line of a block, in the block's own frame. Each line's reference names
        the blocks it is drawn in, from this one down (``CELL > CNC_MILL``)."""
        key = block.name.upper()
        if key in self._expanded:
            return self._expanded[key]
        if depth > MAX_NESTING:
            raise DrawingError(
                "too_complex",
                f"Blocks are nested more than {MAX_NESTING} deep (at '{block.name}'), or a block "
                "contains itself.",
            )
        self._warn_block_units(block)
        outer, self._in_block = self._in_block, block.name
        prims: list[Primitive] = []
        for entity in block.entities:
            if entity.type in ("LINE", "LWPOLYLINE", "POLYLINE", "CIRCLE", "ARC"):
                prim = self.primitive(entity, block.name)
                if prim:
                    prims.append(prim)
            elif entity.type == "INSERT":
                placed = self.insert_transform(entity)
                if placed is None:
                    continue
                transform, inner = placed
                for p in self.expand(inner, depth + 1):
                    ref = p.ref.model_copy(update={"block": f"{block.name} > {p.ref.block}"})
                    prims.append(Primitive([_apply(transform, q) for q in p.points], p.closed, ref))
            else:
                self.classify_other(entity)
            if len(prims) > MAX_DRAWING_LINES:
                self.count(len(prims))  # refuses: one block alone expands past the limit
        self._in_block = outer
        self._expanded[key] = prims
        return prims

    def _warn_block_units(self, block: Block) -> None:
        own = self.block_units.get(block.name.upper(), 0)
        if (
            own
            and self.header_unit
            and own != self.header_unit
            and block.name not in self._unit_warned
        ):
            self._unit_warned.add(block.name)
            self.warnings.append(
                f"Block '{block.name}' says it is drawn in {INSUNITS_NAME.get(own, 'other units')}"
                f", but the drawing says {INSUNITS_NAME.get(self.header_unit, 'other units')}. "
                "Its instances were read at the scale they are inserted with; check their size."
            )


#: Shapes whose listed coordinates do not bound them: infinite lines, inserts of unknown size,
#: and pictures sized in pixels.
_UNPLACEABLE: Final = frozenset(
    {"XLINE", "RAY", "INSERT", "IMAGE", "WIPEOUT"}
    | {"UNDERLAY", "PDFUNDERLAY", "DWFUNDERLAY", "DGNUNDERLAY"}
)


def _extent(entity: Entity) -> tuple[Point, Point] | None:
    """The plan extent of a shape that was not imported, from its coordinates, or None when it
    cannot be placed: infinite lines, inserts of unknown size, pictures, tilted shapes, curves
    that can bulge past their points (arc segments, a hatch's arc, ellipse or spline edges), or
    fewer than two distinct points. An extent is never smaller than the shape; it may be larger
    (a spline's control points, a hatch's elevation point)."""
    if entity.type in _UNPLACEABLE:
        return None
    if any(code == 42 and _float(value) != 0 for code, value in entity.groups):
        return None
    if entity.type == "HATCH" and any(code == 40 for code, _ in entity.groups):
        return None
    ocs = _ocs(entity)
    if ocs is None:
        return None
    if entity.type == "ELLIPSE":
        cx, cy = _xy(entity, 10, 20)
        r = math.hypot(entity.number(11), entity.number(21))
        return (cx - r, cy - r), (cx + r, cy + r)
    points: list[Point] = []
    pending: dict[int, float] = {}
    for code, value in entity.groups:
        if 10 <= code <= 18:
            pending[code] = _float(value)
        elif 20 <= code <= 28 and code - 10 in pending:
            points.append(_apply(ocs, (pending.pop(code - 10), _float(value))))
    if len(set(points)) < 2:
        return None
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return (min(xs), min(ys)), (max(xs), max(ys))


def _header(pairs: list[tuple[int, str]]) -> dict[str, str]:
    values: dict[str, str] = {}
    name: str | None = None
    for code, value in pairs:
        if code == 9:
            name = value.strip().upper()
        elif name is not None and name not in values and code in (1, 70):
            values[name] = value.strip()
    return values


def _tables(pairs: list[tuple[int, str]]) -> tuple[list[str], dict[str, int]]:
    layers: list[str] = []
    units: dict[str, int] = {}
    for entity in _split(pairs):
        if entity.type == "LAYER":
            name = _clean_name(entity.first(2) or "")
            if name and name not in layers:
                layers.append(name)
        elif entity.type == "BLOCK_RECORD":
            units[_clean_name(entity.first(2) or "").upper()] = _int(entity.first(70))
    return layers, units


def _blocks(pairs: list[tuple[int, str]]) -> dict[str, Block]:
    blocks: dict[str, Block] = {}
    current: Block | None = None
    for entity in _split(pairs):
        if entity.type == "BLOCK":
            name = _clean_name(entity.first(2) or "")
            flags = _int(entity.first(70))
            current = Block(name, _xy(entity, 10, 20), flags, bool(flags & (4 | 8)), [])
        elif entity.type == "ENDBLK":
            if current is not None and current.name:
                blocks[current.name.upper()] = current
            current = None
        elif current is not None and not entity.paper_space:
            current.entities.append(entity)
    return blocks


def _text_of(entity: Entity) -> tuple[str, Point] | None:
    if entity.type == "TEXT":
        ocs = _ocs(entity) or IDENTITY
        justified = _int(entity.first(72)) or _int(entity.first(73))
        at = (
            _xy(entity, 11, 21)
            if justified and entity.first(11) is not None
            else _xy(entity, 10, 20)
        )
        return _clean_name(entity.first(1) or ""), _apply(ocs, at)
    if entity.type == "MTEXT":
        chunks = [v for c, v in entity.groups if c == 3] + [entity.first(1) or ""]
        text = _MTEXT_CODE.sub(" ", "".join(chunks))
        return _clean_name(text), _xy(entity, 10, 20)
    return None


def _title(name: str) -> str:
    """A block or layer name as a label: underscores as spaces, long all-capital words
    capitalised (short ones such as CNC are kept)."""
    words = re.split(r"[_\s]+", name.strip())
    return " ".join(w.capitalize() if w.isupper() and len(w) > 3 else w for w in words if w)


def _generic(kind: ObjectKind, layer: str) -> str:
    """The name of an unnamed object, from what its layer says it is."""
    if kind == "walkway":
        return "Walkway"
    if kind == "keep_clear":
        return "Keep-clear zone"
    if kind == "structure":
        if re.search(r"\bcol(umn)?s?\b|column|pillar", layer, re.I):
            return "Column"
        return "Wall outline" if re.search("wall", layer, re.I) else "Structure"
    return _title(layer) or "Object"


def _kind(*names: str) -> ObjectKind:
    text = " ".join(names)
    if _WALKWAY.search(text):
        return "walkway"
    if _KEEP_CLEAR.search(text):
        return "keep_clear"
    if _STRUCTURE.search(text):
        return "structure"
    return "equipment"


def _units(header: dict[str, str], extent: tuple[Point, Point]) -> DrawingUnits:
    raw = header.get("$INSUNITS")
    code = _int(raw, -1) if raw is not None else None
    declared = INSUNITS.get(code) if code is not None else None
    measurement_raw = header.get("$MEASUREMENT")
    measurement: Literal["metric", "imperial"] | None = (
        None
        if measurement_raw is None
        else ("metric" if _int(measurement_raw) == 1 else "imperial")
    )
    question: str | None = None
    if code is None:
        question = "The drawing does not say what unit it is drawn in (it has no $INSUNITS)."
    elif code == 0:
        question = "The drawing does not say what unit it is drawn in ($INSUNITS is 0, unitless)."
    elif declared is None:
        question = (
            f"The drawing says it is drawn in {INSUNITS_NAME.get(code, f'unit code {code}')} "
            f"($INSUNITS {code}), which this reader does not use for floor layouts."
        )
    elif measurement is not None and (declared in IMPERIAL) != (measurement == "imperial"):
        question = (
            f"The drawing's header disagrees with itself: $INSUNITS says {UNIT_NAME[declared]}, "
            f"but $MEASUREMENT says {measurement}."
        )
    else:
        (x0, y0), (x1, y1) = extent
        across = max(x1 - x0, y1 - y0) * METRES_PER_UNIT[declared]
        low, high = PLAUSIBLE_SIZE_M
        if not low <= across <= high:
            question = (
                f"In {UNIT_NAME[declared]} (as the drawing says) the layout would be "
                f"{_size(across)} across, which is unusual for a floor layout."
            )
    return DrawingUnits(
        insunits=code, declared=declared, measurement=measurement, question=question, basis=None
    )


def _size(metres: float) -> str:
    if metres >= 1000:
        return f"{metres / 1000:.1f} km"
    if metres >= 1:
        return f"{metres:.1f} m"
    return f"{metres * 100:.1f} cm"


def read_drawing(data: bytes, filename: str) -> tuple[DrawingImport, list[str]]:
    """Read ``data`` (a DXF file) into a :class:`DrawingImport` and warnings, or raise
    :class:`DrawingError`. The unit is not settled here (``units.basis`` is null)."""
    text = _decode(data, filename)
    sections = _sections(_pairs(text))
    header = _header(sections.get("HEADER", []))
    layers, block_units = _tables(sections.get("TABLES", []))
    blocks = _blocks(sections.get("BLOCKS", []))
    header_code = _int(header.get("$INSUNITS"), 0) if "$INSUNITS" in header else None
    reader = Reader(blocks, block_units, header_code)

    lines: list[PlanLine] = []
    texts: list[PlanLabel] = []
    candidates: list[tuple[Primitive, Entity, list[Point], Footprint, list[str]]] = []
    open_lines: dict[str, int] = {}

    def add_line(prim: Primitive) -> None:
        lines.append(
            PlanLine(
                ref=prim.ref,
                points=[PlanPoint(x=x, y=y) for x, y in prim.points],
                closed=prim.closed,
            )
        )

    for entity in _split(sections.get("ENTITIES", [])):
        if entity.paper_space:
            reader.skip(entity, "In a paper-space sheet, not the model.", False)
            continue
        if entity.type in ("LINE", "LWPOLYLINE", "POLYLINE", "CIRCLE", "ARC"):
            prim = reader.primitive(entity, None)
            if prim is None:
                continue
            reader.count(1)
            add_line(prim)
            if prim.closed:
                if entity.type == "CIRCLE":
                    r = entity.number(40)
                    centre = _apply(_ocs(entity) or IDENTITY, _xy(entity, 10, 20))
                    fp = Footprint(centre, 2 * r, 2 * r, 0.0, False)
                    notes = [
                        f"A circle (radius {r:g} drawing units), drawn as a {CIRCLE_SIDES}-sided "
                        "outline; the box is the square around it."
                    ]
                else:
                    fp = _footprint_of_outline(prim.points)
                    notes = (
                        []
                        if fp.exact
                        else [
                            f"The outline is not a rectangle ({len(prim.points)} corners); the "
                            "box is the smallest rectangle around it."
                        ]
                    )
                if fp.width <= 0 or fp.depth <= 0:
                    reader.skip(entity, "Degenerate: its outline has no area.", True)
                    continue
                candidates.append((prim, entity, prim.points, fp, notes))
            else:
                open_lines[prim.ref.layer] = open_lines.get(prim.ref.layer, 0) + 1
        elif entity.type == "INSERT":
            placed = reader.insert_transform(entity)
            if placed is None:
                continue
            transform, block = placed
            prims = reader.expand(block, 1)
            if not prims:
                reader.skip(
                    entity, f"Block '{block.name}' has no lines or polylines to outline.", True
                )
                continue
            ref = DrawingRef(handle=entity.handle, layer=entity.layer, entity="INSERT", block=None)
            for p in prims:
                reader.count(1)
                add_line(Primitive([_apply(transform, q) for q in p.points], p.closed, p.ref))
            pts = [q for p in prims for q in p.points]
            x0, x1 = min(p[0] for p in pts), max(p[0] for p in pts)
            y0, y1 = min(p[1] for p in pts), max(p[1] for p in pts)
            corners = [_apply(transform, c) for c in ((x0, y0), (x1, y0), (x1, y1), (x0, y1))]
            ax = (corners[1][0] - corners[0][0], corners[1][1] - corners[0][1])
            angle = (
                math.atan2(ax[1], ax[0]) if ax != (0.0, 0.0) else math.radians(entity.number(50))
            )
            rect = _rect_along(corners, angle)
            notes = []
            if (transform[0] * transform[3] - transform[1] * transform[2]) < 0:
                notes.append("Mirrored in the drawing.")
            if rect.width <= 0 or rect.depth <= 0:
                # A block that is only a line has no footprint; it stays on the plan.
                open_lines[entity.layer] = open_lines.get(entity.layer, 0) + 1
                continue
            # The extent is exact when the block draws that very rectangle (an outline).
            box = {(round(x, 9), round(y, 9)) for x, y in ((x0, y0), (x1, y0), (x1, y1), (x0, y1))}
            drawn_box = any(
                p.closed
                and len(p.points) == 4
                and {(round(x, 9), round(y, 9)) for x, y in p.points} == box
                for p in prims
            )
            if not drawn_box:
                notes.append("The box is the extent of everything the block draws.")
            fp = Footprint(rect.centre, rect.width, rect.depth, _normalise(angle, False), drawn_box)
            candidates.append((Primitive(corners, True, ref), entity, corners, fp, notes))
        elif entity.type in ("TEXT", "MTEXT"):
            found = _text_of(entity)
            if found and found[0]:
                text_type: DrawingEntity = "TEXT" if entity.type == "TEXT" else "MTEXT"
                texts.append(
                    PlanLabel(
                        ref=DrawingRef(
                            handle=entity.handle, layer=entity.layer, entity=text_type, block=None
                        ),
                        text=found[0],
                        at=PlanPoint(x=found[1][0], y=found[1][1]),
                    )
                )
        else:
            reader.classify_other(entity)

    if not lines:
        raise DrawingError(
            "empty",
            "The drawing has no lines, straight polylines or blocks in model space, so there is "
            "no layout to read." + _skipped_summary(reader.skips),
        )
    xs = [p.x for line in lines for p in line.points]
    ys = [p.y for line in lines for p in line.points]
    extent = ((min(xs), min(ys)), (max(xs), max(ys)))
    extent_area = max((extent[1][0] - extent[0][0]) * (extent[1][1] - extent[0][1]), 1e-12)

    floor_index: int | None = None
    areas = [
        0.0 if prim.ref.entity == "INSERT" else _polygon_area(points)
        for prim, _, points, _, _ in candidates
    ]
    if areas:
        largest = max(range(len(areas)), key=lambda i: areas[i])
        if areas[largest] >= FLOOR_SHARE * extent_area and _kind(
            candidates[largest][0].ref.layer
        ) not in ("walkway", "keep_clear"):
            floor_index = largest

    # A text names only the smallest outline that contains it, and never an outline that holds
    # other objects (a building or a zone): a note inside a building is not its name.
    centres = [fp.centre for _, _, _, fp, _ in candidates]
    containers = {
        i
        for i, (_, _, outline, _, _) in enumerate(candidates)
        if any(j != i and _inside(c, outline) for j, c in enumerate(centres))
    }
    owned: dict[int, list[PlanLabel]] = {}
    for note in texts:
        holders = [
            i
            for i, (_, _, outline, _, _) in enumerate(candidates)
            if _inside((note.at.x, note.at.y), outline)
        ]
        if holders:
            owner = min(holders, key=lambda i: _polygon_area(candidates[i][2]))
            if owner not in containers:
                owned.setdefault(owner, []).append(note)

    objects: list[DrawingObject] = []
    used_ids: set[str] = set()
    per_layer: dict[str, int] = {}
    for index, (prim, entity, outline, fp, notes) in enumerate(candidates):
        ref = prim.ref
        label_from: Literal["attribute", "text", "block", "layer", "generic"]
        kind: ObjectKind
        handle = ref.handle.lower() if ref.handle else f"e{index}"
        base = f"dxf-{handle}"
        oid = base
        n = 2
        while oid in used_ids:
            oid, n = f"{base}-{n}", n + 1
        used_ids.add(oid)
        if index == floor_index:
            label, label_from, kind = "Floor", "generic", "structure"
            role: Literal["floor", "footprint"] = "floor"
            notes = [*notes, "The largest closed outline, built as the floor."]
        else:
            role = "footprint"
            block_name = _clean_name(entity.first(2) or "") if entity.type == "INSERT" else ""
            kind = _kind(ref.layer, block_name)
            label, label_from = _name(entity, outline, owned.get(index, []), blocks)
            if label_from == "layer":
                base_label = _generic(kind, ref.layer)
                per_layer[base_label] = per_layer.get(base_label, 0) + 1
                label = f"{base_label} {per_layer[base_label]}"
        objects.append(
            DrawingObject(
                id=oid,
                object_id=f"obj-{oid}",
                role=role,
                label=label,
                label_from=label_from,
                kind=kind,
                refs=[ref],
                outline=[PlanPoint(x=x, y=y) for x, y in outline],
                footprint_fit="exact" if fp.exact else "enclosing",
                centre=PlanPoint(x=fp.centre[0], y=fp.centre[1]),
                width=fp.width,
                depth=fp.depth,
                rotation_rad=fp.rotation,
                notes=notes,
            )
        )
    if len(objects) > MAX_DRAWING_OBJECTS:
        raise DrawingError(
            "too_complex",
            f"The drawing has {len(objects)} closed shapes and blocks; this version builds at "
            f"most {MAX_DRAWING_OBJECTS} objects. Export only the floor-layout layers.",
        )

    warnings = list(reader.warnings)
    if open_lines:
        total = sum(open_lines.values())
        where = ", ".join(f"{n} on {layer}" for layer, n in sorted(open_lines.items()))
        warnings.append(
            f"{total} open line{'s' if total != 1 else ''} ({where}) "
            f"{'are' if total != 1 else 'is'} shown on the plan but not built as objects: only "
            "closed outlines and blocks become objects."
        )
    if len(texts) > MAX_DRAWING_LABELS:
        warnings.append(
            f"The drawing has {len(texts)} texts; the first {MAX_DRAWING_LABELS} are kept."
        )
        texts = texts[:MAX_DRAWING_LABELS]

    drawing = DrawingImport(
        reader=READER,
        review=None,
        file=DrawingFile(uri=drawing_uri(hashlib.sha256(data).hexdigest()), bytes=len(data)),
        dxf_version=_clean_name(header.get("$ACADVER", "")) or None,
        units=_units(header, extent),
        layers=sorted({*layers, *(line.ref.layer for line in lines)}),
        extent_min=PlanPoint(x=extent[0][0], y=extent[0][1]),
        extent_max=PlanPoint(x=extent[1][0], y=extent[1][1]),
        lines=lines,
        labels=texts,
        objects=objects,
        skipped=reader.skips.records(),
        omitted=reader.omitted,
    )
    return drawing, warnings


def _skipped_summary(skips: Skips) -> str:
    kinds = sorted({entity for entity, _, layout, _ in skips.groups if layout})
    return f" It holds only {', '.join(kinds)}, which this reader does not import." if kinds else ""


def _name(
    entity: Entity,
    outline: list[Point],
    texts: list[PlanLabel],
    blocks: dict[str, Block],
) -> tuple[str, Literal["attribute", "text", "block", "layer"]]:
    if entity.type == "INSERT":
        for attrib in entity.children:
            tag = (attrib.first(2) or "").strip().upper()
            value = _clean_name(attrib.first(1) or "")
            if attrib.type == "ATTRIB" and tag in NAME_TAGS and value:
                return value, "attribute"
    inside = [t for t in texts if _inside((t.at.x, t.at.y), outline)]
    if inside:
        cx = sum(p[0] for p in outline) / len(outline)
        cy = sum(p[1] for p in outline) / len(outline)
        nearest = min(inside, key=lambda t: (t.at.x - cx) ** 2 + (t.at.y - cy) ** 2)
        return nearest.text, "text"
    if entity.type == "INSERT":
        name = _clean_name(entity.first(2) or "")
        block = blocks.get(name.upper())
        if name and not name.startswith("*") and not (block and block.flags & 1):
            return _title(name), "block"
    return entity.layer, "layer"


# --- Storage ---------------------------------------------------------------------------------


def drawing_uri(sha256: str) -> str:
    return f"{DRAWING_FOLDER}/{sha256}.dxf"


def analyse_drawing(data: bytes, filename: str, sources_dir: Path) -> DrawingAnalysis:
    """Read a DXF drawing and, only if it can be read, store it as ``drawings/<sha256>.dxf``.

    A refused file (DWG, binary DXF, damaged, empty, too large or too complex) is never stored.
    """
    drawing, warnings = read_drawing(data, filename)
    digest = hashlib.sha256(data).hexdigest()
    try:
        write_library_file(sources_dir, drawing_uri(digest), data, "drawing")
    except PhotoError as exc:
        raise DrawingError("unsafe", exc.message) from None
    bare = filename.replace("\\", "/").rsplit("/", 1)[-1].strip()
    name = "drawing.dxf" if bare in ("", ".", "..") else sanitise_filename(bare, "image/jpeg")
    return DrawingAnalysis(filename=name, sha256=digest, drawing=drawing, warnings=warnings)


def drawing_file(sources_dir: Path, uri: str) -> Path | None:
    """The library file for a drawing ``uri``, or None when it is not there (or unsafe)."""
    if not re.fullmatch(r"drawings/[0-9a-f]{64}\.dxf", uri):
        return None
    library = sources_dir.resolve()
    candidate = (library / PurePosixPath(uri)).resolve()
    if not candidate.is_relative_to(library) or not candidate.is_file():
        return None
    return candidate


def check_drawing_files(
    project: Project, sources_dir: Path
) -> tuple[list[dict[str, Any]], list[str]]:
    """Check each drawing source's stored file; return (validation issues, missing files).

    A missing file never blocks opening: the reading the scene was built from is in the project
    itself. An altered file is an issue: a different file is never treated as the original.
    """
    issues: list[dict[str, Any]] = []
    missing: list[str] = []
    for index, source in enumerate(project.sources):
        drawing = source.drawing
        if drawing is None or source.sha256 is None:
            continue
        path = drawing_file(sources_dir, drawing.file.uri)
        if path is None:
            missing.append(drawing.file.uri)
            continue
        with path.open("rb") as handle:
            digest = hashlib.file_digest(handle, "sha256").hexdigest()
        if digest != source.sha256:
            issues.append(
                {
                    "loc": ("body", "sources", index, "sha256"),
                    "msg": (
                        f"Source drawing '{source.filename}' in the source library differs from "
                        f"the recorded file (sha256 {source.sha256[:12]}…); a different file is "
                        "never used in its place."
                    ),
                    "type": "source_hash_mismatch",
                }
            )
    return issues, missing
