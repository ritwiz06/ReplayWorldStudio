// The drawing as a plan (ONB-01): its lines, texts and the objects drawn from it, in drawing
// units with +Y up. Optionally the current arrangement over it: an object moved since the
// import is drawn where it is now, with a dashed outline where the drawing has it. For the
// review (IMP-02) it shows each outline's review status, lets the person pick an outline as
// the floor, and marks two points (snapped to the drawing's corners and centres) for a known
// length. For the layout checks (GEO-01/02) it highlights the objects a finding names, the
// overlapping areas, a route and its narrowest passage, and lets the person pick route points.
// A plan picture (IMP-03) is shown under its outlines; outlines only proposed from it are drawn
// dashed, and points clicked on it are never snapped (each comes with how precisely it was
// marked: two screen pixels at the zoom it was clicked at).
import type { DrawingImport, DrawingObject, PlanPoint, Project } from "@replay-world/contracts";
import { type KeyboardEvent, type MouseEvent, useMemo } from "react";
import { API_BASE_URL } from "../config";
import { type DrawingSource, footprintOnPlan, isPlanImage, type Reviewed } from "../drawing/world";

interface Props {
  drawing: DrawingImport;
  /** Show the project's current arrangement (needs the project and its drawing source). */
  now?: { project: Project; source: DrawingSource; moved: ReadonlySet<string> } | undefined;
  selectedId?: string | null | undefined;
  onSelect?: ((objectId: string) => void) | undefined;
  /** Name every object, or only the selected one (small panels). */
  labels: "all" | "selected";
  /** Metres per drawing unit, once known: draws a scale bar. */
  metresPerUnit?: number | null | undefined;
  testId: string;
  title: string;
  /** The review's status per drawn object (decides which outline is the floor). */
  statuses?: ReadonlyMap<string, Reviewed> | undefined;
  /** "floor": every outline can be picked; "measure": clicks mark points (snapped); "point":
   * clicks mark points where they are. */
  mode?: "select" | "floor" | "measure" | "point" | undefined;
  /** Called with the drawn object clicked (instead of `onSelect`) when given. */
  onDrawn?: ((drawn: DrawingObject) => void) | undefined;
  /** A drawn object focused in the review that has no scene object. */
  focusDrawnId?: string | null | undefined;
  /** Measure mode: a clicked point, snapped to the nearest corner or centre within 12 px (in
   * point mode, or on a plan picture, not snapped), with how precisely it was marked (drawing
   * units). */
  onPoint?: ((point: PlanPoint, tolerance: number) => void) | undefined;
  marks?: readonly PlanPoint[] | undefined;
  /** Join the marks into an outline being traced (rather than one known length). */
  tracing?: boolean | undefined;
  /** Layout check results to draw over the plan. */
  checks?: PlanChecks | undefined;
}

export type Flag = "conflict" | "uncertain";

/** What the layout and route checks show on the plan, in drawing units. */
export interface PlanChecks {
  /** Objects a finding names (by scene object ID). */
  flagged: ReadonlyMap<string, Flag>;
  regions: { points: PlanPoint[]; flag: Flag }[];
  route: { points: PlanPoint[]; outcome: "fits" | "conflict" | "cannot_determine" } | null;
  start: PlanPoint | null;
  end: PlanPoint | null;
  passage: { at: PlanPoint; label: string } | null;
  /** Objects added since the import (not in the drawing), where they are now. */
  added: { id: string; name: string; outline: PlanPoint[] }[];
}

const SNAP_PX = 12;
/** How precisely a click lands, in screen pixels: a traced point is within this of the true one. */
export const MARK_PX = 2;

const KIND_CLASS: Record<DrawingObject["kind"], string> = {
  equipment: "plan-equipment",
  structure: "plan-structure",
  reference: "plan-equipment",
  walkway: "plan-walkway",
  keep_clear: "plan-keep-clear",
};

const points = (pts: readonly { x: number; y: number }[]) => pts.map((p) => `${p.x},${-p.y}`).join(" ");

type Box = { x0: number; y0: number; x1: number; y1: number };
type Placed = { x: number; y: number; size: number; vertical: boolean };

const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const boxOf = (pts: readonly { x: number; y: number }[]): Box => ({
  x0: Math.min(...pts.map((p) => p.x)),
  y0: Math.min(...pts.map((p) => p.y)),
  x1: Math.max(...pts.map((p) => p.x)),
  y1: Math.max(...pts.map((p) => p.y)),
});

/** Where each name goes: inside its shape when it fits (turned upright for a tall, narrow one),
 * else just below or above it if that is clear of other shapes and names, else nowhere (the
 * name is still the shape's tooltip). Greedy, larger shapes first. */
function placeLabels(shapes: { id: string; text: string; outline: readonly { x: number; y: number }[] }[], font: number): Map<string, Placed> {
  const boxes = shapes.map((s) => ({ ...s, box: boxOf(s.outline) }));
  const taken: Box[] = [];
  const placed = new Map<string, Placed>();
  const textBox = (cx: number, cy: number, w: number, h: number): Box => ({ x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 });
  const order = [...boxes].sort((a, b) => (b.box.x1 - b.box.x0) * (b.box.y1 - b.box.y0) - (a.box.x1 - a.box.x0) * (a.box.y1 - a.box.y0));
  for (const shape of order) {
    const { box } = shape;
    const cx = (box.x0 + box.x1) / 2;
    const cy = (box.y0 + box.y1) / 2;
    const w = box.x1 - box.x0;
    const h = box.y1 - box.y0;
    const candidates: Placed[] = [];
    for (const size of [font, font * 0.75]) {
      const tw = shape.text.length * size * 0.56;
      if (tw <= w * 0.95 && size <= h * 0.9) candidates.push({ x: cx, y: cy, size, vertical: false });
      else if (tw <= h * 0.95 && size <= w * 0.9) candidates.push({ x: cx, y: cy, size, vertical: true });
    }
    const small = font * 0.75;
    candidates.push({ x: cx, y: box.y0 - small * 0.8, size: small, vertical: false }, { x: cx, y: box.y1 + small * 0.8, size: small, vertical: false });
    for (const c of candidates) {
      const tw = shape.text.length * c.size * 0.56;
      const tb = c.vertical ? textBox(c.x, c.y, c.size, tw) : textBox(c.x, c.y, tw, c.size);
      const inside = c.x === cx && c.y === cy;
      const clash = taken.some((t) => overlaps(t, tb)) || (!inside && boxes.some((b) => b !== shape && overlaps(b.box, tb)));
      if (!clash) {
        placed.set(shape.id, c);
        taken.push(tb);
        break;
      }
    }
  }
  return placed;
}

/** A round length for a scale bar about a quarter of the drawing's span (in metres). */
function scaleLength(spanM: number): number {
  const target = spanM / 4;
  const step = 10 ** Math.floor(Math.log10(target));
  return [1, 2, 5, 10].map((k) => k * step).filter((v) => v <= target).at(-1) ?? step;
}

export function DrawingPlan({ drawing, now, selectedId, onSelect, labels, testId, title, metresPerUnit, statuses, mode = "select", onDrawn, focusDrawnId, onPoint, marks, checks, tracing }: Props) {
  const picture = isPlanImage(drawing) ? drawing.raster : null;
  const { extent_min: lo, extent_max: hi } = drawing;
  const span = Math.max(hi.x - lo.x, hi.y - lo.y, 1e-9);
  const margin = span * 0.04;
  const font = span / 42;
  const viewBox = `${lo.x - margin} ${-(hi.y + margin)} ${hi.x - lo.x + 2 * margin} ${hi.y - lo.y + 2 * margin}`;
  const live = useMemo(() => new Map(now?.project.scene.objects.map((o) => [o.id, o]) ?? []), [now?.project]);
  const isFloor = useMemo(() => (d: DrawingObject) => (statuses ? statuses.get(d.id) === "used_as_floor" : d.role === "floor"), [statuses]);
  const objects = useMemo(() => [...drawing.objects].sort((a, b) => Number(isFloor(b)) - Number(isFloor(a))), [drawing.objects, isFloor]);
  const snapTargets = useMemo(
    () => [...drawing.lines.flatMap((l) => l.points), ...drawing.objects.map((o) => o.centre)],
    [drawing.lines, drawing.objects],
  );
  const shapes = useMemo(
    () =>
      objects
        .filter((d) => !isFloor(d) && statuses?.get(d.id) !== "not_an_object" && (labels === "all" || d.object_id === selectedId || d.id === focusDrawnId))
        .map((d) => {
          const current = now ? live.get(d.object_id) : undefined;
          const outline = current && now?.moved.has(d.object_id) ? footprintOnPlan(now.source.source_to_world, current) : d.outline;
          return { id: d.id, text: current?.name ?? d.label, outline };
        }),
    [objects, labels, selectedId, now, live, isFloor, statuses, focusDrawnId],
  );
  const placed = useMemo(() => placeLabels(shapes, font), [shapes, font]);
  const bar = metresPerUnit ? scaleLength(span * metresPerUnit) : null;

  const choose = (drawn: DrawingObject) => (onDrawn ? onDrawn(drawn) : onSelect?.(drawn.object_id));
  const onKey = (drawn: DrawingObject) => (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(drawn);
    }
  };

  function mark(e: MouseEvent<SVGSVGElement>) {
    if ((mode !== "measure" && mode !== "point") || !onPoint) return;
    const svg = e.currentTarget;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const local = pt.matrixTransform(ctm.inverse());
    const clicked = { x: Number(local.x.toFixed(2)), y: Number((-local.y).toFixed(2)) };
    const precision = Math.max(1, MARK_PX / Math.abs(ctm.a));
    if (mode === "point" || picture) return onPoint(clicked, Number(precision.toFixed(3)));
    const tolerance = SNAP_PX / Math.abs(ctm.a);
    let best: PlanPoint | null = null;
    let bestDistance = tolerance;
    for (const target of snapTargets) {
      const distance = Math.hypot(target.x - clicked.x, target.y - clicked.y);
      if (distance <= bestDistance) {
        best = target;
        bestDistance = distance;
      }
    }
    onPoint(best ? { x: best.x, y: best.y } : clicked, 0);
  }

  return (
    <svg
      className={`drawing-plan plan-mode-${mode}`}
      viewBox={viewBox}
      role="img"
      aria-label={title}
      data-testid={testId}
      preserveAspectRatio="xMidYMid meet"
      onClick={mark}
    >
      <title>{title}</title>
      {picture && (
        <image className="plan-raster" href={`${API_BASE_URL}/api/v1/sources/files/${picture.uri}`} x={0} y={-picture.height_px} width={picture.width_px} height={picture.height_px} preserveAspectRatio="none" />
      )}
      <g className={picture ? "plan-lines plan-lines-proposed" : "plan-lines"}>
        {drawing.lines.map((line, i) =>
          line.closed ? <polygon key={i} points={points(line.points)} vectorEffect="non-scaling-stroke" /> : <polyline key={i} points={points(line.points)} vectorEffect="non-scaling-stroke" />,
        )}
      </g>
      {objects.map((drawn) => {
        const floor = isFloor(drawn);
        const notObject = statuses?.get(drawn.id) === "not_an_object";
        const current = now ? live.get(drawn.object_id) : undefined;
        const moved = now?.moved.has(drawn.object_id) ?? false;
        const removed = !floor && !notObject && now !== undefined && current === undefined;
        const selected = drawn.object_id === selectedId || drawn.id === focusDrawnId;
        const shape = current && moved && now ? footprintOnPlan(now.source.source_to_world, current) : drawn.outline;
        const state = notObject ? "not-object" : removed ? "removed" : moved ? "moved" : "drawn";
        const interactive =
          mode === "floor" ? onDrawn !== undefined : mode === "select" && !floor && (onDrawn !== undefined || (!removed && !notObject && onSelect !== undefined));
        const kindClass = notObject ? "plan-not-object" : KIND_CLASS[current?.kind ?? drawn.kind];
        const approx = drawn.footprint_fit === "approximate" ? " plan-approx" : drawn.refs[0]?.entity === "TRACE" ? " plan-traced" : "";
        const flag = checks?.flagged.get(drawn.object_id);
        return (
          <g
            key={drawn.id}
            className={`plan-object ${floor ? "plan-floor" : kindClass} plan-${state}${approx}${selected ? " selected" : ""}${flag ? ` plan-flag-${flag}` : ""}`}
            data-testid={`${testId}-object-${drawn.object_id}`}
            data-drawn={drawn.id}
            data-state={floor ? "floor" : state}
            data-flag={flag}
            {...(interactive
              ? {
                  role: "button",
                  tabIndex: 0,
                  "aria-label": mode === "floor" ? `Use ${drawn.label} as the floor` : `${drawn.label} (${state === "moved" ? "moved since the drawing" : notObject ? "not an object" : "as drawn"})`,
                  onClick: (e: MouseEvent) => {
                    e.stopPropagation();
                    choose(drawn);
                  },
                  onKeyDown: onKey(drawn),
                }
              : {})}
          >
            <title>{current?.name ?? drawn.label}</title>
            {moved && <polygon className="plan-original" points={points(drawn.outline)} vectorEffect="non-scaling-stroke" />}
            <polygon points={points(shape)} vectorEffect="non-scaling-stroke" />
          </g>
        );
      })}
      {checks && <CheckLayer checks={checks} font={font} testId={testId} selectedId={selectedId} onSelect={mode === "select" ? onSelect : undefined} />}
      <g className="plan-names">
        {shapes.map((shape) => {
          const at = placed.get(shape.id);
          if (!at) return null;
          return (
            <text
              key={shape.id}
              x={at.x}
              y={-at.y}
              fontSize={at.size}
              textAnchor="middle"
              dominantBaseline="middle"
              transform={at.vertical ? `rotate(-90 ${at.x} ${-at.y})` : undefined}
            >
              {shape.text}
            </text>
          );
        })}
      </g>
      {marks && marks.length > 0 && (
        <g className="plan-marks" data-testid={`${testId}-marks`}>
          {tracing && marks.length >= 2 && <polyline points={points(marks)} vectorEffect="non-scaling-stroke" />}
          {!tracing && marks.length === 2 && <line x1={marks[0]!.x} y1={-marks[0]!.y} x2={marks[1]!.x} y2={-marks[1]!.y} vectorEffect="non-scaling-stroke" />}
          {marks.map((m, i) => (
            <circle key={i} cx={m.x} cy={-m.y} r={font * 0.35} vectorEffect="non-scaling-stroke" />
          ))}
        </g>
      )}
      {bar && metresPerUnit && (
        <g className="plan-scale" data-testid={`${testId}-scale`}>
          <line x1={lo.x} y1={-lo.y + margin * 0.55} x2={lo.x + bar / metresPerUnit} y2={-lo.y + margin * 0.55} vectorEffect="non-scaling-stroke" />
          <text x={lo.x + bar / metresPerUnit + font * 0.4} y={-lo.y + margin * 0.55} fontSize={font * 0.7} dominantBaseline="middle">
            {bar >= 1 ? `${bar} m` : `${bar * 100} cm`}
          </text>
        </g>
      )}
      {labels === "all" &&
        !picture &&
        drawing.labels
          .filter((label) => !drawing.objects.some((o) => o.role !== "floor" && o.label === label.text))
          .map((label, i) => (
            <text key={`t${i}`} className="plan-note" x={label.at.x} y={-label.at.y} fontSize={font * 0.8} textAnchor="middle">
              {label.text}
            </text>
          ))}
    </svg>
  );
}


/** The checks' highlights: added objects, overlapping areas, the route, its narrowest passage,
 * and the start and destination. Drawn over the objects; only added objects take clicks. */
function CheckLayer({ checks, font, testId, selectedId, onSelect }: { checks: PlanChecks; font: number; testId: string; selectedId: string | null | undefined; onSelect: ((id: string) => void) | undefined }) {
  return (
    <g className="plan-checks" data-testid={`${testId}-checks`}>
      {checks.added.map((a) => {
        const flag = checks.flagged.get(a.id);
        return (
          <g
            key={a.id}
            className={`plan-object plan-equipment plan-added${a.id === selectedId ? " selected" : ""}${flag ? ` plan-flag-${flag}` : ""}`}
            data-testid={`${testId}-object-${a.id}`}
            data-flag={flag}
            {...(onSelect ? { role: "button", tabIndex: 0, "aria-label": `${a.name} (added since the drawing)`, onClick: (e: MouseEvent) => {
                    e.stopPropagation();
                    onSelect(a.id);
                  },
                } : {})}
          >
            <title>{a.name}</title>
            <polygon points={points(a.outline)} vectorEffect="non-scaling-stroke" />
          </g>
        );
      })}
      {checks.regions.map((r, i) => (
        <polygon key={`r${i}`} className={`plan-region plan-region-${r.flag}`} points={points(r.points)} vectorEffect="non-scaling-stroke" />
      ))}
      {checks.route && checks.route.points.length > 1 && (
        <polyline className={`plan-route plan-route-${checks.route.outcome}`} data-testid={`${testId}-route`} data-outcome={checks.route.outcome} points={points(checks.route.points)} vectorEffect="non-scaling-stroke" />
      )}
      {checks.passage && (
        <g className="plan-passage" data-testid={`${testId}-passage`}>
          <circle cx={checks.passage.at.x} cy={-checks.passage.at.y} r={font * 0.45} vectorEffect="non-scaling-stroke" />
          <text x={checks.passage.at.x + font * 0.7} y={-checks.passage.at.y} fontSize={font * 0.75} dominantBaseline="middle">
            {checks.passage.label}
          </text>
        </g>
      )}
      {(
        [
          [checks.start, "A", "start"],
          [checks.end, "B", "end"],
        ] as const
      ).map(([p, letter, which]) =>
        p ? (
          <g key={which} className={`plan-end plan-end-${which}`} data-testid={`${testId}-${which}`}>
            <circle cx={p.x} cy={-p.y} r={font * 0.55} vectorEffect="non-scaling-stroke" />
            <text x={p.x} y={-p.y} fontSize={font * 0.7} textAnchor="middle" dominantBaseline="central">
              {letter}
            </text>
          </g>
        ) : null,
      )}
    </g>
  );
}
