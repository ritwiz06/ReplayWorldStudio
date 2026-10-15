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
    MAX_REVISION_CHANGES,
    REVISION_INSTRUCTION_MAX_CHARS,
    CatalogAsset,
    ContractModel,
    Extent3,
    GeometryDraft,
    GeometryMaterial,
    GeometrySpec,
    GltfVisual,
    ImageBox,
    ImagePoint,
    LanguageModelRef,
    NonEmptyText,
    ObjectKind,
    PhotoMediaType,
    PositiveLength,
    Sha256Hex,
    ShortText,
    SourceImage,
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
    vision_model: NonEmptyText | None = Field(
        description="The model that looks at photos (image import), when one is configured."
    )
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


DimensionBasis = Literal["stated", "inferred", "entered", "photo"]


class ReviewedLength(ContractModel):
    """A dimension as the user left it after review."""

    basis: DimensionBasis = Field(
        description="stated: in the description; inferred: estimated; entered: typed by the user; "
        "photo: derived from a photo with the user's scale reference (approximate)."
    )
    quote: NonEmptyText | None
    confirmed: bool
    source_ref: NonEmptyText | None = Field(
        description="For a photo-derived value: how it was derived and from which observation."
    )

    @model_validator(mode="after")
    def _photo_values_cite_their_derivation(self) -> ReviewedLength:
        if (self.basis == "photo") != (self.source_ref is not None):
            raise ValueError("a photo-derived dimension (and only one) cites how it was derived")
        return self


class ReviewedDimensions(ContractModel):
    width: ReviewedLength
    height: ReviewedLength
    depth: ReviewedLength


class GeneratedAssetRequest(ContractModel):
    """Turn a reviewed proposal (or a builder result) into a catalog asset with a stored model."""

    name: ShortText
    kind: Literal["equipment", "structure", "reference"]
    method: Literal["described", "builder", "photo"]
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


# --- Correcting a generated object (GEN-02) -----------------------------------------------

RevisionText = Annotated[
    str, StringConstraints(min_length=3, max_length=REVISION_INSTRUCTION_MAX_CHARS)
]
RevisedBasis = Literal["kept", "entered", "proposed"]


class RevisedLength(ContractModel):
    """How one overall dimension of a revised model was settled.

    kept: unchanged, so the previous value and its evidence carry over exactly (a change of
    parts or colours never turns an estimate into a measurement); entered: typed by the user;
    proposed: changed by a language model's proposal and confirmed by the user.
    """

    basis: RevisedBasis
    confirmed: bool


class RevisedDimensions(ContractModel):
    width: RevisedLength
    height: RevisedLength
    depth: RevisedLength


class GeneratedAssetRevisionRequest(ContractModel):
    """Build a revision of a generated asset as a new asset; the previous one is not changed."""

    previous: CatalogAsset
    spec: GeometryDraft
    dimensions: RevisedDimensions
    instruction: RevisionText | None
    language_model: LanguageModelRef | None
    changes: list[NonEmptyText] = Field(min_length=1, max_length=MAX_REVISION_CHANGES)
    not_represented: list[NonEmptyText] = Field(max_length=20)


class ModelRevisionProposalRequest(ContractModel):
    """Ask the language model for a bounded change to a generated model's specification."""

    name: ShortText
    spec: GeometrySpec
    instruction: RevisionText


class ModelRevisionProposalResult(ContractModel):
    """A proposed specification change, checked and fitted; nothing is built or stored.

    Three outcomes (GEN-04):

    * ``proposal``: the drawable part of the request, as a new specification. ``partial`` is
      true when the request also asked for things the generator cannot show; they are listed in
      ``not_represented``, each grounded in the user's own words.
    * ``unsupported``: nothing drawable was asked for (or the proposal would misrepresent the
      object, such as a solid block offered as an open shelf); ``message`` says why,
      ``not_represented`` lists what could not be shown, and nothing changes.
    * ``already_satisfied``: the current model already shows what was asked; ``message`` says
      how, and no identical new version is made.
    """

    outcome: Literal["proposal", "unsupported", "already_satisfied"]
    message: NonEmptyText | None
    spec: GeometrySpec | None
    summary: NonEmptyText | None
    partial: bool
    size_changed: bool
    not_represented: list[NonEmptyText]
    checks: list[NonEmptyText]
    provider: ProviderRun

    @model_validator(mode="after")
    def _consistent(self) -> ModelRevisionProposalResult:
        if (self.outcome == "proposal") != (self.spec is not None):
            raise ValueError("a proposal (and only a proposal) carries a specification")
        if self.outcome != "proposal" and self.message is None:
            raise ValueError(f"an '{self.outcome}' outcome explains itself in 'message'")
        if self.partial != (self.outcome == "proposal" and bool(self.not_represented)):
            raise ValueError(
                "'partial' marks exactly the proposals that leave requested features unshown"
            )
        return self


# --- Image import (IMG-01) -------------------------------------------------------------------

MAX_ANALYSIS_IMAGE_BYTES: Final = 4 * 1024 * 1024
"""Largest analysis copy the browser may send (it downscales the photo to at most 1600 px)."""
MAX_ANALYSIS_SIDE_PX: Final = 2048

PhotoTemplate = Literal[
    "box",
    "cabinet",
    "table",
    "chair",
    "shelf",
    "sofa",
    "tank",
    "conveyor",
    "machine",
    "screen",
    "plant",
    "pallet",
]
"""Bounded shape families a photo object can be drawn with (provisional geometry)."""

Facing = Literal["toward_camera", "left", "right", "away", "unknown"]


class ImageAnalysisRequest(ContractModel):
    """A metadata-free, downscaled copy of the user's photo, sent for object proposals.

    ``original_sha256`` identifies the user's original file (it selects recorded answers in
    offline tests); it is never sent to the language model.
    """

    media_type: PhotoMediaType
    data_base64: Annotated[str, StringConstraints(min_length=16, max_length=6_000_000)]
    width_px: int = Field(ge=16, le=MAX_ANALYSIS_SIDE_PX)
    height_px: int = Field(ge=16, le=MAX_ANALYSIS_SIDE_PX)
    original_sha256: Sha256Hex


class ProposedPhotoObject(ContractModel):
    """One object the vision model found, after the API's checks."""

    id: StableId
    label: ShortText
    category: ShortText
    template: PhotoTemplate
    material: GeometryMaterial
    box: ImageBox
    floor_contact: ImagePoint | None
    contact_basis: Literal["box_bottom", "model_point"] | None
    on_floor: bool
    visibility: Literal["full", "partly_hidden", "mostly_hidden"]
    cut_off: list[Literal["left", "right", "top", "bottom"]] = Field(
        description="Image edges the object's box touches: it may continue outside the photo."
    )
    facing: Facing
    # The model's rough guess of width, height and depth; never a measurement. (No Field
    # description beside a $ref: it duplicates the TypeScript interface.)
    size_guess_m: Extent3
    suggest_accept: bool
    notes: list[NonEmptyText]


class FloorRectangleSuggestion(ContractModel):
    """A rectangle the model thinks lies on the floor: only a starting point for the user."""

    label: ShortText
    corners: list[ImagePoint] = Field(min_length=4, max_length=4)


class ImageProposal(ContractModel):
    objects: list[ProposedPhotoObject] = Field(max_length=40)
    floor_rectangles: list[FloorRectangleSuggestion] = Field(max_length=3)
    visible_text: list[NonEmptyText] = Field(max_length=20)


class ImageProposalResult(ContractModel):
    """The API's answer to a photo: proposed objects, or why there are none."""

    outcome: Literal["proposal", "unsupported"]
    proposal: ImageProposal | None
    message: NonEmptyText | None
    checks: list[NonEmptyText]
    provider: ProviderRun

    @model_validator(mode="after")
    def _one_outcome(self) -> ImageProposalResult:
        if (self.outcome == "proposal") != (self.proposal is not None) or (
            self.outcome == "unsupported"
        ) != (self.message is not None):
            raise ValueError(f"an '{self.outcome}' result must carry exactly its own content")
        return self


class StoredPhoto(ContractModel):
    """A photo stored in the local source library, ready to be recorded as a project source."""

    filename: NonEmptyText
    sha256: Sha256Hex
    image: SourceImage
