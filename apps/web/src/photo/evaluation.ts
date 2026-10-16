// IMG-03: how good is one photo turned into an editable world? Matching the vision model's
// proposals with independently known objects, and the metric errors of the worlds built from
// them: the initial proposal (as the app pre-accepts it), the world after an idealised photo-only
// review, and a manual-only baseline. The rules are those of
// docs/assist-evaluation/img-03/criteria.md, fixed before the held-out run; they use the app's
// own calibration, placement and correction code, so the scored world is the world the app builds.
import type { ImageBox, ImageProposal, ProposedPhotoObject } from "@replay-world/contracts";
import { splitItem } from "./corrections";
import { type Calibration, calibrateFromRectangle, floorPoint } from "./floor";
import { footprint, outlineIoU } from "./layoutChecks";
import { assetRequest, isPlaced, type PlacedItem, placeItems, type ReviewItem, reviewItemsFrom, userItem } from "./world";

// --- The annotation format (scripts/img03_annotations.py validates it) ------------------------

export type GtClass = "table" | "chair" | "cabinet" | "shelf" | "sofa" | "machine" | "conveyor" | "pallet" | "box" | "screen" | "plant" | "tank";

export interface GtObject {
  id: string;
  class: GtClass;
  centre_m: [number, number] | null;
  yaw_deg: number | null;
  size: { width_m: number | null; depth_m: number | null; height_m: number | null };
  tolerance_m: number;
  visibility: "visible" | "partly_visible" | "mostly_hidden" | "out_of_frame";
  visible_fraction: number | null;
  visible_box: ImageBox | null;
  amodal_box: ImageBox | null;
  cut_off: string[];
  on_floor: boolean;
  counted: boolean;
  reason: string | null;
}

export interface Annotation {
  format: "rws-img03-annotation/1";
  image: { file: string; sha256: string; width_px: number; height_px: number; stratum: "real" | "synthetic"; scene_type: string; split: "development" | "held_out" };
  camera: { position_m: [number, number, number]; target_m: [number, number, number]; vertical_fov_deg: number } | null;
  rectangle: { corners: { u: number; v: number }[]; width_m: number; depth_m: number; tolerance_m: number };
  objects: GtObject[];
}

// --- Matching (criteria.md, "Matching") ------------------------------------------------------

/** A proposal and a ground-truth object are the same object when their outlines overlap this much. */
export const MATCH_IOU = 0.5;
/** A proposal "covers" an object when this share of the object's visible outline is inside it. */
export const COVER_SHARE = 0.7;
/** Below this overlap a matched outline is loose: the reviewer tightens it. */
export const TIGHT_IOU = 0.75;

export type ProposalStatus = "tp" | "group" | "duplicate" | "poor_outline" | "no_object" | "ignored";

export interface MatchResult {
  /** Per proposal (same order as given): what it was counted as, and the object it found. */
  proposals: { status: ProposalStatus; gt: string | null; iou: number; covers: string[] }[];
  /** Counted ground-truth objects with the proposal that found them (or null: missed). */
  found: Map<string, number | null>;
  tp: number;
  fp: number;
  fn: number;
  groups: number;
  duplicates: number;
}

const area = (b: ImageBox) => Math.max(0, b.right - b.left) * Math.max(0, b.bottom - b.top);
function inside(b: ImageBox, of: ImageBox): number {
  const w = Math.min(b.right, of.right) - Math.max(b.left, of.left);
  const h = Math.min(b.bottom, of.bottom) - Math.max(b.top, of.top);
  return w > 0 && h > 0 && area(of) > 0 ? (w * h) / area(of) : 0;
}

/**
 * One-to-one matching on outlines (labels are not used to match; they are scored apart).
 *
 * 1. Pairs with IoU >= 0.5 against an object's visible outline, greedily by IoU.
 * 2. A remaining proposal that covers two or more counted objects is a group outline: it finds
 *    the largest of them (by visible area) if that one is still unfound; the others stay missed.
 * 3. A remaining proposal with IoU >= 0.5 against an object already found is a duplicate (FP).
 * 4. A proposal matched to an object that is not counted (mostly hidden, too small) is ignored.
 * 5. Anything else is a false positive: a poor outline (best IoU 0.1-0.5) or no object.
 */
export function matchProposals(boxes: readonly ImageBox[], objects: readonly GtObject[]): MatchResult {
  const gts = objects.filter((o) => o.visible_box !== null);
  const pairs: { p: number; g: number; iou: number }[] = [];
  boxes.forEach((b, p) => gts.forEach((g, gi) => pairs.push({ p, g: gi, iou: outlineIoU(b, g.visible_box!) })));
  pairs.sort((a, b) => b.iou - a.iou || a.p - b.p || a.g - b.g);
  const byP = new Map<number, number>();
  const byG = new Map<number, number>();
  for (const { p, g, iou } of pairs) {
    if (iou < MATCH_IOU) break;
    if (byP.has(p) || byG.has(g)) continue;
    byP.set(p, g);
    byG.set(g, p);
  }
  const best = (p: number) => Math.max(0, ...gts.map((g) => outlineIoU(boxes[p]!, g.visible_box!)));
  const proposals: MatchResult["proposals"] = boxes.map((b, p) => {
    const covers = gts.filter((g) => g.counted && inside(b, g.visible_box!) >= COVER_SHARE).map((g) => g.id);
    const g = byP.get(p);
    if (g !== undefined) return { status: gts[g]!.counted ? "tp" : "ignored", gt: gts[g]!.id, iou: outlineIoU(b, gts[g]!.visible_box!), covers };
    return { status: "no_object", gt: null, iou: best(p), covers };
  });
  // Group outlines.
  for (const [p, r] of proposals.entries()) {
    if (r.status !== "no_object" || r.covers.length < 2) continue;
    const largest = gts.filter((g) => r.covers.includes(g.id)).sort((a, b) => area(b.visible_box!) - area(a.visible_box!))[0]!;
    const gi = gts.indexOf(largest);
    if (byG.has(gi)) continue;
    byG.set(gi, p);
    proposals[p] = { ...r, status: "group", gt: largest.id, iou: outlineIoU(boxes[p]!, largest.visible_box!) };
  }
  // Duplicates, poor outlines.
  for (const [p, r] of proposals.entries()) {
    if (r.status !== "no_object") continue;
    const dup = gts.findIndex((g, gi) => byG.has(gi) && outlineIoU(boxes[p]!, g.visible_box!) >= MATCH_IOU);
    if (dup >= 0) proposals[p] = { ...r, status: gts[dup]!.counted ? "duplicate" : "ignored", gt: gts[dup]!.id };
    else if (r.iou >= 0.1) {
      // The counted object it overlaps most, for the reviewer to tighten it to (if still unfound).
      const near = gts.filter((g) => g.counted).sort((a, b) => outlineIoU(boxes[p]!, b.visible_box!) - outlineIoU(boxes[p]!, a.visible_box!))[0];
      proposals[p] = { ...r, status: "poor_outline", gt: near ? near.id : null };
    }
  }
  const found = new Map<string, number | null>(objects.filter((o) => o.counted).map((o) => [o.id, null]));
  for (const [gi, p] of byG) if (gts[gi]!.counted) found.set(gts[gi]!.id, p);
  const tp = proposals.filter((r) => r.status === "tp" || r.status === "group").length;
  const fp = proposals.filter((r) => r.status === "duplicate" || r.status === "poor_outline" || r.status === "no_object").length;
  return {
    proposals,
    found,
    tp,
    fp,
    fn: [...found.values()].filter((p) => p === null).length,
    // A group outline: a find whose outline also covers a counted object nothing else found
    // (a chair in front of a desk that has its own outline does not make the desk a group).
    groups: proposals.filter((r) => (r.status === "tp" || r.status === "group") && r.covers.some((g) => g !== r.gt && found.get(g) === null)).length,
    duplicates: proposals.filter((r) => r.status === "duplicate").length,
  };
}

// --- Calibration and frames -----------------------------------------------------------------

export interface FrameMap {
  /** App scene frame (x, z) -> the rectangle's frame. */
  toRect: (x: number, z: number) => [number, number];
  /** The camera in the rectangle's frame, and its height. */
  camera: { x: number; z: number; y: number };
}

/** The app's calibration from the annotated rectangle, as the protocol tells the operator. */
export function calibrate(a: Annotation, sides: "both" | "width_only" = "both", cornerOffsetPx: readonly [number, number][] = []): Calibration {
  const corners = a.rectangle.corners.map((c, i) => ({
    u: c.u + (cornerOffsetPx[i]?.[0] ?? 0) / a.image.width_px,
    v: c.v + (cornerOffsetPx[i]?.[1] ?? 0) / a.image.height_px,
  }));
  const result = calibrateFromRectangle({
    corners,
    widthM: a.rectangle.width_m,
    depthM: sides === "both" ? a.rectangle.depth_m : null,
    imageWidthPx: a.image.width_px,
    imageHeightPx: a.image.height_px,
  });
  if (!result.ok) throw new Error(`${a.image.file}: ${result.message}`);
  return result.calibration;
}

/**
 * The rectangle's frame (origin at its centre, +x along corner 0 -> 1, +z along corner 1 -> 2),
 * found from where the app puts the four marked corners. Ground truth is measured in this frame,
 * so the comparison does not depend on how the app orients its own scene.
 */
export function rectFrame(cal: Calibration, corners: readonly { u: number; v: number }[]): FrameMap {
  const p = corners.map((c) => floorPoint(cal, c));
  if (p.some((q) => q === null)) throw new Error("a rectangle corner is not on the floor");
  const [p0, p1, p2, p3] = p as { x: number; z: number }[];
  const o = { x: (p0!.x + p1!.x + p2!.x + p3!.x) / 4, z: (p0!.z + p1!.z + p2!.z + p3!.z) / 4 };
  const ex = unit(p1!.x - p0!.x, p1!.z - p0!.z);
  let ez = unit(p2!.x - p1!.x, p2!.z - p1!.z);
  const d = ez[0] * ex[0] + ez[1] * ex[1];
  ez = unit(ez[0] - d * ex[0], ez[1] - d * ex[1]);
  const toRect = (x: number, z: number): [number, number] => [(x - o.x) * ex[0] + (z - o.z) * ex[1], (x - o.x) * ez[0] + (z - o.z) * ez[1]];
  const [cx, cz] = toRect(cal.camera.x, cal.camera.z);
  return { toRect, camera: { x: cx, z: cz, y: cal.camera.y } };
}

function unit(x: number, z: number): [number, number] {
  const n = Math.hypot(x, z);
  return [x / n, z / n];
}

/** A ground-truth footprint in the rectangle's frame. */
export function gtFootprint(o: GtObject): [number, number][] | null {
  if (!o.centre_m || o.yaw_deg === null || o.size.width_m === null || o.size.depth_m === null) return null;
  return footprint({ x: o.centre_m[0], z: o.centre_m[1], yawRad: (o.yaw_deg * Math.PI) / 180, width: o.size.width_m, depth: o.size.depth_m }).map(([x, z]) => [x, z]);
}

// --- Geometry errors (criteria.md, "Metres") --------------------------------------------------

export interface GeometryRow {
  gt: string;
  cls: GtClass;
  visibility: GtObject["visibility"];
  /** Angle below the horizon at which the camera sees the object's centre (degrees). */
  depressionDeg: number;
  nearHorizon: boolean;
  /** The app noted "nearly on the horizon" for this placement. */
  flagged: boolean;
  centreErrorM: number;
  /** Footprint extent across the line of sight (the visible width), predicted minus true. */
  acrossErrorM: number;
  acrossRel: number;
  /** Footprint extent along the line of sight (mostly the hidden depth), predicted minus true. */
  alongErrorM: number;
  alongRel: number;
  heightErrorM: number | null;
  /** How each size was settled in the app: photo, partial, hidden, unseen, entered. */
  sources: PlacedItem["source"];
  /** Every estimated (non-photo) size says so in its saved evidence. */
  estimatesLabelled: boolean;
}

export const NEAR_HORIZON_DEG = 6;

function extent(poly: readonly (readonly [number, number])[], dir: readonly [number, number]): number {
  const s = poly.map(([x, z]) => x * dir[0] + z * dir[1]);
  return Math.max(...s) - Math.min(...s);
}

export function geometryRow(placed: PlacedItem, gt: GtObject, frame: FrameMap): GeometryRow | null {
  const truth = gtFootprint(gt);
  if (!truth) return null;
  const pred = footprint(placed).map(([x, z]) => frame.toRect(x, z));
  const centre = (poly: readonly (readonly [number, number])[]): [number, number] => [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length];
  const [tx, tz] = centre(truth);
  const [px, pz] = centre(pred);
  const sight = unit(tx - frame.camera.x, tz - frame.camera.z);
  const across: [number, number] = [-sight[1], sight[0]];
  const trueAcross = extent(truth, across);
  const trueAlong = extent(truth, sight);
  const distance = Math.hypot(tx - frame.camera.x, tz - frame.camera.z);
  const depression = (Math.atan2(frame.camera.y, distance) * 180) / Math.PI;
  const request = assetRequest(placed, { filename: "photo", feature: "rectangle", visionModel: null });
  const estimatesLabelled = (["width", "height", "depth"] as const).every((axis) => {
    const s = placed.source[axis];
    if (s === "photo" || s === "entered") return true;
    const ref = request.dimensions[axis].source_ref ?? "";
    return /estimat|guess/i.test(ref);
  });
  return {
    gt: gt.id,
    cls: gt.class,
    visibility: gt.visibility,
    depressionDeg: depression,
    nearHorizon: depression < NEAR_HORIZON_DEG,
    flagged: placed.notes.some((n) => /nearly on the horizon/.test(n)),
    centreErrorM: Math.hypot(px - tx, pz - tz),
    acrossErrorM: extent(pred, across) - trueAcross,
    acrossRel: (extent(pred, across) - trueAcross) / trueAcross,
    alongErrorM: extent(pred, sight) - trueAlong,
    alongRel: (extent(pred, sight) - trueAlong) / trueAlong,
    heightErrorM: gt.size.height_m === null ? null : placed.height - gt.size.height_m,
    sources: placed.source,
    estimatesLabelled,
  };
}

// --- The three worlds -------------------------------------------------------------------------

/** Every correction a reviewer makes, by kind (criteria.md, "Correction effort"). */
export interface Actions {
  reject: number;
  accept: number;
  split: number;
  merge: number;
  add: number;
  outline: number;
  shape: number;
  visibility: number;
}

export const NO_ACTIONS: Actions = { reject: 0, accept: 0, split: 0, merge: 0, add: 0, outline: 0, shape: 0, visibility: 0 };

/**
 * Seconds per action for a keystroke-level estimate (criteria.md): an estimate from a fixed model
 * of the interface, declared before the run, never a measurement of a person.
 */
export const KLM_SECONDS: Actions = { reject: 1.5, accept: 1.5, split: 4, merge: 4, add: 8, outline: 5, shape: 3, visibility: 3 };

export function klmSeconds(a: Actions): number {
  return (Object.keys(a) as (keyof Actions)[]).reduce((s, k) => s + a[k] * KLM_SECONDS[k], 0);
}

export interface World {
  items: ReviewItem[];
  placed: PlacedItem[];
  /** Which ground-truth object each placed item stands for (null: none). */
  gtOf: Map<string, string | null>;
  actions: Actions;
}

const visibilityOf = (o: GtObject) => (o.visibility === "visible" ? "visible" : "partly_visible");

function placedOf(cal: Calibration, items: readonly ReviewItem[]): PlacedItem[] {
  return [...placeItems(cal, items).values()].filter(isPlaced);
}

/** The initial proposal: what the app pre-accepts, uncorrected. */
export function initialWorld(cal: Calibration, proposal: ImageProposal, objects: readonly GtObject[]): World {
  const items = reviewItemsFrom(proposal);
  const match = matchProposals(proposal.objects.map((o) => o.box), objects);
  const gtOf = new Map(items.map((it, i) => [it.id, match.proposals[i]!.status === "tp" || match.proposals[i]!.status === "group" ? match.proposals[i]!.gt : null]));
  return { items, placed: placedOf(cal, items), gtOf, actions: { ...NO_ACTIONS } };
}

/**
 * An idealised photo-only reviewer (criteria.md, "Reviewed world"): rejects proposals that are no
 * counted object, merges duplicates, splits group outlines, accepts correct proposals the app had
 * left unticked, tightens loose outlines, corrects the shape family and the visibility, and adds
 * missed objects by outlining what shows. No measurement is typed: a photo alone has none.
 */
export function reviewedWorld(cal: Calibration, proposal: ImageProposal, objects: readonly GtObject[]): World {
  const match = matchProposals(proposal.objects.map((o) => o.box), objects);
  const byId = new Map(objects.map((o) => [o.id, o]));
  let items = reviewItemsFrom(proposal);
  const actions = { ...NO_ACTIONS };
  const gtOf = new Map<string, string | null>();
  const set = (id: string, patch: Partial<ReviewItem>) => (items = items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const fix = (id: string, gt: GtObject) => {
    const item = items.find((i) => i.id === id)!;
    if (outlineIoU(item.box, gt.visible_box!) < TIGHT_IOU) {
      const box = { ...gt.visible_box! };
      set(id, { box, contact: { u: (box.left + box.right) / 2, v: box.bottom }, contactBasis: "box_bottom" });
      actions.outline++;
    }
    if (item.template !== gt.class) {
      set(id, { template: gt.class });
      actions.shape++;
    }
    if (item.visibility !== visibilityOf(gt)) {
      set(id, { visibility: visibilityOf(gt) });
      actions.visibility++;
    }
    gtOf.set(id, gt.id);
  };
  const found = new Set<string>();
  for (const [i, r] of match.proposals.entries()) {
    const id = items[i]!.id;
    const accepted = items[i]!.decision === "accepted";
    const others = r.covers.filter((g) => g !== r.gt && match.found.get(g) === null);
    if (r.status === "tp" && others.length === 0) {
      if (!accepted) {
        set(id, { decision: "accepted" });
        actions.accept++;
      }
      fix(id, byId.get(r.gt!)!);
      found.add(r.gt!);
    } else if (r.status === "duplicate") {
      if (accepted) {
        // The same object outlined twice: merged into the outline that found it.
        set(id, { decision: "rejected" });
        actions.merge++;
      }
    } else if (r.status === "group" || r.status === "tp") {
      // A group outline: split into the counted objects it covers that nothing else found,
      // outlined one by one.
      const covered = [...new Set([r.gt!, ...others])].map((g) => byId.get(g)!);
      covered.sort((a, b) => a.visible_box!.left - b.visible_box!.left);
      if (!accepted) {
        set(id, { decision: "accepted" });
        actions.accept++;
      }
      if (covered.length >= 2) {
        const split = splitItem(items, id, covered.length);
        items = split.items;
        actions.split++;
        split.pieces.forEach((pid, k) => {
          const gt = covered[k]!;
          set(pid, { label: gt.class, template: gt.class });
          fix(pid, gt);
          found.add(gt.id);
        });
      } else {
        fix(id, covered[0]!);
        found.add(covered[0]!.id);
      }
    } else if (r.status === "poor_outline" && r.gt && match.found.get(r.gt) === null && !found.has(r.gt)) {
      // A loose outline of an object nothing else found: tightened rather than redrawn.
      if (!accepted) {
        set(id, { decision: "accepted" });
        actions.accept++;
      }
      fix(id, byId.get(r.gt)!);
      found.add(r.gt);
    } else if (r.status === "ignored") {
      // A real object the protocol does not count (mostly hidden, tiny): left as it is.
    } else if (accepted) {
      set(id, { decision: "rejected" });
      actions.reject++;
    }
  }
  for (const o of objects) {
    if (!o.counted || found.has(o.id)) continue;
    const added = userItem(items, { ...o.visible_box! }, visibilityOf(o));
    items = [...items, { ...added, label: o.class, template: o.class }];
    actions.add++;
    actions.shape++;
    if (o.visibility !== "visible") actions.visibility++;
    gtOf.set(added.id, o.id);
  }
  return { items, placed: placedOf(cal, items), gtOf, actions };
}

/** No vision model: the operator outlines every object that shows and picks its shape family. */
export function manualWorld(cal: Calibration, objects: readonly GtObject[]): World {
  let items: ReviewItem[] = [];
  const actions = { ...NO_ACTIONS };
  const gtOf = new Map<string, string | null>();
  for (const o of objects) {
    if (!o.counted) continue;
    const added = userItem(items, { ...o.visible_box! }, visibilityOf(o));
    items = [...items, { ...added, label: o.class, template: o.class }];
    actions.add++;
    actions.shape++;
    if (o.visibility !== "visible") actions.visibility++;
    gtOf.set(added.id, o.id);
  }
  return { items, placed: placedOf(cal, items), gtOf, actions };
}

/** Geometry rows for every placed item that stands for a counted ground-truth object. */
export function geometryOf(world: World, objects: readonly GtObject[], frame: FrameMap): GeometryRow[] {
  const byId = new Map(objects.map((o) => [o.id, o]));
  const rows: GeometryRow[] = [];
  for (const p of world.placed) {
    const gt = world.gtOf.get(p.item.id);
    if (!gt || !byId.get(gt)?.counted) continue;
    const row = geometryRow(p, byId.get(gt)!, frame);
    if (row) rows.push(row);
  }
  return rows;
}

// --- Summaries --------------------------------------------------------------------------------

export function quantile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

export function distribution(values: readonly number[]) {
  return {
    n: values.length,
    median: quantile(values, 0.5),
    p90: quantile(values, 0.9),
    max: values.length ? Math.max(...values) : null,
  };
}

/** Labels agree when the model's shape family is the object's class. */
export function labelAgrees(o: ProposedPhotoObject, gt: GtObject): boolean {
  return o.template === gt.class;
}
