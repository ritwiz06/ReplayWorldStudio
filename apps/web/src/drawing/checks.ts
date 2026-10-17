// What can be checked yet (ADR-049): route, process and physical checks are not built. A
// question about them gets a plain answer naming the missing input, never an invented result.
// A check that needs a verified height answers "height needed" while any height is only a
// display value or an estimate.
import type { Length, Project, SceneObject } from "@replay-world/contracts";
import { checkReadiness } from "./readiness";

export type CheckQuestion = "overhead" | "clearance" | "throughput" | "strength";

export interface CheckAnswer {
  question: CheckQuestion;
  status: "height_needed" | "not_available";
  title: string;
  message: string;
  /** Objects whose missing value blocks the check (for "height needed"). */
  needs: { id: string; name: string }[];
}

export const QUESTIONS: readonly { id: CheckQuestion; label: string }[] = [
  { id: "overhead", label: "Will everything fit under a beam or door?" },
  { id: "clearance", label: "Is there enough room to walk and work?" },
  { id: "throughput", label: "How much can this layout produce?" },
  { id: "strength", label: "Will the floor hold the machines?" },
];

/** Evidence a check may rely on as it is (the contract's VERIFIED_ORIGINS); drawn geometry is
 * design evidence, used only through the readiness rule. */
export function isVerified(length: Length): boolean {
  return length.origin === "measured" || length.origin === "supplier" || length.origin === "user_supplied";
}

const standing = (o: SceneObject) => o.kind === "equipment" || (o.kind === "structure" && o.transform.position_m.y + o.dimensions.height.value_m > 0.05);

export function answer(project: Project, question: CheckQuestion): CheckAnswer {
  if (question === "overhead") {
    const needs = project.scene.objects.filter((o) => standing(o) && !isVerified(o.dimensions.height)).map((o) => ({ id: o.id, name: o.name }));
    if (needs.length > 0) {
      return {
        question,
        status: "height_needed",
        title: "Height needed",
        message: `${needs.length} object${needs.length === 1 ? " has" : "s have"} only a height assumed for display, not a real one. An overhead check needs a measured or supplier height for each: select the object and enter its height. No overhead result is shown until then.`,
        needs,
      };
    }
    return {
      question,
      status: "not_available",
      title: "Not available yet",
      message: "Every height is entered, but overhead checks are not built yet, so no result is shown. The heights are kept for when they are.",
      needs: [],
    };
  }
  const missing: Record<Exclude<CheckQuestion, "overhead">, string> = {
    clearance:
      "A clearance check needs the clear width each route must keep (for people, carts or a forklift) and each machine's access and service zones. The drawing gives footprints and walkway outlines only, so no clearance result is shown.",
    throughput:
      "Throughput needs each station's cycle time, the order work moves between stations, and the shift pattern. A drawing contains none of these, and they are never guessed.",
    strength:
      "A floor-load check needs each machine's mass and the floor's rated load. Nothing here records mass or strength, and neither is ever inferred from a drawing or a name.",
  };
  // Even before checks exist, say what the drawing would have to settle first.
  const readiness = checkReadiness(project, project.scene.objects.filter((o) => o.kind !== "structure" || standing(o)).map((o) => o.id), { height: false });
  const first =
    readiness.level === "review_needed"
      ? ` The values are not ready for a check either: ${readiness.reasons.slice(0, 3).join("; ")}${readiness.reasons.length > 3 ? "; and more" : ""}.`
      : readiness.level === "design_layout"
        ? ` When checks exist, this drawing supports a design-layout result only, not the site as built.`
        : "";
  return { question, status: "not_available", title: "Not available yet", message: missing[question] + first, needs: [] };
}
