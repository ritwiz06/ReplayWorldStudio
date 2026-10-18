// What a geometric check may claim from the values it uses (ADR-051, ADR-052). The layout and
// route checks (GEO-01/02) take their inputs through these functions. They answer only about the
// reviewed design: "fits in the reviewed design", "conflict found" or "cannot determine yet".
// Nothing here establishes the site as built. Measured, supplier or entered sizes describe
// objects, not where they stand on site, so no combination of evidence is "site-verified".
// - geometry read from a design drawing counts once the drawing is reviewed (scale confirmed
//   or measured, floor decided, each object used reviewed, its footprint exact, and what the
//   drawing leaves out accepted);
// - a display default (a height assumed for display, a floor sized for display), an estimate,
//   an unchecked scale, an approximate outline or unaccepted omissions never support "fits";
// - a check that needs a height and has only a display height answers "height needed";
// - on a plan picture (IMP-03), an outline the vision model proposed is approximate however it
//   is reviewed; one the person traced is exact to within the precision it was marked with.
import type { Project, SceneObject } from "@replay-world/contracts";
import { omissionsMatter } from "./review";
import { type DrawingSource, drawingSource, drawnFrom } from "./world";

export type CheckLevel = "design_layout" | "review_needed" | "height_needed";

export interface Readiness {
  level: CheckLevel;
  /** Why the inputs cannot support a result yet (empty when they can). */
  reasons: string[];
  /** Objects whose height is needed (only for a check that uses heights). */
  heightNeeded: { id: string; name: string }[];
  /** What a result would rest on, in words. */
  basis: string;
}

/** What still blocks the drawing itself from supporting a result. */
export function drawingReasons(source: DrawingSource): string[] {
  const review = source.drawing.review;
  const reasons: string[] = [];
  if (review.scale.status === "unchecked") reasons.push("the scale is not checked yet");
  if (review.floor.status === "proposed") reasons.push("the floor is only proposed");
  if (review.omissions !== "accepted" && omissionsMatter(source)) reasons.push(`what the ${source.drawing.reader === "rws-plan-image/1" ? "plan" : "drawing"} leaves out is not yet accepted`);
  return reasons;
}

/** How exactly an object's footprint is known: `exact`, or why not. */
export interface FootprintEvidence {
  /** The footprint rectangle is the object's footprint (not a box around it, not a guess). */
  exact: boolean;
  /** Why the footprint cannot be relied on as it is, if it cannot. */
  problem: string | null;
  /** The footprint only encloses the real shape (a circle, an L-shape, a block): a clear box
   * means clear, an overlapping box means "not evaluated accurately". */
  encloses: boolean;
  /** Plain words for where the size comes from. */
  source: string;
  /** How far the true edges may be from the footprint's (metres): a traced outline's marking
   * precision; 0 for a drawing's own geometry or an entered size. */
  toleranceM: number;
}

/** How much larger an outline proposed from a plan picture may really be, for a route: its
 * true edges are unknown, so a route must keep this much more room from it to fit. */
export const APPROXIMATE_MARGIN_M = 0.5;

export function footprintEvidence(project: Project, object: SceneObject): FootprintEvidence {
  const d = object.dimensions;
  const origins = new Set([d.width.origin, d.depth.origin]);
  const link = drawnFrom(project, object.id);
  // A traced outline places the object only as precisely as it was marked, whatever its size.
  const traced = link?.drawn.tolerance != null ? link.drawn.tolerance * link.source.drawing.review.scale.metres_per_unit : 0;
  const no = (problem: string, source: string, encloses = false): FootprintEvidence => ({ exact: false, encloses, problem, source, toleranceM: traced });
  const tilted = Math.abs(object.transform.rotation_rad.x) > 1e-9 || Math.abs(object.transform.rotation_rad.z) > 1e-9;
  if (tilted) return no(`${object.name} is tilted, so its footprint is not a rectangle on the floor`, "tilted");
  if (origins.has("default")) return no(`${object.name}'s size is only for display`, "display only");
  if (origins.has("inferred")) return no(`${object.name}'s size is an estimate`, "estimated");
  if (origins.has("drawn")) {
    if (!link) return no(`${object.name}'s drawn size has no drawing to check it against`, "drawn");
    const isFloor = link.source.drawing.review.floor.object_id === object.id;
    if (link.drawn.footprint_fit === "approximate") {
      const what = link.drawn.refs[0]?.entity === "PAGE" ? "is only the edge of the picture" : "was only proposed from the plan picture";
      return no(`${object.name}'s outline ${what}: trace it in the review to check it`, "proposed (approximate)");
    }
    if (!isFloor && link.status === "proposed") return no(`${object.name} is not reviewed yet`, "drawn");
    if (link.drawn.footprint_fit === "enclosing") {
      const what = link.drawn.refs[0]?.entity === "CIRCLE" ? "a round shape" : link.drawn.refs[0]?.entity === "INSERT" ? "a block's drawing" : "an outline that is not a rectangle";
      return no(`${object.name}'s box only encloses ${what}: enter its real size to check it exactly`, "drawn (approximate)", true);
    }
    const where = link.drawn.refs[0]?.entity === "TRACE" ? `traced on ${link.source.filename}` : `drawn in ${link.source.filename}`;
    return { exact: true, encloses: false, problem: null, source: where, toleranceM: traced };
  }
  const words = origins.has("user_supplied") ? "entered by you" : origins.has("supplier") ? "supplier data" : "measured";
  return { exact: true, encloses: false, problem: null, source: words, toleranceM: traced };
}

/** Classify the values a check would use: footprints (width, depth) and, if needed, heights. */
export function checkReadiness(project: Project, objectIds: readonly string[], needs: { height: boolean }): Readiness {
  const source = drawingSource(project);
  const reasons = new Set<string>();
  const heightNeeded: { id: string; name: string }[] = [];
  const sources = new Set<string>();
  let usesDrawing = false;
  for (const id of objectIds) {
    const object = project.scene.objects.find((o) => o.id === id);
    if (!object) {
      reasons.add(`'${id}' is not in the scene`);
      continue;
    }
    const evidence = footprintEvidence(project, object);
    if (evidence.problem) reasons.add(evidence.problem);
    else sources.add(evidence.source);
    if ([object.dimensions.width.origin, object.dimensions.depth.origin].includes("drawn")) usesDrawing = true;
    if (needs.height) {
      const h = object.dimensions.height.origin;
      if (h === "default") heightNeeded.push({ id, name: object.name });
      else if (h === "inferred") reasons.add(`${object.name}'s height is an estimate`);
    }
  }
  if (usesDrawing && source) drawingReasons(source).forEach((r) => reasons.add(r));
  const level: CheckLevel = reasons.size > 0 ? "review_needed" : heightNeeded.length > 0 ? "height_needed" : "design_layout";
  const scale = source ? (source.drawing.review.scale.status === "measured" ? "scale checked against a known length" : "scale confirmed") : null;
  const basis = [...sources].map((s) => (s.startsWith("drawn in") && scale ? `${s} (${scale})` : s)).join("; ") || "no sizes";
  return { level, reasons: [...reasons], heightNeeded, basis: `the reviewed design: ${basis}; not the site as built` };
}

export type CheckState = "fits" | "conflict" | "cannot_determine" | "height_needed";

export const OUTCOME_WORDS: Record<CheckState, string> = {
  fits: "Fits in the reviewed design",
  conflict: "Conflict found",
  cannot_determine: "Cannot determine yet",
  height_needed: "Height needed",
};

/** The result a check may report for its geometric outcome, given what its inputs support. */
export function finalise(geometricPass: boolean, readiness: Readiness): { state: CheckState; label: string } {
  if (readiness.level === "review_needed") return { state: "cannot_determine", label: `Cannot determine yet: ${readiness.reasons.join("; ")}` };
  if (readiness.level === "height_needed") return { state: "height_needed", label: `Height needed: ${readiness.heightNeeded.map((o) => o.name).join(", ")}` };
  return geometricPass
    ? { state: "fits", label: `Fits in the reviewed design (${readiness.basis})` }
    : { state: "conflict", label: `Conflict found in the reviewed design (${readiness.basis})` };
}
