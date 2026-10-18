// A plan picture in the upload dialog (IMP-03): the page or image is on screen at once; the
// person marks one length they know (the only way pixels get a scale), and chooses whether the
// vision model drafts the floor and objects or they mark them in the review. The model's draft
// is shown dashed: approximate outlines and names, never sizes. Cancel, retry and "mark it
// myself" always leave the open project as it was.
import type { DrawingAnalysis, PlanPoint, PlanProposalResult, Project } from "@replay-world/contracts";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import type { ApiClient } from "../api/client";
import { type KnownLength, preparePlanDraft, proposeLayout } from "../drawing/planImport";
import { formatLength, formatScale, proposedDrawing } from "../drawing/world";
import { DrawingPlan } from "./DrawingPlan";

type Proposal =
  | { status: "idle" }
  | { status: "running"; startedAt: number }
  | { status: "done"; result: PlanProposalResult; ms: number }
  | { status: "failed"; message: string }
  | { status: "manual" };

type Draft = { status: "idle" } | { status: "building" } | { status: "ready"; project: Project } | { status: "failed"; message: string };

interface Props {
  client: ApiClient;
  analysis: DrawingAnalysis;
  /** Milliseconds the model took, for the journey's measurements. */
  onModelMs: (ms: number) => void;
  /** The checked draft is ready to open (for the journey's measurements). */
  onDraftReady: () => void;
  onCreated: (project: Project) => void;
  /** When a world from a plan is open: keep this file with it instead of starting a new one. */
  onAttach?: (() => void) | undefined;
  onAnother: () => void;
}

export function PlanReading({ client, analysis, onModelMs, onDraftReady, onCreated, onAttach, onAnother }: Props) {
  const [marks, setMarks] = useState<PlanPoint[]>([]);
  const [precision, setPrecision] = useState(0);
  const [length, setLength] = useState("");
  const [proposal, setProposal] = useState<Proposal>({ status: "idle" });
  const [elapsed, setElapsed] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const raster = analysis.drawing.raster!;
  const metres = Number(length);
  const known: KnownLength | null = marks.length === 2 && metres > 0 ? { a: marks[0]!, b: marks[1]!, metres, tolerance: precision } : null;
  const pixels = known ? Math.hypot(known.b.x - known.a.x, known.b.y - known.a.y) : 0;
  const scale = known && pixels > 0 ? metres / pixels : null;
  const shown = useMemo(() => proposedDrawing(analysis, proposal.status === "done" ? proposal.result.proposal : null), [analysis, proposal]);
  const page = raster.page ? `page ${raster.page} of ${analysis.filename}` : analysis.filename;

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (proposal.status !== "running") return;
    const timer = setInterval(() => setElapsed(Math.round((performance.now() - proposal.startedAt) / 1000)), 500);
    return () => clearInterval(timer);
  }, [proposal]);

  function fresh(): AbortSignal {
    controller.current?.abort();
    controller.current = new AbortController();
    return controller.current.signal;
  }

  async function propose() {
    const startedAt = performance.now();
    setElapsed(0);
    setProposal({ status: "running", startedAt });
    const signal = fresh();
    try {
      const result = await proposeLayout(client, analysis, signal);
      const ms = Math.round(performance.now() - startedAt);
      if (!result.ok) return setProposal({ status: "failed", message: result.message });
      onModelMs(ms);
      if (result.value.outcome === "unsupported") return setProposal({ status: "failed", message: result.value.message ?? "No draft was proposed." });
      setProposal({ status: "done", result: result.value, ms });
    } catch {
      // Cancelled: the cancel button has already reset the state.
    }
  }

  function cancel() {
    controller.current?.abort();
    setProposal({ status: "idle" });
  }

  const decided = proposal.status === "done" || proposal.status === "manual";
  const objects = shown.objects.filter((o) => o.role !== "floor");
  const blocker = !known ? "Mark a length you know first" : !decided ? "Propose the layout, or mark it yourself" : null;
  const result = proposal.status === "done" ? proposal.result : null;
  const ready = useRef(false);
  // What the draft is built from; it is built and checked as soon as the scale and the proposal
  // are settled (again if either changes), so opening it is immediate.
  const key = known && blocker === null ? JSON.stringify([known, proposal.status, proposal.status === "done" ? proposal.ms : 0]) : null;
  const [built, setBuilt] = useState<{ key: string; project: Project | null; message: string | null } | null>(null);
  useEffect(() => {
    if (key === null || !known) return;
    const builder = new AbortController();
    const timer = setTimeout(() => {
      void preparePlanDraft(client, analysis, result, known, builder.signal)
        .then((prepared) => {
          if (builder.signal.aborted) return;
          setBuilt({ key, project: prepared.ok ? prepared.value : null, message: prepared.ok ? null : prepared.message });
          if (prepared.ok && !ready.current) {
            ready.current = true;
            onDraftReady();
          }
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      clearTimeout(timer);
      builder.abort();
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const draft: Draft =
    key === null ? { status: "idle" } : built?.key !== key ? { status: "building" } : built.project ? { status: "ready", project: built.project } : { status: "failed", message: built.message ?? "" };

  return (
    <div className="drawing-review">
      <div className="drawing-plan-frame">
        <DrawingPlan drawing={shown} labels="selected" mode="point" testId="drawing-plan" title={`Plan picture: ${page}`} metresPerUnit={scale} marks={marks} onPoint={(p, tolerance) => {
          const next = marks.length >= 2 ? [p] : [...marks, p];
          setMarks(next);
          setPrecision(marks.length >= 2 ? tolerance : Math.max(precision, tolerance));
        }} />
      </div>
      <div className="drawing-side">
        <p className="muted small">
          {page} · {raster.width_px} × {raster.height_px} px · a picture: nothing in it has a size until you mark a length you know
        </p>
        <fieldset className={`drawing-question${known ? " settled" : ""}`} data-testid="plan-known-length">
          <legend>1. Mark a length you know</legend>
          <p className="small">
            {marks.length < 2
              ? `Click ${marks.length === 0 ? "the two ends" : "the other end"} of a distance you know on the plan: a dimension line, a wall, a scale bar.`
              : "Now type the real distance between the two points."}{" "}
            A page size or a printed number is never used on its own.
          </p>
          <label className="small">
            Real length{" "}
            <input type="number" min="0" step="0.01" value={length} data-testid="plan-length" onChange={(e) => setLength(e.target.value)} onKeyDown={(e: KeyboardEvent) => e.stopPropagation()} /> m
          </label>
          {scale && (
            <p className="small" data-testid="plan-scale">
              1 px = {formatScale(scale)} · the picture is {formatLength(raster.width_px * scale)} × {formatLength(raster.height_px * scale)} · each point within about {formatLength(precision * scale)}
            </p>
          )}
        </fieldset>
        <div className="drawing-question" data-testid="plan-proposal" data-status={proposal.status}>
          <strong>2. The floor and objects</strong>
          {proposal.status === "idle" && (
            <>
              <p className="small">The vision model can draft the floor outline, walls and objects with their names. It is a draft: you check, trace and correct it in the review.</p>
              <div className="review-actions">
                <button type="button" className="button button-small button-primary" data-testid="plan-propose" onClick={() => void propose()}>
                  Propose the layout
                </button>
                <button type="button" className="button button-small" data-testid="plan-manual" onClick={() => setProposal({ status: "manual" })}>
                  Mark it myself
                </button>
              </div>
              <p className="muted small">Proposing sends a copy of this picture (at most 1600 px, no metadata) to the vision model the API is set up with (ASU Voyager).</p>
            </>
          )}
          {proposal.status === "running" && (
            <div className="drawing-reading" role="status" data-testid="plan-proposing">
              <span className="spinner" aria-hidden="true" /> Proposing the layout… {elapsed} s
              <button type="button" className="button button-small" data-testid="plan-cancel" onClick={cancel}>
                Cancel
              </button>
            </div>
          )}
          {proposal.status === "failed" && (
            <div className="status-warn" role="alert" data-testid="plan-proposal-failed">
              <p className="small">{proposal.message}</p>
              <div className="review-actions">
                <button type="button" className="button button-small" data-testid="plan-retry" onClick={() => void propose()}>
                  Try again
                </button>
                <button type="button" className="button button-small button-primary" data-testid="plan-manual" onClick={() => setProposal({ status: "manual" })}>
                  Mark it myself
                </button>
              </div>
            </div>
          )}
          {proposal.status === "done" && (
            <div data-testid="plan-proposed">
              <p className="small">
                <strong>
                  Proposed {objects.length} object{objects.length === 1 ? "" : "s"}
                  {shown.objects.some((o) => o.role === "floor" && o.refs[0]?.entity === "REGION") ? " and the floor outline" : ", no floor outline"}
                </strong>{" "}
                in {(proposal.ms / 1000).toFixed(1)} s, dashed on the plan: approximate outlines to check. {proposal.result.provider.mode === "recorded" ? "(A recorded answer, not live.)" : ""}
              </p>
              {proposal.result.checks.length > 0 && (
                <ul className="small drawing-warnings">
                  {proposal.result.checks.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {proposal.status === "manual" && (
            <p className="small" data-testid="plan-manual-chosen">
              You will trace the floor and add each object in the review.{" "}
              <button type="button" className="link-button" onClick={() => setProposal({ status: "idle" })}>
                Propose instead
              </button>
            </p>
          )}
        </div>
        <p className="drawing-height-note">
          <strong>Heights:</strong> a plan has none. Each object gets a height <em>assumed for display</em> until you enter one; a check that needs a height says <q>height needed</q>.
        </p>
        {analysis.warnings.length > 0 && (
          <ul className="drawing-warnings small" data-testid="drawing-warnings">
            {analysis.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
        {draft.status === "failed" && (
          <p className="status-error" role="alert" data-testid="drawing-error">
            {draft.message} Nothing was imported; your current scene is unchanged.
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="button button-primary" data-testid="drawing-open" disabled={draft.status !== "ready"} onClick={() => draft.status === "ready" && onCreated(draft.project)}>
            {blocker ?? (draft.status === "ready" ? "Open the 3D draft" : "Preparing the 3D draft…")}
          </button>
          {onAttach && (
            <button type="button" className="button" data-testid="drawing-attach" onClick={onAttach}>
              Keep it with this world
            </button>
          )}
          <button type="button" className="button" data-testid="drawing-another" onClick={onAnother}>
            Choose another file
          </button>
        </div>
        {onAttach && (
          <p className="muted small">
            <q>Open</q> starts a new world from this plan; <q>Keep it with this world</q> keeps the world you have, its objects and edits, and stores this plan with it. Aligning
            it with the world's plan and taking objects from it comes later.
          </p>
        )}
      </div>
    </div>
  );
}
