import type { CatalogAsset, Dimensions, Length, Project, SceneObject } from "@replay-world/contracts";
import {
  AXES,
  axesDifferingFromNominal,
  dimensionEvidence,
  licenseLabel,
  redistributionLabel,
} from "../evidence";
import {
  KIND_LABEL,
  ORIGIN_LABEL,
  REVIEW_LABEL,
  formatFootprint,
  formatMetres,
  formatNumber,
  formatRadians,
  formatValue,
} from "../format";
import type { ModelState, ModelStates } from "../hooks/useCatalogModels";
import type { SceneSource } from "../hooks/useProject";
import { fitDistortion, fitScale, isStretched } from "../scene/fit";
import { EditPanel } from "./EditPanel";
import { ObjectEditLog, SceneEditLog } from "./EditLog";
import { EvidenceBadge } from "./EvidenceBadge";

/** Everything the edit panel needs except the object itself. */
export type EditControls = Omit<Parameters<typeof EditPanel>[0], "object" | "asset">;

interface Props {
  project: Project | null;
  source: SceneSource | null;
  selected: SceneObject | null;
  models: ModelStates;
  edit: EditControls;
}

export function Inspector({ project, source, selected, models, edit }: Props) {
  if (!project) return <p className="muted panel-pad">Inspector is empty until a scene loads.</p>;
  if (!selected) return <SceneSummary project={project} source={source} />;
  const asset = project.catalog.find((a) => a.id === selected.asset_id) ?? null;
  return <ObjectDetails project={project} object={selected} asset={asset} model={asset ? models.get(asset.id) : undefined} edit={edit} />;
}

function sourceLabel(source: SceneSource | null): string {
  switch (source?.kind) {
    case "file":
      return `${source.filename} (accepted by API)`;
    case "upgrade":
      return `${source.filename} (upgraded from ${source.fromVersion}; not saved yet)`;
    case "fixture":
      return source.name === "industrial-demo" ? "API industrial demo" : "API foundation fixture";
    default:
      return "-";
  }
}

function tally(labels: string[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
  return [...counts];
}

function SceneSummary({ project, source }: { project: Project; source: SceneSource | null }) {
  const objects = project.scene.objects;
  const params = objects.flatMap((o) => o.parameters);
  const unknown = params.filter((p) => p.state === "unknown").length;
  const axisOrigins = objects.flatMap((o) => AXES.map(({ axis }) => ORIGIN_LABEL[o.dimensions[axis].origin]));
  return (
    <section aria-label="Scene summary" className="panel-pad">
      <h2 className="panel-title">Scene</h2>
      <dl className="facts">
        <dt>Name</dt>
        <dd>{project.scene.name}</dd>
        <dt>Revision</dt>
        <dd>{project.scene.revision}</dd>
        <dt>Loaded from</dt>
        <dd data-testid="scene-source">{sourceLabel(source)}</dd>
        <dt>Objects</dt>
        <dd>{objects.length}</dd>
        <dt>Catalog</dt>
        <dd>{project.catalog.length} assets</dd>
      </dl>
      <h3 className="section-title">Dimension evidence (per axis)</h3>
      <ul className="tally">
        {tally(axisOrigins).map(([label, count]) => (
          <li key={label}>
            {label} <span className="count">{count}</span>
          </li>
        ))}
      </ul>
      <h3 className="section-title">Parameters</h3>
      <ul className="tally">
        <li>
          Known <span className="count">{params.length - unknown}</span>
        </li>
        <li>
          Unknown <span className="count">{unknown}</span>
        </li>
      </ul>
      <h3 className="section-title">Catalog licenses</h3>
      {project.catalog.length === 0 ? (
        <p className="muted">No catalog assets.</p>
      ) : (
        <ul className="tally" data-testid="license-summary">
          {tally(project.catalog.map((a) => licenseLabel(a.rights))).map(([label, count]) => (
            <li key={label}>
              {label} <span className="count">{count}</span>
            </li>
          ))}
        </ul>
      )}
      <h3 className="section-title">
        Edit log <span className="count">{project.scene.edit_log.length}</span>
      </h3>
      <SceneEditLog project={project} />
      <h3 className="section-title">Sources</h3>
      {project.sources.map((s) => (
        <p key={s.id} className="source-line">
          <code>{s.id}</code> · {s.kind} plan in {s.source_to_world.source_unit} →{" "}
          {formatNumber(s.source_to_world.metres_per_source_unit, 3)} m per unit
        </p>
      ))}
      <p className="hint">Select an object in the list or the viewport to inspect its evidence.</p>
    </section>
  );
}

/** The latest edit of each axis of `objectId`: its revision and the value it replaced. */
function lastAxisEdits(project: Project, objectId: string) {
  const edits = new Map<string, { revision: number; before: Length }>();
  for (const r of project.scene.edit_log) {
    if (r.type === "object_edited" && r.object_id === objectId) for (const c of r.dimensions) edits.set(c.axis, { revision: r.revision, before: c.before });
  }
  return edits;
}

function DimensionRows({ project, objectId, dimensions }: { project: Project; objectId: string; dimensions: Dimensions }) {
  const edits = lastAxisEdits(project, objectId);
  return (
    <ul className="axes">
      {AXES.map(({ axis, label }) => {
        const length = dimensions[axis];
        const range = length.uncertainty_m;
        const edit = edits.get(axis);
        return (
          <li key={axis} className="axis" data-testid={`axis-${axis}`}>
            <div className="axis-head">
              <span className="axis-label">{label}</span>
              <strong>{formatMetres(length.value_m)}</strong>
              <EvidenceBadge evidence={length.origin} />
            </div>
            <div className="muted axis-detail">
              {REVIEW_LABEL[length.review_status]}
              {range && ` · range ${formatMetres(range.lower)} – ${formatMetres(range.upper)}`}
              {length.source_ref && ` · ${length.source_ref}`}
            </div>
            {edit && (
              <div className="axis-edited" data-testid={`axis-${axis}-edit`}>
                Edited at r{edit.revision}; was {formatMetres(edit.before.value_m)} {ORIGIN_LABEL[edit.before.origin]}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function VisualDetails({ object, asset, model }: { object: SceneObject; asset: CatalogAsset; model: ModelState | undefined }) {
  const visual = asset.visual;
  if (visual.type !== "gltf") {
    return (
      <>
        <dt>Visual</dt>
        <dd>Placeholder box (provisional)</dd>
      </>
    );
  }
  const scale = fitScale(visual, object.dimensions);
  const stretched = isStretched(visual, object.dimensions);
  return (
    <>
      <dt>Visual</dt>
      <dd>
        glTF model <span className="mono">{visual.uri}</span>
      </dd>
      <dt>File hash</dt>
      <dd className="mono" title={visual.sha256}>
        sha256 {visual.sha256.slice(0, 12)}…
      </dd>
      <dt>Authored</dt>
      <dd>
        {visual.metres_per_model_unit === 1 ? "metres" : `${visual.metres_per_model_unit} m per unit`}, {visual.up_axis} up,
        front {visual.front_axis}, origin at bottom-centre
      </dd>
      <dt>Fit</dt>
      <dd data-testid="model-fit" className={stretched ? "status-warn" : undefined}>
        Scaled ×{scale.map((v) => v.toFixed(3)).join(" × ")} to the recorded dimensions
        {stretched &&
          ` - stretched ${(fitDistortion(visual, object.dimensions) * 100).toFixed(0)} % beyond the ${(visual.max_fit_distortion * 100).toFixed(0)} % tolerance; proportions may mislead`}
      </dd>
      <dt>Model</dt>
      <dd data-testid="model-state" className={model?.status === "failed" ? "status-error" : undefined}>
        {model?.status === "ready"
          ? "Loaded; hash and bounds verified"
          : model?.status === "failed"
            ? `Unavailable - ${model.failure.message}`
            : "Loading…"}
      </dd>
    </>
  );
}

function AssetDetails({ object, asset, model }: { object: SceneObject; asset: CatalogAsset; model: ModelState | undefined }) {
  const differing = axesDifferingFromNominal(object.dimensions, asset);
  const { source, rights } = asset;
  return (
    <div data-testid="asset-details">
      <p className="asset-name">{asset.name}</p>
      <p className="muted mono">{asset.id}</p>
      <dl className="facts">
        <VisualDetails object={object} asset={asset} model={model} />
        <dt>Source</dt>
        <dd>
          {source.kind.replace("_", "-")} · {source.author}
          {source.reference && ` · ${source.reference}`}
        </dd>
        <dt>License</dt>
        <dd>{licenseLabel(rights)}</dd>
        <dt>Rights</dt>
        <dd>{redistributionLabel(rights)}</dd>
        {rights.attribution && (
          <>
            <dt>Attribution</dt>
            <dd>{rights.attribution}</dd>
          </>
        )}
        {rights.terms_ref && (
          <>
            <dt>Terms</dt>
            <dd className="source-ref">{rights.terms_ref}</dd>
          </>
        )}
        <dt>Nominal size</dt>
        <dd>{formatFootprint(asset.nominal_dimensions)}</dd>
      </dl>
      {differing.length === 0 ? (
        <p className="muted">This instance uses the catalog nominal size.</p>
      ) : (
        <p className="conflict-note" role="note">
          This instance differs from the catalog nominal size on: {differing.join(", ")}.
        </p>
      )}
    </div>
  );
}

interface DetailsProps {
  project: Project;
  object: SceneObject;
  asset: CatalogAsset | null;
  model: ModelState | undefined;
  edit: EditControls;
}

function ObjectDetails({ project, object, asset, model, edit }: DetailsProps) {
  const { position_m: p, rotation_rad: r } = object.transform;
  return (
    <section aria-label="Object inspector" className="panel-pad" data-testid="object-inspector">
      <h2 className="panel-title">{object.name}</h2>
      <p className="muted mono">{object.id}</p>
      <p className="muted">{KIND_LABEL[object.kind]}</p>
      <p className="placeholder-note">{representationNote(object, asset, model)}</p>

      <EditPanel key={object.id} object={object} asset={asset} {...edit} />

      <h3 className="section-title">
        Dimensions <EvidenceBadge evidence={dimensionEvidence(object.dimensions)} />
      </h3>
      <DimensionRows project={project} objectId={object.id} dimensions={object.dimensions} />

      <h3 className="section-title">Catalog asset</h3>
      {asset ? (
        <AssetDetails object={object} asset={asset} model={model} />
      ) : (
        <p className="muted">None - this object is scene geometry.</p>
      )}

      <h3 className="section-title">Placement</h3>
      <dl className="facts">
        <dt>Position</dt>
        <dd className="mono">
          {formatNumber(p.x)}, {formatNumber(p.y)}, {formatNumber(p.z)} m
        </dd>
        <dt>Rotation Y</dt>
        <dd>{formatRadians(r.y)}</dd>
      </dl>

      <h3 className="section-title">Edit record</h3>
      <ObjectEditLog project={project} objectId={object.id} />

      <h3 className="section-title">Parameters</h3>
      {object.parameters.length === 0 ? (
        <p className="muted">No parameters recorded.</p>
      ) : (
        <ul className="params">
          {object.parameters.map((param) => (
            <li key={param.id} className="param">
              <div className="param-head">
                <span>{param.label}</span>
                <EvidenceBadge evidence={param.state === "known" ? param.origin : "unknown"} />
              </div>
              {param.state === "known" ? (
                <div className="param-body">
                  <strong>{formatValue(param.value, param.unit)}</strong>
                  {param.uncertainty && (
                    <span className="muted">
                      {" "}
                      range {formatValue(param.uncertainty.lower, param.unit)} –{" "}
                      {formatValue(param.uncertainty.upper, param.unit)}
                    </span>
                  )}
                  <div className="muted">
                    {REVIEW_LABEL[param.review_status]}
                    {param.source_ref ? ` · ${param.source_ref}` : ""}
                  </div>
                </div>
              ) : (
                <div className="param-body">
                  <strong>No value</strong>
                  <div className="muted">{param.reason}</div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function representationNote(object: SceneObject, asset: CatalogAsset | null, model: ModelState | undefined): string {
  if (object.kind === "walkway" || object.kind === "keep_clear") return "Floor marking drawn at its recorded size.";
  if (!asset) return "Scene geometry with no catalog asset, drawn as a plain solid.";
  if (asset.visual.type === "placeholder_box") return "Instance of a provisional catalog asset, drawn as a placeholder box.";
  if (model?.status === "failed") return "Its glTF model could not be shown; drawn as a labelled fallback box at the recorded size.";
  return "Original illustrative glTF model, scaled to the recorded dimensions - not a vendor model.";
}
