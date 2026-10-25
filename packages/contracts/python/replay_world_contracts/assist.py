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
    DrawingImport,
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
    PartId,
    PhotoMediaType,
    PositiveLength,
    Sha256Hex,
    ShortText,
    SourceImage,
    StableId,
    UnknownProperty,
    Vec3,
    _require_unique,
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
    chat_deadline_s: float | None = Field(
        default=None,
        gt=0,
        description="The end-to-end deadline for interpreting a chat message (UX-05), every "
        "attempt included; null when no provider is configured.",
    )


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


ChatAction = Literal[
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
]
"""The bounded actions a chat request can map to (UX-03/UX-04, AGT-01). The browser checks each
action's prerequisites and performs it with the existing deterministic code."""

MAX_CHAT_STEPS: Final = 4


class ChatState(ContractModel):
    """What the open world allows right now, so the answer can name only workable actions."""

    has_world: bool
    has_drawing: bool
    review_open: bool
    has_process: bool
    has_run: bool
    run_stale: bool
    layout_edited: bool
    can_undo: bool


class ChatRequest(ContractModel):
    """One chat message, the reviewed scene facts it may need, and the app's state.
    ``focus_object_id`` is the object the conversation last acted on, for "it" and "that"."""

    request: EditRequestText
    context: EditContext
    state: ChatState
    focus_object_id: StableId | None = None


class ChatRoute(ContractModel):
    """The route a request asks about: endpoints by object id, and a width only when stated."""

    from_object_id: StableId | None
    to_object_id: StableId | None
    width_m: PositiveLength | None = Field(description="Only when the request states it.")
    width_quote: NonEmptyText | None


class ChatAdd(ContractModel):
    """A new object asked for: what it is in the person's words, the sizes they stated (metres;
    null when not stated), and where (beside which object, on which side if said)."""

    description: NonEmptyText
    width_m: PositiveLength | None
    depth_m: PositiveLength | None
    height_m: PositiveLength | None
    near_object_id: StableId | None
    side: Literal["left", "right", "front", "back"] | None


class ChatNeed(ContractModel):
    """What one step still needs from the person before it can be shown or applied."""

    # "clarify" (UX-05): a part of the message the interpreter could not understand. The plan
    # stays visible but cannot be applied until the person says what they meant.
    kind: Literal["target", "reference", "move_details", "rotate_details", "clarify"]
    question: NonEmptyText
    candidates: list[StableId]


class ChatStep(ContractModel):
    """One step of a plan. Move and rotate carry their target and the stated amount; a step that
    cannot be done says why in ``unsupported`` and has no action."""

    action: ChatAction | None
    target_id: StableId | None = Field(description="For move, rotate and select.")
    move: MoveIntent | None
    rotate: RotateIntent | None
    route: ChatRoute | None
    add: ChatAdd | None
    needs: ChatNeed | None
    unsupported: NonEmptyText | None

    @model_validator(mode="after")
    def _shape(self) -> ChatStep:
        if self.needs is not None and self.needs.kind == "clarify":
            if self.action is not None or self.unsupported is not None:
                raise ValueError("a step asking what was meant has no action yet")
            return self
        if (self.action is None) != (self.unsupported is not None):
            raise ValueError("a step either has an action or says why it cannot be done")
        if self.action == "check_route" and self.route is None:
            raise ValueError("check_route carries a route")
        if self.action == "add_object" and self.add is None:
            raise ValueError("add_object carries what to add")
        if (
            self.action == "move"
            and self.needs is None
            and (self.move is None or self.target_id is None)
        ):
            raise ValueError("a move without a need carries its target and amount")
        if (
            self.action == "rotate"
            and self.needs is None
            and (self.rotate is None or self.target_id is None)
        ):
            raise ValueError("a turn without a need carries its target and angle")
        return self


class ChatTiming(ContractModel):
    """Where the time of one interpretation went, measured on the local API (UX-05).

    Token counts are the provider's own (OpenAI-style ``usage``) and are null when it reports
    none; sizes are characters of the request and answer text, never called tokens."""

    prepare_ms: int = Field(ge=0, description="Building the prompt and the scene summary.")
    provider_ms: int = Field(ge=0, description="Waiting for the provider, every attempt.")
    validate_ms: int = Field(ge=0, description="Parsing, expanding and checking the answer.")
    request_chars: int = Field(ge=0, description="Characters of the prompt sent (all messages).")
    schema_chars: int = Field(ge=0, description="Characters of the answer schema sent.")
    response_chars: int = Field(ge=0, description="Characters of the answers received.")
    input_tokens: int | None = Field(ge=0)
    output_tokens: int | None = Field(ge=0)


class ChatResult(ContractModel):
    """The interpretation of one chat message: a short plan of checked steps (at most four), a
    question, or why it cannot be done. Nothing here changes the project."""

    outcome: Literal["plan", "clarification", "unsupported"]
    steps: list[ChatStep] = Field(max_length=MAX_CHAT_STEPS)
    question: NonEmptyText | None
    candidates: list[StableId]
    message: NonEmptyText | None
    checks: list[NonEmptyText]
    provider: ProviderRun
    # Null only for results built without the provider (no timing to report). (No Field
    # description beside a $ref: it makes the TypeScript generator duplicate the interface.)
    timing: ChatTiming | None = None

    @model_validator(mode="after")
    def _one_outcome(self) -> ChatResult:
        if (self.outcome == "plan") != bool(self.steps):
            raise ValueError("a plan, and only a plan, has steps")
        if self.outcome == "clarification" and self.question is None:
            raise ValueError("a clarification asks a question")
        if self.outcome == "unsupported" and self.message is None:
            raise ValueError("an unsupported result says why")
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


RevisionView = Literal["front-right", "rear-left", "low-front"]
"""The review dialog's camera views: the standard view from the front-right above, the view
from behind (rear-left, above) and a low view from the front (under tops and shelves)."""


class RevisionProblem(ContractModel):
    """An added part a viewer may not see as asked, found by the API's checks (GEN-05/06)."""

    kind: Literal[
        "hidden",
        "buried",
        "floating",
        "tiny",
        "unseen",
        "blends",
        "solid_slats",
        "backed_glass",
        "floating_kept",
        "unrelated_change",
    ]
    part_ids: list[PartId] = Field(min_length=1)
    text: NonEmptyText


class RevisionAdjustment(ContractModel):
    """A visual choice the API made without asking, shown as such: never a measurement."""

    kind: Literal["enlarged", "coloured_as_asked", "contrast", "scaled", "recentred", "part_action"]
    part_ids: list[PartId] = Field(min_length=1)
    text: NonEmptyText


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

    ``problems`` (GEN-05) lists what a proposal draws but the user may not be able to see, as
    found by the API's checks and not fixed by the model's one corrected answer: an added part
    hidden inside another, sunk into a part of the same material, without support, too small,
    not visible from the usual view (for glass, not standing out from what is behind it), or
    slats drawn without gaps. The review shows them before Apply; a proposal with problems is
    never described as fully shown.

    ``adjustments`` (GEN-06) lists the visual choices the API made without asking: a small
    part enlarged to a visible size (an estimate), a colour shown as asked, a contrasting finish.
    ``view`` (GEN-07) is the review camera that shows the requested additions best.
    """

    outcome: Literal["proposal", "unsupported", "already_satisfied"]
    message: NonEmptyText | None
    spec: GeometrySpec | None
    summary: NonEmptyText | None
    partial: bool
    size_changed: bool
    not_represented: list[NonEmptyText]
    checks: list[NonEmptyText]
    problems: list[RevisionProblem]
    adjustments: list[RevisionAdjustment]
    view: RevisionView
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
        if (self.problems or self.adjustments) and self.outcome != "proposal":
            raise ValueError("only a proposal can carry 'problems' or 'adjustments'")
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


class DrawingAnalysis(ContractModel):
    """A DXF drawing stored in the source library and read deterministically (IMP-01), or a
    plan image (IMP-03): a PNG, JPEG or one PDF page, read as a picture in pixels with no
    objects yet.

    Nothing is in a project yet. ``drawing.units.basis`` is null: when ``units.question`` is set
    the person chooses the unit (DXF) or marks a known length (plan image) before any real size
    is assigned.
    """

    filename: NonEmptyText
    sha256: Sha256Hex
    drawing: DrawingImport
    warnings: list[NonEmptyText] = Field(
        description="Things the person should check, such as a block whose own units differ."
    )


# --- Plan images (IMP-03, 0.12.0) -----------------------------------------------------------


class PlanPage(ContractModel):
    """One page of an uploaded PDF, for choosing the floor-plan page."""

    page: int = Field(ge=1)
    width_pt: float = Field(gt=0, description="The paper's width in PDF points (1/72 inch).")
    height_pt: float = Field(gt=0)
    thumbnail: Annotated[str, StringConstraints(max_length=400_000)] | None = Field(
        description="A small PNG of the page as a data: URL; null past the first pages."
    )


class PlanUpload(ContractModel):
    """A stored plan file: read when it is an image or a one-page PDF; otherwise its pages are
    listed and the person chooses one."""

    filename: NonEmptyText
    sha256: Sha256Hex
    kind: Literal["pdf", "png", "jpeg"]
    pages: list[PlanPage] = Field(max_length=50)
    analysis: DrawingAnalysis | None

    @model_validator(mode="after")
    def _read_or_listed(self) -> PlanUpload:
        if (self.analysis is None) == (len(self.pages) == 0):
            raise ValueError("a plan upload is either read or lists its pages to choose from")
        return self


PlanObjectKind = Literal["equipment", "structure", "keep_clear", "walkway"]
MAX_PLAN_PROPOSALS: Final = 60


class ProposedPlanObject(ContractModel):
    """Something the vision model marked on the plan: a box around it and what it is called.
    A draft only, never a measurement or a complete list."""

    id: StableId
    label: ShortText
    named_on_plan: bool = Field(description="The label is text printed on the plan.")
    kind: PlanObjectKind
    box: ImageBox


class ProposedWall(ContractModel):
    """A wall or partition line the model drew along, as points on the picture."""

    points: list[ImagePoint] = Field(min_length=2, max_length=20)


class ProposedPlanText(ContractModel):
    """Text the model read on the plan, as content (never an instruction)."""

    text: Annotated[str, StringConstraints(min_length=1, max_length=200)]
    at: ImagePoint


class PlanProposal(ContractModel):
    """The vision model's draft of a plan: the floor's outline, wall lines, object boxes and
    texts, in fractions of the picture."""

    floor: list[ImagePoint] | None = Field(min_length=3, max_length=40)
    walls: list[ProposedWall] = Field(max_length=MAX_PLAN_PROPOSALS)
    objects: list[ProposedPlanObject] = Field(max_length=MAX_PLAN_PROPOSALS)
    texts: list[ProposedPlanText] = Field(max_length=MAX_PLAN_PROPOSALS)


class PlanProposalResult(ContractModel):
    """The API's answer to a plan image: a draft, or why there is none."""

    outcome: Literal["proposal", "unsupported"]
    proposal: PlanProposal | None
    message: NonEmptyText | None
    checks: list[NonEmptyText]
    provider: ProviderRun

    @model_validator(mode="after")
    def _one_outcome(self) -> PlanProposalResult:
        if (self.outcome == "proposal") != (self.proposal is not None) or (
            self.outcome == "unsupported"
        ) != (self.message is not None):
            raise ValueError(f"an '{self.outcome}' result must carry exactly its own content")
        return self


SETUP_DESCRIPTION_MAX_CHARS: Final = 1000
MAX_SETUP_OBJECTS: Final = 200
MAX_SUGGESTED_STATIONS: Final = 12


class SetupObject(ContractModel):
    """One reviewed object offered to "Suggest setup": its name, kind and footprint only."""

    id: StableId
    name: NonEmptyText
    kind: ObjectKind
    width_m: PositiveLength
    depth_m: PositiveLength


class ProcessSuggestionRequest(ContractModel):
    """The person's description of the work and the reviewed objects (SIM-01, "Suggest setup").
    Object names are content from the plan, never instructions."""

    description: Annotated[
        str, StringConstraints(min_length=3, max_length=SETUP_DESCRIPTION_MAX_CHARS)
    ]
    objects: list[SetupObject] = Field(min_length=2, max_length=MAX_SETUP_OBJECTS)

    @model_validator(mode="after")
    def _unique(self) -> ProcessSuggestionRequest:
        _require_unique((o.id for o in self.objects), "object id")
        return self


class SuggestedStation(ContractModel):
    object_id: StableId
    name: ShortText
    role: Literal["supply", "process"]
    why: NonEmptyText


class ProcessSuggestion(ContractModel):
    """Station roles and order, what moves, and questions to ask the person. It has no place for
    a cycle time, a staffing level or any other operating value: those are entered or accepted
    as illustrative examples by the person, never suggested as facts."""

    item_name: ShortText | None
    stations: list[SuggestedStation] = Field(min_length=2, max_length=MAX_SUGGESTED_STATIONS)
    questions: list[NonEmptyText] = Field(max_length=6)

    @model_validator(mode="after")
    def _ordered(self) -> ProcessSuggestion:
        _require_unique((s.object_id for s in self.stations), "suggested station")
        if self.stations[0].role != "supply" or any(s.role == "supply" for s in self.stations[1:]):
            raise ValueError("the first suggested station, and only the first, is the supply")
        return self


class ProcessSuggestionResult(ContractModel):
    """The API's answer to "Suggest setup": a suggestion for the person to review, or why
    there is none."""

    outcome: Literal["suggestion", "unsupported"]
    suggestion: ProcessSuggestion | None
    message: NonEmptyText | None
    checks: list[NonEmptyText]
    provider: ProviderRun

    @model_validator(mode="after")
    def _one_outcome(self) -> ProcessSuggestionResult:
        if (self.outcome == "suggestion") != (self.suggestion is not None) or (
            self.outcome == "unsupported"
        ) != (self.message is not None):
            raise ValueError(f"an '{self.outcome}' result must carry exactly its own content")
        return self
