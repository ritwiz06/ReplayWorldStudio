import type { Project, SceneObject } from "@replay-world/contracts";
import { dimensionEvidence } from "../evidence";
import { formatFootprint, KIND_LABEL } from "../format";
import { fitDistortion, isStretched } from "../scene/fit";
import { EvidenceBadge } from "./EvidenceBadge";

interface Props {
  project: Project | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}


/** Distortion of the object's glTF model beyond its tolerance, or null when it is faithful. */
function stretchOf(project: Project, object: SceneObject): number | null {
  const asset = object.asset_id ? project.catalog.find((a) => a.id === object.asset_id) : undefined;
  if (asset?.visual.type !== "gltf" || !isStretched(asset.visual, object.dimensions)) return null;
  return fitDistortion(asset.visual, object.dimensions);
}

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
                {KIND_LABEL[o.kind]} · {o.asset_id ? "catalog asset" : "scene geometry"}
              </span>
              <span className="object-meta">{formatFootprint(o.dimensions)}</span>
              <EvidenceBadge evidence={dimensionEvidence(o.dimensions)} />
              <StretchBadge stretch={stretchOf(project, o)} />
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function StretchBadge({ stretch }: { stretch: number | null }) {
  if (stretch === null) return null;
  const percent = Math.round(stretch * 100);
  return (
    <span className="badge badge-stretched" data-testid="stretch-badge" title={`The model is stretched ${percent} % to fit the recorded dimensions; its proportions may mislead`}>
      Model stretched {percent} %
    </span>
  );
}
