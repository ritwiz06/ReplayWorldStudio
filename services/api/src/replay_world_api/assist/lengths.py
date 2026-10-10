"""Find lengths and plain numbers in the user's own words.

A language model may claim that a value "came from the user". The API checks that claim here:
a stated length must appear in the text, with a unit, as a number that converts to the same
metres. Anything else is treated as an estimate. Parsing is deliberately literal: it reads
"2.2 m", "2200 mm", "7 ft", "1.2 x 0.8 m" and "half a metre", and nothing it cannot find in
the text.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Final

METRES_PER_UNIT: Final[dict[str, float]] = {
    "km": 1000.0,
    "mm": 0.001,
    "cm": 0.01,
    "m": 1.0,
    "in": 0.0254,
    "ft": 0.3048,
}

_UNIT_WORDS: Final = (
    (r"kilomet(?:er|re)s?|km", "km"),
    (r"millimet(?:er|re)s?|mm", "mm"),
    (r"centimet(?:er|re)s?|cm", "cm"),
    (r"met(?:er|re)s?|m", "m"),
    (r"inch(?:es)?|in|\"|\u2033", "in"),  # \u2033 double prime
    (r"feet|foot|ft|'|\u2032", "ft"),  # \u2032 prime
)
_UNIT = "|".join(f"(?:{pattern})" for pattern, _ in _UNIT_WORDS)
_NUMBER = r"\d+(?:[.,]\d+)?|\.\d+"
_NUMBER_WORDS: Final[dict[str, float]] = {
    "half a": 0.5,
    "half": 0.5,
    "a quarter": 0.25,
    "a": 1.0,
    "an": 1.0,
    "one": 1.0,
    "two": 2.0,
    "three": 3.0,
    "four": 4.0,
    "five": 5.0,
    "six": 6.0,
    "seven": 7.0,
    "eight": 8.0,
    "nine": 9.0,
    "ten": 10.0,
    "twenty": 20.0,
    "thirty": 30.0,
    "forty-five": 45.0,
    "ninety": 90.0,
}
_WORD = "|".join(sorted((re.escape(w) for w in _NUMBER_WORDS), key=len, reverse=True))

# "1.2 x 0.8 x 2 m" or "1.2 by 0.8 m": the unit after the last number applies to all of them.
_SERIES = re.compile(
    rf"(?<![\w.])((?:{_NUMBER})(?:\s*(?:x|\u00d7|by)\s*(?:{_NUMBER})){{1,2}})\s*({_UNIT})(?![a-z])",
    re.IGNORECASE,
)
_SINGLE = re.compile(rf"(?<![\w.])({_NUMBER}|{_WORD})\s*-?\s*({_UNIT})(?![a-z])", re.IGNORECASE)
# Articles count as "one" only before a unit ("a metre"), never on their own.
_COUNT_WORD = "|".join(
    sorted((re.escape(w) for w in _NUMBER_WORDS if w not in ("a", "an")), key=len, reverse=True)
)
_ANGLE = re.compile(
    rf"(?<![\w.])({_NUMBER}|{_COUNT_WORD})\s*(?:°|deg(?:ree)?s?\b)|\b(quarter|half)[ -]turn\b",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class FoundLength:
    """A length written in the text: its value in metres and the exact words."""

    metres: float
    value: float
    unit: str
    text: str


def _unit_key(word: str) -> str:
    lowered = word.lower()
    for pattern, key in _UNIT_WORDS:
        if re.fullmatch(pattern, lowered):
            return key
    raise ValueError(f"unknown unit {word!r}")


def _number(token: str) -> float:
    lowered = token.lower()
    if lowered in _NUMBER_WORDS:
        return _NUMBER_WORDS[lowered]
    return float(token.replace(",", "."))


def find_lengths(text: str) -> list[FoundLength]:
    """Every length in ``text``, in order of appearance."""
    found: list[tuple[int, FoundLength]] = []
    covered: list[tuple[int, int]] = []
    for match in _SERIES.finditer(text):
        unit = _unit_key(match.group(2))
        for number in re.findall(_NUMBER, match.group(1)):
            value = _number(number)
            found.append(
                (
                    match.start(),
                    FoundLength(value * METRES_PER_UNIT[unit], value, unit, match.group(0)),
                )
            )
        covered.append(match.span())
    for match in _SINGLE.finditer(text):
        if any(start <= match.start() < end for start, end in covered):
            continue
        unit = _unit_key(match.group(2))
        # A bare "m" after "a" is the article plus a word ("a machine"), not "1 m".
        if match.group(1).lower() in ("a", "an") and not re.match(
            r"\s*(?:met(?:er|re)|foot|inch)", text[match.end(1) :], re.IGNORECASE
        ):
            continue
        value = _number(match.group(1))
        found.append(
            (match.start(), FoundLength(value * METRES_PER_UNIT[unit], value, unit, match.group(0)))
        )
    return [length for _, length in sorted(found, key=lambda item: item[0])]


def same_length(a_m: float, b_m: float) -> bool:
    """Equal within 0.5 mm or 0.5 %, whichever is larger (absorbs unit rounding only)."""
    return abs(a_m - b_m) <= max(0.0005, 0.005 * max(abs(a_m), abs(b_m)))


def find_stated(text: str, value_m: float) -> FoundLength | None:
    """The first length in ``text`` equal to ``value_m``, or None."""
    return next((f for f in find_lengths(text) if same_length(f.metres, value_m)), None)


def find_angles(text: str) -> list[float]:
    """Angles in degrees written in ``text`` ("90°", "45 degrees", "a quarter turn")."""
    angles: list[float] = []
    for match in _ANGLE.finditer(text):
        if match.group(1):
            angles.append(_number(match.group(1)))
        else:
            angles.append(90.0 if match.group(2).lower() == "quarter" else 180.0)
    return angles


def normalise(text: str) -> str:
    return " ".join(text.split()).casefold()


def appears_in(fragment: str, text: str) -> bool:
    return normalise(fragment) in normalise(text)
