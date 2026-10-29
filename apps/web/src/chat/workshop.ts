// "Try rearranging a workshop": one question about one move. Can the assembly bench go beside the
// doorway (a shorter walk to packing), can material still reach every station, and what changes
// during the example shift? Every answer here is read from the existing checks and run engine on
// the layout as it is now: the route check that the shift uses, the layout check, and the same
// shift run on the layout as drawn and as changed. Nothing is written in advance.
import type { Project, SceneObject, Transform } from "@replay-world/contracts";
import { footprint } from "../checks/geometry";
import { checkLayout } from "../checks/layout";
import type { SceneChecks } from "../checks/results";
import { WORKSHOP_TASK } from "../examples/workshop";
import { compareDays, type DayRun, plural, runDay, runOriginal } from "../run/day";
import { planRun, type RouteUse } from "../run/plan";
import { brief } from "./context";
import type { Ghost } from "./plan";

export const WORKSHOP_PROJECT_ID = "proj-example-workshop";
export const NUDGE_M = 0.25;
/** The task's view: high from the south-west, so neither part of the partition hides the
 * doorway, the bench or the packing table. */
export const TASK_VIEW: [number, number, number] = [-0.45, 1.25, 0.75];

export const benchOf = (project: Project): SceneObject | null => project.scene.objects.find((o) => o.id === WORKSHOP_TASK.objectId) ?? null;

/** Where the bench stands, as a key: a change of it (drag, button, undo) is a new reading. */
export const placeKey = (project: Project): string => JSON.stringify(benchOf(project)?.transform ?? null);

/** The bench moved by (dx, dz) metres in the plan's directions (+x right, +z toward the front). */
export function nudged(object: SceneObject, dx: number, dz: number): Transform {
  const p = object.transform.position_m;
  const round = (v: number) => Math.round(v * 1000) / 1000;
  return { ...object.transform, position_m: { x: round(p.x + dx), y: p.y, z: round(p.z + dz) } };
}

/** Whether the bench stands on the spot beside the doorway. */
export const onSpot = (object: SceneObject): boolean => {
  const p = object.transform.position_m;
  return Math.hypot(p.x - WORKSHOP_TASK.spot.x, p.z - WORKSHOP_TASK.spot.z) < 0.01;
};

/** The bench placed on the spot beside the doorway (its turn kept). */
export const atSpot = (object: SceneObject): Transform => ({ ...object.transform, position_m: { ...object.transform.position_m, x: WORKSHOP_TASK.spot.x, z: WORKSHOP_TASK.spot.z } });

/** The spot, outlined in the world while the bench is elsewhere. */
export function spotGhost(object: SceneObject): Ghost {
  const at = atSpot(object);
  return { points: footprint({ ...object, transform: at }), top: object.dimensions.height.value_m, from: { x: object.transform.position_m.x, z: object.transform.position_m.z }, to: { x: at.position_m.x, z: at.position_m.z } };
}

const carried = (route: RouteUse) => route.uses.some((u) => u.startsWith("carrying"));
const m1 = (v: number) => `${v.toFixed(1)} m`;

export interface Reading {
  state: "as_drawn" | "fits" | "blocked" | "unknown" | "cannot_run";
  /** One sentence: the primary result. */
  title: string;
  /** At most three short lines under it. */
  lines: string[];
  highlight: SceneChecks | null;
}

/** The route in the world: its path when it fits, otherwise its ends, the narrowest point and the
 * objects either side of it, outlined. */
function highlightOf(project: Project, plan: ReturnType<typeof planRun>, route: RouteUse | undefined): SceneChecks | null {
  if (!route) return null;
  const ends = [plan.locations[route.from]?.at, plan.locations[route.to]?.at].filter((p) => p !== undefined);
  const flag = route.outcome === "conflict" ? ("conflict" as const) : ("uncertain" as const);
  const outlines = (route.passage?.objectIds ?? []).flatMap((id) => {
    const object = project.scene.objects.find((o) => o.id === id);
    return object ? [{ points: footprint(object), top: object.dimensions.height.value_m, flag }] : [];
  });
  return {
    outlines,
    regions: [],
    route: route.path && route.path.length > 1 ? { points: route.path, outcome: route.outcome } : null,
    ends,
    passage: route.passage?.at ?? null,
  };
}

/** What the layout means for the bench's routes now, against the layout as drawn. */
export function readPlacement(drawn: Project, now: Project): Reading {
  if (!now.process) return { state: "cannot_run", title: "This layout has no shift set up.", lines: [], highlight: null };
  const plan = planRun(now, now.process);
  const before = planRun(drawn, drawn.process!);
  const bench = benchOf(now);
  const name = (r: RouteUse) => `${plan.locations[r.from]?.name} → ${plan.locations[r.to]?.name}`;
  const mine = plan.routes.filter((r) => carried(r) && (plan.locations[r.from]?.objectId === bench?.id || plan.locations[r.to]?.objectId === bench?.id));
  const toPacking = mine.find((r) => plan.locations[r.to]?.name === "Packing table") ?? mine[0];
  const walk = (p: typeof plan, r: RouteUse | undefined) => (r ? p.routes.find((x) => x.from === r.from && x.to === r.to && carried(x))?.lengthM : null) ?? null;
  const drawnWalk = walk(before, toPacking);
  const layout = checkLayout(now);
  const conflicts = (layout?.findings ?? []).filter((f) => f.state === "conflict" && f.objectIds.includes(bench?.id ?? ""));
  if (placeKey(now) === placeKey(drawn)) {
    return {
      state: "as_drawn",
      title: "Can the assembly bench go beside the doorway?",
      lines: [
        `There, the walk with each frame to the packing table would be shorter than today's ${drawnWalk !== null ? m1(drawnWalk) : "walk"}. But the doorway is the only way to packing, and a carried frame needs a 0.70 m wide way.`,
      ],
      highlight: highlightOf(now, plan, toPacking),
    };
  }
  const blocked = plan.routes.filter((r) => r.outcome === "conflict");
  const unknown = plan.routes.filter((r) => r.outcome === "cannot_determine");
  const extra = conflicts.map((f) => f.message).slice(0, 1);
  if (blocked.length) {
    const first = blocked.find(carried) ?? blocked[0]!;
    return {
      state: "blocked",
      title: `Blocked: ${name(first)} ${brief(first.summary).replace(/^the best way through /, "")}.`,
      lines: [`So no ${plural(now.process.item_name).replace(/s$/, "")} can reach the ${plan.locations[first.to]?.name.toLowerCase() ?? "next station"}. Move the bench away from the doorway, or undo.`, ...extra],
      highlight: highlightOf(now, plan, first),
    };
  }
  if (unknown.length) {
    const first = unknown[0]!;
    return {
      state: "unknown",
      title: `Too close to tell: ${name(first)} ${first.summary.replace(/^Cannot determine yet: /, "").replace(/\.$/, "")}.`,
      lines: ["The check does not guess a pass or a fail this close. Move the bench a little further from the doorway.", ...extra],
      highlight: highlightOf(now, plan, first),
    };
  }
  const nowWalk = walk(plan, toPacking);
  const walkText =
    nowWalk === null || drawnWalk === null ? "" : Math.abs(nowWalk - drawnWalk) < 0.05 ? `; the walk to the packing table is unchanged (${m1(nowWalk)})` : `, and the walk to the packing table is ${m1(drawnWalk)} → ${m1(nowWalk)}`;
  return {
    state: "fits",
    title: `It fits: every route still clears${walkText}.`,
    lines: [extra.length ? extra[0]! : "Run the same shift on both layouts to see what it changes."],
    highlight: highlightOf(now, plan, toPacking),
  };
}

export interface BeforeAfter {
  before: DayRun;
  after: DayRun;
  /** One sentence: the outcome in frames. */
  title: string;
  /** Why, from the comparison (at most two lines). */
  lines: string[];
  details: string[];
}

/** The same shift on the layout as drawn and as it is now. */
export function beforeAfter(now: Project): BeforeAfter | null {
  const process = now.process;
  if (!process) return null;
  const before = runOriginal(now, process);
  if (!before) return null;
  const after = runDay(now, process, "edited");
  const item = plural(process.item_name);
  const a = before.result?.metrics.completed ?? 0;
  const b = after.result?.metrics.completed ?? 0;
  const compared = compareDays(before, after, process);
  const diff = b - a;
  const title = `As drawn: ${a} ${item}. With the bench here: ${b} ${item}${diff === 0 ? " (the same)" : ` (${diff > 0 ? "+" : ""}${diff})`}.`;
  const blockedRoute = after.plan.outcome === "blocked" ? after.plan.routes.find((r) => r.outcome === "conflict" && carried(r)) : undefined;
  // The carried walks that changed, as the two plans measured them (shorter and longer alike).
  const named = (plan: DayRun["plan"], r: RouteUse) => `${plan.locations[r.from]?.name} → ${plan.locations[r.to]?.name}`;
  const walks = after.plan.routes
    .filter(carried)
    .flatMap((r) => {
      const was = before.plan.routes.find((x) => x.from === r.from && x.to === r.to && carried(x));
      return was?.lengthM != null && r.lengthM != null && Math.abs(r.lengthM - was.lengthM) >= 0.1 ? [`${named(after.plan, r)} ${m1(was.lengthM)} → ${m1(r.lengthM)}`] : [];
    })
    .slice(0, 2);
  const lines = blockedRoute
    ? [`${named(after.plan, blockedRoute)} is blocked, so no ${process.item_name} gets through: they wait at the ${after.plan.locations[blockedRoute.from]?.name.toLowerCase() ?? "station"}. Nothing is moved through equipment.`]
    : after.result && diff > 0
      ? [`Carried walks: ${walks.join("; ") || "unchanged"}. The assembly worker, who sets the pace, gets back to the bench sooner.`]
      : after.result && diff === 0
        ? [`Carried walks: ${walks.join("; ") || "unchanged"}. The assembly time per ${process.item_name} still sets the pace, so a different walk alone does not change the count.`]
        : after.result
          ? [`Carried walks: ${walks.join("; ") || "unchanged"}. ${compared.explanation.find((l) => l.startsWith("Output")) ?? ""}`]
          : ["Nothing is moved through equipment: the frames wait at the bench, so the packing table gets none."];
  return {
    before,
    after,
    title,
    lines: lines.filter(Boolean),
    details: [...compared.explanation, ...compared.rows.map((r) => `${r.label}: ${r.before} → ${r.after} (${r.change})`), "Both runs use the same example shift, seed and engine; only the layout differs. Example assumptions, not measured performance."],
  };
}
