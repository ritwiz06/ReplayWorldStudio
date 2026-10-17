// The short, plain review of a draft from a drawing (IMP-02): is this the floor, is this the
// right scale, are these the right objects, and what the drawing leaves out. Every answer is
// one editor command (undoable); position, rotation and size stay with the editor's handles.
import type { DrawingObject, PlanPoint, Project } from "@replay-world/contracts";
import { type KeyboardEvent, useMemo, useState } from "react";
import { drawingReasons } from "../drawing/readiness";
import { floorSizeAt, previewReference, type ReviewCorrection, reviewItems, unitChoice } from "../drawing/review";
import { describeRef, type DrawingSource, drawnFrom, formatScale, type ObjectKind, type Reviewed, statusOf, UNIT_NAME, UNITS } from "../drawing/world";
import { DrawingPlan } from "./DrawingPlan";

interface Props {
  project: Project;
  source: DrawingSource;
  selectedId: string | null;
  /** A drawn object focused without a scene object (marked not an object). */
  focus: string | null;
  /** Apply a correction; returns why it was refused, or null. */
  onReview: (correction: ReviewCorrection) => string | null;
  onDrawn: (drawn: DrawingObject) => void;
}

const STATUS_WORDS: Record<Reviewed, string> = {
  proposed: "not checked yet",
  accepted: "accepted",
  corrected: "corrected",
  not_an_object: "not an object",
  used_as_floor: "the floor",
};

const KINDS: readonly { kind: ObjectKind | "none"; label: string }[] = [
  { kind: "equipment", label: "Equipment" },
  { kind: "structure", label: "Structure (column or wall)" },
  { kind: "walkway", label: "Floor marking: walkway" },
  { kind: "keep_clear", label: "Floor marking: keep clear" },
  { kind: "none", label: "Not an object" },
];

export function DrawingReview({ project, source, selectedId, focus, onReview, onDrawn }: Props) {
  const [mode, setMode] = useState<"select" | "floor" | "measure">("select");
  const [marks, setMarks] = useState<PlanPoint[]>([]);
  const [length, setLength] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const review = source.drawing.review;
  const statuses = useMemo(() => new Map(review.objects.map((o) => [o.drawn_id, o.status])), [review.objects]);
  const items = reviewItems(source);
  const item = (id: string) => items.find((i) => i.id === id)!;
  const reasons = drawingReasons(source);
  const unchecked = review.objects.filter((o) => o.status === "proposed").length;
  const approximate = source.drawing.objects
    .filter((d) => d.footprint_fit === "enclosing" && project.scene.objects.some((o) => o.id === d.object_id && o.dimensions.width.origin === "drawn"))
    .map((d) => project.scene.objects.find((o) => o.id === d.object_id)!.name);
  const realLength = Number(length);
  const preview = marks.length === 2 && realLength > 0 ? previewReference(source, marks[0]!, marks[1]!, realLength) : null;

  function apply(correction: ReviewCorrection) {
    const refused = onReview(correction);
    setProblem(refused);
    if (!refused) {
      setMode("select");
      setMarks([]);
      setLength("");
    }
  }

  function picked(drawn: DrawingObject) {
    if (mode === "floor") apply({ kind: "floor", to: drawn.id });
    else onDrawn(drawn);
  }

  const link = selectedId ? drawnFrom(project, selectedId) : null;
  const focused = link && link.status !== "used_as_floor" ? link.drawn : focus ? (source.drawing.objects.find((o) => o.id === focus) ?? null) : null;
  const isFloorSelected = link?.status === "used_as_floor" || (selectedId !== null && selectedId === review.floor.object_id);
  const proposedNames = review.objects
    .filter((o) => o.status === "proposed")
    .map((o) => source.drawing.objects.find((d) => d.id === o.drawn_id)!)
    .slice(0, 8);

  return (
    <div className="source-drawing-body review-panel" data-testid="drawing-review">
      <p className={`review-ready ${reasons.length === 0 && unchecked === 0 ? "ready" : ""}`} data-testid="review-ready">
        {reasons.length === 0 && unchecked === 0
          ? `Reviewed: a check can now give a design-layout result for this drawing (not the site as built).${
              approximate.length > 0
                ? ` Except ${approximate.join(", ")}: ${approximate.length === 1 ? "its box only encloses" : "their boxes only enclose"} the drawn shape, so enter ${approximate.length === 1 ? "its" : "their"} size to use ${approximate.length === 1 ? "it" : "them"}.`
                : ""
            }`
          : `Before any check: ${[...reasons, ...(unchecked > 0 ? [`${unchecked} object${unchecked === 1 ? "" : "s"} not checked yet`] : [])].join("; ")}.`}
      </p>
      <div className="drawing-plan-frame review-plan">
        <DrawingPlan
          drawing={source.drawing}
          statuses={statuses}
          mode={mode}
          onDrawn={picked}
          selectedId={selectedId}
          focusDrawnId={focused?.id ?? null}
          labels="selected"
          testId="review-plan"
          title={`Plan of ${source.filename} for the review`}
          metresPerUnit={review.scale.metres_per_unit}
          onPoint={(p) => setMarks((m) => (m.length >= 2 ? [p] : [...m, p]))}
          marks={marks}
        />
      </div>
      {mode === "floor" && (
        <p className="review-hint" data-testid="review-hint">
          Click the outline that is the floor.{" "}
          <button type="button" className="link-button" onClick={() => setMode("select")}>
            Cancel
          </button>
        </p>
      )}
      {problem && (
        <p className="status-error" role="alert">
          {problem}
        </p>
      )}
      <ol className="review-items">
        <li className={item("floor").done ? "done" : "todo"} data-testid="review-floor">
          <strong>{item("floor").title}</strong> <span className="muted">{item("floor").detail}</span>
          <div className="review-actions">
            {review.floor.status === "proposed" && (
              <button type="button" className="button button-small" data-testid="review-floor-accept" onClick={() => apply({ kind: "accept_floor" })}>
                Looks right
              </button>
            )}
            <button type="button" className="button button-small" aria-pressed={mode === "floor"} data-testid="review-floor-pick" onClick={() => setMode(mode === "floor" ? "select" : "floor")}>
              Use another outline
            </button>
            {review.floor.choice !== "automatic" && (
              <button type="button" className="button button-small" data-testid="review-floor-auto" onClick={() => apply({ kind: "floor", to: "automatic" })}>
                Size it around the objects
              </button>
            )}
          </div>
        </li>

        <li className={item("scale").done ? "done" : "todo"} data-testid="review-scale">
          <strong>{item("scale").title}</strong> <span className="muted">{item("scale").detail}</span>
          <div className="review-actions">
            {review.scale.status === "unchecked" && (
              <button type="button" className="button button-small" data-testid="review-scale-accept" onClick={() => apply({ kind: "unit", unit: review.scale.unit })}>
                Looks right
              </button>
            )}
            <label className="small">
              Unit{" "}
              <select
                data-testid="review-unit"
                value={review.scale.basis === "reference_length" ? "" : review.scale.unit}
                onChange={(e) => e.target.value && apply({ kind: "unit", unit: e.target.value as (typeof UNITS)[number] })}
              >
                {review.scale.basis === "reference_length" && <option value="">from your known length</option>}
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {unitChoice(source, u)}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="button button-small" aria-pressed={mode === "measure"} data-testid="review-measure" onClick={() => (setMode(mode === "measure" ? "select" : "measure"), setMarks([]))}>
              Measure a known length
            </button>
          </div>
          {mode === "measure" && (
            <div className="review-measure" data-testid="review-measure-panel">
              <p className="small">
                {marks.length < 2 ? `Click ${marks.length === 0 ? "two points" : "a second point"} on the plan whose real distance you know (they snap to corners and centres).` : "Now type the real distance between the two points."}
              </p>
              <label className="small">
                Real length{" "}
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={length}
                  data-testid="review-length"
                  onChange={(e) => setLength(e.target.value)}
                  onKeyDown={(e: KeyboardEvent) => e.stopPropagation()}
                />{" "}
                m
              </label>
              {preview && (
                <div className={`review-preview ${preview.agrees ? "agrees" : "conflict"}`} data-testid="review-preview" data-agrees={preview.agrees}>
                  {preview.agrees ? (
                    <p>
                      Your {realLength.toFixed(2)} m gives 1 unit = {formatScale(preview.metresPerUnit)}: it agrees with {UNIT_NAME[review.scale.unit]} (
                      {(preview.difference * 100).toFixed(1)} % apart).
                    </p>
                  ) : (
                    <p>
                      Your {realLength.toFixed(2)} m gives 1 unit = {formatScale(preview.metresPerUnit)}, but {review.scale.basis === "drawing_unit" ? "the drawing says" : "the unit in use is"} 1 unit = 1{" "}
                      {review.scale.unit}. With your measurement the floor is {floorSizeAt(source, preview.metresPerUnit)}; with {UNIT_NAME[review.scale.unit]} it is{" "}
                      {floorSizeAt(source, preview.unitMetresPerUnit)}. Which is right?
                    </p>
                  )}
                  <div className="review-actions">
                    {preview.agrees ? (
                      <button type="button" className="button button-small button-primary" data-testid="review-reference-unit" onClick={() => apply({ kind: "reference", a: marks[0]!, b: marks[1]!, realLengthM: realLength, use: "unit" })}>
                        Mark the scale as checked
                      </button>
                    ) : (
                      <>
                        <button type="button" className="button button-small button-primary" data-testid="review-reference-use" onClick={() => apply({ kind: "reference", a: marks[0]!, b: marks[1]!, realLengthM: realLength, use: "reference" })}>
                          Use my measurement
                        </button>
                        <button type="button" className="button button-small" data-testid="review-reference-unit" onClick={() => apply({ kind: "reference", a: marks[0]!, b: marks[1]!, realLengthM: realLength, use: "unit" })}>
                          Keep 1 unit = 1 {review.scale.unit}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </li>

        <li className={item("objects").done ? "done" : "todo"} data-testid="review-objects">
          <strong>{item("objects").title}</strong> <span className="muted">{item("objects").detail}</span>
          {isFloorSelected ? (
            <p className="small muted">The floor is selected: change it above.</p>
          ) : focused ? (
            <ObjectCard
              key={`${focused.id}:${project.scene.objects.find((o) => o.id === focused.object_id)?.name ?? ""}`}
              project={project}
              source={source}
              drawn={focused}
              apply={apply}
            />
          ) : (
            <p className="small muted">Click an object on the plan or in the 3D view to check its name and kind.</p>
          )}
          {proposedNames.length > 0 && (
            <p className="small review-todo">
              Not checked yet:{" "}
              {proposedNames.map((d, i) => (
                <span key={d.id}>
                  {i > 0 && ", "}
                  <button type="button" className="link-button" onClick={() => onDrawn(d)}>
                    {project.scene.objects.find((o) => o.id === d.object_id)?.name ?? d.label}
                  </button>
                </span>
              ))}
              {unchecked > proposedNames.length && ` and ${unchecked - proposedNames.length} more`}
            </p>
          )}
          {unchecked > 0 && (
            <div className="review-actions">
              <button type="button" className="button button-small" data-testid="review-accept-remaining" onClick={() => apply({ kind: "accept_remaining" })}>
                Accept the remaining {unchecked} as drawn
              </button>
            </div>
          )}
        </li>

        <li className={item("omissions").done ? "done" : "todo"} data-testid="review-omissions">
          <strong>{item("omissions").title}</strong> <span className="muted">{item("omissions").detail}</span>
          {review.omissions !== "accepted" && (
            <div className="review-actions">
              <button type="button" className="button button-small" data-testid="review-omissions-accept" onClick={() => apply({ kind: "accept_omissions" })}>
                I understand
              </button>
            </div>
          )}
        </li>
      </ol>
    </div>
  );
}

function ObjectCard({ project, source, drawn, apply }: { project: Project; source: DrawingSource; drawn: DrawingObject; apply: (c: ReviewCorrection) => void }) {
  const status = statusOf(source, drawn.id);
  const live = project.scene.objects.find((o) => o.id === drawn.object_id) ?? null;
  const [name, setName] = useState(live?.name ?? drawn.label);
  const kind = live?.kind ?? "none";
  const rename = () => {
    if (live && name.trim() && name.trim() !== live.name) apply({ kind: "object", drawnId: drawn.id, action: "correct", name: name.trim() });
  };
  return (
    <div className="review-object" data-testid="review-object">
      <p className="small">
        <strong>{live?.name ?? drawn.label}</strong> · {STATUS_WORDS[status]} · from {describeRef(drawn.refs[0]!)}
        {drawn.footprint_fit === "enclosing" && " · its box only encloses the drawn shape"}
      </p>
      {live && (
        <label className="small review-name">
          Name{" "}
          <input
            value={name}
            data-testid="review-name"
            onChange={(e) => setName(e.target.value)}
            onBlur={rename}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") rename();
            }}
          />
        </label>
      )}
      <fieldset className="review-kinds" data-testid="review-kinds">
        <legend className="small">What is it?</legend>
        {KINDS.map((k) => (
          <label key={k.kind} className="small">
            <input
              type="radio"
              name={`kind-${drawn.id}`}
              checked={kind === k.kind}
              data-testid={`review-kind-${k.kind}`}
              onChange={() =>
                apply(
                  k.kind === "none"
                    ? { kind: "object", drawnId: drawn.id, action: "not_an_object" }
                    : live
                      ? { kind: "object", drawnId: drawn.id, action: "correct", objectKind: k.kind }
                      : { kind: "object", drawnId: drawn.id, action: "make_object", objectKind: k.kind },
                )
              }
            />{" "}
            {k.label}
          </label>
        ))}
      </fieldset>
      {status === "proposed" && live && (
        <button type="button" className="button button-small" data-testid="review-object-accept" onClick={() => apply({ kind: "object", drawnId: drawn.id, action: "accept" })}>
          Looks right
        </button>
      )}
    </div>
  );
}
