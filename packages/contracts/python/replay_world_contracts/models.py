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

SchemaVersion = Literal["0.2.0"]
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

Origin = Literal["measured", "user_supplied", "supplier", "inferred", "default"]
"""Where a known value came from. 'default' and 'inferred' values must stay visibly distinct."""

ReviewStatus = Literal["unreviewed", "confirmed"]
ObjectKind = Literal["structure", "equipment", "reference"]
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


class AssetSource(ContractModel):
    """Where an asset definition came from. Vendor and third-party assets must cite it."""

    kind: Literal["synthetic", "in_house", "vendor", "third_party"]
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


class CatalogAsset(ContractModel):
    """A reusable definition that scene objects instantiate by referencing its ``id``.

    ``nominal_dimensions`` describe the catalogued item. Each scene object keeps its own
    ``dimensions`` because an installed instance may be measured differently; differences
    are surfaced, never averaged away.
    """

    id: StableId
    name: NonEmptyText
    kind: ObjectKind
    visual: PlaceholderBoxVisual
    nominal_dimensions: Dimensions
    source: AssetSource
    rights: UsageRights


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


class Scene(ContractModel):
    id: StableId
    name: NonEmptyText
    revision: int = Field(ge=0, description="Incremented by every accepted edit.")
    objects: list[SceneObject]

    @model_validator(mode="after")
    def _unique_object_ids(self) -> Scene:
        _require_unique((o.id for o in self.objects), "object id")
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
    sha256: Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")] | None
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

    kind: Literal["foundation"]
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
    known_parameter_count: int = Field(ge=0)
    unknown_parameter_count: int = Field(ge=0)


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
