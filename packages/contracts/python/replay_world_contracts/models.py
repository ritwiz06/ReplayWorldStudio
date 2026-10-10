"""Versioned world contracts - the single schema source of truth.

Conventions (see docs/contracts.md):

* Internal units are SI: metres, seconds, kilograms, radians. Display units are a UI concern.
* The world frame is right-handed and Y-up; the floor lies in the X-Z plane.
* An object's ``position_m`` is the bottom-centre of its bounding box, so a floor-standing
  object has ``position_m.y == 0``. Its ``dimensions`` are measured along its local X, Y, Z
  axes before rotation. Physical dimensions are never derived from a visual scale factor.
* Every dimension axis carries its own evidence, so a footprint measured from a plan and an
  inferred height remain distinguishable.
* Unknown values stay unknown: a parameter is either ``known`` (with a value and an origin)
  or ``unknown`` (with a reason). Nothing substitutes a silent default.
* Catalog assets record where they came from and what rights apply. Scene objects reference
  them by stable ID, and every reference must resolve.
* A glTF visual is a representation, never a measurement: it is authored in metres, +Y up,
  front +Z, origin at its bounding-box bottom-centre, and scaled to each instance's recorded
  dimensions. Its file is named by a catalog-library-relative path and pinned by sha256.
* Edits are recorded, not just applied: the scene's ``edit_log`` keeps every edit in effect
  with the previous transform and the previous value and evidence of each changed axis.
* A generated asset is an original, provisional model built by the project's own generator
  from a bounded geometry specification (approved shapes, parts, placements and materials),
  never from code a language model wrote. It records the specification, the words it was
  described with, which facts were stated and which inferred, and the properties it leaves
  unknown (mass, strength, chemical composition, operating behaviour).

JSON Schema and TypeScript types are generated from these models by
``scripts/contracts.mjs``; never edit the generated files by hand. Older documents are
upgraded explicitly by :mod:`replay_world_contracts.migrations`, never accepted as-is.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Annotated, Final, Literal, get_args

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)

SchemaVersion = Literal["0.5.0"]
SCHEMA_VERSION: Final[SchemaVersion] = get_args(SchemaVersion)[0]

StableId = Annotated[
    str,
    StringConstraints(pattern=r"^[a-z0-9][a-z0-9._:-]{0,127}$"),
    Field(description="Stable, lowercase identifier. Never reused for a different entity."),
]
NonEmptyText = Annotated[str, StringConstraints(min_length=1, max_length=500)]
PositiveLength = Annotated[float, Field(gt=0, description="Strictly positive length in metres.")]
LicenseId = Annotated[
    str,
    StringConstraints(
        pattern=r"^(NOASSERTION|LicenseRef-[A-Za-z0-9.-]+|[A-Za-z0-9][A-Za-z0-9.+-]*)$"
    ),
    Field(
        description=(
            "A single SPDX license identifier (e.g. CC0-1.0), a LicenseRef-* identifier for "
            "custom terms, or NOASSERTION when the license is not known."
        )
    ),
]
NO_ASSERTION: Final = "NOASSERTION"
Sha256Hex = Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")]
CATALOG_PATH_PATTERN: Final = r"^(?:[a-z0-9][a-z0-9_-]{0,63}/){0,4}[a-z0-9][a-z0-9_-]{0,63}\.glb$"
"""Catalog-library-relative .glb path. Lowercase segments only: no '..', absolute paths, URL
schemes, backslashes or query strings. Servers must still confine the resolved file to the
library root, because a symbolic link inside the library could point elsewhere."""
CatalogPath = Annotated[
    str,
    StringConstraints(pattern=CATALOG_PATH_PATTERN),
    Field(description="Path of a .glb file relative to the catalog library root."),
]
MODEL_ORIGIN_TOLERANCE_M: Final = 1e-4
"""How far a model's bounding-box bottom-centre may sit from (0, 0, 0)."""
NOMINAL_MATCH_TOLERANCE_M: Final = 1e-3
"""How far a glTF asset's nominal dimensions may differ from its model's extents."""

Origin = Literal["measured", "user_supplied", "supplier", "inferred", "default"]
"""Where a known value came from. 'default' and 'inferred' values must stay visibly distinct."""

ReviewStatus = Literal["unreviewed", "confirmed"]
Axis = Literal["width", "height", "depth"]
ObjectKind = Literal["structure", "equipment", "reference", "walkway", "keep_clear"]
"""'walkway' marks circulation space; 'keep_clear' marks floor area that must stay unobstructed."""
LengthUnit = Literal["m", "cm", "mm", "in", "ft"]
ParameterUnit = Literal["m", "s", "kg", "rad", "m/s", "1"]
"""SI units used internally. '1' marks a dimensionless quantity."""


class ContractModel(BaseModel):
    """Base for all contract records: strict, closed and finite."""

    model_config = ConfigDict(
        extra="forbid",
        strict=True,
        frozen=True,
        allow_inf_nan=False,
    )


class Vec3(ContractModel):
    """A point or offset in world metres."""

    x: float
    y: float
    z: float


class EulerRotation(ContractModel):
    """Rotation in radians, applied as R = Rx(x) * Ry(y) * Rz(z) (Three.js 'XYZ' order)."""

    order: Literal["XYZ"]
    x: float
    y: float
    z: float


class Transform(ContractModel):
    """World placement; ``position_m`` locates the bounding-box bottom-centre."""

    # Keep $ref fields free of Field(description=...): sibling keywords next to a $ref make
    # the TypeScript generator emit duplicate interfaces.
    position_m: Vec3
    rotation_rad: EulerRotation


class UncertaintyBounds(ContractModel):
    """Inclusive bounds in the unit of the value they qualify. Not a calibrated probability."""

    lower: float
    upper: float

    @model_validator(mode="after")
    def _ordered(self) -> UncertaintyBounds:
        if self.lower > self.upper:
            raise ValueError("uncertainty lower bound must not exceed upper bound")
        return self


class Length(ContractModel):
    """A strictly positive length in metres that carries its own evidence."""

    value_m: PositiveLength
    origin: Origin
    source_ref: NonEmptyText | None
    review_status: ReviewStatus
    uncertainty_m: UncertaintyBounds | None

    @model_validator(mode="after")
    def _value_within_uncertainty(self) -> Length:
        u = self.uncertainty_m
        if u is None:
            return self
        if u.lower <= 0:
            raise ValueError("a length's uncertainty lower bound must be greater than 0 m")
        if not (u.lower <= self.value_m <= u.upper):
            raise ValueError(
                f"length {self.value_m} m lies outside its uncertainty bounds "
                f"[{u.lower}, {u.upper}] m"
            )
        return self


class Dimensions(ContractModel):
    """Physical bounding-box extents along the object's local axes, each with its own evidence.

    ``width`` is local X, ``height`` is local Y (up) and ``depth`` is local Z, all before
    rotation. Every placed object needs all three; an axis nobody has established is recorded
    with origin ``default`` and an explanation, never left blank or silently guessed.
    """

    width: Length
    height: Length
    depth: Length


class KnownParameter(ContractModel):
    state: Literal["known"]
    id: StableId
    label: NonEmptyText
    unit: ParameterUnit
    value: float
    origin: Origin
    source_ref: NonEmptyText | None
    review_status: ReviewStatus
    uncertainty: UncertaintyBounds | None

    @model_validator(mode="after")
    def _value_within_uncertainty(self) -> KnownParameter:
        u = self.uncertainty
        if u is not None and not (u.lower <= self.value <= u.upper):
            raise ValueError(
                f"parameter '{self.id}' value {self.value} lies outside its uncertainty "
                f"bounds [{u.lower}, {u.upper}]"
            )
        return self


class UnknownParameter(ContractModel):
    """A required quantity that has not been established. It carries no value."""

    state: Literal["unknown"]
    id: StableId
    label: NonEmptyText
    unit: ParameterUnit
    reason: NonEmptyText


Parameter = Annotated[KnownParameter | UnknownParameter, Field(discriminator="state")]


class PlaceholderBoxVisual(ContractModel):
    """A plain labelled box sized from each instance's dimensions. Always provisional."""

    type: Literal["placeholder_box"]


class ModelBounds(ContractModel):
    """Axis-aligned bounds of a model in metres, in its own authored frame."""

    min: Vec3
    max: Vec3

    @model_validator(mode="after")
    def _non_empty(self) -> ModelBounds:
        for axis in ("x", "y", "z"):
            if getattr(self.min, axis) >= getattr(self.max, axis):
                raise ValueError(f"model bounds must have min < max on {axis}")
        return self


class GltfVisual(ContractModel):
    """A binary glTF (.glb) file from the catalog library, drawn at an instance's dimensions.

    Authoring conventions, checked against ``model_bounds_m``:

    * units: file coordinates times ``metres_per_model_unit`` are metres (glTF's unit is 1 m);
    * orientation: +Y is up and the equipment's front faces +Z, as glTF recommends;
    * origin: the bottom-centre of the model's bounding box is at (0, 0, 0).

    Fit: the renderer scales the model on each axis so its bounds equal the instance's recorded
    ``dimensions``. Physical dimensions are never derived from the model. When a per-axis scale
    departs from 1 by more than ``max_fit_distortion``, the visual is flagged as stretched.
    """

    type: Literal["gltf"]
    uri: CatalogPath
    sha256: Sha256Hex = Field(description="SHA-256 of the exact file bytes, lowercase hex.")
    metres_per_model_unit: PositiveLength = Field(description="Metres per model unit.")
    up_axis: Literal["+Y"]
    front_axis: Literal["+Z"]
    origin: Literal["bottom_centre"]
    model_bounds_m: ModelBounds
    fit: Literal["scale_to_dimensions"]
    max_fit_distortion: float = Field(
        ge=0, le=0.5, description="Largest per-axis scale departure from 1 still shown as faithful."
    )

    @model_validator(mode="after")
    def _origin_is_bottom_centre(self) -> GltfVisual:
        lo, hi = self.model_bounds_m.min, self.model_bounds_m.max
        offsets = {
            "y (bottom)": lo.y,
            "x (centre)": (lo.x + hi.x) / 2,
            "z (centre)": (lo.z + hi.z) / 2,
        }
        for label, offset in offsets.items():
            if abs(offset) > MODEL_ORIGIN_TOLERANCE_M:
                raise ValueError(
                    f"model origin must be the bounding-box bottom-centre; {label} is offset "
                    f"by {offset} m"
                )
        return self


Visual = Annotated[PlaceholderBoxVisual | GltfVisual, Field(discriminator="type")]


class AssetSource(ContractModel):
    """Where an asset definition came from. Vendor and third-party assets must cite it.

    ``generated`` marks an original provisional model built by the object generator from a
    recorded geometry specification; such an asset carries a ``generation`` record.
    """

    kind: Literal["synthetic", "in_house", "vendor", "third_party", "generated"]
    author: NonEmptyText
    reference: NonEmptyText | None = Field(
        description="URL, catalogue number or document that identifies the original."
    )

    @model_validator(mode="after")
    def _external_sources_are_cited(self) -> AssetSource:
        if self.kind in ("vendor", "third_party") and self.reference is None:
            raise ValueError(f"a {self.kind} asset source must give a reference")
        return self


class UsageRights(ContractModel):
    """Explicit usage rights. An unknown license is recorded as NOASSERTION, never omitted."""

    license: LicenseId
    redistribution: Literal["allowed", "restricted", "unknown"]
    attribution: NonEmptyText | None
    terms_ref: NonEmptyText | None = Field(
        description="Where the governing terms are recorded (URL, agreement or note)."
    )

    @model_validator(mode="after")
    def _unknown_license_cannot_grant_rights(self) -> UsageRights:
        if self.license == NO_ASSERTION and self.redistribution != "unknown":
            raise ValueError("redistribution must be 'unknown' while the license is NOASSERTION")
        return self


# --- Generated objects -------------------------------------------------------------------

GEOMETRY_FORMAT: Final = "rws-geometry/1"
GENERATOR_VERSION: Final = "rws-object-generator/1"
GEOMETRY_MAX_PARTS: Final = 40
GEOMETRY_MIN_PART_M: Final = 0.002
GEOMETRY_MIN_ENVELOPE_M: Final = 0.02
GEOMETRY_MAX_ENVELOPE_M: Final = 30.0
ENVELOPE_FIT_TOLERANCE_M: Final = 1e-4
"""How far the union of a specification's parts may differ from its envelope on any side. Equal
to the model-origin tolerance, so every valid specification yields a valid glTF visual."""
GEOMETRY_MAX_COORDINATE_M: Final = 100.0
"""Largest part centre coordinate or extent accepted in a draft (before fitting)."""
GENERATED_MODEL_PREFIX: Final = "generated/"
"""Catalog-library folder that holds generated models, named by their sha256."""

GeometryShape = Literal["box", "rounded_box", "cylinder", "frustum", "sphere"]
"""Approved part shapes. Every part fills its own axis-aligned box ``size_m``: a cylinder or
frustum is round across its axis, a sphere becomes an ellipsoid when the sides differ."""

GeometryMaterial = Literal[
    "paint_light_grey",
    "paint_anthracite",
    "paint_white",
    "paint_blue",
    "paint_red",
    "paint_green",
    "paint_orange",
    "safety_yellow",
    "aluminium",
    "stainless_steel",
    "steel_dark",
    "copper",
    "rubber_black",
    "plastic_black",
    "plastic_grey",
    "polycarbonate",
    "glass_clear",
    "hmi_screen",
    "signal_green",
    "signal_amber",
    "signal_red",
    "signal_white",
    "estop_red",
    "motor_blue",
    "cardboard",
    "wood",
    "pallet_wood",
    "concrete",
    "fabric_grey",
    "label_black",
]
"""Approved surface materials for generated models (physically based colour, metalness and
roughness). A material is an appearance, not a statement about the real object's chemistry."""

PartId = Annotated[str, StringConstraints(pattern=r"^[a-z0-9][a-z0-9_-]{0,39}$")]
ShortText = Annotated[str, StringConstraints(min_length=1, max_length=80)]
PartBasis = Literal["stated", "inferred", "entered"]
"""Where a part came from: named in the user's words, assumed while proposing, or added in
the object builder."""


class Extent3(ContractModel):
    """Strictly positive extents in metres along X (width), Y (height) and Z (depth)."""

    x: PositiveLength
    y: PositiveLength
    z: PositiveLength


class GeometryPart(ContractModel):
    """One solid of a generated model, axis-aligned in the object frame.

    The object frame is the catalog convention: metres, +Y up, front facing +Z, origin at the
    bottom-centre of the whole object. ``center_m`` is the centre of the part's box and
    ``size_m`` its extents. ``axis`` (cylinder only) is the direction the round body runs;
    a frustum always stands upright and narrows to ``taper`` times its width at
    ``narrow_end``.
    """

    id: PartId
    label: ShortText
    shape: GeometryShape
    material: GeometryMaterial
    center_m: Vec3
    size_m: Extent3
    axis: Literal["x", "y", "z"] | None
    taper: float | None = Field(ge=0, le=1)
    narrow_end: Literal["top", "bottom"] | None
    basis: PartBasis

    @model_validator(mode="after")
    def _shape_fields(self) -> GeometryPart:
        if self.shape == "cylinder" and self.axis is None:
            raise ValueError(f"cylinder part '{self.id}' needs an axis (x, y or z)")
        if self.shape != "cylinder" and self.axis is not None:
            raise ValueError(f"only a cylinder has an axis; part '{self.id}' is a {self.shape}")
        frustum = self.shape == "frustum"
        if frustum != (self.taper is not None) or frustum != (self.narrow_end is not None):
            raise ValueError(
                f"part '{self.id}': taper and narrow_end are required for a frustum, and only "
                "for one"
            )
        for name, vec in (("centre", self.center_m), ("size", self.size_m)):
            if max(abs(vec.x), abs(vec.y), abs(vec.z)) > GEOMETRY_MAX_COORDINATE_M:
                raise ValueError(
                    f"part '{self.id}' {name} exceeds {GEOMETRY_MAX_COORDINATE_M:g} m on some axis"
                )
        smallest = min(self.size_m.x, self.size_m.y, self.size_m.z)
        if smallest < GEOMETRY_MIN_PART_M:
            raise ValueError(
                f"part '{self.id}' is thinner than {GEOMETRY_MIN_PART_M * 1000:g} mm ({smallest} m)"
            )
        return self


class GeometryDraft(ContractModel):
    """A geometry specification that may not fit its envelope yet (an editor's working copy).

    The API fits the parts to the envelope, which turns a draft into a :class:`GeometrySpec`.
    """

    format: Literal["rws-geometry/1"]
    envelope_m: Extent3
    parts: list[GeometryPart] = Field(min_length=1, max_length=GEOMETRY_MAX_PARTS)

    @model_validator(mode="after")
    def _bounded(self) -> GeometryDraft:
        _require_unique((p.id for p in self.parts), "part id")
        for axis in ("x", "y", "z"):
            value = getattr(self.envelope_m, axis)
            if not GEOMETRY_MIN_ENVELOPE_M <= value <= GEOMETRY_MAX_ENVELOPE_M:
                raise ValueError(
                    f"envelope {axis} {value} m is outside {GEOMETRY_MIN_ENVELOPE_M}-"
                    f"{GEOMETRY_MAX_ENVELOPE_M} m"
                )
        return self


def parts_bounds(parts: Iterable[GeometryPart]) -> tuple[Vec3, Vec3]:
    """The axis-aligned box that contains every part, in the object frame."""
    items = list(parts)
    lo = {a: min(getattr(p.center_m, a) - getattr(p.size_m, a) / 2 for p in items) for a in "xyz"}
    hi = {a: max(getattr(p.center_m, a) + getattr(p.size_m, a) / 2 for p in items) for a in "xyz"}
    return Vec3(**lo), Vec3(**hi)


class GeometrySpec(GeometryDraft):
    """A bounded, data-only description of a generated model.

    The union of the parts is exactly the envelope (within 0.1 mm): centred on X and Z and
    standing on the floor (Y from 0 to the height). The generator therefore produces a model
    whose bounds are the envelope, with its origin at the bottom-centre.
    """

    @model_validator(mode="after")
    def _parts_fill_envelope(self) -> GeometrySpec:
        lo, hi = parts_bounds(self.parts)
        e = self.envelope_m
        expected = {
            "x": (-e.x / 2, e.x / 2),
            "y": (0.0, e.y),
            "z": (-e.z / 2, e.z / 2),
        }
        for axis, (low, high) in expected.items():
            got = (getattr(lo, axis), getattr(hi, axis))
            if abs(got[0] - low) > ENVELOPE_FIT_TOLERANCE_M or abs(got[1] - high) > (
                ENVELOPE_FIT_TOLERANCE_M
            ):
                raise ValueError(
                    f"parts span {got[0]:.4f}..{got[1]:.4f} m on {axis}, but the envelope is "
                    f"{low:.4f}..{high:.4f} m; fit the parts to the envelope first"
                )
        return self


class LanguageModelRef(ContractModel):
    """The language model that drafted a proposal: service, endpoint and exact model ID."""

    service: NonEmptyText
    base_url: NonEmptyText
    model: NonEmptyText


UnknownPropertyName = Literal["mass", "strength", "chemical_composition", "operating_behaviour"]
UNKNOWN_PROPERTIES: Final[tuple[UnknownPropertyName, ...]] = get_args(UnknownPropertyName)


class UnknownProperty(ContractModel):
    """A physical or behavioural property the generated model does not establish."""

    property: UnknownPropertyName
    reason: NonEmptyText


class AssetGeneration(ContractModel):
    """How a generated asset was made, so it can be reviewed, rebuilt and never mistaken for
    a measured or vendor model.

    ``described``: drafted by ``language_model`` from ``description`` and reviewed by a person.
    ``builder``: assembled by a person in the object builder; no language model was involved.
    """

    method: Literal["described", "builder"]
    description: NonEmptyText | None
    language_model: LanguageModelRef | None
    generator: Literal["rws-object-generator/1"]
    spec: GeometrySpec
    stated_facts: list[NonEmptyText]
    inferred_facts: list[NonEmptyText]
    not_modelled: list[NonEmptyText] = Field(
        description="Things the description mentioned that the model does not represent."
    )
    unknown_properties: list[UnknownProperty]

    @model_validator(mode="after")
    def _consistent(self) -> AssetGeneration:
        described = self.method == "described"
        if described and (self.description is None or self.language_model is None):
            raise ValueError("a described asset records its description and language model")
        if not described and self.language_model is not None:
            raise ValueError("a builder asset was not drafted by a language model")
        named = [u.property for u in self.unknown_properties]
        if sorted(named) != sorted(UNKNOWN_PROPERTIES):
            raise ValueError(
                "a generated asset lists mass, strength, chemical_composition and "
                "operating_behaviour as unknown, once each"
            )
        return self


class CatalogAsset(ContractModel):
    """A reusable definition that scene objects instantiate by referencing its ``id``.

    ``nominal_dimensions`` describe the catalogued item. Each scene object keeps its own
    ``dimensions`` because an installed instance may be measured differently; differences
    are surfaced, never averaged away.
    """

    id: StableId
    name: NonEmptyText
    kind: ObjectKind
    visual: Visual
    nominal_dimensions: Dimensions
    source: AssetSource
    rights: UsageRights
    # How a generated asset was made; null for every other source. (No Field description: a
    # description beside a $ref makes the TypeScript generator emit duplicate interfaces.)
    generation: AssetGeneration | None

    @model_validator(mode="after")
    def _generated_assets_record_their_generation(self) -> CatalogAsset:
        generated = self.source.kind == "generated"
        if generated != (self.generation is not None):
            raise ValueError(
                f"asset '{self.id}': a generation record belongs to, and only to, a "
                "source of kind 'generated'"
            )
        if self.generation is None:
            return self
        if not isinstance(self.visual, GltfVisual) or not self.visual.uri.startswith(
            GENERATED_MODEL_PREFIX
        ):
            raise ValueError(
                f"generated asset '{self.id}' must use a glTF model under "
                f"'{GENERATED_MODEL_PREFIX}'"
            )
        envelope = self.generation.spec.envelope_m
        for axis, extent in (("width", envelope.x), ("height", envelope.y), ("depth", envelope.z)):
            nominal = getattr(self.nominal_dimensions, axis).value_m
            if abs(nominal - extent) > NOMINAL_MATCH_TOLERANCE_M:
                raise ValueError(
                    f"generated asset '{self.id}' nominal {axis} {nominal} m differs from its "
                    f"specification envelope {extent} m"
                )
        return self

    @model_validator(mode="after")
    def _nominal_matches_model(self) -> CatalogAsset:
        if not isinstance(self.visual, GltfVisual):
            return self
        lo, hi = self.visual.model_bounds_m.min, self.visual.model_bounds_m.max
        extents = {"width": hi.x - lo.x, "height": hi.y - lo.y, "depth": hi.z - lo.z}
        for axis, extent in extents.items():
            nominal = getattr(self.nominal_dimensions, axis).value_m
            if abs(nominal - extent) > NOMINAL_MATCH_TOLERANCE_M:
                raise ValueError(
                    f"asset '{self.id}' nominal {axis} {nominal} m does not match its model's "
                    f"extent {extent:.4f} m"
                )
        return self


class SceneObject(ContractModel):
    id: StableId
    name: NonEmptyText
    kind: ObjectKind
    asset_id: StableId | None = Field(
        description="Catalog asset this object instantiates; null for scene geometry."
    )
    transform: Transform
    dimensions: Dimensions
    parameters: list[Parameter]

    @model_validator(mode="after")
    def _unique_parameter_ids(self) -> SceneObject:
        _require_unique((p.id for p in self.parameters), f"parameter id in object '{self.id}'")
        return self


class TransformChange(ContractModel):
    """An object's placement before and after an edit."""

    before: Transform
    after: Transform


class AxisChange(ContractModel):
    """One dimension axis before and after an edit. ``before`` keeps the replaced evidence."""

    axis: Axis
    before: Length
    after: Length


class ObjectEdited(ContractModel):
    """An existing object was moved, rotated or resized in the editor.

    A changed axis always becomes ``user_supplied`` and unreviewed, because a person typed or
    dragged the new value; the previous value and its evidence stay in ``before``.
    """

    type: Literal["object_edited"]
    revision: int = Field(ge=1, description="Scene revision this edit produced.")
    object_id: StableId
    transform: TransformChange | None
    dimensions: list[AxisChange]

    @model_validator(mode="after")
    def _records_a_real_change(self) -> ObjectEdited:
        if self.transform is None and not self.dimensions:
            raise ValueError(
                f"edit at revision {self.revision} changes neither the transform nor a dimension"
            )
        if self.transform is not None and self.transform.before == self.transform.after:
            raise ValueError(f"edit at revision {self.revision} records an unchanged transform")
        _require_unique((c.axis for c in self.dimensions), f"axis in edit {self.revision}")
        for change in self.dimensions:
            if change.after.origin != "user_supplied":
                raise ValueError(
                    f"edit at revision {self.revision}: an edited {change.axis} must be "
                    f"'user_supplied', not '{change.after.origin}'"
                )
            if change.before == change.after:
                raise ValueError(
                    f"edit at revision {self.revision} records an unchanged {change.axis}"
                )
        return self


class ObjectAdded(ContractModel):
    """A new object was placed: an instance of a catalog asset or a copy of another object."""

    type: Literal["object_added"]
    revision: int = Field(ge=1, description="Scene revision this edit produced.")
    object_id: StableId
    asset_id: StableId | None
    duplicate_of: StableId | None = Field(
        description="Object this one was copied from; null for a new catalog instance."
    )

    @model_validator(mode="after")
    def _has_an_origin(self) -> ObjectAdded:
        if self.asset_id is None and self.duplicate_of is None:
            raise ValueError(
                f"added object '{self.object_id}' must name a catalog asset or the object it copies"
            )
        return self


class ObjectRemoved(ContractModel):
    """An object was removed. Its last state, evidence included, is kept here."""

    type: Literal["object_removed"]
    revision: int = Field(ge=1, description="Scene revision this edit produced.")
    object: SceneObject


EditRecord = Annotated[ObjectEdited | ObjectAdded | ObjectRemoved, Field(discriminator="type")]


class Scene(ContractModel):
    """Placed objects plus the record of every edit in effect.

    ``revision`` advances by one for every accepted edit, undo and redo, so a command prepared
    against an older revision is always detected. ``edit_log`` lists, oldest first, the edits
    that produced the current objects. An undone edit leaves the log, so the revisions of its
    records may have gaps; the log never describes values the scene does not hold.
    """

    id: StableId
    name: NonEmptyText
    revision: int = Field(
        ge=0, description="Advanced by one for every accepted edit, undo and redo."
    )
    objects: list[SceneObject]
    edit_log: list[EditRecord]

    @model_validator(mode="after")
    def _unique_object_ids(self) -> Scene:
        _require_unique((o.id for o in self.objects), "object id")
        return self

    @model_validator(mode="after")
    def _edit_log_describes_the_scene(self) -> Scene:
        previous = 0
        for record in self.edit_log:
            if record.revision <= previous:
                raise ValueError(
                    f"edit_log revisions must increase; {record.revision} follows {previous}"
                )
            previous = record.revision
        if previous > self.revision:
            raise ValueError(
                f"edit_log has a record at revision {previous}, after the scene revision "
                f"{self.revision}"
            )

        live = {o.id: o for o in self.objects}
        removed = {r.object.id: r.revision for r in self.edit_log if isinstance(r, ObjectRemoved)}
        for object_id, revision in removed.items():
            if object_id in live:
                raise ValueError(
                    f"object id '{object_id}' was removed at revision {revision}; IDs are never "
                    "reused"
                )

        latest: dict[tuple[str, str], tuple[int, Transform | Length]] = {}
        for record in self.edit_log:
            if isinstance(record, ObjectRemoved):
                continue
            object_id = record.object_id
            if object_id not in live and removed.get(object_id, -1) < record.revision:
                raise ValueError(
                    f"edit_log revision {record.revision} refers to object '{object_id}', which "
                    "is not in the scene and was not removed later"
                )
            if isinstance(record, ObjectAdded):
                obj = live.get(object_id)
                if obj is not None and obj.asset_id != record.asset_id:
                    raise ValueError(
                        f"object '{object_id}' was added at revision {record.revision} from "
                        f"asset {record.asset_id!r} but now references {obj.asset_id!r}"
                    )
                continue
            if record.transform is not None:
                latest[(object_id, "transform")] = (record.revision, record.transform.after)
            for change in record.dimensions:
                latest[(object_id, change.axis)] = (record.revision, change.after)

        for (object_id, field), (revision, after) in latest.items():
            obj = live.get(object_id)
            if obj is None:
                continue
            current = obj.transform if field == "transform" else getattr(obj.dimensions, field)
            if current != after:
                raise ValueError(
                    f"edit_log revision {revision} records a {field} for object '{object_id}' "
                    "that differs from the scene; the log no longer describes the scene"
                )
        return self


class SourceToWorldTransform(ContractModel):
    """Maps a 2D source plan (drawing) point to world metres.

    Steps, applied in order to source point (u, v):
    1. scale by ``metres_per_source_unit``;
    2. axis convention ``plan_xy_to_world_x_neg_z``: source +X -> world +X, source +Y -> world -Z;
    3. rotate about world +Y by ``rotation_about_world_y_rad`` (right-hand rule);
    4. translate by ``translation_m`` (its y component is the plan's floor elevation).
    """

    convention: Literal["plan_xy_to_world_x_neg_z"]
    source_unit: LengthUnit
    metres_per_source_unit: PositiveLength = Field(description="Metres per one source unit.")
    rotation_about_world_y_rad: float
    translation_m: Vec3


class SourceDocument(ContractModel):
    id: StableId
    kind: Literal["synthetic", "dxf", "pdf", "png"]
    filename: NonEmptyText | None
    sha256: Sha256Hex | None
    source_to_world: SourceToWorldTransform
    import_warnings: list[NonEmptyText]


class UnitSystem(ContractModel):
    length: Literal["m"]
    time: Literal["s"]
    mass: Literal["kg"]
    angle: Literal["rad"]


class WorldFrame(ContractModel):
    handedness: Literal["right"]
    up_axis: Literal["+Y"]
    floor_plane: Literal["XZ"]


class FixtureLabel(ContractModel):
    """Marks development data so it is never mistaken for a real project."""

    kind: Literal["foundation", "demonstration"]
    note: NonEmptyText


class Project(ContractModel):
    schema_version: SchemaVersion
    id: StableId
    name: NonEmptyText
    units: UnitSystem
    world_frame: WorldFrame
    fixture: FixtureLabel | None
    sources: list[SourceDocument]
    catalog: list[CatalogAsset]
    scene: Scene

    @model_validator(mode="after")
    def _references_resolve(self) -> Project:
        _require_unique((s.id for s in self.sources), "source id")
        _require_unique((a.id for a in self.catalog), "catalog asset id")
        assets = {a.id: a for a in self.catalog}
        for obj in self.scene.objects:
            if obj.asset_id is None:
                continue
            asset = assets.get(obj.asset_id)
            if asset is None:
                raise ValueError(
                    f"object '{obj.id}' references asset '{obj.asset_id}', "
                    "which is not in the catalog"
                )
            if asset.kind != obj.kind:
                raise ValueError(
                    f"object '{obj.id}' (kind '{obj.kind}') references asset "
                    f"'{asset.id}' of kind '{asset.kind}'"
                )
        for record in self.scene.edit_log:
            if isinstance(record, ObjectAdded) and record.asset_id not in (None, *assets):
                raise ValueError(
                    f"edit_log revision {record.revision} adds an instance of asset "
                    f"'{record.asset_id}', which is not in the catalog"
                )
        return self


class HealthResponse(ContractModel):
    status: Literal["ok"]
    service: Literal["replay-world-api"]
    api_version: NonEmptyText
    schema_version: SchemaVersion


class ValidationReport(ContractModel):
    """Summary returned when the API accepts a project document."""

    valid: Literal[True]
    schema_version: SchemaVersion
    project_id: StableId
    object_count: int = Field(ge=0)
    asset_count: int = Field(ge=0)
    model_file_count: int = Field(ge=0, description="glTF files found with matching sha256.")
    known_parameter_count: int = Field(ge=0)
    unknown_parameter_count: int = Field(ge=0)
    edit_record_count: int = Field(ge=0, description="Records in the scene edit log.")


class UpgradeReport(ContractModel):
    """An older project document upgraded to the current contract and validated, for review.

    Nothing is saved or replaced by producing this report; the client shows ``notes`` and lets
    the user decide whether to open or download the upgraded ``project``.
    """

    from_version: NonEmptyText = Field(description="Schema version of the submitted document.")
    to_version: SchemaVersion
    notes: list[NonEmptyText]
    project: Project
    validation: ValidationReport


class ValidationIssue(ContractModel):
    """One reason a request was rejected. ``loc`` is the path to the offending value."""

    loc: list[str | int]
    msg: NonEmptyText
    type: NonEmptyText


class ValidationErrorResponse(ContractModel):
    """Body of every HTTP 422 response. Rejected input is not echoed back."""

    detail: list[ValidationIssue]


def _require_unique(ids: Iterable[str], what: str) -> None:
    seen: set[str] = set()
    for item in ids:
        if item in seen:
            raise ValueError(f"duplicate {what}: '{item}'")
        seen.add(item)
