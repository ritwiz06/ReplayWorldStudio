/* eslint-disable */
/**
 * GENERATED FILE - DO NOT EDIT.
 * Source of truth: packages/contracts/python/replay_world_contracts/models.py
 * Regenerate with: pnpm contracts:generate
 */

/**
 * Replay World Studio contracts, schema version 0.4.0. Generated from packages/contracts/python - do not edit by hand.
 */
export interface ReplayWorldContracts {
  Project: Project;
  HealthResponse: HealthResponse;
  ValidationReport: ValidationReport;
  UpgradeReport: UpgradeReport;
  ValidationErrorResponse: ValidationErrorResponse;
}
export interface Project {
  schema_version: "0.4.0";
  /**
   * Stable, lowercase identifier. Never reused for a different entity.
   */
  id: string;
  name: string;
  units: UnitSystem;
  world_frame: WorldFrame;
  fixture: FixtureLabel | null;
  sources: SourceDocument[];
  catalog: CatalogAsset[];
  scene: Scene;
}
export interface UnitSystem {
  length: "m";
  time: "s";
  mass: "kg";
  angle: "rad";
}
export interface WorldFrame {
  handedness: "right";
  up_axis: "+Y";
  floor_plane: "XZ";
}
/**
 * Marks development data so it is never mistaken for a real project.
 */
export interface FixtureLabel {
  kind: "foundation" | "demonstration";
  note: string;
}
export interface SourceDocument {
  /**
   * Stable, lowercase identifier. Never reused for a different entity.
   */
  id: string;
  kind: "synthetic" | "dxf" | "pdf" | "png";
  filename: string | null;
  sha256: string | null;
  source_to_world: SourceToWorldTransform;
  import_warnings: string[];
}
/**
 * Maps a 2D source plan (drawing) point to world metres.
 *
 * Steps, applied in order to source point (u, v):
 * 1. scale by ``metres_per_source_unit``;
 * 2. axis convention ``plan_xy_to_world_x_neg_z``: source +X -> world +X, source +Y -> world -Z;
 * 3. rotate about world +Y by ``rotation_about_world_y_rad`` (right-hand rule);
 * 4. translate by ``translation_m`` (its y component is the plan's floor elevation).
 */
export interface SourceToWorldTransform {
  convention: "plan_xy_to_world_x_neg_z";
  source_unit: "m" | "cm" | "mm" | "in" | "ft";
  /**
   * Metres per one source unit.
   */
  metres_per_source_unit: number;
  rotation_about_world_y_rad: number;
  translation_m: Vec3;
}
/**
 * A point or offset in world metres.
 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}
/**
 * A reusable definition that scene objects instantiate by referencing its ``id``.
 *
 * ``nominal_dimensions`` describe the catalogued item. Each scene object keeps its own
 * ``dimensions`` because an installed instance may be measured differently; differences
 * are surfaced, never averaged away.
 */
export interface CatalogAsset {
  /**
   * Stable, lowercase identifier. Never reused for a different entity.
   */
  id: string;
  name: string;
  kind: "structure" | "equipment" | "reference" | "walkway" | "keep_clear";
  visual: PlaceholderBoxVisual | GltfVisual;
  nominal_dimensions: Dimensions;
  source: AssetSource;
  rights: UsageRights;
}
/**
 * A plain labelled box sized from each instance's dimensions. Always provisional.
 */
export interface PlaceholderBoxVisual {
  type: "placeholder_box";
}
/**
 * A binary glTF (.glb) file from the catalog library, drawn at an instance's dimensions.
 *
 * Authoring conventions, checked against ``model_bounds_m``:
 *
 * * units: file coordinates times ``metres_per_model_unit`` are metres (glTF's unit is 1 m);
 * * orientation: +Y is up and the equipment's front faces +Z, as glTF recommends;
 * * origin: the bottom-centre of the model's bounding box is at (0, 0, 0).
 *
 * Fit: the renderer scales the model on each axis so its bounds equal the instance's recorded
 * ``dimensions``. Physical dimensions are never derived from the model. When a per-axis scale
 * departs from 1 by more than ``max_fit_distortion``, the visual is flagged as stretched.
 */
export interface GltfVisual {
  type: "gltf";
  /**
   * Path of a .glb file relative to the catalog library root.
   */
  uri: string;
  /**
   * SHA-256 of the exact file bytes, lowercase hex.
   */
  sha256: string;
  /**
   * Metres per model unit.
   */
  metres_per_model_unit: number;
  up_axis: "+Y";
  front_axis: "+Z";
  origin: "bottom_centre";
  model_bounds_m: ModelBounds;
  fit: "scale_to_dimensions";
  /**
   * Largest per-axis scale departure from 1 still shown as faithful.
   */
  max_fit_distortion: number;
}
/**
 * Axis-aligned bounds of a model in metres, in its own authored frame.
 */
export interface ModelBounds {
  min: Vec3;
  max: Vec3;
}
/**
 * Physical bounding-box extents along the object's local axes, each with its own evidence.
 *
 * ``width`` is local X, ``height`` is local Y (up) and ``depth`` is local Z, all before
 * rotation. Every placed object needs all three; an axis nobody has established is recorded
 * with origin ``default`` and an explanation, never left blank or silently guessed.
 */
export interface Dimensions {
  width: Length;
  height: Length;
  depth: Length;
}
/**
 * A strictly positive length in metres that carries its own evidence.
 */
export interface Length {
  /**
   * Strictly positive length in metres.
   */
  value_m: number;
  origin: "measured" | "user_supplied" | "supplier" | "inferred" | "default";
  source_ref: string | null;
  review_status: "unreviewed" | "confirmed";
  uncertainty_m: UncertaintyBounds | null;
}
/**
 * Inclusive bounds in the unit of the value they qualify. Not a calibrated probability.
 */
export interface UncertaintyBounds {
  lower: number;
  upper: number;
}
/**
 * Where an asset definition came from. Vendor and third-party assets must cite it.
 */
export interface AssetSource {
  kind: "synthetic" | "in_house" | "vendor" | "third_party";
  author: string;
  /**
   * URL, catalogue number or document that identifies the original.
   */
  reference: string | null;
}
/**
 * Explicit usage rights. An unknown license is recorded as NOASSERTION, never omitted.
 */
export interface UsageRights {
  /**
   * A single SPDX license identifier (e.g. CC0-1.0), a LicenseRef-* identifier for custom terms, or NOASSERTION when the license is not known.
   */
  license: string;
  redistribution: "allowed" | "restricted" | "unknown";
  attribution: string | null;
  /**
   * Where the governing terms are recorded (URL, agreement or note).
   */
  terms_ref: string | null;
}
/**
 * Placed objects plus the record of every edit in effect.
 *
 * ``revision`` advances by one for every accepted edit, undo and redo, so a command prepared
 * against an older revision is always detected. ``edit_log`` lists, oldest first, the edits
 * that produced the current objects. An undone edit leaves the log, so the revisions of its
 * records may have gaps; the log never describes values the scene does not hold.
 */
export interface Scene {
  /**
   * Stable, lowercase identifier. Never reused for a different entity.
   */
  id: string;
  name: string;
  /**
   * Advanced by one for every accepted edit, undo and redo.
   */
  revision: number;
  objects: SceneObject[];
  edit_log: (ObjectEdited | ObjectAdded | ObjectRemoved)[];
}
export interface SceneObject {
  /**
   * Stable, lowercase identifier. Never reused for a different entity.
   */
  id: string;
  name: string;
  kind: "structure" | "equipment" | "reference" | "walkway" | "keep_clear";
  /**
   * Catalog asset this object instantiates; null for scene geometry.
   */
  asset_id: string | null;
  transform: Transform;
  dimensions: Dimensions;
  parameters: (KnownParameter | UnknownParameter)[];
}
/**
 * World placement; ``position_m`` locates the bounding-box bottom-centre.
 */
export interface Transform {
  position_m: Vec3;
  rotation_rad: EulerRotation;
}
/**
 * Rotation in radians, applied as R = Rx(x) * Ry(y) * Rz(z) (Three.js 'XYZ' order).
 */
export interface EulerRotation {
  order: "XYZ";
  x: number;
  y: number;
  z: number;
}
export interface KnownParameter {
  state: "known";
  /**
   * Stable, lowercase identifier. Never reused for a different entity.
   */
  id: string;
  label: string;
  unit: "m" | "s" | "kg" | "rad" | "m/s" | "1";
  value: number;
  origin: "measured" | "user_supplied" | "supplier" | "inferred" | "default";
  source_ref: string | null;
  review_status: "unreviewed" | "confirmed";
  uncertainty: UncertaintyBounds | null;
}
/**
 * A required quantity that has not been established. It carries no value.
 */
export interface UnknownParameter {
  state: "unknown";
  /**
   * Stable, lowercase identifier. Never reused for a different entity.
   */
  id: string;
  label: string;
  unit: "m" | "s" | "kg" | "rad" | "m/s" | "1";
  reason: string;
}
/**
 * An existing object was moved, rotated or resized in the editor.
 *
 * A changed axis always becomes ``user_supplied`` and unreviewed, because a person typed or
 * dragged the new value; the previous value and its evidence stay in ``before``.
 */
export interface ObjectEdited {
  type: "object_edited";
  /**
   * Scene revision this edit produced.
   */
  revision: number;
  /**
   * Stable, lowercase identifier. Never reused for a different entity.
   */
  object_id: string;
  transform: TransformChange | null;
  dimensions: AxisChange[];
}
/**
 * An object's placement before and after an edit.
 */
export interface TransformChange {
  before: Transform;
  after: Transform;
}
/**
 * One dimension axis before and after an edit. ``before`` keeps the replaced evidence.
 */
export interface AxisChange {
  axis: "width" | "height" | "depth";
  before: Length;
  after: Length;
}
/**
 * A new object was placed: an instance of a catalog asset or a copy of another object.
 */
export interface ObjectAdded {
  type: "object_added";
  /**
   * Scene revision this edit produced.
   */
  revision: number;
  /**
   * Stable, lowercase identifier. Never reused for a different entity.
   */
  object_id: string;
  asset_id: string | null;
  /**
   * Object this one was copied from; null for a new catalog instance.
   */
  duplicate_of: string | null;
}
/**
 * An object was removed. Its last state, evidence included, is kept here.
 */
export interface ObjectRemoved {
  type: "object_removed";
  /**
   * Scene revision this edit produced.
   */
  revision: number;
  object: SceneObject;
}
export interface HealthResponse {
  status: "ok";
  service: "replay-world-api";
  api_version: string;
  schema_version: "0.4.0";
}
/**
 * Summary returned when the API accepts a project document.
 */
export interface ValidationReport {
  valid: true;
  schema_version: "0.4.0";
  /**
   * Stable, lowercase identifier. Never reused for a different entity.
   */
  project_id: string;
  object_count: number;
  asset_count: number;
  /**
   * glTF files found with matching sha256.
   */
  model_file_count: number;
  known_parameter_count: number;
  unknown_parameter_count: number;
  /**
   * Records in the scene edit log.
   */
  edit_record_count: number;
}
/**
 * An older project document upgraded to the current contract and validated, for review.
 *
 * Nothing is saved or replaced by producing this report; the client shows ``notes`` and lets
 * the user decide whether to open or download the upgraded ``project``.
 */
export interface UpgradeReport {
  /**
   * Schema version of the submitted document.
   */
  from_version: string;
  to_version: "0.4.0";
  notes: string[];
  project: Project;
  validation: ValidationReport;
}
/**
 * Body of every HTTP 422 response. Rejected input is not echoed back.
 */
export interface ValidationErrorResponse {
  detail: ValidationIssue[];
}
/**
 * One reason a request was rejected. ``loc`` is the path to the offending value.
 */
export interface ValidationIssue {
  loc: (string | number)[];
  msg: string;
  type: string;
}
