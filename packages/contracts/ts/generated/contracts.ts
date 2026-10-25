/* eslint-disable */
/**
 * GENERATED FILE - DO NOT EDIT.
 * Source of truth: packages/contracts/python/replay_world_contracts/models.py
 * Regenerate with: pnpm contracts:generate
 */

/**
 * Replay World Studio contracts, schema version 0.14.0. Generated from packages/contracts/python - do not edit by hand.
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
  ChatRequest: ChatRequest;
  ChatResult: ChatResult;
  GeneratedModelRequest: GeneratedModelRequest;
  GeneratedModel: GeneratedModel;
  GeneratedAssetRequest: GeneratedAssetRequest;
  GeneratedModelRestoreReport: GeneratedModelRestoreReport;
  ImageAnalysisRequest: ImageAnalysisRequest;
  ImageProposalResult: ImageProposalResult;
  StoredPhoto: StoredPhoto;
  GeneratedAssetRevisionRequest: GeneratedAssetRevisionRequest;
  ModelRevisionProposalRequest: ModelRevisionProposalRequest;
  ModelRevisionProposalResult: ModelRevisionProposalResult;
  DrawingAnalysis: DrawingAnalysis;
  PlanUpload: PlanUpload;
  PlanProposalResult: PlanProposalResult;
  ProcessSuggestionRequest: ProcessSuggestionRequest;
  ProcessSuggestionResult: ProcessSuggestionResult;
  EvidenceBundleRequest: EvidenceBundleRequest;
  EvidenceBundleOpened: EvidenceBundleOpened;
  EvidenceInventory: EvidenceInventory;
}
export interface Project {
  schema_version: "0.14.0";
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
  /**
   * The process 'Run a day' uses (0.13.0); null when none is set up.
   */
  process: ProcessModel | null;
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
 * stored ``image`` and the reviewed ``photo_import``. An imported DXF drawing also carries its
 * ``drawing`` reading (0.9.0); its transform uses the unit that reading settled.
 */
export interface SourceDocument {
  /**
   * Stable, lowercase identifier. Never reused for a different entity.
   */
  id: string;
  kind: "synthetic" | "dxf" | "pdf" | "png" | "jpeg" | "photo";
  filename: string | null;
  sha256: string | null;
  source_to_world: SourceToWorldTransform | null;
  import_warnings: string[];
  image: SourceImage | null;
  photo_import: PhotoImport | null;
  drawing: DrawingImport | null;
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
  source_unit: "m" | "cm" | "mm" | "in" | "ft" | "px";
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
   * @maxItems 80
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
 * ``depth``. A side the user gave is ``user_supplied``; a side they did not know is derived
 * from the photo's perspective and stays ``inferred``. ``size_basis`` says how the user knows
 * the sides they gave: ``measured`` (measured, or known exactly from a drawing), ``assumed``
 * (a typical size, not measured; such a side stays unreviewed) or ``not_stated`` (projects
 * made before 0.7.0 did not ask).
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
  size_basis: "measured" | "assumed" | "not_stated";
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
  origin: "measured" | "user_supplied" | "supplier" | "inferred" | "default" | "drawn";
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
 * One object seen in the photo, as reviewed, and what the user corrected.
 *
 * ``decision``: ``accepted`` (linked to its scene object), ``rejected``, ``split`` (the outline
 * held several objects; each piece names it in ``derived_from``) or ``merged`` (the same object
 * outlined twice; ``replaced_by`` names the observation it was merged into). Nothing is deleted:
 * split and merged observations are kept with their original outline.
 *
 * ``visibility`` says how much of the object the photo shows: ``visible``, ``partly_visible``
 * (part of it is hidden or cut off, so its hidden sides are estimates), ``added`` (not seen in
 * the photo at all: the user added it where they know it is, so nothing about it is observed),
 * or ``not_recorded`` (saved before 0.8.0, which did not ask).
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
  decision: "accepted" | "rejected" | "split" | "merged";
  object_id: string | null;
  visibility: "visible" | "partly_visible" | "added" | "not_recorded";
  /**
   * The split observation this one was cut from; null if it was not split off.
   */
  derived_from: string | null;
  /**
   * For a merged observation, the observation it was merged into.
   */
  replaced_by: string | null;
  /**
   * What the user corrected, in words, in order.
   *
   * @maxItems 12
   */
  corrections:
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
    | [string, string, string, string, string, string, string, string, string, string, string, string];
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
 * The deterministic reading of one DXF drawing (IMP-01), or of one plan image (IMP-03,
 * 0.12.0: a PNG, a JPEG or one PDF page, its objects proposed by the vision model or traced by
 * the person), kept with the project.
 */
export interface DrawingImport {
  reader: "rws-dxf/1" | "rws-plan-image/1";
  file: DrawingFile;
  /**
   * The picture a plan image reading is in (0.12.0); null for a DXF drawing.
   */
  raster: PlanRaster | null;
  /**
   * The header's $ACADVER, if present.
   */
  dxf_version: string | null;
  units: DrawingUnits;
  layers: string[];
  extent_min: PlanPoint;
  extent_max: PlanPoint;
  /**
   * @maxItems 5000
   */
  lines: PlanLine[];
  /**
   * @maxItems 500
   */
  labels: PlanLabel[];
  /**
   * @maxItems 400
   */
  objects: DrawingObject[];
  skipped: SkippedEntities[];
  /**
   * Where each layout shape that was not imported lies (0.11.0); null for a reading made before positions were recorded.
   */
  omitted: OmittedShape[] | null;
  /**
   * The review of the draft (0.10.0); null only in an analysis.
   */
  review: DrawingReview | null;
}
export interface DrawingFile {
  uri: string;
  bytes: number;
}
/**
 * The picture of a plan image reading (0.12.0): the PNG or JPEG itself, or one PDF page as
 * the API rendered it. Its pixels are the reading's drawing units. A PDF page's size says how
 * big the paper is, never how big the room is.
 */
export interface PlanRaster {
  uri: string;
  media_type: "image/png" | "image/jpeg";
  sha256: string;
  width_px: number;
  height_px: number;
  /**
   * The PDF page shown (from 1); null for an image.
   */
  page: number | null;
  /**
   * Pages in the PDF; null for an image.
   */
  page_count: number | null;
  /**
   * Render resolution of the PDF page.
   */
  dpi: number | null;
}
/**
 * What the drawing says about its units, and how the unit used was established.
 */
export interface DrawingUnits {
  /**
   * The header's $INSUNITS code; null if absent.
   */
  insunits: number | null;
  /**
   * The unit $INSUNITS names, when it is one of the supported length units.
   */
  declared: ("m" | "cm" | "mm" | "in" | "ft") | null;
  /**
   * The header's $MEASUREMENT; null if absent.
   */
  measurement: ("metric" | "imperial") | null;
  /**
   * Why the unit cannot be taken from the drawing as it stands (absent, unsupported, conflicting or implausible); null when the header settles it.
   */
  question: string | null;
  /**
   * How the unit in source_to_world was established; null only in an analysis, before anyone has decided.
   */
  basis: ("drawing_header" | "user_supplied") | null;
}
/**
 * A point on the drawing, in drawing units (DXF world coordinates; for a plan image, its
 * pixels, x to the right and y up from the bottom edge).
 */
export interface PlanPoint {
  x: number;
  y: number;
}
/**
 * A straight-segment line or polyline on the plan, in drawing units.
 */
export interface PlanLine {
  ref: DrawingRef;
  /**
   * @minItems 2
   * @maxItems 2000
   */
  points: [PlanPoint, PlanPoint, ...PlanPoint[]];
  closed: boolean;
}
/**
 * One entity in the drawing: its handle, layer and type, and the block it was drawn in.
 */
export interface DrawingRef {
  /**
   * The entity's DXF handle; null if it has none.
   */
  handle: string | null;
  layer: string;
  entity:
    "LINE" | "LWPOLYLINE" | "POLYLINE" | "INSERT" | "TEXT" | "MTEXT" | "CIRCLE" | "ARC" | "REGION" | "TRACE" | "PAGE";
  /**
   * For geometry inside a block: the block names from the drawing down, separated by ' > '; null for an entity drawn directly in model space.
   */
  block: string | null;
}
/**
 * A text on the plan, recorded as content (never followed as an instruction).
 */
export interface PlanLabel {
  ref: DrawingRef;
  text: string;
  at: PlanPoint;
}
/**
 * A layout object drawn from the drawing, and the scene object it became.
 *
 * ``outline`` is the shape as drawn (a closed polyline's vertices, or a block's extent after
 * its insertion transform). ``centre``, ``width``, ``depth`` and ``rotation_rad`` give the
 * footprint rectangle the scene object was placed with, in drawing units; the rotation is
 * counter-clockwise on the plan, from the drawing's +X axis to the footprint's width.
 */
export interface DrawingObject {
  /**
   * Stable, lowercase identifier. Never reused for a different entity.
   */
  id: string;
  /**
   * Stable, lowercase identifier. Never reused for a different entity.
   */
  object_id: string;
  /**
   * 'floor': the outer outline, built as the floor slab; 'footprint': something standing or marked on the floor.
   */
  role: "floor" | "footprint";
  label: string;
  /**
   * Where the name came from: a block attribute, a text inside the outline, the block name, the layer name, a plain description such as 'Floor', the vision model's proposal (0.12.0), or the person (0.12.0).
   */
  label_from: "attribute" | "text" | "block" | "layer" | "generic" | "proposed" | "entered";
  kind: "structure" | "equipment" | "reference" | "walkway" | "keep_clear";
  /**
   * @minItems 1
   * @maxItems 20
   */
  refs:
    | [DrawingRef]
    | [DrawingRef, DrawingRef]
    | [DrawingRef, DrawingRef, DrawingRef]
    | [DrawingRef, DrawingRef, DrawingRef, DrawingRef]
    | [DrawingRef, DrawingRef, DrawingRef, DrawingRef, DrawingRef]
    | [DrawingRef, DrawingRef, DrawingRef, DrawingRef, DrawingRef, DrawingRef]
    | [DrawingRef, DrawingRef, DrawingRef, DrawingRef, DrawingRef, DrawingRef, DrawingRef]
    | [DrawingRef, DrawingRef, DrawingRef, DrawingRef, DrawingRef, DrawingRef, DrawingRef, DrawingRef]
    | [DrawingRef, DrawingRef, DrawingRef, DrawingRef, DrawingRef, DrawingRef, DrawingRef, DrawingRef, DrawingRef]
    | [
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef
      ]
    | [
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef
      ]
    | [
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef
      ]
    | [
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef
      ]
    | [
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef
      ]
    | [
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef
      ]
    | [
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef
      ]
    | [
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef
      ]
    | [
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef
      ]
    | [
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef
      ]
    | [
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef,
        DrawingRef
      ];
  /**
   * @minItems 3
   * @maxItems 2000
   */
  outline: [PlanPoint, PlanPoint, PlanPoint, ...PlanPoint[]];
  /**
   * 'exact': the footprint rectangle is the drawn shape; 'enclosing': the rectangle encloses a shape that is not one (or a block's extent), so it is approximate; 'approximate' (0.12.0): proposed from a plan image, neither exact nor known to enclose.
   */
  footprint_fit: "exact" | "enclosing" | "approximate";
  /**
   * For an outline the person traced (0.12.0 on a plan image; a floor traced on a DXF, 0.14.0): how far its edges may be from the true ones, in drawing units (the marking precision; 0 on the drawing's own corners). Null for an outline read from a DXF (exact as drawn) and for a proposal (unknown).
   */
  tolerance: number | null;
  centre: PlanPoint;
  /**
   * Footprint along its rotated X, in drawing units.
   */
  width: number;
  /**
   * Footprint along its rotated Y, in drawing units.
   */
  depth: number;
  rotation_rad: number;
  notes: string[];
}
/**
 * Entities of one type on one layer that were not used, and why.
 */
export interface SkippedEntities {
  /**
   * The DXF entity type, e.g. CIRCLE.
   */
  entity: string;
  layer: string;
  count: number;
  /**
   * Up to ten of their handles.
   *
   * @maxItems 10
   */
  handles:
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
    | [string, string, string, string, string, string, string, string, string, string];
  /**
   * True if it may be layout geometry (a shape that was not imported); false for annotation such as dimensions.
   */
  layout: boolean;
  reason: string;
}
/**
 * Where a layout shape that was not imported lies (0.11.0), so a check can tell whether it
 * could matter there. ``min``/``max`` are its extent in drawing units, or null when its
 * position could not be read (inside a block, tilted, infinite, or of unknown size): such a
 * shape could be anywhere.
 */
export interface OmittedShape {
  entity: string;
  handle: string | null;
  layer: string;
  min: PlanPoint | null;
  max: PlanPoint | null;
}
/**
 * The review of a draft from a drawing (IMP-02): floor, scale, each object, and whether the
 * person accepted what the drawing leaves out (shapes not imported, heights).
 */
export interface DrawingReview {
  floor: FloorReview;
  scale: ScaleReview;
  /**
   * @maxItems 400
   */
  objects: ObjectReview[];
  omissions: "proposed" | "accepted";
  /**
   * Layers the person says hold drawing symbols (door swings, wall fill, notes), not things on the floor (0.14.0): their loose lines and left-out shapes are not treated as possible obstacles by the checks. Their closed outlines are reviewed like any other.
   *
   * @maxItems 200
   */
  symbol_layers: string[];
}
/**
 * Which floor the draft uses: a closed outline, one sized around the objects, or none.
 */
export interface FloorReview {
  choice: "outline" | "automatic" | "none";
  /**
   * The drawn outline used, for 'outline'.
   */
  drawn_id: string | null;
  /**
   * The floor scene object; null for 'none'.
   */
  object_id: string | null;
  status: "proposed" | "accepted" | "corrected";
}
/**
 * The scale in use and how it was established: the drawing's unit, a unit the person
 * chose, or a known length they marked. ``status``: 'unchecked' (taken as read), 'confirmed'
 * (the person accepted or chose it), 'measured' (a reference length set it or agrees).
 */
export interface ScaleReview {
  basis: "drawing_unit" | "chosen_unit" | "reference_length";
  /**
   * The drawing's nominal unit (also for a reference); 'px' for a plan image.
   */
  unit: "m" | "cm" | "mm" | "in" | "ft" | "px";
  /**
   * Strictly positive length in metres.
   */
  metres_per_unit: number;
  status: "unchecked" | "confirmed" | "measured";
  reference: ReferenceLength | null;
}
/**
 * A length the person knows, marked on the drawing with two points (IMP-02).
 */
export interface ReferenceLength {
  a: PlanPoint;
  b: PlanPoint;
  /**
   * |b - a| in drawing units.
   */
  drawing_length: number;
  /**
   * The real length the person entered.
   */
  real_length_m: number;
  /**
   * real_length_m / drawing_length.
   */
  metres_per_unit: number;
  /**
   * Metres per unit of the drawing's or chosen unit when it was entered.
   */
  compared_with: number | null;
  /**
   * Whether the two scales are within 2 %.
   */
  agrees: boolean | null;
  /**
   * How far each marked point may be from where it was meant, in drawing units (0.12.0, for a plan image); null where the points snapped to the drawing's geometry.
   */
  tolerance: number | null;
}
/**
 * What the person decided about one drawn object.
 */
export interface ObjectReview {
  /**
   * Stable, lowercase identifier. Never reused for a different entity.
   */
  drawn_id: string;
  status: "proposed" | "accepted" | "corrected" | "not_an_object" | "used_as_floor" | "added";
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
  revision: AssetRevision | null;
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
 * How a generated asset corrects an earlier one (GEN-02).
 *
 * A revision is a new, immutable asset with its own ID, specification and model file; the
 * asset it ``revises`` stays in the catalog unchanged, so every version remains identifiable
 * and hash-checked. ``version`` counts from the original (1, never recorded here). The
 * original description or photo observation stays in the generation record; this record holds
 * only the later correction: the user's instruction (if any), the language model that proposed
 * the specification change (null when the user changed it by hand), the changes in plain words
 * and what was asked for but cannot be represented by the generator.
 */
export interface AssetRevision {
  /**
   * Stable, lowercase identifier. Never reused for a different entity.
   */
  revises: string;
  version: number;
  instruction: string | null;
  language_model: LanguageModelRef | null;
  /**
   * @minItems 1
   * @maxItems 40
   */
  changes: [string, ...string[]];
  /**
   * Requested features the bounded generator cannot depict; never imitated.
   *
   * @maxItems 20
   */
  not_represented:
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
  edit_log: (
    ObjectEdited | ObjectAdded | ObjectRemoved | AssetRevised | DrawingReviewed | SourceAttached | ProcessSet
  )[];
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
  origin: "measured" | "user_supplied" | "supplier" | "inferred" | "default" | "drawn";
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
/**
 * Objects switched from one generated asset to its revision, as one step.
 *
 * Every listed object referenced ``asset_before`` and now references ``asset_after``. An axis
 * appears in ``dimensions`` only when the object's value or evidence changed: the previous
 * value and its evidence stay in ``before``, and ``after`` carries the evidence of how the new
 * value was established (copied from the revised asset), which is not necessarily
 * ``user_supplied`` - a model revision that keeps an inferred size keeps it inferred.
 */
export interface AssetRevised {
  type: "asset_revised";
  /**
   * Scene revision this edit produced.
   */
  revision: number;
  /**
   * Stable, lowercase identifier. Never reused for a different entity.
   */
  asset_before: string;
  /**
   * Stable, lowercase identifier. Never reused for a different entity.
   */
  asset_after: string;
  /**
   * @minItems 1
   */
  objects: [RevisedInstance, ...RevisedInstance[]];
}
/**
 * One object switched to a revised asset, with any of its dimensions that changed.
 */
export interface RevisedInstance {
  /**
   * Stable, lowercase identifier. Never reused for a different entity.
   */
  object_id: string;
  dimensions: AxisChange[];
}
/**
 * A correction made while reviewing a draft from a drawing (IMP-02, 0.10.0): the floor, the
 * scale, an object's name or kind, or 'not an object'. ``correction`` says it in words; every
 * object it changed is recorded as it was and as it became, so the log still describes the
 * scene. The review state itself is the drawing source's ``review``.
 */
export interface DrawingReviewed {
  type: "drawing_reviewed";
  /**
   * Scene revision this edit produced.
   */
  revision: number;
  /**
   * Stable, lowercase identifier. Never reused for a different entity.
   */
  source_id: string;
  correction: string;
  /**
   * @maxItems 800
   */
  objects: ReviewedObjectChange[];
}
/**
 * One object as a drawing review correction found and left it (null: absent).
 */
export interface ReviewedObjectChange {
  /**
   * Stable, lowercase identifier. Never reused for a different entity.
   */
  object_id: string;
  before: SceneObject | null;
  after: SceneObject | null;
}
/**
 * A file kept with the world (IMP-03, 0.12.0): a later plan or drawing, stored by its
 * hash and listed with the world without replacing it. It is not aligned with the world's
 * plan and nothing is merged from it (that is ENR-01); no object changes.
 */
export interface SourceAttached {
  type: "source_attached";
  /**
   * Scene revision this edit produced.
   */
  revision: number;
  /**
   * Stable, lowercase identifier. Never reused for a different entity.
   */
  source_id: string;
  filename: string;
}
/**
 * The process "Run a day" uses was set, changed or removed (0.13.0); no object changes.
 */
export interface ProcessSet {
  type: "process_set";
  /**
   * Scene revision this edit produced.
   */
  revision: number;
  summary: string;
}
/**
 * A bounded production process for "Run a day" (0.13.0): stations in flow order, the
 * transfers between them, the workers and the shift. A run uses it with the scene's current
 * layout, its seed and an engine version, so the same inputs always give the same events.
 */
export interface ProcessModel {
  format: "rws-process/1";
  name: string;
  /**
   * What moves through the process, e.g. 'batch'.
   */
  item_name: string;
  /**
   * Set for a shipped example: what it is, and that its values are assumptions.
   */
  example_note: string | null;
  shift: Shift;
  /**
   * @minItems 2
   * @maxItems 12
   */
  stations:
    | [ProcessStation, ProcessStation]
    | [ProcessStation, ProcessStation, ProcessStation]
    | [ProcessStation, ProcessStation, ProcessStation, ProcessStation]
    | [ProcessStation, ProcessStation, ProcessStation, ProcessStation, ProcessStation]
    | [ProcessStation, ProcessStation, ProcessStation, ProcessStation, ProcessStation, ProcessStation]
    | [ProcessStation, ProcessStation, ProcessStation, ProcessStation, ProcessStation, ProcessStation, ProcessStation]
    | [
        ProcessStation,
        ProcessStation,
        ProcessStation,
        ProcessStation,
        ProcessStation,
        ProcessStation,
        ProcessStation,
        ProcessStation
      ]
    | [
        ProcessStation,
        ProcessStation,
        ProcessStation,
        ProcessStation,
        ProcessStation,
        ProcessStation,
        ProcessStation,
        ProcessStation,
        ProcessStation
      ]
    | [
        ProcessStation,
        ProcessStation,
        ProcessStation,
        ProcessStation,
        ProcessStation,
        ProcessStation,
        ProcessStation,
        ProcessStation,
        ProcessStation,
        ProcessStation
      ]
    | [
        ProcessStation,
        ProcessStation,
        ProcessStation,
        ProcessStation,
        ProcessStation,
        ProcessStation,
        ProcessStation,
        ProcessStation,
        ProcessStation,
        ProcessStation,
        ProcessStation
      ]
    | [
        ProcessStation,
        ProcessStation,
        ProcessStation,
        ProcessStation,
        ProcessStation,
        ProcessStation,
        ProcessStation,
        ProcessStation,
        ProcessStation,
        ProcessStation,
        ProcessStation,
        ProcessStation
      ];
  /**
   * @minItems 1
   * @maxItems 24
   */
  transfers: [ProcessTransfer, ...ProcessTransfer[]];
  /**
   * @minItems 1
   * @maxItems 12
   */
  workers:
    | [ProcessWorker]
    | [ProcessWorker, ProcessWorker]
    | [ProcessWorker, ProcessWorker, ProcessWorker]
    | [ProcessWorker, ProcessWorker, ProcessWorker, ProcessWorker]
    | [ProcessWorker, ProcessWorker, ProcessWorker, ProcessWorker, ProcessWorker]
    | [ProcessWorker, ProcessWorker, ProcessWorker, ProcessWorker, ProcessWorker, ProcessWorker]
    | [ProcessWorker, ProcessWorker, ProcessWorker, ProcessWorker, ProcessWorker, ProcessWorker, ProcessWorker]
    | [
        ProcessWorker,
        ProcessWorker,
        ProcessWorker,
        ProcessWorker,
        ProcessWorker,
        ProcessWorker,
        ProcessWorker,
        ProcessWorker
      ]
    | [
        ProcessWorker,
        ProcessWorker,
        ProcessWorker,
        ProcessWorker,
        ProcessWorker,
        ProcessWorker,
        ProcessWorker,
        ProcessWorker,
        ProcessWorker
      ]
    | [
        ProcessWorker,
        ProcessWorker,
        ProcessWorker,
        ProcessWorker,
        ProcessWorker,
        ProcessWorker,
        ProcessWorker,
        ProcessWorker,
        ProcessWorker,
        ProcessWorker
      ]
    | [
        ProcessWorker,
        ProcessWorker,
        ProcessWorker,
        ProcessWorker,
        ProcessWorker,
        ProcessWorker,
        ProcessWorker,
        ProcessWorker,
        ProcessWorker,
        ProcessWorker,
        ProcessWorker
      ]
    | [
        ProcessWorker,
        ProcessWorker,
        ProcessWorker,
        ProcessWorker,
        ProcessWorker,
        ProcessWorker,
        ProcessWorker,
        ProcessWorker,
        ProcessWorker,
        ProcessWorker,
        ProcessWorker,
        ProcessWorker
      ];
  seed: number;
}
/**
 * ``start_clock_s`` is the clock time the shift starts, in seconds after midnight.
 */
export interface Shift {
  start_clock_s: OperatingValue;
  duration_s: OperatingValue;
  /**
   * @maxItems 10
   */
  breaks:
    | []
    | [ShiftBreak]
    | [ShiftBreak, ShiftBreak]
    | [ShiftBreak, ShiftBreak, ShiftBreak]
    | [ShiftBreak, ShiftBreak, ShiftBreak, ShiftBreak]
    | [ShiftBreak, ShiftBreak, ShiftBreak, ShiftBreak, ShiftBreak]
    | [ShiftBreak, ShiftBreak, ShiftBreak, ShiftBreak, ShiftBreak, ShiftBreak]
    | [ShiftBreak, ShiftBreak, ShiftBreak, ShiftBreak, ShiftBreak, ShiftBreak, ShiftBreak]
    | [ShiftBreak, ShiftBreak, ShiftBreak, ShiftBreak, ShiftBreak, ShiftBreak, ShiftBreak, ShiftBreak]
    | [ShiftBreak, ShiftBreak, ShiftBreak, ShiftBreak, ShiftBreak, ShiftBreak, ShiftBreak, ShiftBreak, ShiftBreak]
    | [
        ShiftBreak,
        ShiftBreak,
        ShiftBreak,
        ShiftBreak,
        ShiftBreak,
        ShiftBreak,
        ShiftBreak,
        ShiftBreak,
        ShiftBreak,
        ShiftBreak
      ];
}
/**
 * One operating fact (a time, a capacity, a speed or a width) with its basis.
 */
export interface OperatingValue {
  value: number;
  basis: "example" | "entered";
}
/**
 * Every worker rests for ``duration_s`` from ``start_s`` (seconds after the shift starts), or
 * from when their task in hand ends, if later.
 */
export interface ShiftBreak {
  /**
   * Stable, lowercase identifier. Never reused for a different entity.
   */
  id: string;
  name: string;
  start_s: OperatingValue;
  duration_s: OperatingValue;
}
/**
 * A step of the process at one scene object. A ``supply`` station is where material is
 * taken (it is always available there, which is itself an assumption); a ``process`` station
 * takes ``worker_s`` with a worker present, then ``machine_s`` on its own. ``access_m`` is where
 * a worker stands to load, unload or pick, in the object's frame.
 */
export interface ProcessStation {
  /**
   * Stable, lowercase identifier. Never reused for a different entity.
   */
  id: string;
  /**
   * Stable, lowercase identifier. Never reused for a different entity.
   */
  object_id: string;
  name: string;
  role: "supply" | "process";
  access_m: LocalPoint;
  access_basis: "example" | "entered";
  worker_s: OperatingValue | null;
  machine_s: OperatingValue | null;
  input_capacity: OperatingValue | null;
  output_capacity: OperatingValue | null;
  /**
   * @maxItems 20
   */
  planned_stops:
    | []
    | [PlannedStop]
    | [PlannedStop, PlannedStop]
    | [PlannedStop, PlannedStop, PlannedStop]
    | [PlannedStop, PlannedStop, PlannedStop, PlannedStop]
    | [PlannedStop, PlannedStop, PlannedStop, PlannedStop, PlannedStop]
    | [PlannedStop, PlannedStop, PlannedStop, PlannedStop, PlannedStop, PlannedStop]
    | [PlannedStop, PlannedStop, PlannedStop, PlannedStop, PlannedStop, PlannedStop, PlannedStop]
    | [PlannedStop, PlannedStop, PlannedStop, PlannedStop, PlannedStop, PlannedStop, PlannedStop, PlannedStop]
    | [
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop
      ]
    | [
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop
      ]
    | [
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop
      ]
    | [
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop
      ]
    | [
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop
      ]
    | [
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop
      ]
    | [
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop
      ]
    | [
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop
      ]
    | [
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop
      ]
    | [
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop
      ]
    | [
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop
      ]
    | [
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop,
        PlannedStop
      ];
  random_stops: RandomStops | null;
}
/**
 * A point in an object's own frame, metres from its centre before its turn: it moves and
 * turns with the object.
 */
export interface LocalPoint {
  x: number;
  z: number;
}
/**
 * No cycle starts at the station between ``start_s`` (seconds after the shift starts) and
 * ``start_s + duration_s``; a cycle already running finishes first.
 */
export interface PlannedStop {
  /**
   * Stable, lowercase identifier. Never reused for a different entity.
   */
  id: string;
  reason: string;
  start_s: OperatingValue;
  duration_s: OperatingValue;
}
/**
 * Unplanned stops drawn from the run's seed: exponential gaps and durations with these
 * means, so the same seed always gives the same stops.
 */
export interface RandomStops {
  mean_between_s: OperatingValue;
  mean_duration_s: OperatingValue;
}
/**
 * Items carried by a worker from one station to the next along a route that has to be
 * clear for ``item_width_m`` with ``allowance_m`` on each side (the route check decides).
 * ``handling_s`` is spent picking the item up, and again setting it down.
 */
export interface ProcessTransfer {
  /**
   * Stable, lowercase identifier. Never reused for a different entity.
   */
  id: string;
  /**
   * Stable, lowercase identifier. Never reused for a different entity.
   */
  from_station: string;
  /**
   * Stable, lowercase identifier. Never reused for a different entity.
   */
  to_station: string;
  method: "carry";
  item_width_m: OperatingValue;
  allowance_m: OperatingValue;
  speed_m_s: OperatingValue;
  handling_s: OperatingValue;
}
/**
 * A worker: one task at a time, chosen in the order of ``tasks`` (``station:<id>`` to work
 * at a station, ``transfer:<id>`` to carry), walking at ``walk_speed_m_s`` through a corridor
 * ``width_m`` wide when carrying nothing.
 */
export interface ProcessWorker {
  /**
   * Stable, lowercase identifier. Never reused for a different entity.
   */
  id: string;
  name: string;
  /**
   * @minItems 1
   * @maxItems 40
   */
  tasks: [string, ...string[]];
  walk_speed_m_s: OperatingValue;
  width_m: OperatingValue;
}
export interface HealthResponse {
  status: "ok";
  service: "replay-world-api";
  api_version: string;
  schema_version: "0.14.0";
}
/**
 * Summary returned when the API accepts a project document.
 */
export interface ValidationReport {
  valid: true;
  schema_version: "0.14.0";
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
  to_version: "0.14.0";
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
  /**
   * The end-to-end deadline for interpreting a chat message (UX-05), every attempt included; null when no provider is configured.
   */
  chat_deadline_s?: number | null;
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
 * One chat message, the reviewed scene facts it may need, and the app's state.
 * ``focus_object_id`` is the object the conversation last acted on, for "it" and "that".
 */
export interface ChatRequest {
  request: string;
  context: EditContext;
  state: ChatState;
  focus_object_id?: string | null;
}
/**
 * What the open world allows right now, so the answer can name only workable actions.
 */
export interface ChatState {
  has_world: boolean;
  has_drawing: boolean;
  review_open: boolean;
  has_process: boolean;
  has_run: boolean;
  run_stale: boolean;
  layout_edited: boolean;
  can_undo: boolean;
}
/**
 * The interpretation of one chat message: a short plan of checked steps (at most four), a
 * question, or why it cannot be done. Nothing here changes the project.
 */
export interface ChatResult {
  outcome: "plan" | "clarification" | "unsupported";
  /**
   * @maxItems 4
   */
  steps:
    [] | [ChatStep] | [ChatStep, ChatStep] | [ChatStep, ChatStep, ChatStep] | [ChatStep, ChatStep, ChatStep, ChatStep];
  question: string | null;
  /**
   * Items: Stable, lowercase identifier. Never reused for a different entity.
   */
  candidates: string[];
  message: string | null;
  checks: string[];
  provider: ProviderRun;
  timing?: ChatTiming | null;
}
/**
 * One step of a plan. Move and rotate carry their target and the stated amount; a step that
 * cannot be done says why in ``unsupported`` and has no action.
 */
export interface ChatStep {
  action:
    | (
        | "move"
        | "rotate"
        | "select"
        | "add_object"
        | "check_route"
        | "check_layout"
        | "run_day"
        | "run_again"
        | "explain_change"
        | "undo"
        | "show_example"
        | "capabilities"
        | "save"
        | "export"
      )
    | null;
  /**
   * For move, rotate and select.
   */
  target_id: string | null;
  move: MoveIntent | null;
  rotate: RotateIntent | null;
  route: ChatRoute | null;
  add: ChatAdd | null;
  needs: ChatNeed | null;
  unsupported: string | null;
}
/**
 * The route a request asks about: endpoints by object id, and a width only when stated.
 */
export interface ChatRoute {
  from_object_id: string | null;
  to_object_id: string | null;
  /**
   * Only when the request states it.
   */
  width_m: number | null;
  width_quote: string | null;
}
/**
 * A new object asked for: what it is in the person's words, the sizes they stated (metres;
 * null when not stated), and where (beside which object, on which side if said).
 */
export interface ChatAdd {
  description: string;
  width_m: number | null;
  depth_m: number | null;
  height_m: number | null;
  near_object_id: string | null;
  side: ("left" | "right" | "front" | "back") | null;
}
/**
 * What one step still needs from the person before it can be shown or applied.
 */
export interface ChatNeed {
  kind: "target" | "reference" | "move_details" | "rotate_details" | "clarify";
  question: string;
  /**
   * Items: Stable, lowercase identifier. Never reused for a different entity.
   */
  candidates: string[];
}
/**
 * Where the time of one interpretation went, measured on the local API (UX-05).
 *
 * Token counts are the provider's own (OpenAI-style ``usage``) and are null when it reports
 * none; sizes are characters of the request and answer text, never called tokens.
 */
export interface ChatTiming {
  /**
   * Building the prompt and the scene summary.
   */
  prepare_ms: number;
  /**
   * Waiting for the provider, every attempt.
   */
  provider_ms: number;
  /**
   * Parsing, expanding and checking the answer.
   */
  validate_ms: number;
  /**
   * Characters of the prompt sent (all messages).
   */
  request_chars: number;
  /**
   * Characters of the answer schema sent.
   */
  schema_chars: number;
  /**
   * Characters of the answers received.
   */
  response_chars: number;
  input_tokens: number | null;
  output_tokens: number | null;
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
/**
 * Build a revision of a generated asset as a new asset; the previous one is not changed.
 */
export interface GeneratedAssetRevisionRequest {
  previous: CatalogAsset;
  spec: GeometryDraft;
  dimensions: RevisedDimensions;
  instruction: string | null;
  language_model: LanguageModelRef | null;
  /**
   * @minItems 1
   * @maxItems 40
   */
  changes: [string, ...string[]];
  /**
   * @maxItems 20
   */
  not_represented:
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
export interface RevisedDimensions {
  width: RevisedLength;
  height: RevisedLength;
  depth: RevisedLength;
}
/**
 * How one overall dimension of a revised model was settled.
 *
 * kept: unchanged, so the previous value and its evidence carry over exactly (a change of
 * parts or colours never turns an estimate into a measurement); entered: typed by the user;
 * proposed: changed by a language model's proposal and confirmed by the user.
 */
export interface RevisedLength {
  basis: "kept" | "entered" | "proposed";
  confirmed: boolean;
}
/**
 * Ask the language model for a bounded change to a generated model's specification.
 */
export interface ModelRevisionProposalRequest {
  name: string;
  spec: GeometrySpec;
  instruction: string;
}
/**
 * A proposed specification change, checked and fitted; nothing is built or stored.
 *
 * Three outcomes (GEN-04):
 *
 * * ``proposal``: the drawable part of the request, as a new specification. ``partial`` is
 *   true when the request also asked for things the generator cannot show; they are listed in
 *   ``not_represented``, each grounded in the user's own words.
 * * ``unsupported``: nothing drawable was asked for (or the proposal would misrepresent the
 *   object, such as a solid block offered as an open shelf); ``message`` says why,
 *   ``not_represented`` lists what could not be shown, and nothing changes.
 * * ``already_satisfied``: the current model already shows what was asked; ``message`` says
 *   how, and no identical new version is made.
 *
 * ``problems`` (GEN-05) lists what a proposal draws but the user may not be able to see, as
 * found by the API's checks and not fixed by the model's one corrected answer: an added part
 * hidden inside another, sunk into a part of the same material, without support, too small,
 * not visible from the usual view (for glass, not standing out from what is behind it), or
 * slats drawn without gaps. The review shows them before Apply; a proposal with problems is
 * never described as fully shown.
 *
 * ``adjustments`` (GEN-06) lists the visual choices the API made without asking: a small
 * part enlarged to a visible size (an estimate), a colour shown as asked, a contrasting finish.
 * ``view`` (GEN-07) is the review camera that shows the requested additions best.
 */
export interface ModelRevisionProposalResult {
  outcome: "proposal" | "unsupported" | "already_satisfied";
  message: string | null;
  spec: GeometrySpec | null;
  summary: string | null;
  partial: boolean;
  size_changed: boolean;
  not_represented: string[];
  checks: string[];
  problems: RevisionProblem[];
  adjustments: RevisionAdjustment[];
  view: "front-right" | "rear-left" | "low-front";
  provider: ProviderRun;
}
/**
 * An added part a viewer may not see as asked, found by the API's checks (GEN-05/06).
 */
export interface RevisionProblem {
  kind:
    | "hidden"
    | "buried"
    | "floating"
    | "tiny"
    | "unseen"
    | "blends"
    | "solid_slats"
    | "backed_glass"
    | "floating_kept"
    | "unrelated_change";
  /**
   * @minItems 1
   */
  part_ids: [string, ...string[]];
  text: string;
}
/**
 * A visual choice the API made without asking, shown as such: never a measurement.
 */
export interface RevisionAdjustment {
  kind: "enlarged" | "coloured_as_asked" | "contrast" | "scaled" | "recentred" | "part_action";
  /**
   * @minItems 1
   */
  part_ids: [string, ...string[]];
  text: string;
}
/**
 * A DXF drawing stored in the source library and read deterministically (IMP-01), or a
 * plan image (IMP-03): a PNG, JPEG or one PDF page, read as a picture in pixels with no
 * objects yet.
 *
 * Nothing is in a project yet. ``drawing.units.basis`` is null: when ``units.question`` is set
 * the person chooses the unit (DXF) or marks a known length (plan image) before any real size
 * is assigned.
 */
export interface DrawingAnalysis {
  filename: string;
  sha256: string;
  drawing: DrawingImport;
  /**
   * Things the person should check, such as a block whose own units differ.
   */
  warnings: string[];
}
/**
 * A stored plan file: read when it is an image or a one-page PDF; otherwise its pages are
 * listed and the person chooses one.
 */
export interface PlanUpload {
  filename: string;
  sha256: string;
  kind: "pdf" | "png" | "jpeg";
  /**
   * @maxItems 50
   */
  pages: PlanPage[];
  analysis: DrawingAnalysis | null;
}
/**
 * One page of an uploaded PDF, for choosing the floor-plan page.
 */
export interface PlanPage {
  page: number;
  /**
   * The paper's width in PDF points (1/72 inch).
   */
  width_pt: number;
  height_pt: number;
  /**
   * A small PNG of the page as a data: URL; null past the first pages.
   */
  thumbnail: string | null;
}
/**
 * The API's answer to a plan image: a draft, or why there is none.
 */
export interface PlanProposalResult {
  outcome: "proposal" | "unsupported";
  proposal: PlanProposal | null;
  message: string | null;
  checks: string[];
  provider: ProviderRun;
}
/**
 * The vision model's draft of a plan: the floor's outline, wall lines, object boxes and
 * texts, in fractions of the picture.
 */
export interface PlanProposal {
  floor: [ImagePoint, ImagePoint, ImagePoint, ...ImagePoint[]] | null;
  /**
   * @maxItems 60
   */
  walls: ProposedWall[];
  /**
   * @maxItems 60
   */
  objects: ProposedPlanObject[];
  /**
   * @maxItems 60
   */
  texts: ProposedPlanText[];
}
/**
 * A wall or partition line the model drew along, as points on the picture.
 */
export interface ProposedWall {
  /**
   * @minItems 2
   * @maxItems 20
   */
  points:
    | [ImagePoint, ImagePoint]
    | [ImagePoint, ImagePoint, ImagePoint]
    | [ImagePoint, ImagePoint, ImagePoint, ImagePoint]
    | [ImagePoint, ImagePoint, ImagePoint, ImagePoint, ImagePoint]
    | [ImagePoint, ImagePoint, ImagePoint, ImagePoint, ImagePoint, ImagePoint]
    | [ImagePoint, ImagePoint, ImagePoint, ImagePoint, ImagePoint, ImagePoint, ImagePoint]
    | [ImagePoint, ImagePoint, ImagePoint, ImagePoint, ImagePoint, ImagePoint, ImagePoint, ImagePoint]
    | [ImagePoint, ImagePoint, ImagePoint, ImagePoint, ImagePoint, ImagePoint, ImagePoint, ImagePoint, ImagePoint]
    | [
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint
      ]
    | [
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint
      ]
    | [
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint
      ]
    | [
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint
      ]
    | [
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint
      ]
    | [
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint
      ]
    | [
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint
      ]
    | [
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint
      ]
    | [
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint
      ]
    | [
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint
      ]
    | [
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint,
        ImagePoint
      ];
}
/**
 * Something the vision model marked on the plan: a box around it and what it is called.
 * A draft only, never a measurement or a complete list.
 */
export interface ProposedPlanObject {
  /**
   * Stable, lowercase identifier. Never reused for a different entity.
   */
  id: string;
  label: string;
  /**
   * The label is text printed on the plan.
   */
  named_on_plan: boolean;
  kind: "equipment" | "structure" | "keep_clear" | "walkway";
  box: ImageBox;
}
/**
 * Text the model read on the plan, as content (never an instruction).
 */
export interface ProposedPlanText {
  text: string;
  at: ImagePoint;
}
/**
 * The person's description of the work and the reviewed objects (SIM-01, "Suggest setup").
 * Object names are content from the plan, never instructions.
 */
export interface ProcessSuggestionRequest {
  description: string;
  /**
   * @minItems 2
   * @maxItems 200
   */
  objects: [SetupObject, SetupObject, ...SetupObject[]];
}
/**
 * One reviewed object offered to "Suggest setup": its name, kind and footprint only.
 */
export interface SetupObject {
  /**
   * Stable, lowercase identifier. Never reused for a different entity.
   */
  id: string;
  name: string;
  kind: "structure" | "equipment" | "reference" | "walkway" | "keep_clear";
  /**
   * Strictly positive length in metres.
   */
  width_m: number;
  /**
   * Strictly positive length in metres.
   */
  depth_m: number;
}
/**
 * The API's answer to "Suggest setup": a suggestion for the person to review, or why
 * there is none.
 */
export interface ProcessSuggestionResult {
  outcome: "suggestion" | "unsupported";
  suggestion: ProcessSuggestion | null;
  message: string | null;
  checks: string[];
  provider: ProviderRun;
}
/**
 * Station roles and order, what moves, and questions to ask the person. It has no place for
 * a cycle time, a staffing level or any other operating value: those are entered or accepted
 * as illustrative examples by the person, never suggested as facts.
 */
export interface ProcessSuggestion {
  item_name: string | null;
  /**
   * @minItems 2
   * @maxItems 12
   */
  stations:
    | [SuggestedStation, SuggestedStation]
    | [SuggestedStation, SuggestedStation, SuggestedStation]
    | [SuggestedStation, SuggestedStation, SuggestedStation, SuggestedStation]
    | [SuggestedStation, SuggestedStation, SuggestedStation, SuggestedStation, SuggestedStation]
    | [SuggestedStation, SuggestedStation, SuggestedStation, SuggestedStation, SuggestedStation, SuggestedStation]
    | [
        SuggestedStation,
        SuggestedStation,
        SuggestedStation,
        SuggestedStation,
        SuggestedStation,
        SuggestedStation,
        SuggestedStation
      ]
    | [
        SuggestedStation,
        SuggestedStation,
        SuggestedStation,
        SuggestedStation,
        SuggestedStation,
        SuggestedStation,
        SuggestedStation,
        SuggestedStation
      ]
    | [
        SuggestedStation,
        SuggestedStation,
        SuggestedStation,
        SuggestedStation,
        SuggestedStation,
        SuggestedStation,
        SuggestedStation,
        SuggestedStation,
        SuggestedStation
      ]
    | [
        SuggestedStation,
        SuggestedStation,
        SuggestedStation,
        SuggestedStation,
        SuggestedStation,
        SuggestedStation,
        SuggestedStation,
        SuggestedStation,
        SuggestedStation,
        SuggestedStation
      ]
    | [
        SuggestedStation,
        SuggestedStation,
        SuggestedStation,
        SuggestedStation,
        SuggestedStation,
        SuggestedStation,
        SuggestedStation,
        SuggestedStation,
        SuggestedStation,
        SuggestedStation,
        SuggestedStation
      ]
    | [
        SuggestedStation,
        SuggestedStation,
        SuggestedStation,
        SuggestedStation,
        SuggestedStation,
        SuggestedStation,
        SuggestedStation,
        SuggestedStation,
        SuggestedStation,
        SuggestedStation,
        SuggestedStation,
        SuggestedStation
      ];
  /**
   * @maxItems 6
   */
  questions:
    | []
    | [string]
    | [string, string]
    | [string, string, string]
    | [string, string, string, string]
    | [string, string, string, string, string]
    | [string, string, string, string, string, string];
}
export interface SuggestedStation {
  /**
   * Stable, lowercase identifier. Never reused for a different entity.
   */
  object_id: string;
  name: string;
  role: "supply" | "process";
  why: string;
}
/**
 * What the browser sends to package a bundle: the texts it made, the asset URIs to copy in
 * (each checked against the project's own hash), and the manifest without its file list.
 */
export interface EvidenceBundleRequest {
  manifest: EvidenceManifest;
  /**
   * @minItems 1
   * @maxItems 20
   */
  texts:
    | [EvidenceText]
    | [EvidenceText, EvidenceText]
    | [EvidenceText, EvidenceText, EvidenceText]
    | [EvidenceText, EvidenceText, EvidenceText, EvidenceText]
    | [EvidenceText, EvidenceText, EvidenceText, EvidenceText, EvidenceText]
    | [EvidenceText, EvidenceText, EvidenceText, EvidenceText, EvidenceText, EvidenceText]
    | [EvidenceText, EvidenceText, EvidenceText, EvidenceText, EvidenceText, EvidenceText, EvidenceText]
    | [EvidenceText, EvidenceText, EvidenceText, EvidenceText, EvidenceText, EvidenceText, EvidenceText, EvidenceText]
    | [
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText
      ]
    | [
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText
      ]
    | [
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText
      ]
    | [
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText
      ]
    | [
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText
      ]
    | [
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText
      ]
    | [
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText
      ]
    | [
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText
      ]
    | [
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText
      ]
    | [
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText
      ]
    | [
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText
      ]
    | [
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText,
        EvidenceText
      ];
  /**
   * @maxItems 200
   */
  include: string[];
}
export interface EvidenceManifest {
  format: "rws-evidence/1";
  created_utc: string;
  schema_version: "0.14.0";
  engine: string;
  project: EvidenceProject;
  process: EvidenceProcess;
  /**
   * @minItems 1
   * @maxItems 2
   */
  runs: [EvidenceRun] | [EvidenceRun, EvidenceRun];
  comparison: EvidenceComparison | null;
  inputs: EvidenceInput[];
  /**
   * What the drawing and its review established (design geometry), in words.
   */
  layout_evidence: string[];
  /**
   * What the results do and do not show.
   */
  claims: string[];
  /**
   * Units, timestamps and event ordering.
   */
  conventions: string[];
  /**
   * 'full': the project and every source and model file it names are included; 'runs_only': the runs replay from the project file, but some of its files are not included (see 'excluded'); 'summary_only': no project file, so nothing can be rerun.
   */
  replay: "full" | "runs_only" | "summary_only";
  /**
   * @maxItems 200
   */
  files: EvidenceFile[];
  excluded: EvidenceExcluded[];
}
export interface EvidenceProject {
  /**
   * Null in a summary-only bundle.
   */
  file: string | null;
  id: string;
  name: string;
  /**
   * A labelled synthetic or demonstration project.
   */
  synthetic: boolean;
  note: string | null;
}
export interface EvidenceProcess {
  name: string;
  fingerprint: string;
  seed: number;
  example_note: string | null;
}
/**
 * One run of the process on one layout, as the engine produced it.
 */
export interface EvidenceRun {
  layout: "original" | "edited";
  engine: string;
  seed: number;
  scene_revision: number;
  layout_fingerprint: string;
  process_fingerprint: string;
  outcome: "ready" | "blocked" | "cannot_determine" | "needs_input";
  reasons: string[];
  event_fingerprint: string | null;
  event_count: number;
  completed: number | null;
  created: number | null;
  unfinished: number | null;
  events_file: string | null;
  metrics_file: string | null;
}
export interface EvidenceComparison {
  identical: boolean;
  explanation: string[];
}
/**
 * One operating value of the process and where it came from.
 */
export interface EvidenceInput {
  /**
   * Where it is in the process, e.g. stations[1].worker_s.
   */
  path: string;
  label: string;
  /**
   * The number in ``unit``; null for a place (detail).
   */
  value: number | null;
  unit: string;
  detail: string | null;
  basis: "example" | "entered";
}
export interface EvidenceFile {
  /**
   * A relative path inside the bundle: no '..', no leading '/', no backslash.
   */
  path: string;
  sha256: string;
  bytes: number;
  role: "readme" | "summary" | "project" | "events" | "metrics" | "source" | "model";
  /**
   * For an asset: the URI the project uses for it (source library or catalog).
   */
  uri: string | null;
}
export interface EvidenceExcluded {
  what: string;
  reason: string;
}
export interface EvidenceText {
  /**
   * A relative path inside the bundle: no '..', no leading '/', no backslash.
   */
  path: string;
  role: "readme" | "summary" | "project" | "events" | "metrics";
  text: string;
}
/**
 * A bundle checked and opened: its manifest, its project, the recorded event logs, and
 * what was verified, stored or missing.
 */
export interface EvidenceBundleOpened {
  manifest: EvidenceManifest;
  project: Project;
  events: {
    [k: string]:
      | {
          [k: string]: unknown | undefined;
        }[]
      | undefined;
  };
  verified: string[];
  stored: string[];
  problems: string[];
}
export interface EvidenceInventory {
  assets: EvidenceAsset[];
}
/**
 * A file the project names, and whether it can go in a bundle.
 */
export interface EvidenceAsset {
  uri: string;
  kind: "drawing" | "plan" | "photo" | "model";
  label: string;
  sha256: string | null;
  bytes: number | null;
  /**
   * 'repo_owned': a synthetic fixture or catalog model in this repository, verified by hash; 'library': the person's own file in their local library; 'missing' or 'changed': not available as the project recorded it.
   */
  status: "repo_owned" | "library" | "missing" | "changed";
}
