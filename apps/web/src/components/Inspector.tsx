import type { Project, SceneObject } from "@replay-world/contracts";
import {
  ORIGIN_LABEL,
  REVIEW_LABEL,
  formatMetres,
  formatNumber,
  formatRadians,
  formatValue,
} from "../format";
import type { SceneSource } from "../hooks/useScene";
import { EvidenceBadge } from "./EvidenceBadge";

interface Props {
  project: Project | null;
  source: SceneSource | null;
  selected: SceneObject | null;
}

export function Inspector({ project, source, selected }: Props) {
  if (!project) return <p className="muted panel-pad">Inspector is empty until a scene loads.</p>;
  return selected ? <ObjectDetails object={selected} /> : <SceneSummary project={project} source={source} />;
}

function SceneSummary({ project, source }: { project: Project; source: SceneSource | null }) {
  const objects = project.scene.objects;
  const params = objects.flatMap((o) => o.parameters);
  const unknown = params.filter((p) => p.state === "unknown").length;
  const byOrigin = new Map<string, number>();
  for (const o of objects) {
    const label = ORIGIN_LABEL[o.dimensions.origin];
    byOrigin.set(label, (byOrigin.get(label) ?? 0) + 1);
  }
  return (
    <section aria-label="Scene summary" className="panel-pad">
      <h2 className="panel-title">Scene</h2>
      <dl className="facts">
        <dt>Name</dt>
        <dd>{project.scene.name}</dd>
        <dt>Revision</dt>
        <dd>{project.scene.revision}</dd>
        <dt>Loaded from</dt>
        <dd data-testid="scene-source">
          {source?.kind === "file" ? `${source.filename} (accepted by API)` : "API foundation fixture"}
        </dd>
        <dt>Objects</dt>
        <dd>{objects.length}</dd>
      </dl>
      <h3 className="section-title">Dimension evidence</h3>
      <ul className="tally">
        {[...byOrigin].map(([label, count]) => (
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

function ObjectDetails({ object }: { object: SceneObject }) {
  const { position_m: p, rotation_rad: r } = object.transform;
  const d = object.dimensions;
  return (
    <section aria-label="Object inspector" className="panel-pad" data-testid="object-inspector">
      <h2 className="panel-title">{object.name}</h2>
      <p className="muted mono">{object.id}</p>
      <p className="placeholder-note">Shown as a labelled placeholder box - not a catalog model.</p>

      <h3 className="section-title">
        Dimensions <EvidenceBadge evidence={d.origin} />
      </h3>
      <dl className="facts">
        <dt>Width (X)</dt>
        <dd>{formatMetres(d.width_m)}</dd>
        <dt>Height (Y)</dt>
        <dd>{formatMetres(d.height_m)}</dd>
        <dt>Depth (Z)</dt>
        <dd>{formatMetres(d.depth_m)}</dd>
        <dt>Review</dt>
        <dd>{REVIEW_LABEL[d.review_status]}</dd>
        {d.source_ref && (
          <>
            <dt>Source</dt>
            <dd className="source-ref">{d.source_ref}</dd>
          </>
        )}
      </dl>

      <h3 className="section-title">Placement</h3>
      <dl className="facts">
        <dt>Position</dt>
        <dd className="mono">
          {formatNumber(p.x)}, {formatNumber(p.y)}, {formatNumber(p.z)} m
        </dd>
        <dt>Rotation Y</dt>
        <dd>{formatRadians(r.y)}</dd>
      </dl>

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
