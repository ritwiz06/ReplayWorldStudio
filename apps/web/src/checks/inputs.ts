// What the layout and route checks see (GEO-01/02): the current objects' footprints on the
// floor, the reviewed floor's edge, keep-clear zones, and the geometry the drawing leaves
// uncertain (open lines, shapes not imported, outlines whose boxes only enclose them). All in
// world metres; the arrangement is the edited one unless an as-drawn project is passed in.
import type { Project, SceneObject } from "@replay-world/contracts";
import { drawingReasons, type FootprintEvidence, footprintEvidence } from "../drawing/readiness";
import { describeRef, type DrawingSource, drawingSource, floorOnOutline, toWorld } from "../drawing/world";
import { isSlab } from "../scene/sceneBounds";
import { footprint, type Vec } from "./geometry";

export interface Shape {
  id: string;
  name: string;
  kind: SceneObject["kind"];
  poly: Vec[];
  evidence: FootprintEvidence;
}

/** Geometry the drawing leaves uncertain: shown on the plan, not an object. */
export interface Uncertain {
  label: string;
  points: Vec[];
  closed: boolean;
}

export interface CheckInputs {
  source: DrawingSource;
  /** The reviewed floor's edge, or null when the floor is only for display. */
  floor: { poly: Vec[]; words: string } | null;
  obstacles: Shape[];
  zones: Shape[];
  uncertain: Uncertain[];
  /** Shapes not imported whose position is unknown: they could be anywhere. */
  unplaced: string[];
  /** Why no check can be made at all. */
  blockers: string[];
}

export const TOLERANCE_M = 0.001;

/** The checks' inputs, or null when the project has no reviewed drawing. */
export function checkInputs(project: Project): CheckInputs | null {
  const source = drawingSource(project);
  if (!source) return null;
  const review = source.drawing.review;
  const t = source.source_to_world;
  const floorId = review.floor.object_id;
  const shapes = (o: SceneObject): Shape => ({ id: o.id, name: o.name, kind: o.kind, poly: footprint(o), evidence: footprintEvidence(project, o) });
  const live = project.scene.objects;
  const obstacles = live.filter((o) => o.id !== floorId && !isSlab(o) && (o.kind === "equipment" || o.kind === "structure")).map(shapes);
  const zones = live.filter((o) => o.kind === "keep_clear").map(shapes);

  let floor: CheckInputs["floor"] = null;
  const floorObject = live.find((o) => o.id === floorId);
  if (review.floor.choice === "outline" && review.floor.drawn_id && floorObject) {
    const outline = source.drawing.objects.find((d) => d.id === review.floor.drawn_id)!;
    const drawnFloor = floorOnOutline(source.filename, t, review.scale, outline, floorObject.id);
    const sameSize = floorObject.dimensions.width.origin === "drawn" && floorObject.dimensions.depth.origin === "drawn";
    if (sameSize) {
      // The drawn outline, carried along if the floor slab itself was moved or turned.
      const turn = floorObject.transform.rotation_rad.y - drawnFloor.transform.rotation_rad.y;
      const c0 = drawnFloor.transform.position_m;
      const c1 = floorObject.transform.position_m;
      const c = Math.cos(turn);
      const s = Math.sin(turn);
      const poly = outline.outline.map((p) => {
        const w = toWorld(t, p);
        const dx = w.x - c0.x;
        const dz = w.z - c0.z;
        return { x: c1.x + dx * c + dz * s, z: c1.z - dx * s + dz * c };
      });
      floor = { poly, words: `the floor outline ${describeRef(outline.refs[0]!)}` };
    } else floor = { poly: footprint(floorObject), words: "the floor's entered size" };
  }

  const uncertain: Uncertain[] = [];
  for (const line of source.drawing.lines) {
    if (line.closed || line.ref.block !== null) continue;
    uncertain.push({ label: `an open line on layer ${line.ref.layer} (${describeRef(line.ref)})`, points: line.points.map((p) => toWorld(t, p)), closed: false });
  }
  const unplaced: string[] = [];
  const layoutSkipped = source.drawing.skipped.filter((s) => s.layout).reduce((n, s) => n + s.count, 0);
  if (source.drawing.omitted === null) {
    if (layoutSkipped > 0) unplaced.push(`${layoutSkipped} shape${layoutSkipped === 1 ? "" : "s"} not imported (read before positions were recorded: upload the drawing again)`);
  } else {
    for (const shape of source.drawing.omitted) {
      const label = `an omitted ${shape.entity}${shape.handle ? ` ${shape.handle}` : ""} on layer ${shape.layer}`;
      if (!shape.min || !shape.max) {
        unplaced.push(label);
        continue;
      }
      const corners = [
        { x: shape.min.x, y: shape.min.y },
        { x: shape.max.x, y: shape.min.y },
        { x: shape.max.x, y: shape.max.y },
        { x: shape.min.x, y: shape.max.y },
      ].map((p) => toWorld(t, p));
      uncertain.push({ label, points: corners, closed: true });
    }
  }
  return { source, floor, obstacles, zones, uncertain, unplaced, blockers: drawingReasons(source) };
}
