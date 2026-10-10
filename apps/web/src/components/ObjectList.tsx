import type { Project } from "@replay-world/contracts";
import { formatFootprint } from "../format";
import { EvidenceBadge } from "./EvidenceBadge";

interface Props {
  project: Project | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

const KIND_LABEL = { structure: "Structure", equipment: "Equipment", reference: "Reference" };

export function ObjectList({ project, selectedId, onSelect }: Props) {
  if (!project) return <p className="muted panel-pad">No scene loaded.</p>;
  return (
    <nav aria-label="Scene objects">
      <h2 className="panel-title">
        Objects <span className="count">{project.scene.objects.length}</span>
      </h2>
      <ul className="object-list">
        {project.scene.objects.map((o) => (
          <li key={o.id}>
            <button
              type="button"
              className={`object-item${o.id === selectedId ? " selected" : ""}`}
              aria-pressed={o.id === selectedId}
              onClick={() => onSelect(o.id === selectedId ? null : o.id)}
            >
              <span className="object-name">{o.name}</span>
              <span className="object-meta">
                {KIND_LABEL[o.kind]} · {formatFootprint(o.dimensions)}
              </span>
              <EvidenceBadge evidence={o.dimensions.origin} />
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
