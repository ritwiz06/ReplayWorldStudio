// "Set up a day" (SIM-01): the operating facts of a process on the person's own layout, entered
// by them: where material comes from, the stations in order and how long each step takes, the
// buffers, how items are carried, who does what, and the shift with its breaks. Nothing is
// filled in from the drawing; the list under the form says exactly what is still needed.
import type { ProcessModel, Project } from "@replay-world/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildProcess, type DayDraft, draftFrom, emptyDraft, emptyStation, emptyTransfer, type Side, stationObjects } from "../run/setup";

interface Props {
  project: Project;
  /** The process to start from (the one set up, or the guided draft's), if any. */
  initial: ProcessModel | null;
  onClose: () => void;
  /** Store the process (one undoable step); returns why it was refused, or null. */
  onSave: (process: ProcessModel, summary: string) => string | null;
}

const SIDES: Side[] = ["front", "back", "left", "right"];

export function SetupDay({ project, initial, onClose, onSave }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<DayDraft>(() => (initial ? draftFrom(initial) : emptyDraft()));
  const [refused, setRefused] = useState<string | null>(null);
  const objects = useMemo(() => stationObjects(project), [project]);
  const built = useMemo(() => buildProcess(project, draft), [project, draft]);
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => element?.close();
  }, []);
  const name = (id: string) => objects.find((o) => o.id === id)?.name ?? "…";
  const set = (patch: Partial<DayDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const setStation = (i: number, patch: Partial<DayDraft["stations"][number]>) => set({ stations: draft.stations.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const setTransfer = (i: number, patch: Partial<DayDraft["transfers"][number]>) => set({ transfers: draft.stations.map((_, j) => (j === i ? { ...(draft.transfers[j] ?? emptyTransfer()), ...patch } : (draft.transfers[j] ?? emptyTransfer()))) });
  const setWorker = (i: number, patch: Partial<DayDraft["workers"][number]>) => set({ workers: draft.workers.map((w, j) => (j === i ? { ...w, ...patch } : w)) });
  const tasks = draft.stations.flatMap((st, i) => {
    const from = i === 0 ? name(draft.supplyObjectId) : name(draft.stations[i - 1]!.objectId);
    return [
      { key: `transfer:${i}`, label: `carry ${from} → ${name(st.objectId)}` },
      { key: `station:${i}`, label: `work at ${name(st.objectId)}` },
    ];
  });
  const number = (value: string, onChange: (v: string) => void, label: string, unit: string, testId: string) => (
    <label className="setup-field">
      <span>{label}</span>
      <input type="text" inputMode="decimal" value={value} placeholder={unit} data-testid={testId} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
  const save = () => {
    if (!built.process) return;
    const summary = `${built.process.stations.length - 1} station${built.process.stations.length === 2 ? "" : "s"}, ${built.process.workers.length} worker${built.process.workers.length === 1 ? "" : "s"}, entered values`;
    setRefused(onSave(built.process, summary));
  };

  return (
    <dialog
      ref={dialog}
      className="modal setup-day"
      aria-labelledby="setup-title"
      data-testid="setup-day"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header className="create-head">
        <h2 id="setup-title">Set up a day</h2>
        <button type="button" className="button" onClick={onClose}>
          Cancel
        </button>
      </header>
      <p className="small muted">
        Enter the operating facts of one process on this layout. None is read from the drawing, and nothing is filled in for you: a run predicts what happens under exactly these
        values. Routes between stations are checked on the layout itself.
      </p>
      {project.process?.example_note && <p className="small status-warn">Changing the example turns its values into entered ones.</p>}

      <fieldset>
        <legend>What moves through it</legend>
        <label className="setup-field">
          <span>Item</span>
          <input type="text" value={draft.itemName} placeholder="for example batch, carton, frame" data-testid="setup-item" onChange={(e) => set({ itemName: e.target.value })} />
        </label>
        <label className="setup-field">
          <span>Name of this process (optional)</span>
          <input type="text" value={draft.name} data-testid="setup-name" onChange={(e) => set({ name: e.target.value })} />
        </label>
      </fieldset>

      <fieldset>
        <legend>1 · Where material is taken from</legend>
        <label className="setup-field">
          <span>Object</span>
          <select value={draft.supplyObjectId} data-testid="setup-supply" onChange={(e) => set({ supplyObjectId: e.target.value })}>
            <option value="">Choose…</option>
            {objects.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <SideFields side={draft.supplySide} clearance={draft.supplyClearanceM} testId="setup-supply" onSide={(side) => set({ supplySide: side })} onClearance={(v) => set({ supplyClearanceM: v })} />
        <label className="check-row small">
          <input type="checkbox" checked={draft.supplyConfirmed} data-testid="setup-supply-confirm" onChange={(e) => set({ supplyConfirmed: e.target.checked })} /> Material is always available there (the run
          assumes it; it is not checked)
        </label>
      </fieldset>

      <fieldset>
        <legend>2 · Stations, in order</legend>
        {draft.stations.map((st, i) => (
          <div key={i} className="setup-station" data-testid={`setup-station-${i}`}>
            <div className="setup-row">
              <strong>Step {i + 2}</strong>
              <select value={st.objectId} data-testid={`setup-station-${i}-object`} onChange={(e) => setStation(i, { objectId: e.target.value })}>
                <option value="">Choose the object…</option>
                {objects.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
              <button type="button" className="link-button small" onClick={() => set({ stations: draft.stations.filter((_, j) => j !== i), transfers: draft.transfers.filter((_, j) => j !== i), workers: draft.workers.map((w) => ({ ...w, tasks: [] })) })}>
                Remove
              </button>
            </div>
            <div className="setup-grid">
              {number(st.workerS, (v) => setStation(i, { workerS: v }), "With a worker", "seconds", `setup-station-${i}-worker`)}
              {number(st.machineS, (v) => setStation(i, { machineS: v }), "Then on its own", "seconds", `setup-station-${i}-machine`)}
              {number(st.inCap, (v) => setStation(i, { inCap: v }), "Queue in front (items)", "items", `setup-station-${i}-in`)}
              {i < draft.stations.length - 1 && number(st.outCap, (v) => setStation(i, { outCap: v }), "Finished items beside it", "items", `setup-station-${i}-out`)}
            </div>
            <SideFields side={st.side} clearance={st.clearanceM} testId={`setup-station-${i}`} onSide={(side) => setStation(i, { side })} onClearance={(v) => setStation(i, { clearanceM: v })} />
            {st.stops.map((stop, k) => (
              <div key={k} className="setup-row small">
                <span className="muted">Planned stop:</span>
                <input type="text" value={stop.reason} placeholder="reason" onChange={(e) => setStation(i, { stops: st.stops.map((x, j) => (j === k ? { ...x, reason: e.target.value } : x)) })} />
                <input type="text" value={stop.start} placeholder="hh:mm" data-testid={`setup-station-${i}-stop-${k}-start`} onChange={(e) => setStation(i, { stops: st.stops.map((x, j) => (j === k ? { ...x, start: e.target.value } : x)) })} />
                <input type="text" value={stop.minutes} placeholder="minutes" data-testid={`setup-station-${i}-stop-${k}-minutes`} onChange={(e) => setStation(i, { stops: st.stops.map((x, j) => (j === k ? { ...x, minutes: e.target.value } : x)) })} />
                <button type="button" className="link-button small" onClick={() => setStation(i, { stops: st.stops.filter((_, j) => j !== k) })}>
                  Remove
                </button>
              </div>
            ))}
            <div className="setup-row small">
              <button type="button" className="link-button small" data-testid={`setup-station-${i}-add-stop`} onClick={() => setStation(i, { stops: [...st.stops, { reason: "", start: "", minutes: "" }] })}>
                Add a planned stop
              </button>
              <span className="muted">Unplanned stops (optional): about every</span>
              <input type="text" className="narrow" value={st.randomEveryMin} placeholder="min" onChange={(e) => setStation(i, { randomEveryMin: e.target.value })} />
              <span className="muted">minutes, lasting about</span>
              <input type="text" className="narrow" value={st.randomForMin} placeholder="min" onChange={(e) => setStation(i, { randomForMin: e.target.value })} />
              <span className="muted">minutes (drawn from the seed)</span>
            </div>
            <div className="setup-grid">
              <span className="small muted">Carried here from {i === 0 ? name(draft.supplyObjectId) : name(draft.stations[i - 1]!.objectId)} by hand:</span>
              {number(draft.transfers[i]?.widthM ?? "", (v) => setTransfer(i, { widthM: v }), "Width carried", "m", `setup-carry-${i}-width`)}
              {number(draft.transfers[i]?.allowanceM ?? "", (v) => setTransfer(i, { allowanceM: v }), "Clear each side", "m", `setup-carry-${i}-allowance`)}
              {number(draft.transfers[i]?.speedMps ?? "", (v) => setTransfer(i, { speedMps: v }), "Speed", "m/s", `setup-carry-${i}-speed`)}
              {number(draft.transfers[i]?.handlingS ?? "", (v) => setTransfer(i, { handlingS: v }), "Pick up / set down", "seconds each", `setup-carry-${i}-handling`)}
            </div>
          </div>
        ))}
        <button type="button" className="button button-small" data-testid="setup-add-station" onClick={() => set({ stations: [...draft.stations, emptyStation()], transfers: [...draft.transfers, emptyTransfer()] })}>
          Add a station
        </button>
        <p className="small muted">The last station completes the item.</p>
      </fieldset>

      <fieldset>
        <legend>3 · Workers</legend>
        {draft.workers.map((w, i) => (
          <div key={i} className="setup-station" data-testid={`setup-worker-${i}`}>
            <div className="setup-row">
              <input type="text" value={w.name} placeholder="Name" data-testid={`setup-worker-${i}-name`} onChange={(e) => setWorker(i, { name: e.target.value })} />
              <button type="button" className="link-button small" onClick={() => set({ workers: draft.workers.filter((_, j) => j !== i) })}>
                Remove
              </button>
            </div>
            <div className="setup-grid">
              {number(w.speedMps, (v) => setWorker(i, { speedMps: v }), "Walking speed", "m/s", `setup-worker-${i}-speed`)}
              {number(w.widthM, (v) => setWorker(i, { widthM: v }), "Path width needed", "m", `setup-worker-${i}-width`)}
            </div>
            <p className="small muted">Tasks, in the order they are chosen when several are ready:</p>
            <div className="setup-tasks">
              {tasks.map((t) => (
                <label key={t.key} className="check-row small">
                  <input
                    type="checkbox"
                    checked={w.tasks.includes(t.key)}
                    data-testid={`setup-worker-${i}-${t.key.replace(":", "-")}`}
                    onChange={(e) => setWorker(i, { tasks: e.target.checked ? [...w.tasks, t.key] : w.tasks.filter((k) => k !== t.key) })}
                  />{" "}
                  {t.label}
                  {w.tasks.includes(t.key) && <span className="muted"> (#{w.tasks.indexOf(t.key) + 1})</span>}
                </label>
              ))}
            </div>
          </div>
        ))}
        <button type="button" className="button button-small" data-testid="setup-add-worker" onClick={() => set({ workers: [...draft.workers, { name: "", speedMps: "", widthM: "", tasks: [] }] })}>
          Add a worker
        </button>
      </fieldset>

      <fieldset>
        <legend>4 · Shift and breaks</legend>
        <div className="setup-grid">
          <label className="setup-field">
            <span>Starts at</span>
            <input type="text" value={draft.shiftStart} placeholder="hh:mm" data-testid="setup-shift-start" onChange={(e) => set({ shiftStart: e.target.value })} />
          </label>
          {number(draft.shiftHours, (v) => set({ shiftHours: v }), "Lasts", "hours", "setup-shift-hours")}
          {number(draft.seed, (v) => set({ seed: v }), "Seed", "whole number", "setup-seed")}
        </div>
        {draft.breaks.map((b, i) => (
          <div key={i} className="setup-row">
            <input type="text" value={b.name} placeholder="Break" onChange={(e) => set({ breaks: draft.breaks.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
            <input type="text" value={b.start} placeholder="hh:mm" data-testid={`setup-break-${i}-start`} onChange={(e) => set({ breaks: draft.breaks.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)) })} />
            <input type="text" value={b.minutes} placeholder="minutes" data-testid={`setup-break-${i}-minutes`} onChange={(e) => set({ breaks: draft.breaks.map((x, j) => (j === i ? { ...x, minutes: e.target.value } : x)) })} />
            <button type="button" className="link-button small" onClick={() => set({ breaks: draft.breaks.filter((_, j) => j !== i) })}>
              Remove
            </button>
          </div>
        ))}
        <button type="button" className="button button-small" data-testid="setup-add-break" onClick={() => set({ breaks: [...draft.breaks, { name: "", start: "", minutes: "" }] })}>
          Add a break
        </button>
      </fieldset>

      {built.needs.length > 0 ? (
        <div className="setup-needs" data-testid="setup-needs">
          <strong>Still needed to run a day:</strong>
          <ul className="small">
            {built.needs.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="small status-ok" data-testid="setup-ready">
          Everything the run needs is entered. Routes are checked on the layout when you run it.
        </p>
      )}
      {refused && (
        <p className="small status-error" role="alert">
          {refused}
        </p>
      )}
      <div className="modal-actions">
        <button type="button" className="button button-primary" data-testid="setup-save" disabled={!built.process} onClick={save}>
          Save this process
        </button>
      </div>
    </dialog>
  );
}

function SideFields({ side, clearance, testId, onSide, onClearance }: { side: Side | "kept"; clearance: string; testId: string; onSide: (side: Side | "kept") => void; onClearance: (v: string) => void }) {
  return (
    <div className="setup-grid">
      <label className="setup-field">
        <span>Worker stands at its</span>
        <select value={side} data-testid={`${testId}-side`} onChange={(e) => onSide(e.target.value as Side | "kept")}>
          {side === "kept" && <option value="kept">place set before</option>}
          {SIDES.map((s) => (
            <option key={s} value={s}>
              {s} side
            </option>
          ))}
        </select>
      </label>
      {side !== "kept" && (
        <label className="setup-field">
          <span>this far from it</span>
          <input type="text" inputMode="decimal" value={clearance} placeholder="m" data-testid={`${testId}-clearance`} onChange={(e) => onClearance(e.target.value)} />
        </label>
      )}
    </div>
  );
}
