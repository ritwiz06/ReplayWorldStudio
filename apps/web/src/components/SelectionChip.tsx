// What is selected, in the chat-first view (UX-04): its name, size, whether its height is only
// assumed, and where each size comes from, one click from the full evidence in the editor.
import type { Project, SceneObject } from "@replay-world/contracts";
import { nameOf } from "../chat/context";
import { heightAssumed } from "../evidence";
import { formatMetres, ORIGIN_LABEL } from "../format";

export function SelectionChip({
  project,
  object,
  onEvidence,
  onLook,
  reference,
  onReference,
}: {
  project: Project;
  object: SceneObject;
  onEvidence: () => void;
  onLook?: (() => void) | null;
  /** The object's reference photo (ENR-01): shown beside its look; null url when it is missing. */
  reference?: { filename: string; url: string | null } | null;
  onReference?: () => void;
}) {
  const d = object.dimensions;
  const origins = [...new Set([d.width.origin, d.depth.origin])].map((o) => ORIGIN_LABEL[o]).join(" / ");
  return (
    <div className="selection-chip" data-testid="selection-chip" role="status">
      <strong>{nameOf(project, object.id)}</strong>
      <span>
        {formatMetres(d.width.value_m)} × {formatMetres(d.depth.value_m)} · {formatMetres(d.height.value_m)} high{heightAssumed(object) ? " (assumed)" : ""}
      </span>
      <span className="muted">Footprint: {origins.toLowerCase()}</span>
      <button type="button" className="link-button" data-testid="selection-evidence" onClick={onEvidence}>
        Evidence…
      </button>
      {onLook && (
        <button type="button" className="link-button" data-testid="selection-look" onClick={onLook}>
          Change look…
        </button>
      )}
      {reference && (
        <button type="button" className="selection-reference" data-testid="selection-reference" title={`Reference photo: ${reference.filename}`} onClick={onReference}>
          {reference.url ? <img src={reference.url} alt={`Reference photo of ${object.name}`} /> : <span className="muted">Photo missing</span>}
        </button>
      )}
    </div>
  );
}
