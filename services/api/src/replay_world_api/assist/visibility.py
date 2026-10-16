"""Can the user see what a revision added? Checks on the proposed specification (GEN-05, GEN-06).

A schema-valid proposal can still draw a requested part where nobody can see it: a stop button
wholly inside its box, cushions sunk into a seat of the same fabric, a stack light floating
above the machine, a cable tray hidden under a table top, "slatted" sides drawn as single
boards, or a glass panel that vanishes against the background. This module finds those cases
for the parts a revision **added**, fixes the ones a deterministic rule can fix without guessing
(colours, a bounded size for a small item whose size was not given), and reports everything
else, so the review never presents a hidden or floating part as shown.

Geometry (every approved shape, exact membership tests on a sample grid):

* **hidden**: at least 95 % of the part lies inside other opaque parts;
* **buried**: at least 40 % of it lies inside a part of the same material;
* **floating**: no chain of touching parts links it to the floor or to a part kept from the
  current model, unless the instruction says it hangs or is mounted. Two parts touch when they
  come within a tolerance that depends on both: 1 cm plus 0.6 % of the object's largest side,
  or 60 % of the thinner part's smallest side if that is more, at most 3 cm (a slat 1.6 cm
  from its post touches; a stack light 11 cm above its machine does not);
* **solid slats**: the instruction asks for slats or gaps, but a side is one board.

Render (the generator's own meshes, a z-buffer from the review dialog's cameras):

* **tiny**: a part the user asked for, with no size given, still under 4 % of the object's
  largest side and covering under 12 pixels after the bounded enlargement below;
* **unseen**: under 15 % of the part shows from the front-right view (it is behind or under
  something). Copies with the same label are judged together; the object's structure (large
  panels, long posts and rails) only fails if the rear-left view does not show it either;
* **transparent parts** (glass, clear plastic) are judged on the composited picture, not on
  raw pixels: the review draws their edges in a mid-tone blue that reads on light and dark
  backgrounds, and blends their surface over what is behind. A transparent part counts as shown
  when the mean of its showing outline share and its noticeably shifted surface share is at
  least 30 % (on the dialog's dark background);
* **blends in**: a part whose colour the user named, where under 30 % of its outline borders
  the background or a clearly different colour (reported; the named colour is kept).

Corrections that need no guess:

* a colour the instruction names for a part is shown (recoloured if the model did not); a
  texture the generator lacks ("dark blue fabric") is listed and the colour drawn; "the legs
  black and the armrests blue" carries the verb across "and"; "red and white" gives one part
  two colours, of which a part can show one (the other is listed);
* an added part whose colour was not named and that blends into a part that was already there
  gets an approved contrasting finish;
* a requested small part with no size given, under 4 % of the object's largest side, is
  enlarged, about the face that touches what holds it, to 5 % of that side, at most 12 cm and
  3 times its size, and only inside
  the object's recorded size; each enlargement is listed as an estimate. Pieces of one
  requested assembly ("lamp arm", "lamp head") are left as drawn.

Approximations: rounded boxes are tested as boxes; touching is sampled in the overlap of two
parts; the render is 200 x 150 pixels with flat material colours (no lighting), so parts that
cover fewer than 4 pixels are too small to judge for "unseen".
"""

from __future__ import annotations

import math
import re
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Final

from replay_world_contracts import Extent3, GeometrySpec
from replay_world_contracts.models import GeometryPart

from ..objects import MATERIALS, part_mesh

HIDDEN_SHARE: Final = 0.95
BURIED_SHARE: Final = 0.40
UNSEEN_SHARE: Final = 0.15
CONTRAST_SHARE: Final = 0.30
MIN_PIXELS: Final = 4
STRUCTURAL_SHARE: Final = 0.6
SLENDER_SHARE: Final = 0.12
VIEW_W: Final = 200
VIEW_H: Final = 150
FOV_DEG: Final = 35.0
TOUCH_SAMPLES: Final = 12
TINY_SHARE: Final = 0.04
VISIBLE_SHARE: Final = 0.05
"""An enlarged small part becomes this share of the object's largest side (within the caps)."""
TINY_PIXELS: Final = 12
MAX_ENLARGED_M: Final = 0.12
MAX_ENLARGE_FACTOR: Final = 3.0
TOUCH_MAX_M: Final = 0.03
EDGE_SHARE: Final = 0.30
GLASS_EDGE: Final = "#3a8fd6"
"""The colour the review draws transparent parts' edges in (apps/web/src/scene/modelLoader.ts)."""
PREVIEW_BACKGROUND: Final = "#1f2329"
"""The review dialog's preview background (apps/web/src/scene/ModelPreview.tsx)."""
VIEWS: Final = ("front-right", "rear-left", "low-front")
"""The review dialog's camera views (apps/web/src/scene/ModelPreview.tsx keeps the same ones)."""
SAMPLES: Final = 6
"""Sample points per axis inside a part (6 x 6 x 6) for the volume tests."""

TRANSPARENT: Final = frozenset(name for name, spec in MATERIALS.items() if spec.opacity is not None)

COLOURS: Final[dict[str, tuple[str, ...]]] = {
    "red": ("paint_red", "estop_red", "signal_red"),
    "yellow": ("safety_yellow", "signal_amber"),
    "orange": ("paint_orange", "signal_amber"),
    "green": ("paint_green", "signal_green"),
    "blue": ("paint_blue", "motor_blue"),
    "white": ("paint_white", "signal_white"),
    "black": ("plastic_black", "rubber_black", "label_black"),
    "grey": ("paint_light_grey", "plastic_grey", "fabric_grey", "paint_anthracite", "concrete"),
    "gray": ("paint_light_grey", "plastic_grey", "fabric_grey", "paint_anthracite", "concrete"),
    "anthracite": ("paint_anthracite",),
    "silver": ("aluminium", "stainless_steel"),
    "brown": ("wood", "pallet_wood", "cardboard"),
    "wooden": ("wood", "pallet_wood"),
    "wood": ("wood", "pallet_wood"),
    "copper": ("copper",),
    "glass": ("glass_clear", "polycarbonate"),
    "clear": ("glass_clear", "polycarbonate"),
    "transparent": ("glass_clear", "polycarbonate"),
}
"""Colour and finish words a user may name, and the approved materials that show them (the
first is used when a part has to be recoloured)."""

TEXTURES: Final = frozenset(
    [
        "fabric",
        "leather",
        "velvet",
        "wool",
        "woollen",
        "cotton",
        "linen",
        "suede",
        "marble",
        "wicker",
        "rattan",
        "denim",
        "carpet",
        "felt",
        "canvas",
    ]
)
_NATURAL: Final = {"fabric": "fabric_grey"}
CONTRAST_FINISHES: Final = (
    "paint_white",
    "paint_anthracite",
    "paint_blue",
    "plastic_black",
    "paint_light_grey",
)
_MODIFIERS: Final = frozenset({"safety", "dark", "light", "bright", "pale", "deep"})
_NOT_PARTS: Final = frozenset(
    {"colour", "color", "finish", "paint", "shade", "tone", "look", "one"}
)
_VERBS: Final = frozenset({"paint", "make", "colour", "color", "turn", "change", "give"})
_ENDS: Final = frozenset(
    [
        "on",
        "under",
        "below",
        "above",
        "at",
        "to",
        "in",
        "into",
        "onto",
        "along",
        "for",
        "with",
        "of",
        "and",
        "but",
        "that",
        "which",
        "so",
        "so",
        "beside",
        "behind",
        "between",
        "near",
        "over",
        "from",
    ]
)
_DETERMINERS: Final = frozenset(
    ["the", "a", "an", "both", "all", "its", "it", "them", "their", "every", "each", "this"]
)
_HANGS: Final = re.compile(
    r"\b(?:hang\w*|hung|suspend\w*|float\w*|wall[- ]mounted|mounted\s+on\s+the\s+wall|ceiling)\b",
    re.IGNORECASE,
)
_PLACED_OUT_OF_VIEW: Final = re.compile(
    r"\b(?:under|underneath|beneath|behind|inside|within|at\s+the\s+back|on\s+the\s+back)\b",
    re.IGNORECASE,
)
_LENGTH: Final = re.compile(r"\d+(?:[.,]\d+)?\s*(?:mm|cm|m|metres?|meters?|inch\w*|in)\b", re.I)
_SLATS: Final = re.compile(r"\b(?:slats?|slatted|gaps?\s+between)\b", re.IGNORECASE)
_WORD: Final = re.compile(r"[a-z]+")


@dataclass(frozen=True)
class Problem:
    """Something an added part does that a viewer cannot see past."""

    part_id: str
    label: str
    kind: str  # hidden, buried, floating, tiny, unseen, blends, solid_slats
    text: str  # for the user
    feedback: str  # for the model's one corrected answer
    retry: bool = True  # False when asking again cannot help (the user chose the place)
    part_ids: tuple[str, ...] = ()  # every part the problem is about (copies with one label)

    @property
    def parts(self) -> tuple[str, ...]:
        return self.part_ids or (self.part_id,)


@dataclass(frozen=True)
class Adjustment:
    """A visual choice the app made without asking (never a measurement)."""

    kind: str  # enlarged, coloured_as_asked, contrast
    part_ids: tuple[str, ...]
    text: str


@dataclass(frozen=True)
class ColourResult:
    spec: GeometrySpec
    notes: list[str]
    adjustments: list[Adjustment]
    honoured: set[str]  # colour words shown on the parts they were asked for
    texture_limits: list[str]  # not-represented entries for textures that cannot be shown
    named_parts: set[str]  # ids of parts whose colour the instruction names


# --- Membership --------------------------------------------------------------------------------


def _inside(part: GeometryPart, p: tuple[float, float, float], pad: float = 1e-6) -> bool:
    c, s = part.center_m, part.size_m
    d = (p[0] - c.x, p[1] - c.y, p[2] - c.z)
    h = (s.x / 2 + pad, s.y / 2 + pad, s.z / 2 + pad)
    if any(abs(d[i]) > h[i] for i in range(3)):
        return False
    if part.shape in ("box", "rounded_box"):
        return True
    if part.shape == "sphere":
        return sum((d[i] / h[i]) ** 2 for i in range(3)) <= 1
    if part.shape == "cylinder":
        a = "xyz".index(part.axis or "y")
        u, v = [i for i in range(3) if i != a]
        return (d[u] / h[u]) ** 2 + (d[v] / h[v]) ** 2 <= 1
    # frustum: upright; the radius changes linearly from one end to the other
    taper = part.taper if part.taper is not None else 1.0
    low, high = (1.0, taper) if part.narrow_end == "top" else (taper, 1.0)
    t = (d[1] + h[1]) / (2 * h[1])
    scale = max(low + (high - low) * t, 1e-9)
    return (d[0] / (h[0] * scale)) ** 2 + (d[2] / (h[2] * scale)) ** 2 <= 1


def _samples(part: GeometryPart) -> list[tuple[float, float, float]]:
    c, s = part.center_m, part.size_m
    axis = [
        [c_ + s_ * ((i + 0.5) / SAMPLES - 0.5) for i in range(SAMPLES)]
        for c_, s_ in ((c.x, s.x), (c.y, s.y), (c.z, s.z))
    ]
    points = [(x, y, z) for x in axis[0] for y in axis[1] for z in axis[2]]
    return [p for p in points if _inside(part, p)] or [(c.x, c.y, c.z)]


def touch_tolerance(a: GeometryPart, b: GeometryPart, base: float) -> float:
    """How close two parts must come to count as touching: ``base`` (1 cm plus 0.6 % of the
    object's largest side), or 60 % of the thinner part's smallest side if that is more, at
    most 3 cm. A slat 1.6 cm from a 3 cm post touches; a light 11 cm above its machine does
    not."""
    thinner = min(min(a.size_m.x, a.size_m.y, a.size_m.z), min(b.size_m.x, b.size_m.y, b.size_m.z))
    return min(TOUCH_MAX_M, max(base, 0.6 * thinner))


def _touches(a: GeometryPart, b: GeometryPart, tolerance: float) -> bool:
    """True when the two parts overlap or come within ``tolerance`` of each other: points
    sampled in the overlap of their boxes (each grown by half the tolerance) lie in both
    shapes (each grown by half)."""
    gap = tolerance / 2
    lo, hi = [], []
    for k in "xyz":
        ca, sa = getattr(a.center_m, k), getattr(a.size_m, k) / 2 + gap
        cb, sb = getattr(b.center_m, k), getattr(b.size_m, k) / 2 + gap
        low, high = max(ca - sa, cb - sb), min(ca + sa, cb + sb)
        if low > high:
            return False
        lo.append(low)
        hi.append(high)
    if a.shape in ("box", "rounded_box") and b.shape in ("box", "rounded_box"):
        return True
    n = TOUCH_SAMPLES  # finer than the volume grid: round parts often touch along one tangent
    grid = [[lo[i] + (hi[i] - lo[i]) * (j + 0.5) / n for j in range(n)] for i in range(3)]
    return any(
        _inside(a, (x, y, z), gap) and _inside(b, (x, y, z), gap)
        for x in grid[0]
        for y in grid[1]
        for z in grid[2]
    )


# --- Render ------------------------------------------------------------------------------------


@dataclass(frozen=True)
class View:
    """Which part is seen at each pixel, and every pixel each part would cover on its own."""

    seen: list[int]  # part index per pixel (opaque parts), -1 for background
    covered: list[dict[int, float]]  # per part: pixel -> depth
    opaque_depth: list[float]


def camera(
    spec: GeometrySpec, view: str
) -> tuple[tuple[float, float, float], tuple[float, float, float]]:
    """Eye and target of one of the review dialog's views (ModelPreview.tsx uses the same)."""
    e = spec.envelope_m
    reach = max(e.x, e.y, e.z)
    if view == "rear-left":
        return (-reach * 1.6, e.y * 0.9 + reach * 0.7, -reach * 2.1), (0.0, e.y / 2, 0.0)
    if view == "low-front":
        return (reach * 1.1, e.y * 0.12, reach * 2.6), (0.0, e.y * 0.4, 0.0)
    return (reach * 1.6, e.y * 0.9 + reach * 0.7, reach * 2.1), (0.0, e.y / 2, 0.0)


def render(spec: GeometrySpec, side: int = 1, view: str | None = None) -> View:
    """A z-buffer of the generator's meshes from one of the review dialog's views: the default
    front-right view from above, the rear-left view (``side=-1``), or the low front view."""
    eye, target = camera(spec, view or ("front-right" if side > 0 else "rear-left"))
    f = _norm(tuple(target[i] - eye[i] for i in range(3)))
    r = _norm(_cross(f, (0.0, 1.0, 0.0)))
    u = _cross(r, f)
    t = math.tan(math.radians(FOV_DEG) / 2)
    aspect = VIEW_W / VIEW_H

    def project(v: tuple[float, float, float]) -> tuple[float, float, float]:
        d = (v[0] - eye[0], v[1] - eye[1], v[2] - eye[2])
        z = max(_dot(d, f), 1e-6)
        x = _dot(d, r) / (z * t * aspect)
        y = _dot(d, u) / (z * t)
        return ((x + 1) / 2 * VIEW_W, (1 - y) / 2 * VIEW_H, z)

    size = VIEW_W * VIEW_H
    depth = [math.inf] * size
    seen = [-1] * size
    covered: list[dict[int, float]] = []
    for index, part in enumerate(spec.parts):
        mesh = part_mesh(part)
        screen = [project(p) for p in mesh.positions]
        mine: dict[int, float] = {}
        opaque = part.material not in TRANSPARENT
        for k in range(0, len(mesh.indices), 3):
            a, b, c = (screen[mesh.indices[k + m]] for m in range(3))
            area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
            if abs(area) < 1e-12:
                continue
            x0, x1 = max(int(min(a[0], b[0], c[0])), 0), min(int(max(a[0], b[0], c[0])) + 1, VIEW_W)
            y0, y1 = max(int(min(a[1], b[1], c[1])), 0), min(int(max(a[1], b[1], c[1])) + 1, VIEW_H)
            for py in range(y0, y1):
                cy = py + 0.5
                for px in range(x0, x1):
                    cx = px + 0.5
                    w0 = ((b[0] - cx) * (c[1] - cy) - (b[1] - cy) * (c[0] - cx)) / area
                    w1 = ((c[0] - cx) * (a[1] - cy) - (c[1] - cy) * (a[0] - cx)) / area
                    w2 = 1 - w0 - w1
                    if w0 < 0 or w1 < 0 or w2 < 0:
                        continue
                    z = 1 / (w0 / a[2] + w1 / b[2] + w2 / c[2])
                    pix = py * VIEW_W + px
                    if z < mine.get(pix, math.inf):
                        mine[pix] = z
                    # A later part wins a face it shares with an earlier one, as in the viewer
                    # (apps/web/src/scene/modelLoader.ts, separateCoincidentFaces).
                    if opaque and z <= depth[pix] + 1e-9:
                        depth[pix], seen[pix] = min(z, depth[pix]), index
        covered.append(mine)
    return View(seen=seen, covered=covered, opaque_depth=depth)


def visible_pixels(view: View, index: int, transparent: bool) -> int:
    if transparent:
        return sum(
            1 for pix, z in view.covered[index].items() if z <= view.opaque_depth[pix] + 1e-6
        )
    return sum(1 for pix in view.covered[index] if view.seen[pix] == index)


def contrast_share(view: View, spec: GeometrySpec, index: int) -> tuple[float, int | None]:
    """Share of the part's visible outline that borders the background or a clearly different
    colour, and the part it mostly borders."""
    mine = spec.parts[index].material
    edge = contrast = 0
    neighbours: dict[int, int] = {}
    for pix in view.covered[index]:
        if view.seen[pix] != index:
            continue
        px, py = pix % VIEW_W, pix // VIEW_W
        for nx, ny in ((px + 1, py), (px - 1, py), (px, py + 1), (px, py - 1)):
            if not (0 <= nx < VIEW_W and 0 <= ny < VIEW_H):
                continue
            other = view.seen[ny * VIEW_W + nx]
            if other == index:
                continue
            edge += 1
            if other < 0:
                contrast += 1
                continue
            material = spec.parts[other].material
            neighbours[other] = neighbours.get(other, 0) + 1
            if colour_distance(mine, material) > 60:
                contrast += 1
    beside = max(neighbours, key=lambda m: neighbours[m]) if neighbours else None
    return (contrast / edge if edge else 1.0), beside


FILL_CONTRAST: Final = 30.0
"""How far (in sRGB units) a transparent surface must shift what is behind it to be noticed."""


def outline_share(
    view: View, spec: GeometrySpec, index: int, background: str = PREVIEW_BACKGROUND
) -> float:
    """For a transparent part, how much of it shows in the composited picture: the mean of (a)
    the share of its outline that shows, drawn in the review's edge colour, against what is
    actually behind it, and (b) the share of its unoccluded surface whose blend (the part's
    colour at its opacity over what is behind) differs noticeably from what is behind."""
    mine = view.covered[index]
    if not mine:
        return 0.0
    material = MATERIALS[spec.parts[index].material]
    alpha = material.opacity if material.opacity is not None else 1.0
    glass = _rgb(material.color_srgb)
    edge = _rgb(GLASS_EDGE)
    outline = outlined = fill = filled = 0
    for pix, z in mine.items():
        px, py = pix % VIEW_W, pix // VIEW_W
        border = any(
            not (0 <= nx < VIEW_W and 0 <= ny < VIEW_H) or (ny * VIEW_W + nx) not in mine
            for nx, ny in ((px + 1, py), (px - 1, py), (px, py + 1), (px, py - 1))
        )
        occluded = z > view.opaque_depth[pix] + 1e-6
        seen = view.seen[pix]
        behind = (
            _rgb(MATERIALS[spec.parts[seen].material].color_srgb) if seen >= 0 else _rgb(background)
        )
        if border:
            outline += 1
            if not occluded and math.dist(edge, behind) > 60:
                outlined += 1
        else:
            fill += 1
            if not occluded and alpha * math.dist(glass, behind) > FILL_CONTRAST:
                filled += 1
    edges = outlined / outline if outline else 0.0
    surface = filled / fill if fill else edges
    return (edges + surface) / 2


def colour_distance(a: str, b: str) -> float:
    ca, cb = _rgb(MATERIALS[a].color_srgb), _rgb(MATERIALS[b].color_srgb)
    return math.dist(ca, cb)


def _rgb(hex_colour: str) -> tuple[int, int, int]:
    h = hex_colour.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _dot(a: Iterable[float], b: Iterable[float]) -> float:
    return sum(x * y for x, y in zip(a, b, strict=True))


def _cross(a: tuple[float, ...], b: tuple[float, ...]) -> tuple[float, float, float]:
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _norm(v: tuple[float, ...]) -> tuple[float, float, float]:
    n = math.sqrt(_dot(v, v))
    return (v[0] / n, v[1] / n, v[2] / n)


# --- Colours named in the instruction ---------------------------------------------------------


@dataclass
class _Named:
    colours: list[str]  # one, or two joined by "and" ("red and white")
    head: str  # the noun the colour belongs to ("guard" in "a yellow safety guard")
    nouns: list[str]  # every noun word in the phrase ("safety", "guard")
    texture: str | None
    phrase: str


def named_colours(instruction: str) -> list[_Named]:
    """Colours the instruction gives to particular parts ("a red cushion", "paint the legs
    black"). A colour for the whole object ("make it blue") names no part and is left to the
    model.

    Elliptical clauses keep the verb of their sentence ("make the legs black and the armrests
    dark blue fabric"), whichever comes first; a clause that is only a colour ("paint the frame
    red and white") is a second colour for the part just named.
    """
    found: list[_Named] = []
    for sentence in re.split(r"[.;:]", instruction.lower()):
        verb_seen = False
        for chunk in re.split(r",|\band\b|\bbut\b|\bthen\b", sentence):
            words = _WORD.findall(chunk)
            if not words:
                continue
            content = [w for w in words if w not in _DETERMINERS and w not in _MODIFIERS]
            if found and content and all(w in COLOURS or w in TEXTURES for w in content):
                # "... red and white": another colour for the part just named.
                last = found[-1]
                last.colours += [w for w in content if w in COLOURS and w not in last.colours]
                last.texture = last.texture or next((w for w in content if w in TEXTURES), None)
                last.phrase = f"{last.phrase} and {' '.join(content)}"
                verb_seen = verb_seen or any(w in _VERBS for w in words)
                continue
            for i, w in enumerate(words):
                if w not in COLOURS or (
                    w == "clear" and i + 1 < len(words) and words[i + 1] == "of"
                ):
                    continue
                after: list[str] = []
                for nxt in words[i + 1 : i + 5]:
                    if nxt in _ENDS or nxt in COLOURS:
                        break
                    after.append(nxt)
                nouns = [
                    n
                    for n in after
                    if n not in TEXTURES and n not in _DETERMINERS and n not in _NOT_PARTS
                ]
                texture = next((n for n in after if n in TEXTURES), None)
                if not nouns:
                    start = next((j for j in range(i - 1, -1, -1) if words[j] in _VERBS), None)
                    if start is None and verb_seen:
                        start = -1  # the verb is in an earlier clause of the sentence
                    if start is not None:
                        before_colour = words[start + 1 : i]
                        nouns = [
                            n
                            for n in before_colour
                            if n not in _DETERMINERS
                            and n not in _MODIFIERS
                            and n not in TEXTURES
                            and n not in COLOURS
                            and n not in _NOT_PARTS
                        ]
                        texture = texture or next((n for n in before_colour if n in TEXTURES), None)
                nouns = [n for n in nouns if len(n) >= 3]
                if nouns:
                    phrase = " ".join([w, *after]) if after else " ".join([*nouns, w])
                    found.append(_Named([w], nouns[-1], nouns, texture, phrase))
            verb_seen = verb_seen or any(w in _VERBS for w in words)
    return found


def _stem(word: str) -> str:
    for suffix in ("es", "s"):
        if word.endswith(suffix) and len(word) - len(suffix) >= 3:
            return word[: -len(suffix)]
    return word


def _matches(label: str, nouns: list[str]) -> bool:
    label_words = [_stem(w) for w in _WORD.findall(label.lower())]
    stems = [_stem(n) for n in nouns]
    return any(lw == n or (len(n) >= 3 and lw.endswith(n)) for lw in label_words for n in stems)


def honour_colours(spec: GeometrySpec, current: GeometrySpec, instruction: str) -> ColourResult:
    """Recolour parts whose named colour the proposal did not show; list missing textures, and
    a second colour one part cannot show."""
    before = {p.id for p in current.parts}
    parts = list(spec.parts)
    notes: list[str] = []
    adjustments: list[Adjustment] = []
    honoured: set[str] = set()
    textures: list[str] = []
    named: set[str] = set()
    for item in named_colours(instruction):
        # The colour belongs to the head noun's parts; parts named by the other words of the
        # phrase ("button" in "a red stop button box") may already show it.
        matched = [i for i, p in enumerate(parts) if _matches(p.label, [item.head])]
        if not matched:
            continue
        related = [i for i, p in enumerate(parts) if _matches(p.label, item.nouns)]
        named |= {parts[i].id for i in related}
        shown = [c for c in item.colours if any(parts[i].material in COLOURS[c] for i in related)]
        if not shown:
            colour = item.colours[0]
            new = [i for i in matched if parts[i].id not in before] or matched
            for i in new:
                parts[i] = parts[i].model_copy(update={"material": COLOURS[colour][0]})
            labels = ", ".join(sorted({f"“{parts[i].label}”" for i in new}))
            note = f"Coloured {labels} {colour}, as asked."
            notes.append(note)
            adjustments.append(
                Adjustment("coloured_as_asked", tuple(parts[i].id for i in new), note)
            )
            shown = [colour]
        honoured |= set(shown)
        missing = [c for c in item.colours if c not in shown]
        if missing:
            textures.append(
                f"“{item.phrase}”: one part shows one colour; {' and '.join(missing)} is not "
                f"shown, {' and '.join(shown)} is."
            )
        if item.texture and not any(
            parts[i].material == _NATURAL.get(item.texture) for i in related
        ):
            textures.append(
                f"“{item.phrase}”: the {item.texture} texture is not shown; the colour is."
            )
    return ColourResult(
        spec=spec.model_copy(update={"parts": parts}),
        notes=notes,
        adjustments=adjustments,
        honoured=honoured,
        texture_limits=textures,
        named_parts=named,
    )


def contrast_additions(
    spec: GeometrySpec, current: GeometrySpec, named_parts: set[str]
) -> tuple[GeometrySpec, list[str]]:
    """Give an added part whose colour was not asked for a contrasting approved finish when it
    blends into a part that was already there (or is sunk into one of its own material). Parts
    of a rebuilt structure (shelves among new panels) keep the model's colours."""
    before = {p.id for p in current.parts}
    parts = list(spec.parts)
    notes: list[str] = []
    view = render(spec)
    for i, part in enumerate(parts):
        if part.id in before or part.id in named_parts or part.material in TRANSPARENT:
            continue
        share, beside = contrast_share(view, spec, i)
        host = _most_overlapped(part, parts)
        same = _same_material_share(part, parts)
        if share < CONTRAST_SHARE and beside is not None and parts[beside].id in before:
            around = parts[beside]
        elif same >= BURIED_SHARE and host is not None and host.id in before:
            around = host
        else:
            continue
        finish = max(CONTRAST_FINISHES, key=lambda m: colour_distance(m, around.material))
        parts[i] = part.model_copy(update={"material": finish})
        notes.append(
            f"Coloured “{part.label}” {finish.replace('_', ' ')} so it stands out from the "
            f"“{around.label}” it sits on (no colour was asked for)."
        )
    return spec.model_copy(update={"parts": parts}), notes


def enlarge_small(
    spec: GeometrySpec, current: GeometrySpec, instruction: str
) -> tuple[GeometrySpec, list[Adjustment]]:
    """Bring a requested small part whose size the user did not give up to a size that can be
    seen: 4 % of the object's largest side, at most 12 cm and 3 times its size, about the face
    that touches what holds it, and only inside the object's recorded size (which never
    changes here). Each enlargement is an estimate and says so."""
    before = {p.id for p in current.parts}
    e = spec.envelope_m
    reach = max(e.x, e.y, e.z)
    least = VISIBLE_SHARE * reach
    base = 0.01 + 0.006 * reach
    parts = list(spec.parts)
    adjustments: list[Adjustment] = []
    by_label: dict[str, list[int]] = {}
    for i, p in enumerate(parts):
        if (
            p.id not in before
            and _asked_for(p.label, instruction)
            and not _sized(p.label, instruction)
        ):
            by_label.setdefault(p.label, []).append(i)
    pieces = _assembly_pieces(spec, current, instruction)
    for label, group in by_label.items():
        if label in pieces:
            continue  # pieces of one requested assembly ("lamp arm", "lamp head"): left as drawn
        size = max(max(parts[i].size_m.x, parts[i].size_m.y, parts[i].size_m.z) for i in group)
        if size >= TINY_SHARE * reach:
            continue
        target = min(least, MAX_ENLARGED_M, MAX_ENLARGE_FACTOR * size)
        if target <= size * 1.05:
            continue
        factor = target / size
        changed: list[int] = []
        for i in group:
            grown = _grow(parts[i], factor, parts, e, base)
            if grown is not None:
                parts[i] = grown
                changed.append(i)
        if changed:
            new = max(max(parts[i].size_m.x, parts[i].size_m.y, parts[i].size_m.z) for i in changed)
            adjustments.append(
                Adjustment(
                    "enlarged",
                    tuple(parts[i].id for i in changed),
                    f"Enlarged “{label}” from {size * 100:.0f} cm to {new * 100:.0f} cm across so "
                    "it can be seen. No size was given, so this is an estimate, not a "
                    "measurement; the object's overall size is unchanged.",
                )
            )
    return spec.model_copy(update={"parts": parts}), adjustments


def _assembly_pieces(spec: GeometrySpec, current: GeometrySpec, instruction: str) -> set[str]:
    """Labels of added parts that are pieces of one requested item: several labels share the
    requested word ("lamp arm", "lamp head", "lamp joint" for "a desk lamp")."""
    before = {p.id for p in current.parts}
    asked = {_stem(w) for w in _WORD.findall(instruction.lower()) if len(w) >= 3}
    labels = {p.label for p in spec.parts if p.id not in before}
    keys = {label: {_stem(w) for w in _WORD.findall(label.lower())} & asked for label in labels}
    return {
        label
        for label in labels
        if keys[label] and any(keys[label] & keys[other] for other in labels if other != label)
    }


def _grow(
    part: GeometryPart, factor: float, parts: list[GeometryPart], e: Extent3, base: float
) -> GeometryPart | None:
    """The part scaled by ``factor``, keeping the face that touches what holds it in place and
    staying inside the envelope; None when it cannot grow there."""
    holder = next(
        (q for q in parts if q.id != part.id and _touches(part, q, touch_tolerance(part, q, base))),
        None,
    )
    center = {a: getattr(part.center_m, a) for a in "xyz"}
    size = {a: getattr(part.size_m, a) for a in "xyz"}
    low = {"x": -e.x / 2, "y": 0.0, "z": -e.z / 2}
    high = {"x": e.x / 2, "y": e.y, "z": e.z / 2}
    anchor: dict[str, str] = {}
    for a in "xyz":
        lo, hi = center[a] - size[a] / 2, center[a] + size[a] / 2
        if holder is not None:
            q_lo = getattr(holder.center_m, a) - getattr(holder.size_m, a) / 2
            q_hi = getattr(holder.center_m, a) + getattr(holder.size_m, a) / 2
            if abs(lo - q_hi) <= 0.02:
                anchor[a] = "low"  # resting on the holder's face: keep that face
            elif abs(hi - q_lo) <= 0.02:
                anchor[a] = "high"  # hanging from the holder's face: keep that face
    # Grow only as far as the envelope allows on every axis (it never changes here).
    room = factor
    for a in "xyz":
        lo, hi = center[a] - size[a] / 2, center[a] + size[a] / 2
        if anchor.get(a) == "low":
            room = min(room, (high[a] - lo) / size[a])
        elif anchor.get(a) == "high":
            room = min(room, (hi - low[a]) / size[a])
        else:
            room = min(room, 2 * min(center[a] - low[a], high[a] - center[a]) / size[a])
    if room <= 1.05:
        return None
    new_size = {a: size[a] * room for a in "xyz"}
    for a in "xyz":
        lo, hi = center[a] - size[a] / 2, center[a] + size[a] / 2
        if anchor.get(a) == "low":
            center[a] = lo + new_size[a] / 2
        elif anchor.get(a) == "high":
            center[a] = hi - new_size[a] / 2
    return part.model_copy(
        update={
            "center_m": part.center_m.model_copy(update={a: round(center[a], 6) for a in "xyz"}),
            "size_m": part.size_m.model_copy(update={a: round(new_size[a], 6) for a in "xyz"}),
        }
    )


def best_view(spec: GeometrySpec, current: GeometrySpec, instruction: str) -> str:
    """The review view that shows the requested additions best: the standard front-right view
    unless another view shows clearly more of them (at least half again, and visibly)."""
    before = {p.id for p in current.parts}
    wanted = [
        i
        for i, p in enumerate(spec.parts)
        if p.id not in before and _asked_for(p.label, instruction)
    ]
    if not wanted:
        return "front-right"
    scores: dict[str, float] = {}
    for name in VIEWS:
        view = render(spec, view=name)
        scores[name] = sum(
            outline_share(view, spec, i) * len(view.covered[i])
            if spec.parts[i].material in TRANSPARENT
            else visible_pixels(view, i, False)
            for i in wanted
        )
    best = max(VIEWS, key=lambda n: scores[n])
    if best != "front-right" and scores[best] >= max(1.5 * scores["front-right"], MIN_PIXELS):
        return best
    return "front-right"


def _same_material_share(part: GeometryPart, parts: list[GeometryPart]) -> float:
    others = [q for q in parts if q.id != part.id and q.material == part.material]
    if not others:
        return 0.0
    points = _samples(part)
    return sum(any(_inside(q, p) for q in others) for p in points) / len(points)


def _most_overlapped(part: GeometryPart, parts: list[GeometryPart]) -> GeometryPart | None:
    points = _samples(part)
    best, count = None, 0
    for q in parts:
        if q.id == part.id:
            continue
        n = sum(_inside(q, p) for p in points)
        if n > count:
            best, count = q, n
    return best


# --- Problems ----------------------------------------------------------------------------------


VIEW_NAMES: Final = {
    "front-right": "the usual front-right view",
    "rear-left": "the view from behind",
    "low-front": "the low view from the front",
}


def find_problems(spec: GeometrySpec, current: GeometrySpec, instruction: str) -> list[Problem]:
    """What the added parts do that a viewer cannot see past (nothing is changed here). One
    problem per kind and label, naming every part it is about."""
    before = {p.id for p in current.parts}
    parts = spec.parts
    added = [i for i, p in enumerate(parts) if p.id not in before]
    if not added:
        return []
    e = spec.envelope_m
    reach = max(e.x, e.y, e.z)
    base = 0.01 + 0.006 * reach
    found: list[Problem] = []
    views: dict[str, View] = {"front-right": render(spec)}

    def view_of(name: str) -> View:
        if name not in views:
            views[name] = render(spec, view=name)
        return views[name]

    hangs = bool(_HANGS.search(instruction))
    grounded = _grounded(list(parts), base, before)
    judged: set[str] = set()
    pieces = _assembly_pieces(spec, current, instruction)
    colours = {pid for item in named_colours(instruction) for pid in _named_ids(item, parts)}
    for i in added:
        part = parts[i]
        points = _samples(part)
        opaque = [q for q in parts if q.id != part.id and q.material not in TRANSPARENT]
        holders = [sum(_inside(q, p) for p in points) for q in opaque]
        inside = sum(any(_inside(q, p) for q in opaque) for p in points) / len(points)
        if inside >= HIDDEN_SHARE:
            host = opaque[holders.index(max(holders))]
            found.append(
                Problem(
                    part.id,
                    part.label,
                    "hidden",
                    f"“{part.label}” is hidden inside “{host.label}”, so it cannot be seen.",
                    f"Part {part.id} (“{part.label}”) lies inside part {host.id} (“{host.label}”). "
                    "Move it so it sits on that part's outer surface and stays visible.",
                )
            )
            continue
        same = 0.0 if part.material in TRANSPARENT else _same_material_share(part, list(parts))
        if same >= BURIED_SHARE:
            found.append(
                Problem(
                    part.id,
                    part.label,
                    "buried",
                    f"“{part.label}” is sunk {same * 100:.0f} % into a part of the same "
                    f"material ({part.material.replace('_', ' ')}), so it is hard to tell apart.",
                    f"Part {part.id} (“{part.label}”) is {same * 100:.0f} % inside a part of the "
                    "same material. Place it on that part's surface instead of inside it.",
                )
            )
        if i not in grounded and not hangs:
            found.append(
                Problem(
                    part.id,
                    part.label,
                    "floating",
                    f"“{part.label}” does not touch anything that holds it up; it floats.",
                    f"Part {part.id} (“{part.label}”) touches no part that rests on the floor. "
                    "Move it, or add a short mount or post, so it is attached to the object.",
                )
            )
        if part.label in judged or not _asked_for(part.label, instruction):
            continue  # a helper part the user did not name (a mounting post) is not judged
        judged.add(part.label)
        group = [j for j in added if parts[j].label == part.label]
        ids = tuple(parts[j].id for j in group)
        size = max(max(parts[j].size_m.x, parts[j].size_m.y, parts[j].size_m.z) for j in group)
        main = view_of("front-right")
        if (
            part.label not in pieces
            and size * 1.05 < TINY_SHARE * reach
            and sum(len(main.covered[j]) for j in group) < TINY_PIXELS
            and not _sized(part.label, instruction)
        ):
            least = min(TINY_SHARE * reach, MAX_ENLARGED_M)
            found.append(
                Problem(
                    part.id,
                    part.label,
                    "tiny",
                    f"“{part.label}” is only {size * 100:.0f} cm across, too small to see from "
                    "the usual view.",
                    f"Part {part.id} (“{part.label}”) is only {size * 100:.0f} cm across, too "
                    f"small to see. No size was given: make it at least {least * 100:.0f} cm "
                    "across.",
                    part_ids=ids,
                )
            )
            continue

        # How much shows, from each view, in the composited picture: for glass and clear
        # plastic the share of their edges that stand out from what is behind them.
        def shown(name: str, group: list[int] = group) -> float:
            v = view_of(name)
            alone = sum(len(v.covered[j]) for j in group)
            if alone < MIN_PIXELS:
                return 1.0  # too small to judge from this view (the tiny rule covers it)
            if all(parts[j].material in TRANSPARENT for j in group):
                return sum(outline_share(v, spec, j) * len(v.covered[j]) for j in group) / alone
            return (
                sum(visible_pixels(v, j, parts[j].material in TRANSPARENT) for j in group) / alone
            )

        transparent = all(parts[j].material in TRANSPARENT for j in group)
        threshold = EDGE_SHARE if transparent else UNSEEN_SHARE
        front = shown("front-right")
        if front < threshold:
            structural = all(_structural(parts[j], e) for j in group)
            others = {name: shown(name) for name in VIEWS if name != "front-right"}
            better = max(others, key=lambda n: others[n])
            if structural and others["rear-left"] >= threshold:
                continue  # a back panel or rear post: the view from behind shows it
            placed = bool(_PLACED_OUT_OF_VIEW.search(instruction))
            where = " where you asked for it" if placed else ""
            elsewhere = f"; {VIEW_NAMES[better]} shows it" if others[better] >= threshold else ""
            if transparent:
                text = (
                    f"“{part.label}” is hard to see: only {front * 100:.0f} % of its edges show "
                    f"against what is behind it in the usual view{elsewhere}."
                )
            else:
                text = (
                    f"“{part.label}”{where} cannot be seen from the usual front-right view (only "
                    f"{front * 100:.0f} % of it shows){elsewhere or '; turn the model to see it'}."
                )
            occluded = sum(visible_pixels(main, j, parts[j].material in TRANSPARENT) for j in group)
            found.append(
                Problem(
                    part.id,
                    part.label,
                    "unseen",
                    text,
                    f"Part {part.id} (“{part.label}”) is almost completely covered by other parts "
                    "when the object is seen from the front-right, above. Place it where it can "
                    "be seen, for example at the front edge.",
                    # Asking again cannot move a part from where the user put it, nor make clear
                    # glass less clear.
                    retry=not placed
                    and not (transparent and occluded >= UNSEEN_SHARE * len(main.covered[i])),
                    part_ids=ids,
                )
            )
            continue
        if part.id in colours and not transparent and not any(part.id in f.parts for f in found):
            share, _beside = contrast_share(main, spec, i)
            if share < CONTRAST_SHARE and visible_pixels(main, i, False) >= MIN_PIXELS:
                found.append(
                    Problem(
                        part.id,
                        part.label,
                        "blends",
                        f"“{part.label}” is in the colour you asked for, but blends into what is "
                        "around it, so it is hard to tell apart.",
                        "",
                        retry=False,
                        part_ids=ids,
                    )
                )
    found += _slat_problems(spec, current, instruction)
    return _merge(found)


def _merge(problems: list[Problem]) -> list[Problem]:
    """One problem per kind and label: copies of one part share a sentence and list every id."""
    merged: dict[tuple[str, str], Problem] = {}
    for p in problems:
        key = (p.kind, p.label)
        if key in merged:
            old = merged[key]
            merged[key] = Problem(
                old.part_id,
                old.label,
                old.kind,
                old.text,
                old.feedback,
                old.retry and p.retry,
                tuple(dict.fromkeys(old.parts + p.parts)),
            )
        else:
            merged[key] = Problem(p.part_id, p.label, p.kind, p.text, p.feedback, p.retry, p.parts)
    return list(merged.values())


def _named_ids(item: _Named, parts: list[GeometryPart] | tuple[GeometryPart, ...]) -> list[str]:
    return [p.id for p in parts if _matches(p.label, [item.head])]


def _sized(label: str, instruction: str) -> bool:
    """The user gave a size in the clause that names this part ("a 30 cm lamp")."""
    words = {_stem(w) for w in _WORD.findall(label.lower()) if len(w) >= 3}
    for clause in re.split(r",|;|\.|\band\b|\bbut\b", instruction.lower()):
        if _LENGTH.search(clause) and words & {_stem(w) for w in _WORD.findall(clause)}:
            return True
    return False


def _asked_for(label: str, instruction: str) -> bool:
    """The part's label shares a word with the instruction (so the user asked for it)."""
    asked = {_stem(w) for w in _WORD.findall(instruction.lower()) if len(w) >= 3}
    return any(_stem(w) in asked for w in _WORD.findall(label.lower()) if len(w) >= 3)


def _structural(part: GeometryPart, envelope: Extent3) -> bool:
    """A panel (spanning most of the object on two axes) or a post or rail (on one axis, and
    slender on the others): the structure itself, which one view never shows completely (a back
    panel, a rear post), rather than an item added to it (a tray, a button, a wheel)."""
    shares: list[float] = sorted(
        float(getattr(part.size_m, a)) / float(getattr(envelope, a)) for a in "xyz"
    )
    panel = shares[1] >= STRUCTURAL_SHARE
    member = shares[2] >= STRUCTURAL_SHARE and shares[1] <= SLENDER_SHARE
    return panel or member


def _grounded(parts: list[GeometryPart], base: float, kept: set[str]) -> set[int]:
    """Indices of parts linked to the floor, or to a part kept from the current model, through
    touching parts. The model the user started from counts as supported: only additions are
    judged (a template whose legs stand clear of its round body does not make every addition
    to it "floating")."""
    floor = {
        i for i, p in enumerate(parts) if p.center_m.y - p.size_m.y / 2 <= base or p.id in kept
    }
    reached, frontier = set(floor), list(floor)
    while frontier:
        i = frontier.pop()
        for j, q in enumerate(parts):
            if j not in reached and _touches(parts[i], q, touch_tolerance(parts[i], q, base)):
                reached.add(j)
                frontier.append(j)
    return reached


def _slat_problems(spec: GeometrySpec, current: GeometrySpec, instruction: str) -> list[Problem]:
    if not _SLATS.search(instruction):
        return []
    before = {p.id for p in current.parts}
    e = spec.envelope_m
    slats = [p for p in spec.parts if p.id not in before and p.material not in TRANSPARENT]
    sides: dict[tuple[str, int], list[GeometryPart]] = {}
    for p in slats:
        thin = min("xz", key=lambda a: getattr(p.size_m, a))
        if getattr(p.size_m, thin) > 0.25 * getattr(e, thin):
            continue  # not a thin upright board
        sides.setdefault((thin, round(getattr(p.center_m, thin) * 100)), []).append(p)
    out: list[Problem] = []
    for (thin, _), boards in sides.items():
        if len(boards) > 1:
            continue
        board = boards[0]
        across = "z" if thin == "x" else "x"
        if board.size_m.y >= 0.6 * e.y and getattr(board.size_m, across) >= 0.6 * getattr(
            e, across
        ):
            out.append(
                Problem(
                    board.id,
                    board.label,
                    "solid_slats",
                    f"“{board.label}” is one solid board; the slats and gaps asked for are not "
                    "drawn on that side.",
                    f"Part {board.id} (“{board.label}”) is a single board covering the whole side. "
                    "Replace it with several narrower slats with gaps between them (use repeat).",
                )
            )
    return out
