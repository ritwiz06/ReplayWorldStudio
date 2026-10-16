"""Can the user see what a revision added? Checks on the proposed specification (GEN-05).

A schema-valid proposal can still draw a requested part where nobody can see it: a stop button
wholly inside its box, cushions sunk into a seat of the same fabric, a stack light floating
above the machine, a cable tray hidden under a table top, or "slatted" sides drawn as single
boards. This module finds those cases for the parts a revision **added**, and fixes the ones a
deterministic rule can fix without guessing (colours). Everything else is reported, so the
review never presents a hidden or floating part as shown.

Geometry (every approved shape, exact membership tests on a sample grid):

* **hidden**: at least 95 % of the part lies inside other opaque parts;
* **buried**: at least 40 % of it lies inside a part of the same material (it cannot be told
  apart there);
* **floating**: no chain of touching parts links it to the floor (parts within 0.5 cm plus
  0.3 % of the object's largest side of each other count as touching),
  unless the instruction says it hangs or is mounted (a wall or ceiling outside the object);
* **solid slats**: the instruction asks for slats or gaps, but a side is one board.

Render (the generator's own meshes, a z-buffer from the review dialog's default camera):

* **unseen**: under 15 % of the part shows from that view (it is behind or under something).
  Copies with the same label are judged together. The object's structure (panels spanning at
  least 60 % of it on two axes; posts or rails spanning 60 % on one axis and at most 12 % on
  the others) counts as unseen only if the mirrored rear-left view does not show it either, so a
  back panel or rear post passes and a sheet under a table top does not;
* **blends in**: under 30 % of its outline borders the background or a clearly different
  colour.

Colour rules: a colour the instruction names for a part is honoured (the part is recoloured if
the model did not); an added part whose colour was not named and that blends into a part that
was already there (or sinks into one of its own material) gets an approved contrasting finish; a
requested colour whose texture the generator lacks ("red fabric") is drawn
in that colour, and only the texture is listed as not shown. Glass and clear plastic stay
transparent: they never hide what is behind them and are never recoloured for contrast.

Approximations: rounded boxes are tested as boxes; touch tests sample each part's box faces, so
round parts can count as touching slightly early; the render is 200 x 150 pixels, so parts that
cover fewer than 4 pixels from the default view are too small to judge there and are not
reported as unseen.
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
_SLATS: Final = re.compile(r"\b(?:slats?|slatted|gaps?\s+between)\b", re.IGNORECASE)
_WORD: Final = re.compile(r"[a-z]+")


@dataclass(frozen=True)
class Problem:
    """Something an added part does that a viewer cannot see past."""

    part_id: str
    label: str
    kind: str  # hidden, buried, floating, unseen, solid_slats
    text: str  # for the user
    feedback: str  # for the model's one corrected answer
    retry: bool = True  # False when asking again cannot help (the user chose the place)


@dataclass(frozen=True)
class ColourResult:
    spec: GeometrySpec
    notes: list[str]
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


def _touches(a: GeometryPart, b: GeometryPart, gap: float) -> bool:
    """True when the two parts overlap or come within ``gap`` of each other: points sampled in
    the overlap of their boxes (each grown by the gap) lie in both shapes (grown by half)."""
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
    n = SAMPLES
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


def render(spec: GeometrySpec, side: int = 1) -> View:
    """A z-buffer of the generator's meshes from the review dialog's default camera (front-right,
    above), or with ``side=-1`` from the mirrored rear-left camera."""
    e = spec.envelope_m
    reach = max(e.x, e.y, e.z)
    eye = (side * reach * 1.6, e.y * 0.9 + reach * 0.7, side * reach * 2.1)
    target = (0.0, e.y / 2, 0.0)
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
                    if opaque and z < depth[pix]:
                        depth[pix], seen[pix] = z, index
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


@dataclass(frozen=True)
class _Named:
    colour: str
    head: str  # the noun the colour belongs to ("guard" in "a yellow safety guard")
    nouns: list[str]  # every noun word in the phrase ("safety", "guard")
    texture: str | None
    phrase: str


def _clauses(instruction: str) -> list[list[str]]:
    out: list[list[str]] = []
    for chunk in re.split(r"[,;.:]|\band\b|\bbut\b|\bthen\b", instruction.lower()):
        words = _WORD.findall(chunk)
        if words:
            out.append(words)
    return out


def named_colours(instruction: str) -> list[_Named]:
    """Colours the instruction gives to particular parts ("a red cushion", "paint the legs
    black"). A colour for the whole object ("make it blue") names no part and is left to the
    model."""
    found: list[_Named] = []
    for words in _clauses(instruction):
        for i, w in enumerate(words):
            if w not in COLOURS or (w == "clear" and i + 1 < len(words) and words[i + 1] == "of"):
                continue
            after: list[str] = []
            for nxt in words[i + 1 : i + 5]:
                if nxt in _ENDS or nxt in COLOURS:
                    break
                after.append(nxt)
            nouns = [n for n in after if n not in TEXTURES and n not in _DETERMINERS]
            texture = next((n for n in after if n in TEXTURES), None)
            if not nouns:
                start = next((j for j in range(i - 1, -1, -1) if words[j] in _VERBS), None)
                if start is not None:
                    nouns = [
                        n
                        for n in words[start + 1 : i]
                        if n not in _DETERMINERS and n not in _MODIFIERS and n not in TEXTURES
                    ]
                    texture = texture or next(
                        (n for n in words[start + 1 : i] if n in TEXTURES), None
                    )
            nouns = [n for n in nouns if len(n) >= 3]
            if nouns:
                phrase = " ".join([w, *after]) if after else " ".join([*nouns, w])
                found.append(_Named(w, nouns[-1], nouns, texture, phrase))
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
    """Recolour parts whose named colour the proposal did not show; list missing textures."""
    before = {p.id for p in current.parts}
    parts = list(spec.parts)
    notes: list[str] = []
    honoured: set[str] = set()
    textures: list[str] = []
    named: set[str] = set()
    for item in named_colours(instruction):
        family = COLOURS[item.colour]
        # The colour belongs to the head noun's parts; parts named by the other words of the
        # phrase ("button" in "a red stop button box") may already show it.
        matched = [i for i, p in enumerate(parts) if _matches(p.label, [item.head])]
        if not matched:
            continue
        related = [i for i, p in enumerate(parts) if _matches(p.label, item.nouns)]
        named |= {parts[i].id for i in related}
        if not any(parts[i].material in family for i in related):
            new = [i for i in matched if parts[i].id not in before] or matched
            for i in new:
                parts[i] = parts[i].model_copy(update={"material": family[0]})
            labels = ", ".join(sorted({f"“{parts[i].label}”" for i in new}))
            notes.append(f"Coloured {labels} {item.colour}, as asked.")
        honoured.add(item.colour)
        if item.texture and not any(
            parts[i].material == _NATURAL.get(item.texture) for i in related
        ):
            textures.append(
                f"“{item.phrase}”: the {item.texture} texture is not shown; the colour is."
            )
    return ColourResult(
        spec=spec.model_copy(update={"parts": parts}),
        notes=notes,
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


def find_problems(spec: GeometrySpec, current: GeometrySpec, instruction: str) -> list[Problem]:
    """What the added parts do that a viewer cannot see past (nothing is changed here)."""
    before = {p.id for p in current.parts}
    parts = spec.parts
    added = [i for i, p in enumerate(parts) if p.id not in before]
    if not added:
        return []
    e = spec.envelope_m
    gap = 0.005 + 0.003 * max(e.x, e.y, e.z)
    problems: list[Problem] = []
    view = render(spec)
    hangs = bool(_HANGS.search(instruction))
    grounded = _grounded(parts, gap)
    unseen_reported: set[str] = set()
    behind: View | None = None
    for i in added:
        part = parts[i]
        points = _samples(part)
        opaque = [q for q in parts if q.id != part.id and q.material not in TRANSPARENT]
        holders = [sum(_inside(q, p) for p in points) for q in opaque]
        inside = sum(any(_inside(q, p) for q in opaque) for p in points) / len(points)
        if inside >= HIDDEN_SHARE:
            host = opaque[holders.index(max(holders))]
            problems.append(
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
            problems.append(
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
            problems.append(
                Problem(
                    part.id,
                    part.label,
                    "floating",
                    f"“{part.label}” does not touch anything that holds it up; it floats.",
                    f"Part {part.id} (“{part.label}”) touches no part that rests on the floor. "
                    "Move it, or add a short mount or post, so it is attached to the object.",
                )
            )
        if part.label in unseen_reported or not _asked_for(part.label, instruction):
            continue  # a helper part the user did not name (a mounting post) is not judged
        # Copies with the same label are judged together: one rear wheel of four out of view
        # is fine; all four under the pallet is not. The structure (a back panel, a rear post)
        # only counts as unseen when the rear-left view does not show it either.
        group = [j for j in added if parts[j].label == part.label]
        views = [view]
        if all(_structural(parts[j], e) for j in group):
            if behind is None:
                behind = render(spec, side=-1)
            views.append(behind)
        alone = [sum(len(v.covered[j]) for j in group) for v in views]
        shown = [
            sum(visible_pixels(v, j, parts[j].material in TRANSPARENT) for j in group)
            for v in views
        ]
        if alone[0] >= MIN_PIXELS and all(
            s_ < UNSEEN_SHARE * a for s_, a in zip(shown, alone, strict=True)
        ):
            shown, alone = shown[:1], alone[:1]
            unseen_reported.add(part.label)
            placed = bool(_PLACED_OUT_OF_VIEW.search(instruction))
            where = " where you asked for it" if placed else ""
            problems.append(
                Problem(
                    part.id,
                    part.label,
                    "unseen",
                    f"“{part.label}”{where} cannot be seen from the usual front-right view "
                    f"(only {shown[0] * 100 / alone[0]:.0f} % of it shows); turn the model to see "
                    "it.",
                    f"Part {part.id} (“{part.label}”) is almost completely covered by other parts "
                    "when the object is seen from the front-right, above. Place it where it can "
                    "be seen, for example at the front edge.",
                    retry=not placed,
                )
            )
    problems += _slat_problems(spec, current, instruction)
    return problems


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


def _grounded(parts: list[GeometryPart], gap: float) -> set[int]:
    """Indices of parts linked to the floor through touching parts."""
    floor = {i for i, p in enumerate(parts) if p.center_m.y - p.size_m.y / 2 <= gap}
    reached, frontier = set(floor), list(floor)
    while frontier:
        i = frontier.pop()
        for j, q in enumerate(parts):
            if j not in reached and _touches(parts[i], q, gap):
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
