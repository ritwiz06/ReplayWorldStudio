import type { CatalogAsset, Project } from "@replay-world/contracts";
import { licenseLabel } from "../evidence";
import { formatFootprint, KIND_LABEL } from "../format";

interface Props {
  project: Project;
  /** Asset currently being placed, if any. */
  placingAssetId: string | null;
  editable: boolean;
  onPlace: (asset: CatalogAsset) => void;
  onCancel: () => void;
  /** Create a new catalog asset by describing it, or in the object builder. */
  onDescribe: () => void;
  onBuild: () => void;
}

/** The project's catalog: place a new instance of any asset at its nominal size and evidence. */
export function CatalogPanel({ project, placingAssetId, editable, onPlace, onCancel, onDescribe, onBuild }: Props) {
  return (
    <section aria-label="Catalog" className="catalog-panel">
      <h2 className="panel-title">
        Add from catalog <span className="count">{project.catalog.length}</span>
      </h2>
      <div className="catalog-create">
        <button type="button" className="button button-small button-primary" disabled={!editable} data-testid="catalog-describe" onClick={onDescribe}>
          Describe a new object…
        </button>
        <button type="button" className="button button-small" disabled={!editable} data-testid="catalog-build" onClick={onBuild}>
          Build one…
        </button>
      </div>
      {project.catalog.length === 0 ? (
        <p className="muted panel-pad">This project has no catalog assets.</p>
      ) : (
        <ul className="object-list">
          {project.catalog.map((asset) => {
            const placing = asset.id === placingAssetId;
            return (
              <li key={asset.id} className="catalog-item">
                <div>
                  <span className="object-name">{asset.name}</span>
                  <span className="object-meta">
                    {KIND_LABEL[asset.kind]} ·{" "}
                    {asset.generation ? "generated, provisional" : asset.visual.type === "gltf" ? "glTF model" : "placeholder box"} ·{" "}
                    {licenseLabel(asset.rights)}
                  </span>
                  <span className="object-meta">{formatFootprint(asset.nominal_dimensions)}</span>
                </div>
                <button
                  type="button"
                  className={`button button-small${placing ? " button-primary" : ""}`}
                  disabled={!editable}
                  aria-pressed={placing}
                  data-testid={`place-${asset.id}`}
                  title={editable ? `Place a new ${asset.name} on the floor` : "Switch to the orbit or top view to place equipment"}
                  onClick={() => (placing ? onCancel() : onPlace(asset))}
                >
                  {placing ? "Cancel" : "Place…"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
