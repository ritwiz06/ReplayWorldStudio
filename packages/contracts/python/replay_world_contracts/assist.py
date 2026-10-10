"""Contracts for guided object creation and language-assisted edits (GEN-01).

A language model never changes a project. It drafts a *proposal*, which the API checks
(schema, grounding of stated values in the user's own words, bounded geometry) before the
browser shows it. The user confirms what matters; only then does the editor apply one typed
command, through the same engine as every other edit.

These models are request and response bodies of the local API. They are part of the contract
bundle so the browser validates responses with the same schema.
"""

from __future__ import annotations

from typing import Annotated, Final, Literal

from pydantic import Field, StringConstraints, model_validator

from .models import (
    ContractModel,
    Extent3,
    GeometryDraft,
    GeometrySpec,
    GltfVisual,
    LanguageModelRef,
    NonEmptyText,
    ObjectKind,
    PositiveLength,
    ShortText,
    StableId,
    UnknownProperty,
    Vec3,
)

DESCRIPTION_MAX_CHARS: Final = 500
EDIT_REQUEST_MAX_CHARS: Final = 300

Description = Annotated[str, StringConstraints(min_length=3, max_length=DESCRIPTION_MAX_CHARS)]
EditRequestText = Annotated[str, StringConstraints(min_length=3, max_length=EDIT_REQUEST_MAX_CHARS)]
Basis = Literal["stated", "inferred"]
"""``stated``: the value is in the user's words (and the API found it there).
``inferred``: an estimate the model made; it needs the user's confirmation."""


class AssistStatus(ContractModel):
    """Whether language assistance is available, and where requests would be sent."""

    available: bool
    mode: Literal["live", "recorded", "off"] = Field(
        description=(
            "live: requests go to the configured provider. recorded: an offline test provider "
            "replays saved responses (never live AI). off: no provider is configured."
        )
    )
    service: NonEmptyText | None
    base_url: NonEmptyText | None
    model: NonEmptyText | None
    message: NonEmptyText


class ProviderRun(ContractModel):
    """Which model answered, how, and how often it had to be asked."""

    service: NonEmptyText
    base_url: NonEmptyText
    model: NonEmptyText
    mode: Literal["live", "recorded"]
    attempts: int = Field(ge=1, le=3)
    first_attempt_valid: bool = Field(
        description="The first answer was valid JSON matching the requested schema."
    )
    latency_ms: int = Field(ge=0)


class ObjectProposalRequest(ContractModel):
    description: Description


class ProposedLength(ContractModel):
    """One proposed dimension and where it came from."""

    value_m: PositiveLength
    basis: Basis
    quote: NonEmptyText | None = Field(description="The user's words the value came from.")
    needs_confirmation: bool


class ProposedDimensions(ContractModel):
    width: ProposedLength
    height: ProposedLength
    depth: ProposedLength


class ObjectProposal(ContractModel):
    """A described object, ready for review. ``spec`` already fits ``dimensions``."""

    name: ShortText
    category: ShortText
    appearance: Annotated[str, StringConstraints(min_length=1, max_length=300)]
    dimensions: ProposedDimensions
    spec: GeometrySpec
    stated_facts: list[NonEmptyText]
    inferred_facts: list[NonEmptyText]
    not_modelled: list[NonEmptyText]
    unknown_properties: list[UnknownProperty]


class ObjectProposalResult(ContractModel):
    """The API's answer to a description: a proposal, a question, or a refusal."""

    outcome: Literal["proposal", "clarification", "unsupported"]
    proposal: ObjectProposal | None
    question: NonEmptyText | None
    message: NonEmptyText | None
    checks: list[NonEmptyText] = Field(
        description="Corrections the API made to the model's answer, in plain words."
    )
    provider: ProviderRun

    @model_validator(mode="after")
    def _one_outcome(self) -> ObjectProposalResult:
        expected = {
            "proposal": self.proposal is not None,
            "clarification": self.question is not None,
            "unsupported": self.message is not None,
        }
        if not expected[self.outcome] or (self.outcome != "proposal" and self.proposal):
            raise ValueError(f"an '{self.outcome}' result must carry exactly its own content")
        return self


class ContextObject(ContractModel):
    """What the model is told about one object when interpreting an edit request."""

    id: StableId
    name: NonEmptyText
    kind: ObjectKind
    position_m: Vec3
    rotation_y_rad: float
    size_m: Extent3


class EditContext(ContractModel):
    revision: int = Field(ge=0)
    selected_object_id: StableId | None
    objects: list[ContextObject] = Field(max_length=500)


class EditProposalRequest(ContractModel):
    request: EditRequestText
    context: EditContext


MoveDirection = Literal["left", "right", "forward", "back", "up", "down"]
"""Plan directions as seen in the top view: left = -X, right = +X, back = -Z (up the
screen), forward = +Z (down the screen); up and down are vertical (+Y / -Y)."""

DistanceUnit = Literal["km", "m", "cm", "mm", "ft", "in"]


class MoveIntent(ContractModel):
    direction: MoveDirection
    distance: PositiveLength = Field(description="In ``unit``, exactly as the user said it.")
    unit: DistanceUnit
    quote: NonEmptyText = Field(description="The user's words that give the distance.")


class RotateIntent(ContractModel):
    direction: Literal["clockwise", "counterclockwise"] = Field(
        description="As seen from above (the top view)."
    )
    angle_deg: float = Field(gt=0, le=360)
    quote: NonEmptyText = Field(description="The user's words that give the angle.")


class EditTarget(ContractModel):
    reference: Literal["selected", "named"]
    object_ids: list[StableId] = Field(min_length=1, max_length=1)
    phrase: NonEmptyText = Field(description="How the user referred to the object.")


class EditIntent(ContractModel):
    """One bounded edit. The browser turns it into an exact command and shows the change."""

    action: Literal["move", "rotate"]
    target: EditTarget
    move: MoveIntent | None
    rotate: RotateIntent | None

    @model_validator(mode="after")
    def _payload_matches_action(self) -> EditIntent:
        if (self.action == "move") != (self.move is not None) or (self.action == "rotate") != (
            self.rotate is not None
        ):
            raise ValueError(f"a '{self.action}' intent carries exactly its own payload")
        return self


class EditProposalResult(ContractModel):
    outcome: Literal["proposal", "clarification", "unsupported"]
    intent: EditIntent | None
    question: NonEmptyText | None
    candidates: list[StableId] = Field(
        description="Objects a clarification is choosing between, if it is about the target."
    )
    message: NonEmptyText | None
    checks: list[NonEmptyText]
    provider: ProviderRun

    @model_validator(mode="after")
    def _one_outcome(self) -> EditProposalResult:
        expected = {
            "proposal": self.intent is not None,
            "clarification": self.question is not None,
            "unsupported": self.message is not None,
        }
        if not expected[self.outcome] or (self.outcome != "proposal" and self.intent):
            raise ValueError(f"an '{self.outcome}' result must carry exactly its own content")
        return self


class GeneratedModelRequest(ContractModel):
    """Build (and optionally store) the model for a geometry draft."""

    spec: GeometryDraft


class GeneratedModel(ContractModel):
    """A model built from a specification, with the record a catalog asset would use.

    ``glb_base64`` is set for previews; a stored model omits it and is served from the
    catalog library at ``visual.uri``.
    """

    spec: GeometrySpec
    visual: GltfVisual
    # Per-axis factor by which the draft's parts were scaled to fit its envelope. (No Field
    # description beside a $ref: it makes the TypeScript generator duplicate the interface.)
    scale_applied: Vec3
    triangles: int = Field(ge=1)
    bytes: int = Field(ge=1)
    materials: list[NonEmptyText]
    notes: list[NonEmptyText]
    stored: bool
    glb_base64: str | None


DimensionBasis = Literal["stated", "inferred", "entered"]


class ReviewedLength(ContractModel):
    """A dimension as the user left it after review."""

    basis: DimensionBasis = Field(
        description="stated: in the description; inferred: estimated; entered: typed by the user."
    )
    quote: NonEmptyText | None
    confirmed: bool


class ReviewedDimensions(ContractModel):
    width: ReviewedLength
    height: ReviewedLength
    depth: ReviewedLength


class GeneratedAssetRequest(ContractModel):
    """Turn a reviewed proposal (or a builder result) into a catalog asset with a stored model."""

    name: ShortText
    kind: Literal["equipment", "structure", "reference"]
    method: Literal["described", "builder"]
    description: NonEmptyText | None
    language_model: LanguageModelRef | None
    spec: GeometryDraft
    dimensions: ReviewedDimensions
    stated_facts: list[NonEmptyText]
    inferred_facts: list[NonEmptyText]
    not_modelled: list[NonEmptyText]


class RestoredModel(ContractModel):
    asset_id: StableId
    uri: NonEmptyText
    status: Literal["present", "restored", "mismatch"]
    message: NonEmptyText


class GeneratedModelRestoreReport(ContractModel):
    """Result of rebuilding a project's missing generated models from their specifications.

    A rebuilt file is kept only when its sha256 equals the one the project records.
    """

    results: list[RestoredModel]
