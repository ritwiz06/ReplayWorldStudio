// The review cameras (GEN-07), shared by the Improve dialog's previews and its tests.
import type { ModelRevisionProposalResult } from "@replay-world/contracts";
import type { Vec3Tuple } from "./fit";

/** The review dialog's camera views (the API chooses the first one for a proposal). */
export type RevisionView = ModelRevisionProposalResult["view"];

/**
 * The review cameras (GEN-07): the standard view from the front-right above, the view from behind
 * (rear-left, above) and a low view from the front, under tops and shelves. The API's visibility
 * checks render from the same cameras (services/api/.../assist/visibility.py, camera()).
 */
export function viewCamera(view: RevisionView, [w, h, d]: Vec3Tuple): { eye: Vec3Tuple; target: Vec3Tuple } {
  const reach = Math.max(w, h, d);
  if (view === "rear-left") return { eye: [-reach * 1.6, h * 0.9 + reach * 0.7, -reach * 2.1], target: [0, h / 2, 0] };
  if (view === "low-front") return { eye: [reach * 1.1, h * 0.12, reach * 2.6], target: [0, h * 0.4, 0] };
  return { eye: [reach * 1.6, h * 0.9 + reach * 0.7, reach * 2.1], target: [0, h / 2, 0] };
}

