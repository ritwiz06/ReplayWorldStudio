// What is selected, in the chat-first view (UX-04): its name, size, whether its height is only
// assumed, and where each size comes from, one click from the full evidence in the editor.
import type { Project, SceneObject } from "@replay-world/contracts";
import { nameOf } from "../chat/context";
import { heightAssumed } from "../evidence";
import { formatFootprint, formatMetres, ORIGIN_LABEL } from "../format";

export function SelectionChip({ project, object, onEvidence }: { project: Project; object: SceneObject; onEvidence: () => void }) {
  const d = object.dimensions;
  const origins = [...new Set([d.width.origin, d.depth.origin])].map((o) => ORIGIN_LABEL[o]).join(" / ");
  return (
    <div className="selection-chip" data-testid="selection-chip" role="status">
      <strong>{nameOf(project, object.id)}</strong>
      <span>
        {formatFootprint(d)} · {formatMetres(d.height.value_m)} high{heightAssumed(object) ? " (assumed)" : ""}
      </span>
      <span className="muted">Footprint: {origins.toLowerCase()}</span>
      <button type="button" className="link-button" data-testid="selection-evidence" onClick={onEvidence}>
        Evidence…
      </button>
    </div>
  );
}
