/* eslint-disable */
/**
 * GENERATED FILE - DO NOT EDIT.
 * Source of truth: packages/contracts/python/replay_world_contracts/models.py
 * Regenerate with: pnpm contracts:generate
 */

/**
 * Replay World Studio contracts, schema version 0.6.0. Generated from packages/contracts/python - do not edit by hand.
 */
export interface ReplayWorldContracts {
  Project: Project;
  HealthResponse: HealthResponse;
  ValidationReport: ValidationReport;
  UpgradeReport: UpgradeReport;
  ValidationErrorResponse: ValidationErrorResponse;
  CatalogAsset: CatalogAsset;
  AssistStatus: AssistStatus;
  ObjectProposalRequest: ObjectProposalRequest;
  ObjectProposalResult: ObjectProposalResult;
  EditProposalRequest: EditProposalRequest;
  EditProposalResult: EditProposalResult;
  GeneratedModelRequest: GeneratedModelRequest;
  GeneratedModel: GeneratedModel;
  GeneratedAssetRequest: GeneratedAssetRequest;
  GeneratedModelRestoreReport: GeneratedModelRestoreReport;
  ImageAnalysisRequest: ImageAnalysisRequest;
  ImageProposalResult: ImageProposalResult;
  StoredPhoto: StoredPhoto;
}
export interface Project {
  schema_version: "0.6.0";
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
/**
 * Where scene content came from.
 *
 * A drawing or plan has a single ``source_to_world`` transform. A ``photo`` has none - a
 * perspective photo maps to the floor only through its calibration - and instead carries its
 * stored ``image`` and the reviewed ``photo_import``.
 */
export interface SourceDocument {
  /**
   * Stable, lowercase identifier. Never reused for a different entity.
   */
  id: string;
  kind: "synthetic" | "dxf" | "pdf" | "png" | "photo";
  filename: string | null;
  sha256: string | null;
  source_to_world: SourceToWorldTransform | null;
  import_warnings: string[];
  image: SourceImage | null;
  photo_import: PhotoImport | null;
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
 * The stored image file of a photo source (its sha256 is the source's ``sha256``).
 */
export interface SourceImage {
  uri: string;
  media_type: "image/jpeg" | "image/png" | "image/webp";
  /**
   * Displayed width (EXIF orientation applied).
   */
  width_px: number;
  /**
   * Displayed height (EXIF orientation applied).
   */
  height_px: number;
  bytes: number;
}
/**
 * The reviewed result of importing one photo.
 */
export interface PhotoImport {
  /**
   * The model that proposed the objects; null if the person marked them all.
   */
  vision_model: LanguageModelRef | null;
  calibration: PhotoCalibration;
  /**
   * @maxItems 60
   */
  observations: PhotoObservation[];
  /**
   * Text read from the photo. Recorded as content, never followed as instructions.
   */
  visible_text: string[];
}
/**
 * The language model that drafted a proposal: service, endpoint and exact model ID.
 */
export interface LanguageModelRef {
  service: string;
  base_url: string;
  model: string;
}
/**
 * How positions on the photo's floor become scene metres.
 *
 * ``image_to_floor`` is a 3 x 3 homography, row-major, mapping (u, v, 1) on the photo to
 * (x, z, w) on the scene floor (y = 0), valid only for points on the floor plane. The scene
 * frame has +X to the right of the photo and the camera on the +Z side, looking towards -Z.
 */
export interface PhotoCalibration {
  reference: FloorRectangle;
  /**
   * @minItems 9
   * @maxItems 9
   */
  image_to_floor: [number, number, number, number, number, number, number, number, number];
  camera: CameraEstimate;
  notes: string[];
}
/**
 * A rectangle lying on the floor, marked by the user on the photo: the scale reference.
 *
 * ``corners`` go around the rectangle; corner 0 to 1 is the ``width``, corner 1 to 2 the
 * ``depth``. A side the user measured is ``user_supplied``; a side they did not know is
 * derived from the photo's perspective and stays ``inferred``.
 */
export interface FloorRectangle {
  /**
   * What the rectangle is, e.g. 'rug' or 'floor tiles'.
   */
  feature: string;
  /**
   * @minItems 4
   * @maxItems 4
   */
  corners: [ImagePoint, ImagePoint, ImagePoint, ImagePoint];
  width: Length;
  depth: Length;
}
/**
 * A point on an image as fractions of its displayed width (``u``, from the left) and height
 * (``v``, from the top). Independent of the image's resolution.
 */
export interface ImagePoint {
  u: number;
  v: number;
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
 * The camera reconstructed from the floor rectangle (in the scene frame).
 */
export interface CameraEstimate {
  vertical_fov_deg: number;
  /**
   * from_rectangle: solved from the rectangle's perspective; from_sides: solved from its two user-given side lengths (a rectangle seen face-on); assumed: a typical lens was assumed because neither could determine it.
   */
  fov_basis: "from_rectangle" | "from_sides" | "assumed";
  position_m: Vec3;
}
/**
 * One object seen in the photo, as reviewed: accepted (linked to its scene object) or not.
 */
export interface PhotoObservation {
  /**
   * Stable, lowercase identifier. Never reused for a different entity.
   */
  id: string;
  label: string;
  box: ImageBox;
  floor_contact: ImagePoint | null;
  contact_basis: ("box_bottom" | "model_point" | "user") | null;
  found_by: "model" | "user";
  decision: "accepted" | "rejected";
  object_id: string | null;
  notes: string[];
}
/**
 * An axis-aligned box on an image, in the same fractions as :class:`ImagePoint`.
 */
export interface ImageBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
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
  generation: AssetGeneration | null;
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
 * Where an asset definition came from. Vendor and third-party assets must cite it.
 *
 * ``generated`` marks an original provisional model built by the object generator from a
 * recorded geometry specification; such an asset carries a ``generation`` record.
 */
export interface AssetSource {
  kind: "synthetic" | "in_house" | "vendor" | "third_party" | "generated";
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
 * How a generated asset was made, so it can be reviewed, rebuilt and never mistaken for
 * a measured or vendor model.
 *
 * ``described``: drafted by ``language_model`` from ``description`` and reviewed by a person.
 * ``builder``: assembled by a person in the object builder; no language model was involved.
 * ``photo``: a bounded shape for an object seen in a photo source; ``description`` names what
 * was seen, and ``language_model`` is the vision model that found it (null when the person
 * marked the object themselves).
 */
export interface AssetGeneration {
  method: "described" | "builder" | "photo";
  description: string | null;
  language_model: LanguageModelRef | null;
  generator: "rws-object-generator/1";
  spec: GeometrySpec;
  stated_facts: string[];
  inferred_facts: string[];
  /**
   * Things the description mentioned that the model does not represent.
   */
  not_modelled: string[];
  unknown_properties: UnknownProperty[];
}
/**
 * A bounded, data-only description of a generated model.
 *
 * The union of the parts is exactly the envelope (within 0.1 mm): centred on X and Z and
 * standing on the floor (Y from 0 to the height). The generator therefore produces a model
 * whose bounds are the envelope, with its origin at the bottom-centre.
 */
export interface GeometrySpec {
  format: "rws-geometry/1";
  envelope_m: Extent3;
  /**
   * @minItems 1
   * @maxItems 40
   */
  parts: [GeometryPart, ...GeometryPart[]];
}
/**
 * Strictly positive extents in metres along X (width), Y (height) and Z (depth).
 */
export interface Extent3 {
  /**
   * Strictly positive length in metres.
   */
  x: number;
  /**
   * Strictly positive length in metres.
   */
  y: number;
  /**
   * Strictly positive length in metres.
   */
  z: number;
}
/**
 * One solid of a generated model, axis-aligned in the object frame.
 *
 * The object frame is the catalog convention: metres, +Y up, front facing +Z, origin at the
 * bottom-centre of the whole object. ``center_m`` is the centre of the part's box and
 * ``size_m`` its extents. ``axis`` (cylinder only) is the direction the round body runs;
 * a frustum always stands upright and narrows to ``taper`` times its width at
 * ``narrow_end``.
 */
export interface GeometryPart {
  id: string;
  label: string;
  shape: "box" | "rounded_box" | "cylinder" | "frustum" | "sphere";
  material:
    | "paint_light_grey"
    | "paint_anthracite"
    | "paint_white"
    | "paint_blue"
    | "paint_red"
    | "paint_green"
    | "paint_orange"
    | "safety_yellow"
    | "aluminium"
    | "stainless_steel"
    | "steel_dark"
    | "copper"
    | "rubber_black"
    | "plastic_black"
    | "plastic_grey"
    | "polycarbonate"
    | "glass_clear"
    | "hmi_screen"
    | "signal_green"
    | "signal_amber"
    | "signal_red"
    | "signal_white"
    | "estop_red"
    | "motor_blue"
    | "cardboard"
    | "wood"
    | "pallet_wood"
    | "concrete"
    | "fabric_grey"
    | "label_black";
  center_m: Vec3;
  size_m: Extent3;
  axis: ("x" | "y" | "z") | null;
  taper: number | null;
  narrow_end: ("top" | "bottom") | null;
  basis: "stated" | "inferred" | "entered";
}
/**
 * A physical or behavioural property the generated model does not establish.
 */
export interface UnknownProperty {
  property: "mass" | "strength" | "chemical_composition" | "operating_behaviour";
  reason: string;
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
  schema_version: "0.6.0";
}
/**
 * Summary returned when the API accepts a project document.
 */
export interface ValidationReport {
  valid: true;
  schema_version: "0.6.0";
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
  /**
   * Source photos found with matching sha256.
   */
  photo_file_count: number;
  /**
   * Source photos absent from the library, listed only when the caller allowed opening without them.
   */
  missing_source_files: string[];
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
  to_version: "0.6.0";
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
/**
 * Whether language assistance is available, and where requests would be sent.
 */
export interface AssistStatus {
  available: boolean;
  /**
   * live: requests go to the configured provider. recorded: an offline test provider replays saved responses (never live AI). off: no provider is configured.
   */
  mode: "live" | "recorded" | "off";
  service: string | null;
  base_url: string | null;
  model: string | null;
  /**
   * The model that looks at photos (image import), when one is configured.
   */
  vision_model: string | null;
  message: string;
}
export interface ObjectProposalRequest {
  description: string;
}
/**
 * The API's answer to a description: a proposal, a question, or a refusal.
 */
export interface ObjectProposalResult {
  outcome: "proposal" | "clarification" | "unsupported";
  proposal: ObjectProposal | null;
  question: string | null;
  message: string | null;
  /**
   * Corrections the API made to the model's answer, in plain words.
   */
  checks: string[];
  provider: ProviderRun;
}
/**
 * A described object, ready for review. ``spec`` already fits ``dimensions``.
 */
export interface ObjectProposal {
  name: string;
  category: string;
  appearance: string;
  dimensions: ProposedDimensions;
  spec: GeometrySpec;
  stated_facts: string[];
  inferred_facts: string[];
  not_modelled: string[];
  unknown_properties: UnknownProperty[];
}
export interface ProposedDimensions {
  width: ProposedLength;
  height: ProposedLength;
  depth: ProposedLength;
}
/**
 * One proposed dimension and where it came from.
 */
export interface ProposedLength {
  /**
   * Strictly positive length in metres.
   */
  value_m: number;
  basis: "stated" | "inferred";
  /**
   * The user's words the value came from.
   */
  quote: string | null;
  needs_confirmation: boolean;
}
/**
 * Which model answered, how, and how often it had to be asked.
 */
export interface ProviderRun {
  service: string;
  base_url: string;
  model: string;
  mode: "live" | "recorded";
  attempts: number;
  /**
   * The first answer was valid JSON matching the requested schema.
   */
  first_attempt_valid: boolean;
  latency_ms: number;
}
export interface EditProposalRequest {
  request: string;
  context: EditContext;
}
export interface EditContext {
  revision: number;
  selected_object_id: string | null;
  /**
   * @maxItems 500
   */
  objects: ContextObject[];
}
/**
 * What the model is told about one object when interpreting an edit request.
 */
export interface ContextObject {
  /**
   * Stable, lowercase identifier. Never reused for a different entity.
   */
  id: string;
  name: string;
  kind: "structure" | "equipment" | "reference" | "walkway" | "keep_clear";
  position_m: Vec3;
  rotation_y_rad: number;
  size_m: Extent3;
}
export interface EditProposalResult {
  outcome: "proposal" | "clarification" | "unsupported";
  intent: EditIntent | null;
  question: string | null;
  /**
   * Objects a clarification is choosing between, if it is about the target.
   *
   * Items: Stable, lowercase identifier. Never reused for a different entity.
   */
  candidates: string[];
  message: string | null;
  checks: string[];
  provider: ProviderRun;
}
/**
 * One bounded edit. The browser turns it into an exact command and shows the change.
 */
export interface EditIntent {
  action: "move" | "rotate";
  target: EditTarget;
  move: MoveIntent | null;
  rotate: RotateIntent | null;
}
export interface EditTarget {
  reference: "selected" | "named";
  /**
   * @minItems 1
   * @maxItems 1
   *
   * Items: Stable, lowercase identifier. Never reused for a different entity.
   */
  object_ids: [string];
  /**
   * How the user referred to the object.
   */
  phrase: string;
}
export interface MoveIntent {
  direction: "left" | "right" | "forward" | "back" | "up" | "down";
  /**
   * In ``unit``, exactly as the user said it.
   */
  distance: number;
  unit: "km" | "m" | "cm" | "mm" | "ft" | "in";
  /**
   * The user's words that give the distance.
   */
  quote: string;
}
export interface RotateIntent {
  /**
   * As seen from above (the top view).
   */
  direction: "clockwise" | "counterclockwise";
  angle_deg: number;
  /**
   * The user's words that give the angle.
   */
  quote: string;
}
/**
 * Build (and optionally store) the model for a geometry draft.
 */
export interface GeneratedModelRequest {
  spec: GeometryDraft;
}
/**
 * A geometry specification that may not fit its envelope yet (an editor's working copy).
 *
 * The API fits the parts to the envelope, which turns a draft into a :class:`GeometrySpec`.
 */
export interface GeometryDraft {
  format: "rws-geometry/1";
  envelope_m: Extent3;
  /**
   * @minItems 1
   * @maxItems 40
   */
  parts: [GeometryPart, ...GeometryPart[]];
}
/**
 * A model built from a specification, with the record a catalog asset would use.
 *
 * ``glb_base64`` is set for previews; a stored model omits it and is served from the
 * catalog library at ``visual.uri``.
 */
export interface GeneratedModel {
  spec: GeometrySpec;
  visual: GltfVisual;
  scale_applied: Vec3;
  triangles: number;
  bytes: number;
  materials: string[];
  notes: string[];
  stored: boolean;
  glb_base64: string | null;
}
/**
 * Turn a reviewed proposal (or a builder result) into a catalog asset with a stored model.
 */
export interface GeneratedAssetRequest {
  name: string;
  kind: "equipment" | "structure" | "reference";
  method: "described" | "builder" | "photo";
  description: string | null;
  language_model: LanguageModelRef | null;
  spec: GeometryDraft;
  dimensions: ReviewedDimensions;
  stated_facts: string[];
  inferred_facts: string[];
  not_modelled: string[];
}
export interface ReviewedDimensions {
  width: ReviewedLength;
  height: ReviewedLength;
  depth: ReviewedLength;
}
/**
 * A dimension as the user left it after review.
 */
export interface ReviewedLength {
  /**
   * stated: in the description; inferred: estimated; entered: typed by the user; photo: derived from a photo with the user's scale reference (approximate).
   */
  basis: "stated" | "inferred" | "entered" | "photo";
  quote: string | null;
  confirmed: boolean;
  /**
   * For a photo-derived value: how it was derived and from which observation.
   */
  source_ref: string | null;
}
/**
 * Result of rebuilding a project's missing generated models from their specifications.
 *
 * A rebuilt file is kept only when its sha256 equals the one the project records.
 */
export interface GeneratedModelRestoreReport {
  results: RestoredModel[];
}
export interface RestoredModel {
  /**
   * Stable, lowercase identifier. Never reused for a different entity.
   */
  asset_id: string;
  uri: string;
  status: "present" | "restored" | "mismatch";
  message: string;
}
/**
 * A metadata-free, downscaled copy of the user's photo, sent for object proposals.
 *
 * ``original_sha256`` identifies the user's original file (it selects recorded answers in
 * offline tests); it is never sent to the language model.
 */
export interface ImageAnalysisRequest {
  media_type: "image/jpeg" | "image/png" | "image/webp";
  data_base64: string;
  width_px: number;
  height_px: number;
  original_sha256: string;
}
/**
 * The API's answer to a photo: proposed objects, or why there are none.
 */
export interface ImageProposalResult {
  outcome: "proposal" | "unsupported";
  proposal: ImageProposal | null;
  message: string | null;
  checks: string[];
  provider: ProviderRun;
}
export interface ImageProposal {
  /**
   * @maxItems 40
   */
  objects: ProposedPhotoObject[];
  /**
   * @maxItems 3
   */
  floor_rectangles:
    | []
    | [FloorRectangleSuggestion]
    | [FloorRectangleSuggestion, FloorRectangleSuggestion]
    | [FloorRectangleSuggestion, FloorRectangleSuggestion, FloorRectangleSuggestion];
  /**
   * @maxItems 20
   */
  visible_text:
    | []
    | [string]
    | [string, string]
    | [string, string, string]
    | [string, string, string, string]
    | [string, string, string, string, string]
    | [string, string, string, string, string, string]
    | [string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string, string, string]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ];
}
/**
 * One object the vision model found, after the API's checks.
 */
export interface ProposedPhotoObject {
  /**
   * Stable, lowercase identifier. Never reused for a different entity.
   */
  id: string;
  label: string;
  category: string;
  template:
    | "box"
    | "cabinet"
    | "table"
    | "chair"
    | "shelf"
    | "sofa"
    | "tank"
    | "conveyor"
    | "machine"
    | "screen"
    | "plant"
    | "pallet";
  material:
    | "paint_light_grey"
    | "paint_anthracite"
    | "paint_white"
    | "paint_blue"
    | "paint_red"
    | "paint_green"
    | "paint_orange"
    | "safety_yellow"
    | "aluminium"
    | "stainless_steel"
    | "steel_dark"
    | "copper"
    | "rubber_black"
    | "plastic_black"
    | "plastic_grey"
    | "polycarbonate"
    | "glass_clear"
    | "hmi_screen"
    | "signal_green"
    | "signal_amber"
    | "signal_red"
    | "signal_white"
    | "estop_red"
    | "motor_blue"
    | "cardboard"
    | "wood"
    | "pallet_wood"
    | "concrete"
    | "fabric_grey"
    | "label_black";
  box: ImageBox;
  floor_contact: ImagePoint | null;
  contact_basis: ("box_bottom" | "model_point") | null;
  on_floor: boolean;
  visibility: "full" | "partly_hidden" | "mostly_hidden";
  /**
   * Image edges the object's box touches: it may continue outside the photo.
   */
  cut_off: ("left" | "right" | "top" | "bottom")[];
  facing: "toward_camera" | "left" | "right" | "away" | "unknown";
  size_guess_m: Extent3;
  suggest_accept: boolean;
  notes: string[];
}
/**
 * A rectangle the model thinks lies on the floor: only a starting point for the user.
 */
export interface FloorRectangleSuggestion {
  label: string;
  /**
   * @minItems 4
   * @maxItems 4
   */
  corners: [ImagePoint, ImagePoint, ImagePoint, ImagePoint];
}
/**
 * A photo stored in the local source library, ready to be recorded as a project source.
 */
export interface StoredPhoto {
  filename: string;
  sha256: string;
  image: SourceImage;
}
