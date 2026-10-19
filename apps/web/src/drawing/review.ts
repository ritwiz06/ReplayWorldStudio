// Reviewing a draft from a drawing (IMP-02): the floor, the scale and each object, as editor
// commands. A correction changes the scene (through object snapshots), the drawing source's
// review and, for the scale, its transform, and records itself in the edit log as one
// `drawing_reviewed` step, so undo and redo restore it exactly and a saved file still describes
// its scene. The drawing's own reading (units, kinds, names as read) is never changed: the
// review holds the person's decisions beside it. On a plan picture (IMP-03) the person can also
// trace an object's outline, add one the proposal missed, and trace the floor: a traced outline
// records how precisely it was marked, and only then may a check rely on it.
import type { DrawingObject, DrawingReview, PlanPoint, Project, SceneObject, SourceDocument } from "@replay-world/contracts";
import type { Change, ObjectPatch, Result } from "../editing/commands";
import { quantizeMetres } from "../editing/units";
import {
  type DrawingSource,
  type DrawingUnit,
  describeRef,
  displayHeightLength,
  drawingSource,
  drawnObject,
  FLOOR_OBJECT_ID,
  floorAround,
  floorOnOutline,
  formatLength,
  formatScale,
  fromWorld,
  isMarking,
  isPlanImage,
  METRES_PER_UNIT,
  type ObjectKind,
  type Reviewed,
  type ScaleReview,
  scalePhrase,
  sourceToWorld,
  statusOf,
  toWorld,
  UNIT_NAME,
} from "./world";

export type ReviewCorrection =
  /** Use another closed outline as the floor, or a floor sized around the objects. */
  | { kind: "floor"; to: string | "automatic" }
  | { kind: "accept_floor" }
  /** Use (or confirm) a unit: the drawing's own, or one the person chooses. */
  | { kind: "unit"; unit: DrawingUnit }
  /** A known length between two points; use it as the scale, or keep the unit and record it.
   * `tolerance`: how precisely each point was marked, in drawing units (a plan picture). */
  | { kind: "reference"; a: PlanPoint; b: PlanPoint; realLengthM: number; use: "reference" | "unit"; tolerance?: number }
  /** Trace an object's outline on a plan picture by three of its corners: correct a proposed
   * outline (`drawnId`), or add an object the proposal missed (`drawnId` null). */
  | { kind: "trace"; drawnId: string | null; corners: readonly [PlanPoint, PlanPoint, PlanPoint]; tolerance: number; name?: string; objectKind?: ObjectKind }
  /** Trace the floor's outline on a plan picture, corner by corner. */
  | { kind: "trace_floor"; outline: readonly PlanPoint[]; tolerance: number }
  | { kind: "object"; drawnId: string; action: "accept" }
  | { kind: "object"; drawnId: string; action: "correct"; name?: string; objectKind?: ObjectKind }
  | { kind: "object"; drawnId: string; action: "not_an_object" }
  | { kind: "object"; drawnId: string; action: "make_object"; objectKind: ObjectKind }
  | { kind: "accept_remaining" }
  | { kind: "accept_omissions" }
  /** A layer holds drawing symbols (door swings, wall fill, notes), not things on the floor
   * (0.14.0): its loose lines and left-out shapes stop counting as possible obstacles. */
  | { kind: "symbols"; layer: string; symbols: boolean };

export interface ReviewCommand {
  type: "review_drawing";
  sourceId: string;
  correction: ReviewCorrection;
}

/** A known length agrees with a unit within 2 % (the contract's SCALE_AGREEMENT). */
export const SCALE_AGREEMENT = 0.02;

type Rejection = Extract<Result<object>, { ok: false }>;
const reject = (message: string, kind: "invalid" | "not_found" | "no_change" = "invalid"): Rejection => ({ ok: false, rejection: { kind, message } });

/** What a reference length would mean before the person decides. */
export interface ReferencePreview {
  drawingLength: number;
  metresPerUnit: number;
  /** The drawing's (or chosen) unit it is compared with; null for a plan picture (pixels). */
  unitMetresPerUnit: number | null;
  agrees: boolean | null;
  /** Relative difference, e.g. 0.004 for 0.4 %. */
  difference: number | null;
}

export function previewReference(source: DrawingSource, a: PlanPoint, b: PlanPoint, realLengthM: number): ReferencePreview | null {
  const drawingLength = Math.hypot(b.x - a.x, b.y - a.y);
  if (!(drawingLength > 0) || !(realLengthM > 0) || !Number.isFinite(realLengthM)) return null;
  const metresPerUnit = realLengthM / drawingLength;
  const unit = source.drawing.review.scale.unit;
  if (unit === "px") return { drawingLength, metresPerUnit, unitMetresPerUnit: null, agrees: null, difference: null };
  const unitMetresPerUnit = METRES_PER_UNIT[unit];
  const difference = Math.abs(metresPerUnit / unitMetresPerUnit - 1);
  return { drawingLength, metresPerUnit, unitMetresPerUnit, agrees: difference <= SCALE_AGREEMENT, difference };
}

/** A footprint rectangle from three of its corners: the first two give one side, the third how
 * deep it is (only its distance across that side counts, so a slightly skewed click still gives
 * a rectangle). In drawing units, rotation counter-clockwise from +X. */
export function rectangleFrom(corners: readonly [PlanPoint, PlanPoint, PlanPoint]) {
  const [a, b, c] = corners;
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const side = Math.hypot(ux, uy);
  if (!(side > 0)) return null;
  const nx = -uy / side;
  const ny = ux / side;
  const deep = (c.x - b.x) * nx + (c.y - b.y) * ny;
  if (!(Math.abs(deep) > 0)) return null;
  const r = (v: number) => Number(v.toFixed(3));
  const p3 = { x: r(b.x + nx * deep), y: r(b.y + ny * deep) };
  const p4 = { x: r(a.x + nx * deep), y: r(a.y + ny * deep) };
  return {
    outline: [{ x: r(a.x), y: r(a.y) }, { x: r(b.x), y: r(b.y) }, p3, p4] as DrawingObject["outline"],
    centre: { x: r((a.x + p3.x) / 2), y: r((a.y + p3.y) / 2) },
    width: side,
    depth: Math.abs(deep),
    rotation_rad: Number(Math.atan2(uy, ux).toFixed(6)),
  };
}

/** The floor's size (or the drawing's extent when there is no floor) at a scale, for people. */
export function floorSizeAt(source: DrawingSource, metresPerUnit: number): string {
  const review = source.drawing.review;
  const outline = review.floor.drawn_id ? source.drawing.objects.find((o) => o.id === review.floor.drawn_id) : null;
  const w = outline ? outline.width : source.drawing.extent_max.x - source.drawing.extent_min.x;
  const d = outline ? outline.depth : source.drawing.extent_max.y - source.drawing.extent_min.y;
  return `${formatLength(w * metresPerUnit)} × ${formatLength(d * metresPerUnit)}`;
}

const sameTransform = (a: SceneObject["transform"], b: SceneObject["transform"]) => JSON.stringify(a) === JSON.stringify(b);

/** Every object ID the scene and its edit log have used. */
function usedIds(project: Project): Set<string> {
  const ids = new Set(project.scene.objects.map((o) => o.id));
  for (const record of project.scene.edit_log) {
    if (record.type === "object_removed") ids.add(record.object.id);
    else if (record.type === "asset_revised" || record.type === "drawing_reviewed") for (const o of record.objects) ids.add(o.object_id);
    else if (record.type !== "source_attached" && record.type !== "process_set") ids.add(record.object_id);
  }
  return ids;
}

/** Used IDs plus the IDs drawn objects keep in reserve. */
function takenIds(project: Project, source: DrawingSource): Set<string> {
  const ids = usedIds(project);
  for (const o of source.drawing.objects) ids.add(o.object_id);
  return ids;
}

function freshId(taken: Set<string>, base: string): string {
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  const id = `${base}-${n}`;
  taken.add(id);
  return id;
}

/** Collects the objects a correction changes, then turns them into ordered patches:
 * replacements first, removals from the highest index down, insertions at the end. */
class SceneEdit {
  readonly before: readonly SceneObject[];
  private readonly next = new Map<string, SceneObject | null>();
  private readonly added: SceneObject[] = [];

  constructor(objects: readonly SceneObject[]) {
    this.before = objects;
  }

  current(id: string): SceneObject | null {
    if (this.next.has(id)) return this.next.get(id)!;
    return this.added.find((o) => o.id === id) ?? this.before.find((o) => o.id === id) ?? null;
  }

  set(object: SceneObject) {
    if (this.before.some((o) => o.id === object.id)) this.next.set(object.id, object);
    else {
      const i = this.added.findIndex((o) => o.id === object.id);
      if (i >= 0) this.added[i] = object;
      else this.added.push(object);
    }
  }

  remove(id: string) {
    if (this.before.some((o) => o.id === id)) this.next.set(id, null);
  }

  /** Objects as they would be after the correction, in scene order. */
  result(): SceneObject[] {
    return [...this.before.map((o) => (this.next.has(o.id) ? this.next.get(o.id)! : o)).filter((o): o is SceneObject => o !== null), ...this.added];
  }

  patches(): { patches: ObjectPatch[]; changes: { object_id: string; before: SceneObject | null; after: SceneObject | null }[] } {
    const patches: ObjectPatch[] = [];
    const changes: { object_id: string; before: SceneObject | null; after: SceneObject | null }[] = [];
    this.before.forEach((o, index) => {
      const after = this.next.get(o.id);
      if (after && JSON.stringify(after) !== JSON.stringify(o)) {
        patches.push({ index, before: o, after });
        changes.push({ object_id: o.id, before: o, after });
      }
    });
    const removals = this.before.map((o, index) => ({ o, index })).filter(({ o }) => this.next.get(o.id) === null);
    for (const { o, index } of [...removals].reverse()) patches.push({ index, before: o, after: null });
    for (const { o } of removals) changes.push({ object_id: o.id, before: o, after: null });
    let length = this.before.length - removals.length;
    for (const o of this.added) {
      patches.push({ index: length, before: null, after: o });
      changes.push({ object_id: o.id, before: null, after: o });
      length += 1;
    }
    return { patches, changes };
  }
}

function withReview(source: DrawingSource, review: DrawingReview, extra: Partial<Pick<SourceDocument, "source_to_world">> = {}, objects?: DrawingObject[]): SourceDocument {
  return { ...source, ...extra, drawing: { ...source.drawing, ...(objects ? { objects } : {}), review } };
}

const setStatus = (review: DrawingReview, drawnId: string, status: Reviewed): DrawingReview => ({
  ...review,
  objects: review.objects.map((o) => (o.drawn_id === drawnId ? { ...o, status } : o)),
});

const describeDrawn = (drawn: DrawingObject) => `${drawn.label} (${describeRef(drawn.refs[0]!)})`;
const KIND_WORDS: Record<ObjectKind, string> = {
  equipment: "equipment",
  structure: "a structure",
  walkway: "a walkway (floor marking)",
  keep_clear: "a keep-clear zone (floor marking)",
  reference: "a reference",
};

interface Prepared {
  source: SourceDocument;
  edit: SceneEdit;
  label: string;
  correction: string;
  objectId: string;
}

/** Build the change a review correction would make, without touching the project. */
export function prepareReview(project: Project, command: ReviewCommand): Result<{ change: Change }> {
  const index = project.sources.findIndex((s) => s.id === command.sourceId);
  const source = drawingSource(project);
  if (index < 0 || !source || project.sources[index] !== source) return reject(`No drawing source '${command.sourceId}' with a review in this project.`, "not_found");
  const prepared = prepare(project, source, command.correction);
  if (!prepared.ok) return prepared;
  const { patches, changes } = prepared.edit.patches();
  return {
    ok: true,
    change: {
      label: prepared.label,
      objectId: prepared.objectId,
      patches,
      sourcePatch: { index, before: source, after: prepared.source },
      record: { type: "drawing_reviewed", source_id: source.id, correction: prepared.correction.slice(0, 500), objects: changes },
    },
  };
}

function prepare(project: Project, source: DrawingSource, c: ReviewCorrection): ({ ok: true } & Prepared) | Rejection {
  const review = source.drawing.review;
  const edit = new SceneEdit(project.scene.objects);
  const t = source.source_to_world;
  const find = (id: string) => source.drawing.objects.find((o) => o.id === id);
  const floorId = review.floor.object_id;

  switch (c.kind) {
    case "accept_floor": {
      if (review.floor.status !== "proposed") return reject("The floor is already reviewed.", "no_change");
      const what = review.floor.drawn_id ? describeDrawn(find(review.floor.drawn_id)!) : review.floor.choice === "automatic" ? "sized around the objects" : "none";
      return ok(withReview(source, { ...review, floor: { ...review.floor, status: "accepted" } }), edit, "Accept the floor", `Floor accepted: ${what}`, floorId ?? "");
    }

    case "floor": {
      const previous = review.floor;
      if ((c.to === "automatic" && previous.choice === "automatic") || c.to === previous.drawn_id) return reject("That is already the floor.", "no_change");
      const taken = takenIds(project, source);
      let drawnObjects = source.drawing.objects;
      let next = review;
      // The outline that was the floor is no longer an object of its own unless the person makes it one.
      if (previous.drawn_id) {
        next = setStatus(next, previous.drawn_id, "not_an_object");
        const old = find(previous.drawn_id)!;
        if (old.object_id === floorId || edit.current(old.object_id)) {
          const reserved = freshId(taken, old.object_id === floorId ? `${old.object_id}-outline` : old.object_id);
          drawnObjects = drawnObjects.map((o) => (o.id === old.id ? { ...o, object_id: reserved } : o));
        }
      }
      const id = floorId ?? (taken.has(FLOOR_OBJECT_ID) ? freshId(taken, FLOOR_OBJECT_ID) : FLOOR_OBJECT_ID);
      let floor: SceneObject;
      let words: string;
      if (c.to === "automatic") {
        floor = floorAround(edit.result(), id);
        words = "sized around the objects";
        next = { ...next, floor: { choice: "automatic", drawn_id: null, object_id: id, status: "corrected" } };
      } else {
        const outline = find(c.to);
        if (!outline) return reject(`No drawn outline '${c.to}'.`, "not_found");
        if (statusOf(source, outline.id) !== "used_as_floor" && edit.current(outline.object_id)) edit.remove(outline.object_id);
        floor = floorOnOutline(source.filename, t, review.scale, outline, id);
        words = describeDrawn(outline);
        next = setStatus({ ...next, floor: { choice: "outline", drawn_id: outline.id, object_id: id, status: "corrected" } }, outline.id, "used_as_floor");
      }
      const existing = edit.current(id);
      // A floor the person renamed keeps its name.
      edit.set(existing && !existing.name.startsWith("Floor") ? { ...floor, name: existing.name } : floor);
      const was = previous.drawn_id ? describeDrawn(find(previous.drawn_id)!) : previous.choice === "automatic" ? "sized around the objects" : "no floor";
      return ok(withReview(source, next, {}, drawnObjects), edit, "Change the floor", `Floor: ${words}, instead of ${was}`, id);
    }

    case "unit": {
      if (isPlanImage(source.drawing)) return reject("A plan picture has no unit: mark a length you know instead.");
      const scale = review.scale;
      const basis = c.unit === source.drawing.units.declared ? "drawing_unit" : "chosen_unit";
      const next: ScaleReview = { basis, unit: c.unit, metres_per_unit: METRES_PER_UNIT[c.unit], status: "confirmed", reference: null };
      if (scale.basis === basis && scale.unit === c.unit) {
        if (scale.status !== "unchecked") return reject("This unit is already confirmed.", "no_change");
        return ok(withReview(source, { ...review, scale: { ...scale, status: "confirmed" } }), edit, "Confirm the scale", `Scale confirmed: ${scalePhrase(scale)}`, floorId ?? "");
      }
      return rescale(project, source, edit, next, "Change the scale", `Scale: ${scalePhrase(next)}, instead of ${scalePhrase(scale)}${scale.reference ? ` (your ${scale.reference.real_length_m.toFixed(2)} m measurement is replaced)` : ""}`);
    }

    case "reference": {
      const preview = previewReference(source, c.a, c.b, c.realLengthM);
      if (!preview) return reject("Mark two different points and enter a length above 0 m.");
      const scale = review.scale;
      const reference = {
        a: { x: c.a.x, y: c.a.y },
        b: { x: c.b.x, y: c.b.y },
        drawing_length: preview.drawingLength,
        real_length_m: c.realLengthM,
        metres_per_unit: preview.metresPerUnit,
        compared_with: preview.unitMetresPerUnit,
        agrees: preview.agrees,
        tolerance: c.tolerance ?? null,
      };
      const pixels = scale.unit === "px";
      const measured = `your known length of ${c.realLengthM.toFixed(2)} m (${Number(preview.drawingLength.toPrecision(6))} ${pixels ? "px" : "drawing units"}) gives 1 ${pixels ? "px" : "unit"} = ${formatScale(preview.metresPerUnit)}`;
      if (pixels) {
        const next: ScaleReview = { basis: "reference_length", unit: "px", metres_per_unit: preview.metresPerUnit, status: "measured", reference };
        return rescale(project, source, edit, next, "Set the scale from a known length", `Scale: ${measured}, instead of ${scalePhrase(scale)}`);
      }
      if (c.use === "reference") {
        const next: ScaleReview = { basis: "reference_length", unit: scale.unit, metres_per_unit: preview.metresPerUnit, status: "measured", reference };
        return rescale(project, source, edit, next, "Set the scale from a known length", `Scale: ${measured}; the ${scale.basis === "reference_length" ? "previous measurement" : `drawing's unit said 1 ${scale.unit}`} (${preview.agrees ? "agrees" : `${((preview.difference ?? 0) * 100).toFixed(1)} % apart`})`);
      }
      const unitBasis = scale.unit === source.drawing.units.declared ? "drawing_unit" : "chosen_unit";
      const next: ScaleReview = { basis: unitBasis, unit: scale.unit, metres_per_unit: preview.unitMetresPerUnit!, status: preview.agrees ? "measured" : "confirmed", reference };
      const words = preview.agrees
        ? `Scale checked: ${measured}, which agrees with 1 unit = 1 ${scale.unit} (${((preview.difference ?? 0) * 100).toFixed(1)} % apart)`
        : `Scale kept at 1 unit = 1 ${scale.unit} although ${measured} (${((preview.difference ?? 0) * 100).toFixed(1)} % apart)`;
      return rescale(project, source, edit, next, preview.agrees ? "Check the scale" : "Keep the drawing's unit", words);
    }

    case "trace": {
      if (!isPlanImage(source.drawing)) return reject("Outlines are traced only on a plan picture; a drawing's outlines are exact as drawn.");
      const rect = rectangleFrom(c.corners);
      if (!rect) return reject("Click three different corners of the outline.");
      const layer = source.drawing.layers[0] ?? "image";
      const trace = { handle: null, layer, entity: "TRACE" as const, block: null };
      const notes = [`Traced by you on the plan: its edges are within ${formatLength(c.tolerance * review.scale.metres_per_unit)} of where you clicked.`];
      const old = c.drawnId ? find(c.drawnId) : null;
      if (c.drawnId && !old) return reject(`No drawn object '${c.drawnId}'.`, "not_found");
      if (old && statusOf(source, old.id) === "used_as_floor") return reject("This outline is the floor; trace the floor instead.");
      const taken = takenIds(project, source);
      const n = (() => {
        let i = 1;
        while (source.drawing.objects.some((o) => o.id === `trace-${i}`) || taken.has(`obj-trace-${i}`)) i += 1;
        return i;
      })();
      const drawn: DrawingObject = old
        ? { ...old, ...rect, footprint_fit: "exact", tolerance: c.tolerance, refs: [trace, ...old.refs.filter((r) => r.entity !== "TRACE")].slice(0, 20) as DrawingObject["refs"], notes }
        : {
            ...rect,
            id: `trace-${n}`,
            object_id: `obj-trace-${n}`,
            role: "footprint",
            label: (c.name?.trim() || `Added object ${n}`).slice(0, 500),
            label_from: "entered",
            kind: c.objectKind ?? "equipment",
            refs: [trace],
            footprint_fit: "exact",
            tolerance: c.tolerance,
            notes: [...notes, "Added by you: the proposal did not mark it."],
          };
      const objects = old ? source.drawing.objects.map((o) => (o.id === old.id ? drawn : o)) : [...source.drawing.objects, drawn];
      const live = edit.current(drawn.object_id);
      const placed = drawnObject(source.filename, t, review.scale, drawn, { id: drawn.object_id, kind: live?.kind ?? drawn.kind, name: live?.name ?? drawn.label });
      if (live && old) {
        // Keep the person's move, and a height they entered.
        const was = drawnObject(source.filename, t, review.scale, old, { id: live.id });
        edit.set({ ...placed, transform: offset(live.transform, was.transform, placed.transform), dimensions: { ...placed.dimensions, height: live.dimensions.height.origin === "default" ? placed.dimensions.height : live.dimensions.height } });
      } else edit.set(placed);
      const status: Reviewed = old ? (statusOf(source, old.id) === "added" ? "added" : "corrected") : "added";
      const next = old ? setStatus(review, old.id, status) : { ...review, objects: [...review.objects, { drawn_id: drawn.id, status }] };
      const name = live?.name ?? drawn.label;
      const size = `${formatLength(rect.width * review.scale.metres_per_unit)} × ${formatLength(rect.depth * review.scale.metres_per_unit)}`;
      return ok(
        withReview(source, next, {}, objects),
        edit,
        old ? `Trace ${name}` : `Add ${name}`,
        old ? `${name}: outline traced, ${size} (was ${describeRef(old.refs[0]!)})` : `${name}: added and traced, ${size}`,
        drawn.object_id,
      );
    }

    case "trace_floor": {
      if (c.outline.length < 3) return reject("Click at least three corners of the floor.");
      const xs = c.outline.map((p) => p.x);
      const ys = c.outline.map((p) => p.y);
      const r = (v: number) => Number(v.toFixed(3));
      const box = c.outline.length === 4 ? rectangleFrom([c.outline[0]!, c.outline[1]!, c.outline[2]!]) : null;
      const square = box && box.outline.every((q, i) => Math.hypot(q.x - c.outline[i]!.x, q.y - c.outline[i]!.y) <= 3 * c.tolerance);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const taken = takenIds(project, source);
      let n = 1;
      while (source.drawing.objects.some((o) => o.id === `floor-trace-${n}`) || taken.has(`obj-floor-trace-${n}`)) n += 1;
      const floorDrawn: DrawingObject = {
        id: `floor-trace-${n}`,
        object_id: `obj-floor-trace-${n}`,
        role: "footprint",
        label: "Floor (traced)",
        label_from: "entered",
        kind: "structure",
        refs: [{ handle: null, layer: isPlanImage(source.drawing) ? (source.drawing.layers[0] ?? "image") : "drawing", entity: "TRACE", block: null }],
        outline: c.outline.map((q) => ({ x: r(q.x), y: r(q.y) })) as DrawingObject["outline"],
        ...(square && box ? { centre: box.centre, width: box.width, depth: box.depth, rotation_rad: box.rotation_rad } : { centre: { x: r((x0 + x1) / 2), y: r((y0 + y1) / 2) }, width: x1 - x0, depth: y1 - y0, rotation_rad: 0 }),
        footprint_fit: square ? "exact" : "enclosing",
        tolerance: c.tolerance,
        notes: [c.tolerance > 0 ? `Traced by you: its edges are within ${formatLength(c.tolerance * review.scale.metres_per_unit)} of where you clicked.` : "Traced by you on the drawing's own corners: exact as drawn."],
      };
      const traced = withReview(source, { ...review, objects: [...review.objects, { drawn_id: floorDrawn.id, status: "proposed" }] }, {}, [...source.drawing.objects, floorDrawn]) as DrawingSource;
      const done = prepare(project, traced, { kind: "floor", to: floorDrawn.id });
      if (!done.ok) return done;
      const area = `${formatLength((x1 - x0) * review.scale.metres_per_unit)} × ${formatLength((y1 - y0) * review.scale.metres_per_unit)}`;
      return { ...done, label: "Trace the floor", correction: `Floor traced: ${c.outline.length} corners, ${area} overall` };
    }

    case "accept_remaining": {
      const proposed = review.objects.filter((o) => o.status === "proposed");
      if (proposed.length === 0) return reject("Every object is already reviewed.", "no_change");
      const next = { ...review, objects: review.objects.map((o) => (o.status === "proposed" ? { ...o, status: "accepted" as const } : o)) };
      return ok(withReview(source, next), edit, `Accept ${proposed.length} objects as drawn`, `Accepted ${proposed.length} object${proposed.length === 1 ? "" : "s"} as drawn`, "");
    }

    case "accept_omissions": {
      if (review.omissions === "accepted") return reject("Already accepted.", "no_change");
      return ok(withReview(source, { ...review, omissions: "accepted" }), edit, "Accept what the drawing leaves out", `Accepted what the drawing leaves out: ${omissions(source).join("; ")}`, "");
    }

    case "symbols": {
      if (!source.drawing.layers.includes(c.layer)) return reject(`The drawing has no layer “${c.layer}”.`, "not_found");
      const marked = review.symbol_layers.includes(c.layer);
      if (marked === c.symbols) return reject(c.symbols ? "Already marked as drawing symbols." : "Not marked as drawing symbols.", "no_change");
      const layers = c.symbols ? [...review.symbol_layers, c.layer] : review.symbol_layers.filter((l) => l !== c.layer);
      return ok(
        withReview(source, { ...review, symbol_layers: layers }),
        edit,
        c.symbols ? `Layer ${c.layer}: drawing symbols` : `Layer ${c.layer}: possible obstacles`,
        c.symbols ? `Layer ${c.layer} marked as drawing symbols (door swings, wall fill, notes), not things on the floor` : `Layer ${c.layer}: its loose lines and left-out shapes count as possible obstacles again`,
        "",
      );
    }

    case "object": {
      const drawn = find(c.drawnId);
      if (!drawn) return reject(`No drawn object '${c.drawnId}'.`, "not_found");
      const status = statusOf(source, drawn.id);
      if (status === "used_as_floor") return reject("This outline is the floor; choose another floor first.");
      const live = edit.current(drawn.object_id);
      if (c.action === "accept") {
        if (status !== "proposed") return reject(`${drawn.label} is already reviewed.`, "no_change");
        return ok(withReview(source, setStatus(review, drawn.id, "accepted")), edit, `Accept ${live?.name ?? drawn.label}`, `${live?.name ?? drawn.label} accepted as drawn (${KIND_WORDS[live?.kind ?? drawn.kind]})`, drawn.object_id);
      }
      if (c.action === "not_an_object") {
        if (status === "not_an_object") return reject(`${drawn.label} is already marked not an object.`, "no_change");
        if (live) edit.remove(live.id);
        return ok(withReview(source, setStatus(review, drawn.id, "not_an_object")), edit, `Not an object: ${live?.name ?? drawn.label}`, `${live?.name ?? drawn.label}: not an object (${describeRef(drawn.refs[0]!)} stays on the plan)`, drawn.object_id);
      }
      if (c.action === "make_object") {
        if (status !== "not_an_object") return reject(`${drawn.label} is already an object.`, "no_change");
        // Its reserved ID, unless the scene has already used it (IDs are never reused).
        const id = usedIds(project).has(drawn.object_id) ? freshId(takenIds(project, source), drawn.object_id) : drawn.object_id;
        const object = drawnObject(source.filename, t, review.scale, drawn, { id, kind: c.objectKind });
        edit.set(object);
        const objects = id === drawn.object_id ? source.drawing.objects : source.drawing.objects.map((o) => (o.id === drawn.id ? { ...o, object_id: id } : o));
        return ok(withReview(source, setStatus(review, drawn.id, "corrected"), {}, objects), edit, `Make ${drawn.label} an object`, `${drawn.label}: made an object (${KIND_WORDS[c.objectKind]})`, id);
      }
      // Correct the name or the kind.
      if (!live) return reject(`${drawn.label} is not in the scene; make it an object first.`, "not_found");
      const name = c.name?.trim() ?? live.name;
      const kind = c.objectKind ?? live.kind;
      if (name.length === 0 || name.length > 500) return reject("A name of 1-500 characters is required.");
      if (name === live.name && kind === live.kind) return reject("Nothing changed.", "no_change");
      const height = live.dimensions.height.origin === "default" || isMarking(kind) !== isMarking(live.kind) ? displayHeightLength(kind, name, drawn.refs) : live.dimensions.height;
      edit.set({ ...live, name, kind, dimensions: { ...live.dimensions, height }, transform: { ...live.transform, position_m: { ...live.transform.position_m, y: isMarking(kind) ? 0 : live.transform.position_m.y } } });
      const words = [kind !== live.kind ? `now ${KIND_WORDS[kind]} (was ${KIND_WORDS[live.kind]})` : null, name !== live.name ? `renamed from "${live.name}"` : null].filter(Boolean).join(", ");
      return ok(withReview(source, setStatus(review, drawn.id, "corrected")), edit, `Correct ${name}`, `${name}: ${words}`, live.id);
    }
  }
}

function ok(source: SourceDocument, edit: SceneEdit, label: string, correction: string, objectId: string): { ok: true } & Prepared {
  return { ok: true, source, edit, label, correction, objectId };
}

/**
 * Apply a new scale. A drawn object goes where the drawing puts it at the new scale, keeping
 * any move the person made as the same offset in metres; any other object's position is
 * carried through the drawing. Footprint axes read from the drawing are re-read at the new
 * scale; values the person entered or that came from elsewhere keep their size.
 */
function rescale(project: Project, source: DrawingSource, edit: SceneEdit, scale: ScaleReview, label: string, correction: string): ({ ok: true } & Prepared) | Rejection {
  const review = source.drawing.review;
  const t1 = source.source_to_world;
  const t2 = sourceToWorld(source.drawing, scale.unit, scale.metres_per_unit);
  const floorId = review.floor.object_id;
  const byObject = new Map(source.drawing.objects.map((d) => [d.object_id, d]));
  const floorOutline = review.floor.drawn_id ? (source.drawing.objects.find((o) => o.id === review.floor.drawn_id) ?? null) : null;
  for (const object of project.scene.objects) {
    if (object.id === floorId && review.floor.choice === "automatic") continue; // resized below
    const isFloor = object.id === floorId;
    const drawn = isFloor ? floorOutline : (byObject.get(object.id) ?? null);
    // Where the drawing put it before and puts it now.
    const placed = (t: DrawingSource["source_to_world"], sc: ScaleReview) =>
      drawn ? (isFloor ? floorOnOutline(source.filename, t, sc, drawn, object.id) : drawnObject(source.filename, t, sc, drawn, { id: object.id })) : null;
    const was = placed(t1, review.scale);
    const now = placed(t2, scale);
    const transform = was && now ? offset(object.transform, was.transform, now.transform) : mapped(t1, t2, object.transform);
    const dims = { ...object.dimensions };
    for (const axis of ["width", "depth"] as const) {
      if (dims[axis].origin !== "drawn") continue;
      dims[axis] = now ? now.dimensions[axis] : { ...dims[axis], value_m: Math.max(0.001, quantizeMetres((dims[axis].value_m * scale.metres_per_unit) / t1.metres_per_source_unit, 1)) };
    }
    edit.set({ ...object, transform, dimensions: dims });
  }
  if (floorId && review.floor.choice === "automatic" && edit.current(floorId)) {
    const floor = edit.current(floorId)!;
    edit.set({ ...floorAround(edit.result(), floorId), name: floor.name });
  }
  const next = withReview(source, { ...review, scale }, { source_to_world: t2 });
  return { ok: true, source: next, edit, label, correction, objectId: floorId ?? "" };
}

/** The same move away from the drawn place, applied to the new drawn place. */
function offset(current: SceneObject["transform"], was: SceneObject["transform"], now: SceneObject["transform"]): SceneObject["transform"] {
  if (sameTransform(current, was)) return now;
  const p = current.position_m;
  return {
    ...current,
    position_m: {
      x: quantizeMetres(now.position_m.x + (p.x - was.position_m.x), 1) || 0,
      y: p.y,
      z: quantizeMetres(now.position_m.z + (p.z - was.position_m.z), 1) || 0,
    },
  };
}

function mapped(t1: DrawingSource["source_to_world"], t2: DrawingSource["source_to_world"], transform: SceneObject["transform"]): SceneObject["transform"] {
  const onPlan = fromWorld(t1, { x: transform.position_m.x, z: transform.position_m.z });
  const p = toWorld(t2, onPlan);
  return { ...transform, position_m: { x: quantizeMetres(p.x, 1) || 0, y: transform.position_m.y, z: quantizeMetres(p.z, 1) || 0 } };
}

/** What the drawing leaves out, in words. */
export function omissions(source: DrawingSource): string[] {
  const drawing = source.drawing;
  if (isPlanImage(drawing)) {
    const walls = drawing.lines.filter((l) => !l.closed).length;
    return [
      "heights and appearance (assumed for display)",
      "anything the proposal did not mark: compare the outlines with the plan and add what is missing",
      "fine detail, handwriting and symbols (not read)",
      ...(walls > 0 ? [`${walls} proposed wall line${walls === 1 ? "" : "s"} shown on the plan only`] : []),
    ];
  }
  const shapes = drawing.skipped.filter((s) => s.layout);
  const count = shapes.reduce((n, s) => n + s.count, 0);
  const open = drawing.lines.filter((l) => !l.closed && l.ref.block === null).length;
  return [
    "heights and appearance (assumed for display)",
    ...(count > 0 ? [`${count} shape${count === 1 ? "" : "s"} not imported (${[...new Set(shapes.map((s) => s.entity.toLowerCase()))].join(", ")})`] : []),
    ...(open > 0 ? [`${open} open line${open === 1 ? "" : "s"} shown on the plan only`] : []),
    ...(drawing.lines.some((l) => !l.closed && /wall/i.test(l.ref.layer)) ? ["wall thickness and height"] : []),
  ];
}

/** Whether the person has to accept what the drawing leaves out before a check may use it. */
export function omissionsMatter(source: DrawingSource): boolean {
  if (isPlanImage(source.drawing)) return true;
  return source.drawing.skipped.some((s) => s.layout) || source.drawing.lines.some((l) => !l.closed && l.ref.block === null);
}

export interface ReviewItem {
  id: "floor" | "scale" | "objects" | "omissions";
  done: boolean;
  title: string;
  detail: string;
}

/** The review in four plain items: what needs attention and what was decided. */
export function reviewItems(source: DrawingSource): ReviewItem[] {
  const review = source.drawing.review;
  const floorOutline = review.floor.drawn_id ? source.drawing.objects.find((o) => o.id === review.floor.drawn_id) : null;
  const floorWords = floorOutline ? `${describeDrawn(floorOutline)}, ${floorSizeAt(source, review.scale.metres_per_unit)}` : review.floor.choice === "automatic" ? "sized around the objects (not from the drawing)" : "no floor";
  const counts = (status: Reviewed) => review.objects.filter((o) => o.status === status).length;
  const scaleWords = `${scalePhrase(review.scale)}; the floor is ${floorSizeAt(source, review.scale.metres_per_unit)}`;
  return [
    { id: "floor", done: review.floor.status !== "proposed", title: review.floor.status === "proposed" ? "Is this the floor?" : review.floor.status === "accepted" ? "Floor accepted" : "Floor corrected", detail: floorWords },
    {
      id: "scale",
      done: review.scale.status !== "unchecked",
      title: review.scale.status === "unchecked" ? "Is this the right scale?" : review.scale.unit === "px" ? "Scale from your known length" : review.scale.status === "measured" ? "Scale checked against a known length" : "Scale confirmed by you",
      detail: scaleWords,
    },
    {
      id: "objects",
      done: counts("proposed") === 0,
      title: counts("proposed") > 0 ? "Are these the right objects?" : "Objects reviewed",
      detail: `${counts("proposed")} to check · ${counts("accepted")} accepted · ${counts("corrected")} corrected${counts("added") > 0 ? ` · ${counts("added")} added` : ""} · ${counts("not_an_object")} ${counts("not_an_object") === 1 ? "not an object" : "not objects"}`,
    },
    {
      id: "omissions",
      done: review.omissions === "accepted" || !omissionsMatter(source),
      title: `${review.omissions === "accepted" ? "You accepted what the " : "What the "}${isPlanImage(source.drawing) ? "plan" : "drawing"} leaves out`,
      detail: omissions(source).join("; "),
    },
  ];
}

/** A unit's name with its effect, for the scale choices. */
export function unitChoice(source: DrawingSource, unit: DrawingUnit): string {
  return `${UNIT_NAME[unit]} → ${floorSizeAt(source, METRES_PER_UNIT[unit])}`;
}

