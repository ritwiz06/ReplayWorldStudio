// Compare the current arrangement with the drawing it was built from (ONB-01): which objects
// moved, turned, were resized, removed or added. The original arrangement is the drawing
// itself (through the project's source-to-world transform), so the comparison needs no second
// project and survives save and reopen.
import type { Project, SceneObject, Transform } from "@replay-world/contracts";
import { type DrawingSource, drawingSource, drawnSize, drawnTransform } from "./world";

export type ChangeStatus = "unchanged" | "changed" | "removed" | "added";

export interface Change {
  objectId: string;
  label: string;
  status: ChangeStatus;
  /** Plain words for what changed, e.g. "moved 2.00 m", "turned 90°". */
  what: string[];
  /** As drawn (null for an object added after the import). */
  before: { transform: Transform; width: number; depth: number } | null;
  /** Now (null for a removed object). */
  after: SceneObject | null;
}

export interface Comparison {
  source: DrawingSource;
  changes: Change[];
  counts: Record<ChangeStatus, number>;
}

const MOVE_TOLERANCE_M = 0.0005;
const TURN_TOLERANCE_RAD = (0.5 * Math.PI) / 180;
const SIZE_TOLERANCE_M = 0.0005;

const turnOf = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

export function compareWithDrawing(project: Project): Comparison | null {
  const source = drawingSource(project);
  if (!source) return null;
  const t = source.source_to_world;
  const live = new Map(project.scene.objects.map((o) => [o.id, o]));
  const drawnIds = new Set(source.drawing.objects.map((d) => d.object_id));
  const changes: Change[] = source.drawing.objects.map((drawn) => {
    const transform = drawnTransform(t, drawn);
    const before = { transform, ...drawnSize(t, drawn) };
    const now = live.get(drawn.object_id) ?? null;
    if (!now) return { objectId: drawn.object_id, label: drawn.label, status: "removed", what: ["removed"], before, after: null };
    const what: string[] = [];
    const p = now.transform.position_m;
    const moved = Math.hypot(p.x - transform.position_m.x, p.z - transform.position_m.z);
    if (moved > MOVE_TOLERANCE_M) what.push(`moved ${moved.toFixed(2)} m`);
    if (Math.abs(p.y - transform.position_m.y) > MOVE_TOLERANCE_M) what.push(`raised ${(p.y - transform.position_m.y).toFixed(2)} m`);
    const turn = turnOf(transform.rotation_rad.y, now.transform.rotation_rad.y);
    if (Math.abs(turn) > TURN_TOLERANCE_RAD) what.push(`turned ${Math.round((turn * 180) / Math.PI)}°`);
    const d = now.dimensions;
    if (Math.abs(d.width.value_m - before.width) > SIZE_TOLERANCE_M || Math.abs(d.depth.value_m - before.depth) > SIZE_TOLERANCE_M) {
      what.push(`footprint now ${d.width.value_m.toFixed(2)} × ${d.depth.value_m.toFixed(2)} m`);
    }
    if (d.height.origin !== "default") what.push(`height ${d.height.value_m.toFixed(2)} m entered`);
    return { objectId: drawn.object_id, label: now.name, status: what.length ? "changed" : "unchanged", what, before, after: now };
  });
  for (const object of project.scene.objects) {
    if (drawnIds.has(object.id)) continue;
    changes.push({ objectId: object.id, label: object.name, status: "added", what: ["added: not in the drawing"], before: null, after: object });
  }
  const counts: Record<ChangeStatus, number> = { unchanged: 0, changed: 0, removed: 0, added: 0 };
  for (const change of changes) counts[change.status] += 1;
  return { source, changes, counts };
}

export function summary(counts: Record<ChangeStatus, number>): string {
  const parts = [
    counts.changed && `${counts.changed} changed`,
    counts.removed && `${counts.removed} removed`,
    counts.added && `${counts.added} added`,
    `${counts.unchanged} as drawn`,
  ].filter(Boolean);
  return parts.join(" · ");
}
