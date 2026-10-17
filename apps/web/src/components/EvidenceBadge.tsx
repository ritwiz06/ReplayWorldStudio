import type { Origin } from "../evidence";
import { ORIGIN_LABEL } from "../format";

type Evidence = Origin | "unknown" | "mixed";

const DESCRIPTION: Record<Evidence, string> = {
  measured: "Measured from a source document or on site",
  user_supplied: "Entered by a user",
  supplier: "Taken from supplier data",
  inferred: "Inferred - check before relying on it",
  default: "Default placeholder - not real data",
  drawn: "Read from a design drawing at its reviewed scale: design geometry, not a site measurement",
  unknown: "Not established - no value is assumed",
  mixed: "Axes have different evidence - inspect each axis",
};

const SPECIAL_LABEL = { unknown: "Unknown", mixed: "Mixed" } as const;

/** Text label plus colour, so evidence status never depends on colour alone. */
export function EvidenceBadge({ evidence }: { evidence: Evidence }) {
  return (
    <span className={`badge badge-${evidence}`} title={DESCRIPTION[evidence]}>
      {evidence === "unknown" || evidence === "mixed" ? SPECIAL_LABEL[evidence] : ORIGIN_LABEL[evidence]}
    </span>
  );
}
