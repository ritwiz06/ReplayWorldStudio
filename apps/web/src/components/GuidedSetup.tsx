// The guided "Set up a day" in the Run tab (SIM-01): pick stations on the plan in process order,
// say what moves between them, give the pace and the number of people if known, and accept or
// change the example assumptions offered for everything else. Run stays off until every example
// in use is accepted and every route the shift needs is clear. The full form stays available.
import type { ProcessModel, ProcessSuggestionRequest, ProcessSuggestionResult, Project, SceneObject } from "@replay-world/contracts";
import { useMemo, useState } from "react";
import type { ApiClient } from "../api/client";
import { checkInputs } from "../checks/inputs";
import { type Assumption, buildGuided, candidates, corrections, type GuidedDraft } from "../run/guided";
import { planRun } from "../run/plan";

interface Props {
  project: Project;
  /** The object selected in the 3D view or on the plan, if any. */
  selected: SceneObject | null;
  client: ApiClient;
  /** A language model is configured (live or recorded): "Suggest setup" is offered. */
  suggestions: boolean;
  draft: GuidedDraft;
  onDraft: (draft: GuidedDraft) => void;
  /** Store the process (one undoable step) and run it; returns why it was refused, or null. */
  onSave: (process: ProcessModel, summary: string) => string | null;
  onFullForm: (process: ProcessModel | null) => void;
  onCancel: (() => void) | null;
}

function AssumptionRow({ a, onAccept, onChange, onReset }: { a: Assumption; onAccept: (yes: boolean) => void; onChange: (value: string) => void; onReset: () => void }) {
  return (
    <li className={`assumption assumption-${a.basis}${a.basis === "example" && !a.accepted ? " pending" : ""}`} data-testid={`assumption-${a.key}`} data-basis={a.basis} data-accepted={a.accepted ? "true" : "false"}>
      <div className="assumption-head">
        <span>{a.label}:</span> <strong>{a.shown}</strong>
      </div>
      <div className="assumption-actions">
        {a.basis === "entered" ? (
          <>
            <span className="basis basis-entered">you entered</span>
            {a.key !== "item" && !a.key.startsWith("pace:") && a.key !== "workers" && (
              <button type="button" className="link-button small" onClick={onReset}>
                use the example
              </button>
            )}
          </>
        ) : (
          <>
            <span className="basis basis-example">Example assumption — please accept or change</span>
            <label className="check-row small">
              <input type="checkbox" checked={a.accepted} data-testid={`accept-${a.key}`} onChange={(e) => onAccept(e.target.checked)} /> Accept
            </label>
          </>
        )}
        {a.key !== "supply" && a.key !== "assign" && a.key !== "item" && !a.key.startsWith("pace:") && a.key !== "workers" && (
          <label className="small change-field">
            <span className="sr-only">Change {a.label}</span>
            {a.choices ? (
              <select value={a.input} data-testid={`change-${a.key}`} onChange={(e) => onChange(e.target.value)}>
                {a.choices.map((c) => (
                  <option key={c} value={c}>
                    {c} side
                  </option>
                ))}
              </select>
            ) : (
              <input type="text" placeholder={`change (${a.unit || "text"})`} data-testid={`change-${a.key}`} defaultValue="" onBlur={(e) => e.target.value.trim() && onChange(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).value.trim() && onChange((e.target as HTMLInputElement).value)} />
            )}
          </label>
        )}
      </div>
    </li>
  );
}

export function GuidedSetup({ project, selected, client, suggestions, draft, onDraft, onSave, onFullForm, onCancel }: Props) {
  const [description, setDescription] = useState("");
  const [suggesting, setSuggesting] = useState<{ status: "idle" | "busy" } | { status: "done"; result: ProcessSuggestionResult } | { status: "failed"; message: string }>({ status: "idle" });
  const [refused, setRefused] = useState<string | null>(null);
  const objects = useMemo(() => candidates(project), [project]);
  const guided = useMemo(() => buildGuided(project, draft), [project, draft]);
  const inputs = useMemo(() => checkInputs(project), [project]);
  // Routes depend only on where stations are and how wide the paths are: not on times typed.
  const routeKey = guided.process
    ? JSON.stringify({
        s: guided.process.stations.map((s) => [s.object_id, s.access_m]),
        t: guided.process.transfers.map((t) => [t.from_station, t.to_station, t.item_width_m.value, t.allowance_m.value]),
        w: guided.process.workers.map((w) => [w.tasks, w.width_m.value]),
        r: project.scene.revision,
      })
    : null;
  const plan = useMemo(() => (guided.process ? planRun(project, guided.process) : null), [routeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const fixes = plan ? (plan.outcome === "needs_input" || plan.outcome === "cannot_determine" ? (plan.routes.length ? corrections(plan) : plan.reasons) : corrections(plan)) : [];
  const set = (patch: Partial<GuidedDraft>) => onDraft({ ...draft, ...patch });
  const accept = (key: string, yes: boolean) => set({ accepted: yes ? [...new Set([...draft.accepted, key])] : draft.accepted.filter((k) => k !== key) });
  const change = (key: string, value: string) => set({ changes: { ...draft.changes, [key]: value } });
  const reset = (key: string) => {
    const changes = { ...draft.changes };
    delete changes[key];
    set({ changes });
  };
  const move = (i: number, by: number) => {
    const stations = [...draft.stations];
    const [s] = stations.splice(i, 1);
    stations.splice(i + by, 0, s!);
    set({ stations });
  };
  const add = (object: SceneObject) => {
    if (draft.stations.some((s) => s.objectId === object.id)) return;
    set({ stations: [...draft.stations, { objectId: object.id, name: object.name }] });
  };
  const essential = guided.assumptions.filter((a) => a.group === "essential");
  const details = guided.assumptions.filter((a) => a.group === "details");
  const pending = guided.unaccepted.length;
  const ready = guided.process !== null && pending === 0 && plan?.outcome === "ready";
  const reviewProblem = !inputs ? "Run a day needs a reviewed plan." : inputs.blockers.length ? `Finish the review first: ${inputs.blockers.join("; ")}.` : !inputs.floor ? `The floor's edge is not known (${inputs.floorProblem}): in the review, trace the floor or choose its outline, so routes can be checked.` : null;

  async function suggest() {
    setSuggesting({ status: "busy" });
    const result = await client.suggestProcess({
      description: description.trim(),
      objects: objects.map((o) => ({ id: o.id, name: o.name, kind: o.kind, width_m: o.dimensions.width.value_m, depth_m: o.dimensions.depth.value_m })) as ProcessSuggestionRequest["objects"],
    });
    setSuggesting(result.ok ? { status: "done", result: result.value } : { status: "failed", message: result.error.message });
  }

  return (
    <div className="source-drawing-body run-panel guided" data-testid="guided-setup">
      <div className="run-head">
        <strong>Set up a day</strong>
        <button type="button" className="link-button small" data-testid="guided-full-form" onClick={() => onFullForm(guided.process)}>
          Full form…
        </button>
        {onCancel && (
          <button type="button" className="link-button small" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
      <p className="small muted">
        Pick the stations in the order work moves. Times and people are never read from the drawing: type what you know, and accept or change an illustrative example for the rest.
      </p>
      {reviewProblem && (
        <p className="small status-warn" data-testid="guided-review-problem">
          {reviewProblem}
        </p>
      )}

      <h4>1 · Stations, in process order</h4>
      <ol className="guided-stations" data-testid="guided-stations">
        {draft.stations.map((s, i) => {
          const object = project.scene.objects.find((o) => o.id === s.objectId);
          return (
            <li key={s.objectId} data-testid={`guided-station-${i}`}>
              <div className="setup-row">
                <input type="text" value={s.name} aria-label={`Name of station ${i + 1}`} data-testid={`guided-station-${i}-name`} onChange={(e) => set({ stations: draft.stations.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                <button type="button" className="link-button small" disabled={i === 0} aria-label="Move up" data-testid={`guided-station-${i}-up`} onClick={() => move(i, -1)}>
                  ↑
                </button>
                <button type="button" className="link-button small" disabled={i === draft.stations.length - 1} aria-label="Move down" data-testid={`guided-station-${i}-down`} onClick={() => move(i, 1)}>
                  ↓
                </button>
                <button type="button" className="link-button small" aria-label="Remove" data-testid={`guided-station-${i}-remove`} onClick={() => set({ stations: draft.stations.filter((_, j) => j !== i) })}>
                  ✕
                </button>
              </div>
              <span className="small muted">
                {i === 0 ? "material comes from here" : `step ${i}`} · object: {object?.name ?? "not in the layout"}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="setup-row">
        <button type="button" className="button button-small" disabled={!selected || draft.stations.some((s) => s.objectId === selected.id)} data-testid="guided-add-selected" onClick={() => selected && add(selected)}>
          {selected ? `Add ${selected.name}` : "Add the selected object"}
        </button>
        <select value="" aria-label="Or choose an object" data-testid="guided-add" onChange={(e) => {
          const object = objects.find((o) => o.id === e.target.value);
          if (object) add(object);
        }}>
          <option value="">or choose…</option>
          {objects
            .filter((o) => !draft.stations.some((s) => s.objectId === o.id))
            .map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
        </select>
      </div>
      {!selected && draft.stations.length === 0 && <p className="small muted">Click an object in the 3D view or on the plan, then add it.</p>}
      {suggestions && (
        <details className="guided-suggest" data-testid="guided-suggest">
          <summary>Suggest setup (AI, optional)</summary>
          <p className="small muted">Describe the work in a sentence. The names of the reviewed objects and your words are sent to the language model; it suggests stations and order only, never times or staffing. Nothing is applied until you choose to.</p>
          <textarea value={description} rows={2} data-testid="guided-suggest-text" placeholder="for example: parts come from the store shelves, are assembled into kits at the bench and put in the cabinet" onChange={(e) => setDescription(e.target.value)} />
          <button type="button" className="button button-small" disabled={description.trim().length < 3 || suggesting.status === "busy" || objects.length < 2} data-testid="guided-suggest-button" onClick={() => void suggest()}>
            {suggesting.status === "busy" ? "Asking…" : "Suggest setup"}
          </button>
          {suggesting.status === "failed" && (
            <p className="small status-error" role="alert">
              {suggesting.message}
            </p>
          )}
          {suggesting.status === "done" && (
            <div className="guided-suggestion" data-testid="guided-suggestion">
              {suggesting.result.outcome === "unsupported" ? (
                <p className="small">{suggesting.result.message}</p>
              ) : (
                <>
                  <p className="small">
                    <strong>Suggested</strong> ({suggesting.result.provider.mode === "recorded" ? "a recorded answer, not live" : suggesting.result.provider.model}): {suggesting.result.suggestion!.item_name ? `${suggesting.result.suggestion!.item_name} moving through ` : ""}
                    {suggesting.result.suggestion!.stations.map((s) => s.name).join(" → ")}
                  </p>
                  <ul className="small">
                    {suggesting.result.suggestion!.stations.map((s) => (
                      <li key={s.object_id}>
                        <strong>{s.name}</strong> ({project.scene.objects.find((o) => o.id === s.object_id)?.name}): {s.why}
                      </li>
                    ))}
                  </ul>
                  {suggesting.result.suggestion!.questions.length > 0 && (
                    <p className="small" data-testid="guided-questions">
                      Questions to answer: {suggesting.result.suggestion!.questions.join(" ")}
                    </p>
                  )}
                  {suggesting.result.checks.length > 0 && <p className="small muted">Checked: {suggesting.result.checks.join(" ")}</p>}
                  <button
                    type="button"
                    className="button button-small"
                    data-testid="guided-use-suggestion"
                    onClick={() => {
                      const s = suggesting.result.suggestion!;
                      set({ stations: s.stations.map((x) => ({ objectId: x.object_id, name: x.name })), item: draft.item || s.item_name || "" });
                      setSuggesting({ status: "idle" });
                    }}
                  >
                    Use these stations (you review them)
                  </button>
                </>
              )}
            </div>
          )}
        </details>
      )}

      <h4>2 · What moves between them?</h4>
      <input type="text" value={draft.item} placeholder="for example: kit, batch, tray" data-testid="guided-item" onChange={(e) => set({ item: e.target.value })} />
      <span className="small muted"> carried by hand</span>

      <h4>3 · Pace and people (type what you know)</h4>
      {draft.stations.slice(1).map((s) => (
        <div className="setup-row" key={s.objectId}>
          <label className="setup-field">
            <span>
              {s.name}: time for one {draft.item.trim() || "item"}
            </span>
            <input type="text" inputMode="decimal" value={draft.pace[s.objectId] ?? ""} placeholder={draft.paceUnit} data-testid={`guided-pace-${s.objectId}`} onChange={(e) => set({ pace: { ...draft.pace, [s.objectId]: e.target.value } })} />
          </label>
        </div>
      ))}
      {draft.stations.length > 1 && (
        <label className="small">
          Times in{" "}
          <select value={draft.paceUnit} data-testid="guided-pace-unit" onChange={(e) => set({ paceUnit: e.target.value as GuidedDraft["paceUnit"] })}>
            <option value="min">minutes</option>
            <option value="s">seconds</option>
          </select>
        </label>
      )}
      <label className="setup-field">
        <span>People working this process</span>
        <input type="text" inputMode="numeric" value={draft.workers} placeholder="people" data-testid="guided-workers" onChange={(e) => set({ workers: e.target.value })} />
      </label>
      <ul className="assumptions">
        {essential.map((a) => (
          <AssumptionRow key={a.key} a={a} onAccept={(yes) => accept(a.key, yes)} onChange={(v) => change(a.key, v)} onReset={() => reset(a.key)} />
        ))}
      </ul>

      <details className="guided-details" data-testid="guided-details">
        <summary>
          4 · Review assumptions ({details.filter((a) => a.basis === "example").length} examples, {details.filter((a) => a.basis === "example" && a.accepted).length} accepted)
        </summary>
        <ul className="assumptions">
          {details.map((a) => (
            <AssumptionRow key={a.key} a={a} onAccept={(yes) => accept(a.key, yes)} onChange={(v) => change(a.key, v)} onReset={() => reset(a.key)} />
          ))}
        </ul>
      </details>

      <div className="guided-status" data-testid="guided-status">
        {guided.needs.length > 0 && (
          <div className="setup-needs" data-testid="guided-needs">
            <strong>Needed first:</strong>
            <ul className="small">
              {guided.needs.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        )}
        {guided.needs.length === 0 && pending > 0 && (
          <div className="setup-needs" data-testid="guided-pending">
            <strong>
              {pending} example assumption{pending === 1 ? "" : "s"} to accept or change before Run.
            </strong>{" "}
            <button type="button" className="button button-small" data-testid="guided-accept-all" onClick={() => set({ accepted: [...new Set([...draft.accepted, ...guided.unaccepted.map((a) => a.key)])] })}>
              Accept all {pending} examples shown
            </button>
            <p className="small muted">Accepting means you agree to run with these illustrative values; the results then hold only under them.</p>
          </div>
        )}
        {plan && fixes.length > 0 && (
          <div className="run-problem run-blocked" data-testid="guided-routes">
            <strong>{plan.outcome === "blocked" ? "A route the shift needs is blocked" : "A route the shift needs cannot be determined"}</strong>
            <ul>
              {fixes.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        )}
        {plan?.outcome === "ready" && (
          <p className="small" data-testid="guided-routes-clear">
            Routes checked on the layout: {plan.routes.map((r) => `${plan.locations[r.from]!.name} ↔ ${plan.locations[r.to]!.name} ${r.lengthM!.toFixed(1)} m`).join(" · ")}.
          </p>
        )}
        <p className="small muted" data-testid="guided-counts">
          {guided.counts.entered} value{guided.counts.entered === 1 ? "" : "s"} you entered · {guided.counts.examples} illustrative assumption{guided.counts.examples === 1 ? "" : "s"}
        </p>
        <button
          type="button"
          className="button button-primary"
          disabled={!ready}
          data-testid="guided-run"
          onClick={() => {
            if (!guided.process) return;
            setRefused(onSave(guided.process, `${draft.stations.length} stations; ${guided.counts.entered} values entered, ${guided.counts.examples} illustrative assumptions accepted`));
          }}
        >
          Save and run the day
        </button>
        {refused && (
          <p className="small status-error" role="alert">
            {refused}
          </p>
        )}
      </div>
    </div>
  );
}
