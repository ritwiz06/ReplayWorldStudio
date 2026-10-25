"""Read one step's own words (UX-05).

The chat model returns, for each step, the person's words for that step only (``said``). Every
number, unit, direction, angle and size is read here, from those words, by plain parsing, so a
value is attached to the step - and the object - whose words contain it: in "Move A 1 m right
and B 2 m left", A's step reads "1 m right" and B's "2 m left", whatever the model wrote.
Anything ambiguous returns None and the step asks.
"""

from __future__ import annotations

import re
from typing import Final, Literal

from .edits import _DIRECTION_WORDS, _TURN_WORDS, _says, _words
from .lengths import FoundLength, appears_in, find_angles, find_lengths

Axis = Literal["width", "depth", "height"]

# Words after a length that say which axis it is ("1.5 m wide"), or before it ("width of 1.5 m").
_AXIS_AFTER: Final[tuple[tuple[str, Axis], ...]] = (
    (r"wide|in width|across", "width"),
    (r"deep|in depth", "depth"),
    (r"high|tall|in height", "height"),
)
_AXIS_BEFORE: Final[tuple[tuple[str, Axis], ...]] = (
    (r"width", "width"),
    (r"depth", "depth"),
    (r"height", "height"),
)
_NEGATION: Final = re.compile(r"\b(?:do not|don't|dont|never|without|no need to)\b", re.I)
_REFERRING: Final = ("it", "its", "this", "that", "these", "those", "them", "selected")
# Words of a step that never name an object.
_NOT_NAMES: Final = frozenset(
    {
        *("move", "moving", "shift", "slide", "push", "pull", "put", "place", "turn", "rotate"),
        *("select", "show", "highlight", "find", "check", "add", "and", "then", "also", "by"),
        *("degrees", "degree", "deg", "clockwise", "counterclockwise", "anticlockwise"),
        *("counter-clockwise", "anti-clockwise", "cw", "ccw", "routes", "route", "its", "again"),
        *("metre", "metres", "meter", "meters", "m", "cm", "mm", "ft", "feet", "foot", "inch"),
        *("inches", "please", "now", "there", "so", "over", "about", "around", "exactly"),
    }
)
_DIRECTIONS: Final = frozenset(w for words in _DIRECTION_WORDS.values() for w in words)


def own_words(said: str, message: str) -> str | None:
    """``said`` when it is the person's words (case and spacing aside); else None."""
    said = said.strip()
    return said if said and appears_in(said, message) else None


def negated(clause: str) -> bool:
    """The step's words say not to do it ("do not move it")."""
    return bool(_NEGATION.search(clause))


def refers_back(clause: str) -> bool:
    return _says(clause, _REFERRING)


def name_words(clause: str) -> list[str]:
    """The words of a step that could name its object ("the rack" -> ["rack"])."""
    return [
        w
        for w in _words(clause)
        if w not in _NOT_NAMES
        and w not in _DIRECTIONS
        and w not in _REFERRING
        and not re.fullmatch(r"[\d.,]+", w)
    ]


def move_in(clause: str) -> tuple[str, float, str] | None:
    """(direction, distance, unit) when the words state exactly one length and one direction."""
    lengths = find_lengths(clause)
    directions = [d for d, words in _DIRECTION_WORDS.items() if _says(clause, words)]
    if len(lengths) != 1 or len(directions) != 1:
        return None
    return directions[0], lengths[0].value, lengths[0].unit


def turn_in(clause: str) -> tuple[str, float] | None:
    """(direction, degrees) when the words state exactly one angle and one turn direction."""
    angles = find_angles(clause)
    turns = [d for d, words in _TURN_WORDS.items() if _says(clause, words)]
    if len(angles) != 1 or len(turns) != 1 or not 0 < angles[0] <= 360:
        return None
    return turns[0], angles[0]


def sizes_in(clause: str) -> dict[Axis, FoundLength]:
    """Each length the words tie to an axis: "1.5 m wide", "a depth of 0.8 m". A length without
    an axis word ("1.5 x 0.8 m", "2 m long") is not assigned to any axis."""
    found: dict[Axis, FoundLength] = {}
    lowered = clause.casefold()
    for length in find_lengths(clause):
        at = lowered.find(length.text.casefold())
        if at < 0:
            continue
        after = lowered[at + len(length.text) : at + len(length.text) + 14]
        before = lowered[max(0, at - 16) : at]
        axis = next(
            (a for pattern, a in _AXIS_AFTER if re.match(rf"\s*(?:{pattern})\b", after)), None
        ) or next(
            (
                a
                for pattern, a in _AXIS_BEFORE
                if re.search(rf"\b(?:{pattern})\s*(?:of|is|:|=)?\s*$", before)
            ),
            None,
        )
        if axis is not None and axis not in found:
            found[axis] = length
    return found


def width_in(clause: str) -> FoundLength | None:
    """An item width for a route check, when the words state exactly one length."""
    lengths = find_lengths(clause)
    return lengths[0] if len(lengths) == 1 else None


def side_in(clause: str) -> Literal["left", "right", "front", "back"] | None:
    """Which side to stand on, only when said ("to the left of", "behind")."""
    lowered = clause.casefold()
    sides: list[Literal["left", "right", "front", "back"]] = []
    if re.search(r"\bleft of\b|\bto the left\b", lowered):
        sides.append("left")
    if re.search(r"\bright of\b|\bto the right\b", lowered):
        sides.append("right")
    if re.search(r"\bin front of\b", lowered):
        sides.append("front")
    if re.search(r"\bbehind\b|\bat the back of\b", lowered):
        sides.append("back")
    return sides[0] if len(sides) == 1 else None
