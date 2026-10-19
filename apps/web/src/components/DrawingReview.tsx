// The short, plain review of a draft from a drawing (IMP-02): is this the floor, is this the
// right scale, are these the right objects, and what the drawing leaves out. Every answer is
// one editor command (undoable); position, rotation and size stay with the editor's handles.
// On a plan picture (IMP-03) the person also traces the floor and object outlines (zooming in
// to place corners precisely) and adds objects the proposal missed.
import type { DrawingObject, PlanPoint, Project } from "@replay-world/contracts";
import { type KeyboardEvent, useMemo, useState } from "react";
import { drawingReasons } from "../drawing/readiness";
import { floorSizeAt, previewReference, type ReviewCorrection, reviewItems, unitChoice } from "../drawing/review";
import { describeRef, type DrawingSource, drawnFrom, formatLength, formatScale, isPlanImage, type ObjectKind, type Reviewed, statusOf, UNIT_NAME, UNITS } from "../drawing/world";
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
  added: "added by you",
};

type Mode = "select" | "floor" | "measure" | "trace" | "trace_floor" | "add";
const ZOOMS = [1, 2, 4] as const;
type Zoom = (typeof ZOOMS)[number];
/** The zoom chosen for each plan, kept while the app is open (the panel remounts on tab changes). */
const zooms = new Map<string, Zoom>();

const KINDS: readonly { kind: ObjectKind | "none"; label: string }[] = [
  { kind: "equipment", label: "Equipment" },
  { kind: "structure", label: "Structure (column or wall)" },
  { kind: "walkway", label: "Floor marking: walkway" },
  { kind: "keep_clear", label: "Floor marking: keep clear" },
  { kind: "none", label: "Not an object" },
];

export function DrawingReview({ project, source, selectedId, focus, onReview, onDrawn }: Props) {
  const [mode, setModeState] = useState<Mode>("select");
  const [marks, setMarks] = useState<PlanPoint[]>([]);
  const [precision, setPrecision] = useState(0);
  const [traceTarget, setTraceTarget] = useState<string | null>(null);
  const [zoom, setZoomState] = useState<Zoom>(() => zooms.get(source.id) ?? 1);
  const setZoom = (z: Zoom) => {
    zooms.set(source.id, z);
    setZoomState(z);
  };
  const picture = isPlanImage(source.drawing);
  const setMode = (next: Mode) => {
    setModeState(next);
    setMarks([]);
    setPrecision(0);
  };
  const [length, setLength] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const review = source.drawing.review;
  const statuses = useMemo(() => new Map(review.objects.map((o) => [o.drawn_id, o.status])), [review.objects]);
  const items = reviewItems(source);
  const item = (id: string) => items.find((i) => i.id === id)!;
  const reasons = drawingReasons(source);
  const unchecked = review.objects.filter((o) => o.status === "proposed").length;
  // Layers with loose lines or left-out shapes, and how many: the person may mark them as symbols.
  const looseLayers = useMemo(() => {
    const counts = new Map<string, number>();
    const add = (layer: string, n = 1) => counts.set(layer, (counts.get(layer) ?? 0) + n);
    for (const line of source.drawing.lines) if (!line.closed && line.ref.block === null) add(line.ref.layer);
    for (const shape of source.drawing.omitted ?? []) add(shape.layer);
    if (source.drawing.omitted === null) for (const skip of source.drawing.skipped) if (skip.layout) add(skip.layer, skip.count);
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([layer, n]) => [layer, `${n} item${n === 1 ? "" : "s"}`] as const);
  }, [source.drawing]);
  const approximate = source.drawing.objects
    .filter((d) => d.footprint_fit === "enclosing" && project.scene.objects.some((o) => o.id === d.object_id && o.dimensions.width.origin === "drawn"))
    .map((d) => project.scene.objects.find((o) => o.id === d.object_id)!.name);
  const proposedOnly = source.drawing.objects.filter((d) => d.footprint_fit === "approximate" && d.role !== "floor" && project.scene.objects.some((o) => o.id === d.object_id)).length;
  const realLength = Number(length);
  const preview = marks.length === 2 && realLength > 0 ? previewReference(source, marks[0]!, marks[1]!, realLength) : null;

  function apply(correction: ReviewCorrection) {
    const refused = onReview(correction);
    setProblem(refused);
    if (!refused) {
      setMode("select");
      setLength("");
    }
  }

  /** A click on the plan: a known length's two points, or the next corner of an outline. */
  function point(p: PlanPoint, tolerance: number) {
    const next = mode === "measure" && marks.length >= 2 ? [p] : [...marks, p];
    const worst = Math.max(mode === "measure" && marks.length >= 2 ? 0 : precision, tolerance);
    setMarks(next);
    setPrecision(worst);
    if ((mode === "trace" || mode === "add") && next.length === 3) {
      apply({ kind: "trace", drawnId: mode === "trace" ? traceTarget : null, corners: [next[0]!, next[1]!, next[2]!], tolerance: worst });
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
          ? `Reviewed: a check can now give a design-layout result for this ${picture ? "plan" : "drawing"} (not the site as built).${
              proposedOnly > 0 ? ` ${proposedOnly} outline${proposedOnly === 1 ? " is" : "s are"} only proposed: trace the ones a check depends on.` : ""
            }${
              approximate.length > 0
                ? ` Except ${approximate.join(", ")}: ${approximate.length === 1 ? "its box only encloses" : "their boxes only enclose"} the drawn shape, so enter ${approximate.length === 1 ? "its" : "their"} size to use ${approximate.length === 1 ? "it" : "them"}.`
                : ""
            }`
          : `Before any check: ${[...reasons, ...(unchecked > 0 ? [`${unchecked} object${unchecked === 1 ? "" : "s"} not checked yet`] : [])].join("; ")}.`}
      </p>
      {picture && (
        <div className="review-zoom" role="group" aria-label="Plan zoom">
          <span className="small muted">Zoom</span>
          {ZOOMS.map((z) => (
            <button key={z} type="button" className="button button-small" aria-pressed={zoom === z} data-testid={`review-zoom-${z}`} onClick={() => setZoom(z)}>
              {z}×
            </button>
          ))}
          <span className="small muted">Zoom in to place corners precisely; scroll to move around.</span>
        </div>
      )}
      <div className={`drawing-plan-frame review-plan${zoom > 1 ? " zoomed" : ""}`} data-testid="review-plan-frame">
        <div className="review-plan-inner" style={zoom > 1 ? { width: `${zoom * 100}%`, height: `${zoom * 100}%` } : undefined}>
        <DrawingPlan
          drawing={source.drawing}
          statuses={statuses}
          mode={mode === "select" || mode === "floor" ? mode : picture ? "point" : "measure"}
          tracing={mode === "trace" || mode === "add" || mode === "trace_floor"}
          onDrawn={picked}
          selectedId={selectedId}
          focusDrawnId={focused?.id ?? null}
          labels="selected"
          testId="review-plan"
          title={`Plan of ${source.filename} for the review`}
          metresPerUnit={review.scale.metres_per_unit}
          onPoint={point}
          marks={marks}
        />
        </div>
      </div>
      {mode === "floor" && (
        <p className="review-hint" data-testid="review-hint">
          Click the outline that is the floor.{" "}
          <button type="button" className="link-button" onClick={() => setMode("select")}>
            Cancel
          </button>
        </p>
      )}
      {(mode === "trace" || mode === "add") && (
        <p className="review-hint" data-testid="review-hint">
          {mode === "add" ? "Add a missed object: click" : "Trace the outline: click"} three of its corners in turn ({marks.length} of 3)
          {precision > 0 && `; each is within about ${formatLength(precision * review.scale.metres_per_unit)} at this zoom`}.{" "}
          <button type="button" className="link-button" onClick={() => setMode("select")}>
            Cancel
          </button>
        </p>
      )}
      {mode === "trace_floor" && (
        <p className="review-hint" data-testid="review-hint">
          Click each corner of the floor in turn{picture ? "" : ", for example the outside corners of the walls (clicks snap to the drawing's corners)"} ({marks.length} so far
          {precision > 0 && `, each within about ${formatLength(precision * review.scale.metres_per_unit)}`}).{" "}
          <button type="button" className="button button-small" disabled={marks.length < 3} data-testid="review-floor-finish" onClick={() => apply({ kind: "trace_floor", outline: marks, tolerance: precision })}>
            Finish the floor
          </button>{" "}
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
            <button type="button" className="button button-small" aria-pressed={mode === "trace_floor"} data-testid="review-floor-trace" onClick={() => setMode(mode === "trace_floor" ? "select" : "trace_floor")}>
              Trace the floor
            </button>
            {!picture && (
              <button type="button" className="button button-small" aria-pressed={mode === "floor"} data-testid="review-floor-pick" onClick={() => setMode(mode === "floor" ? "select" : "floor")}>
                Use another outline
              </button>
            )}
            {!picture && review.floor.choice !== "automatic" && (
              <button type="button" className="button button-small" data-testid="review-floor-auto" onClick={() => apply({ kind: "floor", to: "automatic" })}>
                Size it around the objects
              </button>
            )}
          </div>
        </li>

        <li className={item("scale").done ? "done" : "todo"} data-testid="review-scale">
          <strong>{item("scale").title}</strong> <span className="muted">{item("scale").detail}</span>
          <div className="review-actions">
            {review.scale.status === "unchecked" && review.scale.unit !== "px" && (
              <button type="button" className="button button-small" data-testid="review-scale-accept" onClick={() => apply({ kind: "unit", unit: review.scale.unit as (typeof UNITS)[number] })}>
                Looks right
              </button>
            )}
            {!picture && (
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
            )}
            <button type="button" className="button button-small" aria-pressed={mode === "measure"} data-testid="review-measure" onClick={() => (setMode(mode === "measure" ? "select" : "measure"), setMarks([]))}>
              Measure a known length
            </button>
          </div>
          {mode === "measure" && (
            <div className="review-measure" data-testid="review-measure-panel">
              <p className="small">
                {marks.length < 2
                  ? `Click ${marks.length === 0 ? "two points" : "a second point"} on the plan whose real distance you know${picture ? " (zoom in to place them precisely)" : " (they snap to corners and centres)"}.`
                  : "Now type the real distance between the two points."}
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
              {preview && preview.agrees === null && (
                <div className="review-preview agrees" data-testid="review-preview">
                  <p>
                    Your {realLength.toFixed(2)} m gives 1 px = {formatScale(preview.metresPerUnit)}: the floor is {floorSizeAt(source, preview.metresPerUnit)}, and the scale is good to about{" "}
                    {((2 * precision) / preview.drawingLength * 100).toFixed(1)} % (the two points are each within {formatLength(precision * preview.metresPerUnit)}).
                  </p>
                  <div className="review-actions">
                    <button type="button" className="button button-small button-primary" data-testid="review-reference-use" onClick={() => apply({ kind: "reference", a: marks[0]!, b: marks[1]!, realLengthM: realLength, use: "reference", tolerance: precision })}>
                      Use my measurement
                    </button>
                  </div>
                </div>
              )}
              {preview && preview.agrees !== null && (
                <div className={`review-preview ${preview.agrees ? "agrees" : "conflict"}`} data-testid="review-preview" data-agrees={preview.agrees}>
                  {preview.agrees ? (
                    <p>
                      Your {realLength.toFixed(2)} m gives 1 unit = {formatScale(preview.metresPerUnit)}: it agrees with {UNIT_NAME[review.scale.unit as (typeof UNITS)[number]]} (
                      {((preview.difference ?? 0) * 100).toFixed(1)} % apart).
                    </p>
                  ) : (
                    <p>
                      Your {realLength.toFixed(2)} m gives 1 unit = {formatScale(preview.metresPerUnit)}, but {review.scale.basis === "drawing_unit" ? "the drawing says" : "the unit in use is"} 1 unit = 1{" "}
                      {review.scale.unit}. With your measurement the floor is {floorSizeAt(source, preview.metresPerUnit)}; with {UNIT_NAME[review.scale.unit as (typeof UNITS)[number]]} it is{" "}
                      {floorSizeAt(source, preview.unitMetresPerUnit ?? preview.metresPerUnit)}. Which is right?
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
              tracing={mode === "trace" && traceTarget === focused.id}
              onTrace={
                picture
                  ? () => {
                      setMode(mode === "trace" && traceTarget === focused.id ? "select" : "trace");
                      setTraceTarget(focused.id);
                    }
                  : null
              }
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
          <div className="review-actions">
            {unchecked > 0 && (
              <button type="button" className="button button-small" data-testid="review-accept-remaining" onClick={() => apply({ kind: "accept_remaining" })}>
                Accept the remaining {unchecked} as {picture ? "proposed" : "drawn"}
              </button>
            )}
            {picture && (
              <button type="button" className="button button-small" aria-pressed={mode === "add"} data-testid="review-add-object" onClick={() => setMode(mode === "add" ? "select" : "add")}>
                Add a missed object
              </button>
            )}
          </div>
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
          {looseLayers.length > 0 && (
            <div className="review-symbols" data-testid="review-symbols">
              <p className="small muted">
                Loose lines and shapes left out count as possible obstacles in Check layout and Run a day, so a route past them “cannot be determined”. If a layer only holds drawing
                symbols, say so:
              </p>
              {looseLayers.map(([layer, count]) => (
                <label key={layer} className="check-row small">
                  <input
                    type="checkbox"
                    checked={review.symbol_layers.includes(layer)}
                    data-testid={`review-symbols-${layer}`}
                    onChange={(e) => apply({ kind: "symbols", layer, symbols: e.target.checked })}
                  />{" "}
                  <strong>{layer}</strong> ({count}): drawing symbols (door swings, wall fill, notes), not things on the floor
                </label>
              ))}
            </div>
          )}
        </li>
      </ol>
    </div>
  );
}

function ObjectCard({
  project,
  source,
  drawn,
  apply,
  tracing,
  onTrace,
}: {
  project: Project;
  source: DrawingSource;
  drawn: DrawingObject;
  apply: (c: ReviewCorrection) => void;
  tracing: boolean;
  onTrace: (() => void) | null;
}) {
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
        {drawn.footprint_fit === "approximate" && " · outline only proposed (approximate)"}
        {drawn.tolerance !== null && ` · traced to within ${formatLength(drawn.tolerance * source.drawing.review.scale.metres_per_unit)}`}
      </p>
      {onTrace && (
        <button type="button" className="button button-small" aria-pressed={tracing} data-testid="review-trace" onClick={onTrace}>
          {drawn.tolerance !== null ? "Trace it again" : "Trace its outline"}
        </button>
      )}
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
