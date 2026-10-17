// From a DXF reading to an editable draft world (ONB-01). The API reads the drawing (IMP-01);
// this module settles the unit, maps drawing units to world metres, and builds one scene object
// per drawn object with its evidence: the footprint as drawn, a height assumed only for display,
// and a link back to the drawing entity it came from. Nothing here talks to the API.
import {
  SCHEMA_VERSION,
  type DrawingAnalysis,
  type DrawingImport,
  type DrawingObject,
  type DrawingRef,
  type Length,
  type Project,
  type SceneObject,
  type SourceDocument,
  type SourceToWorldTransform,
  type Transform,
} from "@replay-world/contracts";
import { quantizeMetres } from "../editing/units";

export type DrawingUnit = SourceToWorldTransform["source_unit"];
export type UnitBasis = NonNullable<DrawingImport["units"]["basis"]>;

export const UNITS: readonly DrawingUnit[] = ["mm", "cm", "m", "in", "ft"];
export const METRES_PER_UNIT: Record<DrawingUnit, number> = { mm: 0.001, cm: 0.01, m: 1, in: 0.0254, ft: 0.3048 };
export const UNIT_NAME: Record<DrawingUnit, string> = { mm: "millimetres", cm: "centimetres", m: "metres", in: "inches", ft: "feet" };
const UNIT_SINGULAR: Record<DrawingUnit, string> = { mm: "1 mm", cm: "1 cm", m: "1 m", in: "1 inch", ft: "1 foot" };

/** A drawing source with its reading and transform, as stored in a project. */
export type DrawingSource = SourceDocument & { drawing: DrawingImport; source_to_world: SourceToWorldTransform; filename: string };

export function drawingSource(project: Project): DrawingSource | null {
  const source = project.sources.find((s) => s.drawing !== null && s.source_to_world !== null && s.filename !== null);
  return (source as DrawingSource | undefined) ?? null;
}

/** The unit the drawing settles by itself, or null when the person has to choose. */
export function headerUnit(drawing: DrawingImport): DrawingUnit | null {
  return drawing.units.question === null ? drawing.units.declared : null;
}

/** How the chosen unit was established: from the header only when the header settled it. */
export function unitBasis(drawing: DrawingImport, unit: DrawingUnit): UnitBasis {
  return headerUnit(drawing) === unit ? "drawing_header" : "user_supplied";
}

/** The drawing's overall size in metres if it is drawn in `unit`. */
export function sizeIn(drawing: DrawingImport, unit: DrawingUnit): { width: number; depth: number } {
  const s = METRES_PER_UNIT[unit];
  return { width: (drawing.extent_max.x - drawing.extent_min.x) * s, depth: (drawing.extent_max.y - drawing.extent_min.y) * s };
}

/** A length for a person: "24 m", "2.4 km", "38 cm". */
export function formatLength(metres: number): string {
  if (metres >= 1000) return `${(metres / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })} km`;
  if (metres >= 1) return `${metres.toLocaleString("en-US", { maximumFractionDigits: metres >= 100 ? 0 : 1 })} m`;
  if (metres >= 0.01) return `${(metres * 100).toLocaleString("en-US", { maximumFractionDigits: 1 })} cm`;
  return `${(metres * 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })} mm`;
}

export function formatSize(drawing: DrawingImport, unit: DrawingUnit): string {
  const { width, depth } = sizeIn(drawing, unit);
  return `${formatLength(width)} × ${formatLength(depth)}`;
}

/** Centre the drawing on the world origin; its +X is world +X and its +Y is world -Z. */
export function sourceToWorld(drawing: DrawingImport, unit: DrawingUnit): SourceToWorldTransform {
  const s = METRES_PER_UNIT[unit];
  const cx = (drawing.extent_min.x + drawing.extent_max.x) / 2;
  const cy = (drawing.extent_min.y + drawing.extent_max.y) / 2;
  return {
    convention: "plan_xy_to_world_x_neg_z",
    source_unit: unit,
    metres_per_source_unit: s,
    rotation_about_world_y_rad: 0,
    translation_m: { x: quantizeMetres(-cx * s, 1) || 0, y: 0, z: quantizeMetres(cy * s, 1) || 0 },
  };
}

/** A drawing point in world metres (on the floor plane). */
export function toWorld(t: SourceToWorldTransform, p: { x: number; y: number }): { x: number; z: number } {
  const X = p.x * t.metres_per_source_unit;
  const Z = -p.y * t.metres_per_source_unit;
  const c = Math.cos(t.rotation_about_world_y_rad);
  const s = Math.sin(t.rotation_about_world_y_rad);
  return { x: X * c + Z * s + t.translation_m.x, z: -X * s + Z * c + t.translation_m.z };
}

const wrap = (rad: number) => {
  const a = Math.atan2(Math.sin(rad), Math.cos(rad));
  return Math.abs(a) < 1e-12 ? 0 : a;
};

/** Where a drawn object stands in the world as the drawing places it. */
export function drawnTransform(t: SourceToWorldTransform, drawn: DrawingObject): Transform {
  const { x, z } = toWorld(t, drawn.centre);
  const y = drawn.role === "floor" ? -FLOOR_THICKNESS_M : 0;
  // A counter-clockwise turn on the plan is a turn about world +Y by the same angle.
  const yaw = Number(wrap(drawn.rotation_rad + t.rotation_about_world_y_rad).toFixed(6));
  return { position_m: { x: quantizeMetres(x, 1) || 0, y, z: quantizeMetres(z, 1) || 0 }, rotation_rad: { order: "XYZ", x: 0, y: yaw, z: 0 } };
}

/** The drawn footprint in world metres (width along its turned X, depth along its turned Z). */
export function drawnSize(t: SourceToWorldTransform, drawn: DrawingObject): { width: number; depth: number } {
  const s = t.metres_per_source_unit;
  return { width: Math.max(0.001, quantizeMetres(drawn.width * s, 1)), depth: Math.max(0.001, quantizeMetres(drawn.depth * s, 1)) };
}

const FLOOR_THICKNESS_M = 0.1;
const MARKING_M = 0.005;

/** Display heights for the draft, by what an object is called. A typical value only: it stays
 * a default, is said to be one, and is never used by a check that needs a real height. */
const DISPLAY_HEIGHTS: readonly [RegExp, number, string][] = [
  [/rack|shelv|shelf/i, 2.4, "rack or shelving"],
  [/pallet/i, 0.15, "pallet"],
  [/conveyor/i, 0.9, "conveyor"],
  [/table|bench|desk/i, 0.9, "table or bench"],
  [/panel|cabinet|locker/i, 2.0, "cabinet or panel"],
  [/press/i, 2.2, "press"],
  [/tank|silo/i, 2.5, "tank"],
  [/mill|lathe|saw|drill|machine|cnc|cell/i, 1.6, "machine"],
];

export function displayHeight(drawn: DrawingObject): { height: number; what: string } {
  if (drawn.kind === "structure") return { height: 3, what: "column or wall" };
  const text = `${drawn.label} ${drawn.refs.map((r) => r.block ?? "").join(" ")}`;
  const match = DISPLAY_HEIGHTS.find(([pattern]) => pattern.test(text));
  return match ? { height: match[1], what: match[2] } : { height: 1.2, what: "piece of equipment" };
}

export function describeRef(ref: DrawingRef): string {
  return `${ref.entity}${ref.handle ? ` ${ref.handle}` : ""} on layer ${ref.layer}${ref.block ? ` (in block ${ref.block})` : ""}`;
}

function unitPhrase(t: SourceToWorldTransform, basis: UnitBasis): string {
  const unit = t.source_unit;
  return basis === "drawing_header"
    ? `1 unit = ${UNIT_SINGULAR[unit]} (the drawing's own unit, $INSUNITS)`
    : `1 unit = ${UNIT_SINGULAR[unit]} (your answer: the drawing did not settle its unit)`;
}

const length = (value: number, origin: Length["origin"], ref: string): Length => ({
  value_m: value,
  origin,
  source_ref: ref.slice(0, 500),
  review_status: "unreviewed",
  uncertainty_m: null,
});

/** One scene object for a drawn object: footprint from the drawing, a display height. */
export function drawnObject(filename: string, t: SourceToWorldTransform, basis: UnitBasis, drawn: DrawingObject): SceneObject {
  const { width, depth } = drawnSize(t, drawn);
  const ref = drawn.refs[0]!;
  const shape =
    ref.entity === "INSERT"
      ? "the extent of the block as inserted"
      : drawn.notes.some((n) => n.includes("not a rectangle"))
        ? "the smallest rectangle around the drawn outline"
        : "the outline as drawn";
  const footprint = `Drawn in ${filename}: ${describeRef(ref)}, ${shape}; ${unitPhrase(t, basis)}. The drawing's size, not a site measurement.`;
  let height: Length;
  if (drawn.role === "floor") height = length(FLOOR_THICKNESS_M, "default", "Floor slab thickness for display; a drawing gives no thickness");
  else if (drawn.kind === "walkway" || drawn.kind === "keep_clear") height = length(MARKING_M, "default", "Drawn as a marking on the floor; a drawing gives no height");
  else {
    const shown = displayHeight(drawn);
    height = length(
      shown.height,
      "default",
      `Display height for the draft (typical for a ${shown.what}): not in the drawing and not measured. A check that needs the height says "height needed".`,
    );
  }
  return {
    id: drawn.object_id,
    name: drawn.label.slice(0, 500),
    kind: drawn.kind,
    asset_id: null,
    transform: drawnTransform(t, drawn),
    dimensions: { width: length(width, "measured", footprint), height, depth: length(depth, "measured", footprint) },
    parameters: [],
  };
}

const stem = (filename: string) => filename.replace(/\.[^.]+$/, "") || filename;

/** The draft project: one drawing source and one scene object per drawn object. */
export function buildDrawingProject(analysis: DrawingAnalysis, unit: DrawingUnit): Project {
  const basis = unitBasis(analysis.drawing, unit);
  const t = sourceToWorld(analysis.drawing, unit);
  const tag = analysis.sha256.slice(0, 12);
  const name = `${stem(analysis.filename)} (draft from drawing)`.slice(0, 500);
  // The floor first, so the floor slab is drawn under everything and listed first.
  const ordered = [...analysis.drawing.objects].sort((a, b) => Number(b.role === "floor") - Number(a.role === "floor"));
  return {
    schema_version: SCHEMA_VERSION,
    id: `proj-dxf-${tag}`,
    name,
    units: { length: "m", time: "s", mass: "kg", angle: "rad" },
    world_frame: { handedness: "right", up_axis: "+Y", floor_plane: "XZ" },
    fixture: null,
    sources: [
      {
        id: `src-dxf-${tag}`,
        kind: "dxf",
        filename: analysis.filename,
        sha256: analysis.sha256,
        source_to_world: t,
        import_warnings: analysis.warnings.map((w) => w.slice(0, 500)),
        image: null,
        photo_import: null,
        drawing: { ...analysis.drawing, units: { ...analysis.drawing.units, basis } },
      },
    ],
    catalog: [],
    scene: {
      id: `scene-dxf-${tag}`,
      name,
      revision: 0,
      objects: ordered.map((drawn) => drawnObject(analysis.filename, t, basis, drawn)),
      edit_log: [],
    },
  };
}

/** The drawing entity a scene object was drawn from, if any. */
export function drawnFrom(project: Project, objectId: string): { source: DrawingSource; drawn: DrawingObject } | null {
  const source = drawingSource(project);
  const drawn = source?.drawing.objects.find((o) => o.object_id === objectId);
  return source && drawn ? { source, drawn } : null;
}

/** A world point back on the drawing (the inverse of `toWorld`). */
export function fromWorld(t: SourceToWorldTransform, p: { x: number; z: number }): { x: number; y: number } {
  const X = p.x - t.translation_m.x;
  const Z = p.z - t.translation_m.z;
  const c = Math.cos(t.rotation_about_world_y_rad);
  const s = Math.sin(t.rotation_about_world_y_rad);
  // Undo the turn about +Y, then the axis convention (drawing +Y is world -Z) and the scale.
  const x = X * c - Z * s;
  const z = X * s + Z * c;
  return { x: x / t.metres_per_source_unit, y: -z / t.metres_per_source_unit };
}

/** A scene object's footprint corners in drawing units, for drawing it on the plan. */
export function footprintOnPlan(t: SourceToWorldTransform, object: SceneObject): { x: number; y: number }[] {
  const centre = fromWorld(t, { x: object.transform.position_m.x, z: object.transform.position_m.z });
  const angle = object.transform.rotation_rad.y - t.rotation_about_world_y_rad;
  const hw = object.dimensions.width.value_m / t.metres_per_source_unit / 2;
  const hd = object.dimensions.depth.value_m / t.metres_per_source_unit / 2;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ].map(([u, v]) => ({ x: centre.x + u! * c - v! * s, y: centre.y + u! * s + v! * c }));
}
