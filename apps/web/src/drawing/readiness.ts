// What a geometric check may claim from the values it uses (ADR-051). GEO-01/02 checks must
// pass their inputs through `checkReadiness` and their outcome through `finalise`:
// - geometry read from a design drawing supports a *design-layout* result, and only once the
//   drawing is reviewed (scale checked or confirmed, floor decided, each object used reviewed,
//   its footprint exact, and what the drawing leaves out accepted);
// - an as-built result needs measured or supplier values;
// - a display default (a height assumed for display, a floor sized for display), an estimate,
//   an unchecked scale, an approximate outline or unaccepted omissions never give a pass.
import type { Length, Project, SceneObject } from "@replay-world/contracts";
import { omissionsMatter } from "./review";
import { type DrawingSource, drawingSource, drawnFrom } from "./world";

export type CheckLevel = "as_built" | "design_layout" | "review_needed" | "height_needed";

export interface Readiness {
  level: CheckLevel;
  /** Why the inputs cannot support a result yet (empty for a design-layout or as-built level). */
  reasons: string[];
  /** Objects whose height is needed (only for a check that uses heights). */
  heightNeeded: { id: string; name: string }[];
  /** What a result would rest on, in words. */
  basis: string;
}

/** What still blocks the drawing itself from supporting a design-layout result. */
export function drawingReasons(source: DrawingSource): string[] {
  const review = source.drawing.review;
  const reasons: string[] = [];
  if (review.scale.status === "unchecked") reasons.push("the scale is not checked yet");
  if (review.floor.status === "proposed") reasons.push("the floor is only proposed");
  if (review.omissions !== "accepted" && omissionsMatter(source)) reasons.push("what the drawing leaves out is not yet accepted");
  return reasons;
}

const PHYSICAL: readonly Length["origin"][] = ["measured", "supplier"];

/** Classify the values a check would use: footprints (width, depth) and, if needed, heights. */
export function checkReadiness(project: Project, objectIds: readonly string[], needs: { height: boolean }): Readiness {
  const source = drawingSource(project);
  const reasons = new Set<string>();
  const heightNeeded: { id: string; name: string }[] = [];
  let physical = true;
  let usesDrawing = false;
  for (const id of objectIds) {
    const object = project.scene.objects.find((o) => o.id === id);
    if (!object) {
      reasons.add(`'${id}' is not in the scene`);
      continue;
    }
    const axes = needs.height ? (["width", "depth", "height"] as const) : (["width", "depth"] as const);
    for (const axis of axes) {
      const value = object.dimensions[axis];
      if (!PHYSICAL.includes(value.origin)) physical = false;
      if (value.origin === "default") {
        if (axis === "height") heightNeeded.push({ id, name: object.name });
        else reasons.add(`${object.name}'s ${axis} is only for display`);
      } else if (value.origin === "inferred") reasons.add(`${object.name}'s ${axis} is an estimate`);
      else if (value.origin === "drawn") {
        usesDrawing = true;
        objectReasons(project, source, object).forEach((r) => reasons.add(r));
      }
    }
  }
  if (usesDrawing && source) drawingReasons(source).forEach((r) => reasons.add(r));
  const level: CheckLevel = reasons.size > 0 ? "review_needed" : heightNeeded.length > 0 ? "height_needed" : physical ? "as_built" : "design_layout";
  const basis =
    level === "as_built"
      ? "measured or supplier values"
      : usesDrawing && source
        ? `the design drawing ${source.filename} (${source.drawing.review.scale.status === "measured" ? "scale checked against a known length" : "scale confirmed"}), not the site as built`
        : "values entered in the editor";
  return { level, reasons: [...reasons], heightNeeded, basis };
}

function objectReasons(project: Project, source: DrawingSource | null, object: SceneObject): string[] {
  const link = drawnFrom(project, object.id);
  if (!source || !link) return [`${object.name}'s drawn size has no drawing to check it against`];
  const reasons: string[] = [];
  const isFloor = source.drawing.review.floor.object_id === object.id;
  if (!isFloor && link.status === "proposed") reasons.push(`${object.name} is not reviewed yet`);
  if (link.drawn.footprint_fit === "enclosing") reasons.push(`${object.name}'s box only encloses its drawn shape (enter its size to use it)`);
  return reasons;
}

export type CheckState = "passed" | "failed" | "not_evaluated" | "height_needed";

/** The result a check may report for its geometric outcome, given what its inputs support. */
export function finalise(geometricPass: boolean, readiness: Readiness): { state: CheckState; label: string } {
  if (readiness.level === "review_needed") return { state: "not_evaluated", label: `Not evaluated: ${readiness.reasons.join("; ")}` };
  if (readiness.level === "height_needed") return { state: "height_needed", label: `Height needed: ${readiness.heightNeeded.map((o) => o.name).join(", ")}` };
  const outcome = geometricPass ? "passed" : "failed";
  return readiness.level === "as_built"
    ? { state: outcome, label: geometricPass ? "Passes, on measured values" : "Fails, on measured values" }
    : { state: outcome, label: `${geometricPass ? "Passes" : "Fails"} on the design layout: ${readiness.basis}` };
}
