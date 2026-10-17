// Upload a floor plan (ONB-01): the plan appears as soon as the drawing is read, while the 3D
// draft is prepared; the one question asked is the unit, and only when the drawing does not
// settle it. Cancel and every failure leave the open project exactly as it was.
import type { DrawingAnalysis, Project } from "@replay-world/contracts";
import { useEffect, useRef, useState } from "react";
import type { ApiClient } from "../api/client";
import { type Outcome, prepareDraft, readDrawing, STEPS, type StepId, settledUnit } from "../drawing/orchestrator";
import { type DrawingUnit, formatSize, headerUnit, METRES_PER_UNIT, UNIT_NAME, UNITS } from "../drawing/world";
import { DrawingPlan } from "./DrawingPlan";

interface Props {
  client: ApiClient;
  onClose: () => void;
  /** The checked draft; the editor decides whether it may replace the open project. */
  onCreated: (project: Project, filename: string) => void;
}

type Draft = { status: "waiting" } | { status: "building" } | { status: "ready"; project: Project } | { status: "failed"; message: string };

type Step =
  | { kind: "choose"; error: string | null; dwg: boolean }
  | { kind: "reading"; filename: string }
  | { kind: "read"; analysis: DrawingAnalysis; unit: DrawingUnit | null; draft: Draft };

/** Milliseconds from choosing the file to the plan on screen and to the checked draft; read by
 * the browser journey to record the measurements. */
type Timing = { startedAt: number; planMs: number | null; draftMs: number | null };

export function DrawingImport({ client, onClose, onCreated }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const [step, setStep] = useState<Step>({ kind: "choose", error: null, dwg: false });
  const [timing, setTiming] = useState<Timing>({ startedAt: 0, planMs: null, draftMs: null });

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => {
      controller.current?.abort();
      element?.close();
    };
  }, []);

  // The plan is on screen after the next paint.
  const planShown = step.kind === "read";
  useEffect(() => {
    if (!planShown || timing.planMs !== null) return;
    const frame = requestAnimationFrame(() => setTiming((t) => ({ ...t, planMs: Math.round(performance.now() - t.startedAt) })));
    return () => cancelAnimationFrame(frame);
  }, [planShown, timing.planMs]);

  function fresh(): AbortSignal {
    controller.current?.abort();
    controller.current = new AbortController();
    return controller.current.signal;
  }

  async function choose(file: File) {
    setTiming({ startedAt: performance.now(), planMs: null, draftMs: null });
    setStep({ kind: "reading", filename: file.name });
    const signal = fresh();
    let read: Outcome<DrawingAnalysis>;
    try {
      read = await readDrawing(client, file, signal);
    } catch {
      return; // cancelled: the cancel handler has already reset the dialog
    }
    if (!read.ok) {
      setStep({ kind: "choose", error: read.message, dwg: /DWG/.test(read.message) });
      return;
    }
    const unit = settledUnit(read.value, null);
    setStep({ kind: "read", analysis: read.value, unit, draft: unit ? { status: "building" } : { status: "waiting" } });
    if (unit) void build(read.value, unit, signal);
  }

  async function build(analysis: DrawingAnalysis, unit: DrawingUnit, signal = fresh()) {
    setStep({ kind: "read", analysis, unit, draft: { status: "building" } });
    let prepared: Outcome<Project>;
    try {
      prepared = await prepareDraft(client, analysis, unit, signal);
    } catch {
      return;
    }
    if (prepared.ok) setTiming((t) => (t.draftMs === null ? { ...t, draftMs: Math.round(performance.now() - t.startedAt) } : t));
    setStep((s) => (s.kind === "read" && s.analysis === analysis && s.unit === unit ? { ...s, draft: prepared.ok ? { status: "ready", project: prepared.value } : { status: "failed", message: prepared.message } } : s));
  }

  function cancel() {
    controller.current?.abort();
    setStep({ kind: "choose", error: "Cancelled.", dwg: false });
  }

  const reading = step.kind === "reading";
  const current: StepId = step.kind === "reading" ? "read" : step.kind === "read" ? (step.unit === null ? "units" : step.draft.status === "ready" ? "check" : "build") : "read";

  return (
    <dialog
      ref={dialog}
      className="modal drawing-import"
      aria-labelledby="drawing-title"
      data-testid="drawing-import"
      data-plan-ms={timing.planMs ?? undefined}
      data-draft-ms={timing.draftMs ?? undefined}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header className="create-head">
        <h2 id="drawing-title">Upload a floor plan</h2>
        <button type="button" className="button" onClick={onClose}>
          Close
        </button>
      </header>

      {(step.kind === "choose" || reading) && (
        <div
          className="photo-drop"
          data-testid="drawing-drop"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (file && !reading) void choose(file);
          }}
        >
          <p>
            <strong>Choose a floor layout saved as DXF.</strong> Its walls, outlines and blocks become a 3D draft you can walk through and change. The original file
            stays linked, so every object shows where it came from.
          </p>
          <p className="muted small">
            DXF (ASCII) up to 10 MB · read here, no AI involved · a DWG has to be exported as DXF first (Save As &gt; DXF in your CAD program).
          </p>
          {reading ? (
            <div className="drawing-reading" role="status" data-testid="drawing-reading">
              <span className="spinner" aria-hidden="true" /> Reading {step.filename}…
              <button type="button" className="button button-small" data-testid="drawing-cancel" onClick={cancel}>
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" className="button button-primary" data-testid="drawing-choose" onClick={() => fileInput.current?.click()}>
              Choose a drawing…
            </button>
          )}
          <input
            ref={fileInput}
            type="file"
            accept=".dxf,.dwg"
            hidden
            data-testid="drawing-file-input"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void choose(file);
            }}
          />
          {step.kind === "choose" && step.error && (
            <div className={step.error === "Cancelled." ? "muted" : step.dwg ? "status-warn" : "status-error"} role="alert" data-testid="drawing-error">
              {step.dwg && <strong className="drawing-error-head">DWG is not supported yet</strong>}
              {step.error} Nothing was imported. Your current scene is unchanged.
            </div>
          )}
        </div>
      )}

      {step.kind === "read" && (
        <div className="drawing-review">
          <div className="drawing-plan-frame">
            <DrawingPlan
              drawing={step.analysis.drawing}
              labels="all"
              testId="drawing-plan"
              title={`Plan of ${step.analysis.filename}`}
              metresPerUnit={step.unit ? METRES_PER_UNIT[step.unit] : null}
            />
          </div>
          <div className="drawing-side">
            <p className="muted small">
              {step.analysis.filename} · {step.analysis.drawing.dxf_version ?? "DXF"} · read in this app, no AI used
            </p>
            <Units analysis={step.analysis} unit={step.unit} onChoose={(unit) => void build(step.analysis, unit)} />
            <Found analysis={step.analysis} />
            <p className="drawing-height-note" data-testid="drawing-height-note">
              <strong>Heights:</strong> a floor plan has none. Each object gets a height <em>assumed for display</em>, marked as such, until you enter a real one. A
              check that needs a height will say <q>height needed</q>.
            </p>
            <Skipped analysis={step.analysis} />
            <ol className="drawing-steps" aria-label="Progress">
              {STEPS.map((s, i) => {
                const index = STEPS.findIndex((x) => x.id === current);
                const done = step.draft.status === "ready" || i < index;
                const state = done ? "done" : s.id === current ? (step.draft.status === "failed" ? "failed" : step.unit === null ? "waiting" : "running") : "todo";
                return (
                  <li key={s.id} className={`step-${state}`} data-testid={`drawing-step-${s.id}`} data-state={state}>
                    {s.label}
                  </li>
                );
              })}
            </ol>
            {step.draft.status === "failed" && (
              <p className="status-error" role="alert" data-testid="drawing-error">
                {step.draft.message} Nothing was imported; your current scene is unchanged.
              </p>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="button button-primary"
                data-testid="drawing-open"
                disabled={step.draft.status !== "ready"}
                onClick={() => step.draft.status === "ready" && onCreated(step.draft.project, step.analysis.filename)}
              >
                {step.draft.status === "building" ? "Preparing the 3D draft…" : step.draft.status === "waiting" ? "Choose the unit first" : "Open the 3D draft"}
              </button>
              <button type="button" className="button" data-testid="drawing-another" onClick={() => setStep({ kind: "choose", error: null, dwg: false })}>
                Choose another file
              </button>
            </div>
          </div>
        </div>
      )}
    </dialog>
  );
}

function Units({ analysis, unit, onChoose }: { analysis: DrawingAnalysis; unit: DrawingUnit | null; onChoose: (unit: DrawingUnit) => void }) {
  const drawing = analysis.drawing;
  const settled = headerUnit(drawing);
  if (settled) {
    return (
      <p className="drawing-units" data-testid="drawing-units">
        <strong>Unit:</strong> {UNIT_NAME[settled]}, as the drawing says · the layout is {formatSize(drawing, settled)}
      </p>
    );
  }
  return (
    <fieldset className="drawing-question" data-testid="drawing-unit-question">
      <legend>What unit is this drawing in?</legend>
      <p className="small">{drawing.units.question} Nothing gets a real size until you choose; your answer is recorded as yours.</p>
      {UNITS.map((u) => (
        <label key={u} className="drawing-unit-option">
          <input type="radio" name="drawing-unit" value={u} checked={unit === u} data-testid={`drawing-unit-${u}`} onChange={() => onChoose(u)} />
          <span>
            {UNIT_NAME[u]}
            {drawing.units.declared === u && " (what the header says)"}
          </span>
          <span className="muted">→ {formatSize(drawing, u)}</span>
        </label>
      ))}
    </fieldset>
  );
}

const KINDS: readonly [DrawingAnalysis["drawing"]["objects"][number]["kind"], string, string][] = [
  ["equipment", "piece of equipment", "pieces of equipment"],
  ["structure", "column or wall", "columns or walls"],
  ["walkway", "walkway", "walkways"],
  ["keep_clear", "keep-clear zone", "keep-clear zones"],
  ["reference", "reference", "references"],
];

function Found({ analysis }: { analysis: DrawingAnalysis }) {
  const objects = analysis.drawing.objects.filter((o) => o.role !== "floor");
  const floor = analysis.drawing.objects.some((o) => o.role === "floor");
  const counts = KINDS.map(([kind, one, many]) => {
    const n = objects.filter((o) => o.kind === kind).length;
    return n === 0 ? null : `${n} ${n === 1 ? one : many}`;
  }).filter(Boolean);
  return (
    <div className="drawing-found" data-testid="drawing-summary">
      <p>
        <strong>Found {objects.length} object{objects.length === 1 ? "" : "s"}</strong>
        {floor ? " and the floor outline" : " (no closed floor outline: the floor is sized around them)"}:{" "}
        {counts.join(", ")}.
      </p>
      <p className="muted small">Names come from texts, block names and layers in the drawing. Each object keeps a link to the drawing entity it came from.</p>
      {analysis.warnings.length > 0 && (
        <ul className="drawing-warnings small" data-testid="drawing-warnings">
          {analysis.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Skipped({ analysis }: { analysis: DrawingAnalysis }) {
  const skipped = analysis.drawing.skipped;
  if (skipped.length === 0) return null;
  const layout = skipped.filter((s) => s.layout);
  const notes = skipped.filter((s) => !s.layout);
  const total = (list: typeof skipped) => list.reduce((n, s) => n + s.count, 0);
  return (
    <details className="drawing-skipped" data-testid="drawing-skipped" open={layout.length > 0}>
      <summary>
        {layout.length > 0 ? <strong className="status-warn">{total(layout)} shape{total(layout) === 1 ? "" : "s"} not imported</strong> : "Nothing left out of the layout"}
        {notes.length > 0 && ` · ${total(notes)} annotation item${total(notes) === 1 ? "" : "s"} not used`}
      </summary>
      <ul className="small">
        {skipped.map((s) => (
          <li key={`${s.entity}-${s.layer}-${s.reason}`} data-testid={`drawing-skipped-${s.entity.toLowerCase()}`}>
            {s.count} {s.entity} on layer {s.layer}
            {s.handles.length > 0 && ` (${s.handles.join(", ")})`}: {s.reason}
          </li>
        ))}
      </ul>
    </details>
  );
}
