// The drawing a world was built from, beside the 3D view (ONB-01). "Drawing" shows the plan as
// drawn, linked both ways to the scene; "Compare" shows the drawing and the current arrangement
// side by side with every change listed, the way to walk through it, and plain answers for the
// checks that are not built yet. Nothing is animated and no clearance result is invented.
import type { Project } from "@replay-world/contracts";
import { useMemo, useState } from "react";
import { answer, type CheckAnswer, QUESTIONS } from "../drawing/checks";
import { compareWithDrawing, summary } from "../drawing/compare";
import { describeRef, drawingSource, drawnFrom, scalePhrase } from "../drawing/world";
import type { DrawingObject } from "@replay-world/contracts";
import type { ReviewCorrection } from "../drawing/review";
import { DrawingPlan } from "./DrawingPlan";
import { DrawingReview } from "./DrawingReview";

export type DrawingView = "review" | "drawing" | "compare";

interface Props {
  project: Project;
  selectedId: string | null;
  view: DrawingView;
  open: boolean;
  underlay: boolean;
  onView: (view: DrawingView) => void;
  onOpen: (open: boolean) => void;
  onUnderlay: (shown: boolean) => void;
  onSelect: (id: string) => void;
  onWalk: () => void;
  /** Source files the API reported missing when the project was opened. */
  missingFiles: readonly string[];
  /** A drawn object focused in the review without a scene object. */
  focus: string | null;
  onReview: (correction: ReviewCorrection) => string | null;
  onDrawn: (drawn: DrawingObject) => void;
}

export function SourceDrawing({ project, selectedId, view, open, underlay, onView, onOpen, onUnderlay, onSelect, onWalk, missingFiles, focus, onReview, onDrawn }: Props) {
  const source = drawingSource(project);
  const comparison = useMemo(() => compareWithDrawing(project), [project]);
  const [asked, setAsked] = useState<CheckAnswer | null>(null);
  if (!source || !comparison) return null;
  const drawing = source.drawing;
  const moved = new Set(comparison.changes.filter((c) => c.status === "changed" && c.what.some((w) => w.startsWith("moved") || w.startsWith("turned"))).map((c) => c.objectId));
  const link = selectedId ? drawnFrom(project, selectedId) : null;
  const unit = scalePhrase(drawing.review.scale);
  const statuses = new Map(drawing.review.objects.map((o) => [o.drawn_id, o.status]));
  const changed = comparison.changes.filter((c) => c.status !== "unchanged");
  const missing = missingFiles.includes(drawing.file.uri);

  return (
    <section className={`source-drawing${open ? " open" : ""}${view !== "drawing" && open ? " wide" : ""}`} aria-label="Source drawing" data-testid="source-drawing">
      <div className="source-drawing-head">
        <button type="button" className="source-photo-toggle" aria-expanded={open} data-testid="source-drawing-toggle" onClick={() => onOpen(!open)}>
          {open ? "Hide" : `Drawing: ${source.filename}`}
        </button>
        {open && (
          <div className="segmented" role="tablist" aria-label="Drawing view">
            <button type="button" role="tab" aria-selected={view === "review"} data-testid="drawing-tab-review" onClick={() => onView("review")}>
              Review
            </button>
            <button type="button" role="tab" aria-selected={view === "drawing"} data-testid="drawing-tab-drawing" onClick={() => onView("drawing")}>
              Drawing
            </button>
            <button type="button" role="tab" aria-selected={view === "compare"} data-testid="drawing-tab-compare" onClick={() => onView("compare")}>
              Compare
            </button>
          </div>
        )}
      </div>
      {open && view === "review" && <DrawingReview project={project} source={source} selectedId={selectedId} focus={focus} onReview={onReview} onDrawn={onDrawn} />}
      {open && view === "drawing" && (
        <div className="source-drawing-body">
          <div className="drawing-plan-frame small-plan">
            <DrawingPlan drawing={drawing} statuses={statuses} selectedId={selectedId} onSelect={onSelect} labels="selected" testId="source-plan" title={`Plan of ${source.filename}`} />
          </div>
          <p className="source-photo-caption">
            {source.filename} · {unit} · click an outline to select it
            {missing && " · the original file is not in this computer's source library; the reading kept in the project is shown"}
          </p>
          {link && (
            <p className="source-drawing-link" data-testid="source-drawing-link">
              <strong>{link.drawn.label}</strong> comes from {describeRef(link.drawn.refs[0]!)}.
            </p>
          )}
          <label className="check-row small">
            <input type="checkbox" checked={underlay} data-testid="drawing-underlay" onChange={(e) => onUnderlay(e.target.checked)} /> Show the drawing on the 3D floor
          </label>
        </div>
      )}
      {open && view === "compare" && (
        <div className="source-drawing-body" data-testid="drawing-compare">
          <p className="compare-summary" data-testid="compare-summary">
            <strong>Compared with {source.filename}:</strong> {summary(comparison.counts)}
          </p>
          <div className="compare-plans">
            <figure>
              <figcaption>As drawn</figcaption>
              <div className="drawing-plan-frame">
                <DrawingPlan drawing={drawing} statuses={statuses} selectedId={selectedId} onSelect={onSelect} labels="selected" testId="compare-before" title="The layout as drawn" />
              </div>
            </figure>
            <figure>
              <figcaption>Now</figcaption>
              <div className="drawing-plan-frame">
                <DrawingPlan
                  drawing={drawing}
                  statuses={statuses}
                  now={{ project, source, moved }}
                  selectedId={selectedId}
                  onSelect={onSelect}
                  labels="selected"
                  testId="compare-after"
                  title="The layout now, with moved objects where they are and dashed where they were"
                />
              </div>
            </figure>
          </div>
          {changed.length === 0 ? (
            <p className="muted small" data-testid="compare-none">
              Nothing has changed yet. Select an object and drag it with the Move tool, then come back here.
            </p>
          ) : (
            <ul className="compare-changes" data-testid="compare-changes">
              {changed.map((c) => (
                <li key={c.objectId} data-testid={`compare-change-${c.objectId}`} data-status={c.status}>
                  {c.after ? (
                    <button type="button" className="link-button" onClick={() => onSelect(c.objectId)}>
                      {c.label}
                    </button>
                  ) : (
                    <span>{c.label}</span>
                  )}{" "}
                  {c.what.join(", ")}
                </li>
              ))}
            </ul>
          )}
          <div className="compare-actions">
            <button type="button" className="button button-primary" data-testid="compare-walk" onClick={onWalk}>
              Walk through it
            </button>
            <span className="muted small">W A S D to walk, drag to look; the drawing stays on the floor.</span>
          </div>
          <div className="not-yet" data-testid="not-available">
            <p>
              <strong>Not available yet:</strong> route, process and physical checks. Nothing is animated and no clearance or capacity result is shown.
            </p>
            <details data-testid="check-questions">
              <summary>Ask about a check…</summary>
              <div className="not-yet-questions">
                {QUESTIONS.map((q) => (
                  <button key={q.id} type="button" className="button button-small" data-testid={`check-${q.id}`} onClick={() => setAsked(answer(project, q.id))}>
                    {q.label}
                  </button>
                ))}
              </div>
            </details>
            {asked && (
              <div className={`check-answer check-${asked.status}`} role="status" data-testid="check-answer" data-status={asked.status}>
                <strong>{asked.title}.</strong> {asked.message}
                {asked.needs.length > 0 && (
                  <p className="small">
                    Needs a height:{" "}
                    {asked.needs.slice(0, 6).map((n, i) => (
                      <span key={n.id}>
                        {i > 0 && ", "}
                        <button type="button" className="link-button" onClick={() => onSelect(n.id)}>
                          {n.name}
                        </button>
                      </span>
                    ))}
                    {asked.needs.length > 6 && ` and ${asked.needs.length - 6} more`}.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
