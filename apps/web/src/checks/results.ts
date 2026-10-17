// The layout checks (GEO-01/02) as the screen uses them: both checks on the edited arrangement
// and on the drawing's own, and what each shows on the plan and in the 3D view.
import type { PlanPoint, Project } from "@replay-world/contracts";
import type { Flag, PlanChecks } from "../components/DrawingPlan";
import { compareWithDrawing } from "../drawing/compare";
import { type DrawingSource, drawingSource, footprintOnPlan, fromWorld, toWorld } from "../drawing/world";
import { asDrawn } from "./arrangement";
import { footprint, type Vec } from "./geometry";
import { checkLayout, type FindingState, type LayoutResult } from "./layout";
import { checkRoute, type RouteResult } from "./route";

/** The route the person asked about: points on the drawing (so a scale change keeps them where
 * they were picked) and the width and allowance as typed. Kept while the app is open. */
export interface RouteAsk {
  sourceId: string;
  start: PlanPoint | null;
  end: PlanPoint | null;
  width: string;
  allowance: string;
}

export interface Checks {
  project: Project;
  source: DrawingSource;
  layout: LayoutResult;
  route: RouteResult | null;
}

/** The checks on the edited arrangement and on the drawing's own. */
export interface CheckPair {
  now: Checks;
  drawn: Checks;
}

const metres = (text: string) => (text.trim() === "" ? Number.NaN : Number(text.trim().replace(",", ".")));

function evaluate(project: Project, ask: RouteAsk | null): Checks | null {
  const source = drawingSource(project);
  const layout = checkLayout(project);
  if (!source || !layout) return null;
  const asked = ask && ask.sourceId === source.id && ask.start && ask.end ? ask : null;
  const allowance = asked && asked.allowance.trim() !== "" ? metres(asked.allowance) : 0;
  const route = asked
    ? checkRoute(project, { start: toWorld(source.source_to_world, asked.start!), end: toWorld(source.source_to_world, asked.end!), widthM: metres(asked.width), allowanceM: allowance })
    : null;
  return { project, source, layout, route };
}

export function runChecks(project: Project, ask: RouteAsk | null): CheckPair | null {
  const now = evaluate(project, ask);
  if (!now) return null;
  const counts = compareWithDrawing(project)?.counts;
  const unchanged = counts !== undefined && counts.changed + counts.removed + counts.added === 0;
  const original = unchanged ? null : asDrawn(project);
  return { now, drawn: (original && evaluate(original, ask)) ?? now };
}

export const flagOf = (state: FindingState | RouteResult["outcome"]): Flag => (state === "conflict" ? "conflict" : "uncertain");

/** The objects a finding names, and those either side of a route's blockage. */
function flags(checks: Checks): Map<string, Flag> {
  const flagged = new Map<string, Flag>();
  const flag = (id: string, f: Flag) => {
    if (flagged.get(id) !== "conflict") flagged.set(id, f);
  };
  for (const f of checks.layout.findings) for (const id of f.objectIds) flag(id, flagOf(f.state));
  const route = checks.route;
  if (route && route.outcome !== "fits" && route.passage) for (const id of route.passage.objectIds) flag(id, flagOf(route.outcome));
  return flagged;
}

/** What one arrangement's results show on the plan. */
export function planChecks(checks: Checks, ask: RouteAsk | null): PlanChecks {
  const t = checks.source.source_to_world;
  const onPlan = (points: readonly Vec[]) => points.map((p) => fromWorld(t, p));
  const flagged = flags(checks);
  const linked = new Set(checks.source.drawing.objects.map((d) => d.object_id));
  const floorId = checks.source.drawing.review.floor.object_id;
  const route = checks.route;
  const asked = ask && ask.sourceId === checks.source.id ? ask : null;
  return {
    flagged,
    regions: checks.layout.findings.filter((f) => f.region.length >= 3 && f.kind !== "zone_uncertain").map((f) => ({ points: onPlan(f.region), flag: flagOf(f.state) })),
    route: route?.path ? { points: onPlan(route.path), outcome: route.outcome } : null,
    start: asked?.start ?? null,
    end: asked?.end ?? null,
    passage: route?.passage ? { at: fromWorld(t, route.passage.at), label: `${route.passage.widthM.toFixed(2)} m` } : null,
    added: checks.project.scene.objects
      .filter((o) => !linked.has(o.id) && o.id !== floorId && (o.kind === "equipment" || o.kind === "structure" || o.kind === "keep_clear"))
      .map((o) => ({ id: o.id, name: o.name, outline: footprintOnPlan(t, o) })),
  };
}

/** What the 3D view highlights: the objects a finding names, the overlapping areas and the
 * route, in world metres. */
export interface SceneChecks {
  outlines: { points: Vec[]; top: number; flag: Flag }[];
  regions: { points: Vec[]; flag: Flag }[];
  route: { points: Vec[]; outcome: RouteResult["outcome"] } | null;
  ends: Vec[];
  passage: Vec | null;
}

export function sceneChecks(checks: Checks, ask: RouteAsk | null): SceneChecks {
  const t = checks.source.source_to_world;
  const asked = ask && ask.sourceId === checks.source.id ? ask : null;
  const flagged = flags(checks);
  const route = checks.route;
  return {
    outlines: checks.project.scene.objects
      .filter((o) => flagged.has(o.id))
      .map((o) => ({ points: footprint(o), top: o.transform.position_m.y + o.dimensions.height.value_m, flag: flagged.get(o.id)! })),
    regions: checks.layout.findings.filter((f) => f.region.length >= 3 && (f.kind === "overlap" || f.kind === "zone")).map((f) => ({ points: f.region, flag: flagOf(f.state) })),
    route: route?.path ? { points: route.path, outcome: route.outcome } : null,
    ends: [asked?.start, asked?.end].filter((p) => p != null).map((p) => toWorld(t, p)),
    passage: route?.passage && route.outcome !== "fits" ? route.passage.at : null,
  };
}
