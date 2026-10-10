import type { Dimensions } from "@replay-world/contracts";
import { ORIGIN_LABEL } from "../format";

type Evidence = Dimensions["origin"] | "unknown";

const DESCRIPTION: Record<Evidence, string> = {
  measured: "Measured from a source document or on site",
  user_supplied: "Entered by a user",
  supplier: "Taken from supplier data",
  inferred: "Inferred - check before relying on it",
  default: "Default placeholder - not real data",
  unknown: "Not established - no value is assumed",
};

/** Text label plus colour, so evidence status never depends on colour alone. */
export function EvidenceBadge({ evidence }: { evidence: Evidence }) {
  return (
    <span className={`badge badge-${evidence}`} title={DESCRIPTION[evidence]}>
      {evidence === "unknown" ? "Unknown" : ORIGIN_LABEL[evidence]}
    </span>
  );
}
