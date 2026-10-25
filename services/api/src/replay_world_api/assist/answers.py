"""The shapes a language model is asked to answer in, and the JSON Schema sent with the request.

These are the provider-facing drafts, not contract records: they are checked here, then
converted (with grounding and bounded-geometry rules) into the contract's proposals. Unknown
fields are refused so schema adherence is measured honestly.
"""

from __future__ import annotations

import copy
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from replay_world_contracts.assist import DistanceUnit, MoveDirection
from replay_world_contracts.models import GeometryMaterial, GeometryShape


class _Raw(BaseModel):
    # Lenient on number types (2 is accepted for 2.0), strict on structure.
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class RawVec(_Raw):
    x: float
    y: float
    z: float


class RawPart(_Raw):
    id: str = Field(description="Short lowercase id, e.g. 'belt' or 'leg-front-left'.")
    label: str = Field(description="What the part is, in a few words.")
    shape: GeometryShape
    material: GeometryMaterial
    center_m: RawVec
    size_m: RawVec
    # Required for every part so schema-guided decoding cannot leave a cylinder without one;
    # it is ignored for other shapes.
    axis: Literal["x", "y", "z"] = Field(
        description='The direction a cylinder runs. For other shapes use "y"; it is ignored.'
    )
    taper: float | None = Field(description="Frustums only (0..1); otherwise null.")
    narrow_end: Literal["top", "bottom"] | None = Field(description="Frustums only.")
    basis: Literal["stated", "inferred"]


class RawLength(_Raw):
    value_m: float
    basis: Literal["stated", "inferred"]
    quote: str | None = Field(description="Exact words of the description, when stated.")


class RawDimensions(_Raw):
    width: RawLength
    height: RawLength
    depth: RawLength


class RawObjectAnswer(_Raw):
    outcome: Literal["proposal", "clarification", "unsupported"]
    question: str | None
    message: str | None
    name: str | None
    category: str | None
    appearance: str | None
    dimensions: RawDimensions | None
    stated_facts: list[str]
    inferred_facts: list[str]
    not_modelled: list[str]
    parts: list[RawPart]


class RawCounts(_Raw):
    x: int
    y: int
    z: int


class RawRepeat(_Raw):
    """One new part copied along X, Y and Z: ``counts`` copies per axis, ``step_m`` apart (centre
    to centre); the given part is the first copy. Keeps answers short for repeated items."""

    part: RawPart
    counts: RawCounts
    step_m: RawVec


class RawRevisionAnswer(_Raw):
    """A revision as changes to the current parts (GEN-04): parts not listed are kept as they
    are, so the answer stays short and unrelated parts cannot drift."""

    outcome: Literal["revision", "unsupported", "already_satisfied"]
    message: str | None = Field(description="For unsupported or already_satisfied: why.")
    summary: str | None = Field(description="What changed, in one sentence.")
    envelope_m: RawVec
    remove: list[str] = Field(description="IDs of current parts to remove.")
    change: list[RawPart] = Field(description="Current parts (same id) with new values.")
    add: list[RawPart] = Field(description="New parts, with new ids.")
    repeat: list[RawRepeat] = Field(
        description="Rows or grids of identical new parts (bins, slats, shelves, posts)."
    )
    not_representable: list[str] = Field(
        description="Requested features the generator cannot show, in the user's words."
    )


class RawTarget(_Raw):
    reference: Literal["selected", "named"]
    object_id: str | None
    phrase: str


class RawMove(_Raw):
    direction: MoveDirection
    distance: float
    unit: DistanceUnit
    quote: str


class RawRotate(_Raw):
    direction: Literal["clockwise", "counterclockwise"]
    angle_deg: float
    quote: str


class RawEditAnswer(_Raw):
    outcome: Literal["proposal", "clarification", "unsupported"]
    question: str | None
    candidates: list[str]
    message: str | None
    action: Literal["move", "rotate"] | None
    target: RawTarget | None
    move: RawMove | None
    rotate: RawRotate | None


class RawRoute(_Raw):
    from_object_id: str | None
    to_object_id: str | None
    width: float | None
    unit: DistanceUnit | None
    quote: str | None


_CHAT_INTENTS = Literal[
    "move",
    "rotate",
    "select",
    "add_object",
    "check_route",
    "check_layout",
    "run_day",
    "run_again",
    "explain_change",
    "undo",
    "show_example",
    "capabilities",
    "save",
    "export",
    "ask",
    "cannot",
]


class RawAdd(_Raw):
    description: str
    width: float | None
    depth: float | None
    height: float | None
    unit: DistanceUnit | None
    near_object_id: str | None
    side: Literal["left", "right", "front", "back"] | None


class RawChatStep(_Raw):
    intent: _CHAT_INTENTS
    question: str | None
    candidates: list[str]
    message: str | None
    target: RawTarget | None
    move: RawMove | None
    rotate: RawRotate | None
    route: RawRoute | None
    add: RawAdd | None


class RawChatPlan(_Raw):
    """chat-02: a short plan. An answer in the older one-intent form (chat-01) is read as a plan
    of one step, so recordings made with it still replay."""

    steps: list[RawChatStep]


# Keywords that schema-guided decoders often do not support. Limits are enforced by the
# Pydantic checks after decoding instead.
_DROPPED = {"title", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "pattern"}


def provider_schema(model: type[BaseModel]) -> dict[str, Any]:
    """A self-contained JSON Schema for ``model``: refs inlined, every object closed."""
    schema = model.model_json_schema()
    defs: dict[str, Any] = schema.pop("$defs", {})

    def resolve(node: Any) -> Any:
        if isinstance(node, list):
            return [resolve(item) for item in node]
        if not isinstance(node, dict):
            return node
        if "$ref" in node:
            target = copy.deepcopy(defs[node["$ref"].rsplit("/", 1)[-1]])
            extra = {k: v for k, v in node.items() if k != "$ref"}
            return resolve({**target, **extra})
        out = {k: resolve(v) for k, v in node.items() if k not in _DROPPED}
        if out.get("type") == "object":
            out["additionalProperties"] = False
            out["required"] = list(out.get("properties", {}))
        return out

    resolved: dict[str, Any] = resolve(schema)
    return resolved
