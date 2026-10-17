// The drawing as a plan (ONB-01): its lines, texts and the objects drawn from it, in drawing
// units with +Y up. Optionally the current arrangement over it: an object moved since the
// import is drawn where it is now, with a dashed outline where the drawing has it.
import type { DrawingImport, DrawingObject, Project } from "@replay-world/contracts";
import { type KeyboardEvent, useMemo } from "react";
import { type DrawingSource, footprintOnPlan } from "../drawing/world";

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
}

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

export function DrawingPlan({ drawing, now, selectedId, onSelect, labels, testId, title, metresPerUnit }: Props) {
  const { extent_min: lo, extent_max: hi } = drawing;
  const span = Math.max(hi.x - lo.x, hi.y - lo.y, 1e-9);
  const margin = span * 0.04;
  const font = span / 42;
  const viewBox = `${lo.x - margin} ${-(hi.y + margin)} ${hi.x - lo.x + 2 * margin} ${hi.y - lo.y + 2 * margin}`;
  const live = useMemo(() => new Map(now?.project.scene.objects.map((o) => [o.id, o]) ?? []), [now?.project]);
  const objects = useMemo(() => [...drawing.objects].sort((a, b) => Number(b.role === "floor") - Number(a.role === "floor")), [drawing.objects]);
  const shapes = useMemo(
    () =>
      objects
        .filter((d) => d.role !== "floor" && (labels === "all" || d.object_id === selectedId))
        .map((d) => {
          const current = now ? live.get(d.object_id) : undefined;
          const outline = current && now?.moved.has(d.object_id) ? footprintOnPlan(now.source.source_to_world, current) : d.outline;
          return { id: d.id, text: current?.name ?? d.label, outline };
        }),
    [objects, labels, selectedId, now, live],
  );
  const placed = useMemo(() => placeLabels(shapes, font), [shapes, font]);
  const bar = metresPerUnit ? scaleLength(span * metresPerUnit) : null;

  const select = (id: string) => onSelect?.(id);
  const onKey = (id: string) => (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      select(id);
    }
  };

  return (
    <svg className="drawing-plan" viewBox={viewBox} role="img" aria-label={title} data-testid={testId} preserveAspectRatio="xMidYMid meet">
      <title>{title}</title>
      <g className="plan-lines">
        {drawing.lines.map((line, i) =>
          line.closed ? <polygon key={i} points={points(line.points)} vectorEffect="non-scaling-stroke" /> : <polyline key={i} points={points(line.points)} vectorEffect="non-scaling-stroke" />,
        )}
      </g>
      {objects.map((drawn) => {
        const floor = drawn.role === "floor";
        const current = now ? live.get(drawn.object_id) : undefined;
        const moved = now?.moved.has(drawn.object_id) ?? false;
        const removed = now !== undefined && current === undefined;
        const selected = drawn.object_id === selectedId;
        const shape = current && moved && now ? footprintOnPlan(now.source.source_to_world, current) : drawn.outline;
        const state = removed ? "removed" : moved ? "moved" : "drawn";
        const interactive = !floor && !removed && onSelect !== undefined;
        return (
          <g
            key={drawn.id}
            className={`plan-object ${floor ? "plan-floor" : KIND_CLASS[drawn.kind]} plan-${state}${selected ? " selected" : ""}`}
            data-testid={`${testId}-object-${drawn.object_id}`}
            data-state={state}
            {...(interactive ? { role: "button", tabIndex: 0, "aria-label": `${drawn.label} (${state === "moved" ? "moved since the drawing" : "as drawn"})`, onClick: () => select(drawn.object_id), onKeyDown: onKey(drawn.object_id) } : {})}
          >
            <title>{current?.name ?? drawn.label}</title>
            {moved && <polygon className="plan-original" points={points(drawn.outline)} vectorEffect="non-scaling-stroke" />}
            <polygon points={points(shape)} vectorEffect="non-scaling-stroke" />
          </g>
        );
      })}
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
      {bar && metresPerUnit && (
        <g className="plan-scale" data-testid={`${testId}-scale`}>
          <line x1={lo.x} y1={-lo.y + margin * 0.55} x2={lo.x + bar / metresPerUnit} y2={-lo.y + margin * 0.55} vectorEffect="non-scaling-stroke" />
          <text x={lo.x + bar / metresPerUnit + font * 0.4} y={-lo.y + margin * 0.55} fontSize={font * 0.7} dominantBaseline="middle">
            {bar >= 1 ? `${bar} m` : `${bar * 100} cm`}
          </text>
        </g>
      )}
      {labels === "all" &&
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

