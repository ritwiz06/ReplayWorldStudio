// Upload a floor plan (ONB-01): the plan appears as soon as the drawing is read, while the 3D
// draft is prepared; the one question asked is the unit, and only when the drawing does not
// settle it. A PDF, PNG or JPEG plan (IMP-03) is shown as a picture: a PDF with several pages
// first asks which page, and the one question is a length the person knows. Cancel and every
// failure leave the open project exactly as it was.
import type { DrawingAnalysis, PlanUpload, Project, SourceDocument } from "@replay-world/contracts";
import { useEffect, useRef, useState } from "react";
import type { ApiClient } from "../api/client";
import { type Outcome, prepareDraft, readDrawing, STEPS, type StepId, settledUnit } from "../drawing/orchestrator";
import { type DrawingUnit, formatSize, headerUnit, METRES_PER_UNIT, UNIT_NAME, UNITS } from "../drawing/world";
import { isPlanFile, readPage, readPlan } from "../drawing/planImport";
import { DrawingPlan } from "./DrawingPlan";
import { PlanReading } from "./PlanReading";

interface Props {
  client: ApiClient;
  onClose: () => void;
  /** The checked draft; the editor decides whether it may replace the open project. */
  onCreated: (project: Project, filename: string) => void;
  /** When a world from a plan is open: keep the file with it instead (not aligned, ENR-01). */
  onAttach?: ((source: SourceDocument) => void) | undefined;
  /** A vision model is set up to draft plan pictures (off in the public preview). */
  proposals?: boolean | undefined;
  /** A file already chosen (attached in the conversation): reading starts at once. */
  initialFile?: File | null | undefined;
}

/** A later plan or drawing kept with the open world: stored by hash, not aligned or merged. */
function attachedSource(analysis: DrawingAnalysis): SourceDocument {
  const extension = analysis.drawing.file.uri.split(".").pop();
  const kind = extension === "pdf" ? "pdf" : extension === "png" ? "png" : extension === "jpg" ? "jpeg" : "dxf";
  return {
    id: `src-kept-${analysis.sha256.slice(0, 12)}`,
    kind,
    filename: analysis.filename,
    sha256: analysis.sha256,
    source_to_world: null,
    import_warnings: ["Kept with this world as a reference: not aligned with its plan, and nothing is merged from it yet (ENR-01)."],
    image: null,
    photo_import: null,
    drawing: null,
  };
}

type Draft = { status: "waiting" } | { status: "building" } | { status: "ready"; project: Project } | { status: "failed"; message: string };

type Step =
  | { kind: "choose"; error: string | null; dwg: boolean }
  | { kind: "reading"; filename: string }
  | { kind: "read"; analysis: DrawingAnalysis; unit: DrawingUnit | null; draft: Draft }
  | { kind: "pages"; upload: PlanUpload; reading: number | null }
  | { kind: "plan"; analysis: DrawingAnalysis };

/** Milliseconds from choosing the file to the plan on screen and to the checked draft; read by
 * the browser journey to record the measurements. */
type Timing = { startedAt: number; pageAt: number | null; planMs: number | null; modelMs: number | null; draftMs: number | null };

export function DrawingImport({ client, onClose, onCreated, onAttach, proposals = true, initialFile = null }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const [step, setStep] = useState<Step>({ kind: "choose", error: null, dwg: false });
  const [timing, setTiming] = useState<Timing>({ startedAt: 0, pageAt: null, planMs: null, modelMs: null, draftMs: null });

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => {
      controller.current?.abort();
      element?.close();
    };
  }, []);

  // The plan is on screen after the next paint (a picture: once it has loaded). For a PDF with
  // several pages, it is timed from choosing the page.
  const planShown = step.kind === "read" || step.kind === "plan";
  useEffect(() => {
    if (!planShown || timing.planMs !== null) return;
    let frame = 0;
    const done = () => {
      frame = requestAnimationFrame(() => setTiming((t) => ({ ...t, planMs: Math.round(performance.now() - (t.pageAt ?? t.startedAt)) })));
    };
    const picture = dialog.current?.querySelector<SVGImageElement>(".plan-raster");
    if (picture) {
      const image = new Image();
      image.onload = done;
      image.onerror = done;
      image.src = picture.href.baseVal;
    } else done();
    return () => cancelAnimationFrame(frame);
  }, [planShown, timing.planMs]);

  // A file attached in the conversation is read at once, as if chosen here.
  const started = useRef(false);
  useEffect(() => {
    if (!initialFile || started.current) return;
    started.current = true;
    void choose(initialFile);
  }, [initialFile]); // eslint-disable-line react-hooks/exhaustive-deps

  function fresh(): AbortSignal {
    controller.current?.abort();
    controller.current = new AbortController();
    return controller.current.signal;
  }

  async function choose(file: File) {
    setTiming({ startedAt: performance.now(), pageAt: null, planMs: null, modelMs: null, draftMs: null });
    setStep({ kind: "reading", filename: file.name });
    const signal = fresh();
    if (isPlanFile(file)) {
      let upload;
      try {
        upload = await readPlan(client, file, signal);
      } catch {
        return;
      }
      if (!upload.ok) return setStep({ kind: "choose", error: upload.message, dwg: false });
      setStep(upload.value.analysis ? { kind: "plan", analysis: upload.value.analysis } : { kind: "pages", upload: upload.value, reading: null });
      return;
    }
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

  async function choosePage(upload: PlanUpload, page: number) {
    setTiming((t) => ({ ...t, pageAt: performance.now(), planMs: null }));
    setStep({ kind: "pages", upload, reading: page });
    let read;
    try {
      read = await readPage(client, upload, page, fresh());
    } catch {
      return;
    }
    if (!read.ok) return setStep({ kind: "choose", error: read.message, dwg: false });
    setStep({ kind: "plan", analysis: read.value });
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
      data-model-ms={timing.modelMs ?? undefined}
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
            <strong>Choose a floor layout: a DXF, or a PDF, PNG or JPEG of the plan.</strong> It becomes a 3D draft you can walk through and change. The original file
            stays linked, so every object shows where it came from.
          </p>
          <p className="muted small">
            Up to 10 MB · a DXF is read here, no AI involved · a PDF page or plan image is shown at once; you mark one length you know, then
            {proposals ? " ask the vision model to draft the objects or mark them yourself" : " mark the floor and objects yourself"} · a DWG has to be exported as DXF
            first (Save As &gt; DXF in your CAD program).
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
            accept=".dxf,.dwg,.pdf,.png,.jpg,.jpeg"
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

      {step.kind === "pages" && (
        <div className="plan-pages" data-testid="plan-pages">
          <p>
            <strong>{step.upload.filename} has {step.upload.pages.length} pages.</strong> Which one is the floor plan?
          </p>
          <ul>
            {step.upload.pages.map((p) => (
              <li key={p.page}>
                <button type="button" className="plan-page" data-testid={`plan-page-${p.page}`} disabled={step.reading !== null} onClick={() => void choosePage(step.upload, p.page)}>
                  {p.thumbnail ? <img src={p.thumbnail} alt={`Page ${p.page}`} /> : <span className="plan-page-blank">Page {p.page}</span>}
                  <span>
                    Page {p.page} · {Math.round((p.width_pt / 72) * 25.4)} × {Math.round((p.height_pt / 72) * 25.4)} mm paper
                    {step.reading === p.page && " · opening…"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="muted small">The paper's size is shown to tell the pages apart; it says nothing about the room's size.</p>
        </div>
      )}

      {step.kind === "plan" && (
        <PlanReading
          key={step.analysis.drawing.raster?.uri}
          client={client}
          analysis={step.analysis}
          onModelMs={(ms) => setTiming((t) => ({ ...t, modelMs: ms }))}
          onDraftReady={() => setTiming((t) => (t.draftMs === null ? { ...t, draftMs: Math.round(performance.now() - t.startedAt) } : t))}
          onCreated={(project) => onCreated(project, step.analysis.filename)}
          onAttach={onAttach ? () => onAttach(attachedSource(step.analysis)) : undefined}
          proposals={proposals}
          onAnother={() => setStep({ kind: "choose", error: null, dwg: false })}
        />
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
              {onAttach && (
                <button type="button" className="button" data-testid="drawing-attach" onClick={() => onAttach(attachedSource(step.analysis))}>
                  Keep it with this world
                </button>
              )}
              <button type="button" className="button" data-testid="drawing-another" onClick={() => setStep({ kind: "choose", error: null, dwg: false })}>
                Choose another file
              </button>
            </div>
            {onAttach && (
              <p className="muted small">
                <q>Open</q> starts a new world from this file; <q>Keep it with this world</q> keeps the world you have and stores this file with it, not yet aligned with its plan.
              </p>
            )}
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
