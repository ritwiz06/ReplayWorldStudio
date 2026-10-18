// The simple screen's view of the selected object (UX-01): what it is, where its size comes
// from in plain words, and the next step - check it in the review, move it, or open the
// details (sizes, position and evidence) in the inspector.
import type { Project, SceneObject } from "@replay-world/contracts";
import type { EditTool } from "../scene/drag";
import { drawnFrom } from "../drawing/world";
import { heightAssumed } from "../evidence";
import { formatFootprint, KIND_LABEL } from "../format";

interface Props {
  project: Project | null;
  selected: SceneObject | null;
  onCheck: () => void;
  /** The editor's tool for the 3D handles: move, turn or resize. */
  tool: EditTool;
  onTool: (tool: Exclude<EditTool, "select">) => void;
  onDetails: () => void;
}

const FOOTPRINT_WORDS: Record<string, string> = {
  drawn: "footprint from the design drawing",
  measured: "footprint measured",
  supplier: "footprint from the supplier",
  user_supplied: "footprint entered by you",
  inferred: "footprint estimated",
  default: "footprint only for display",
};

const TOOLS: readonly { id: Exclude<EditTool, "select">; label: string; key: string }[] = [
  { id: "move", label: "Move", key: "M" },
  { id: "rotate", label: "Turn", key: "R" },
  { id: "resize", label: "Resize", key: "S" },
];

export function SelectionCard({ project, selected, onCheck, tool, onTool, onDetails }: Props) {
  if (!project) return null;
  if (!selected) {
    return (
      <section className="selection-card empty" aria-label="Selected object" data-testid="selection-card">
        <p className="muted small">Select an object in the 3D view or on the plan to see what it is and change it.</p>
        <button type="button" className="link-button small" data-testid="selection-details" onClick={onDetails}>
          Show the object list and details
        </button>
      </section>
    );
  }
  const link = drawnFrom(project, selected.id);
  const picture = link?.source.drawing.reader === "rws-plan-image/1";
  const footprint =
    selected.dimensions.width.origin === "drawn" && picture
      ? link?.drawn.tolerance != null
        ? "footprint traced on the plan"
        : "footprint proposed from the plan (approximate)"
      : (FOOTPRINT_WORDS[selected.dimensions.width.origin] ?? "");
  return (
    <section className="selection-card" aria-label="Selected object" data-testid="selection-card">
      <h2 className="panel-title">{selected.name}</h2>
      <p className="small">
        {KIND_LABEL[selected.kind]} · {formatFootprint(selected.dimensions)}
      </p>
      <p className="small muted">
        {footprint}
        {heightAssumed(selected) && "; height assumed for display"}
        {link && ` · from ${link.source.filename}`}
      </p>
      <div className="selection-actions">
        {link && (
          <button type="button" className="button button-small button-primary" data-testid="selection-check" onClick={onCheck}>
            Check it
          </button>
        )}
        <div className="segmented" role="group" aria-label="Change it with the 3D handles">
          {TOOLS.map((t) => (
            <button key={t.id} type="button" aria-pressed={tool === t.id} data-testid={`selection-${t.id}`} title={`${t.label} with the handles in the 3D view (${t.key})`} onClick={() => onTool(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <button type="button" className="button button-small" data-testid="selection-details" onClick={onDetails}>
          Size, position and evidence…
        </button>
      </div>
    </section>
  );
}
