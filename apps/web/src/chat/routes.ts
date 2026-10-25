// Routes asked about in the conversation (UX-03). The answer always comes from the existing
// width-only route check (GEO-02): between two objects named in the request, or along the routes
// the shift uses when a process is set up. Nothing here measures anything itself.
import type { Project, SceneObject } from "@replay-world/contracts";
import type { Vec } from "../checks/geometry";
import { type RouteAsk, runChecks, type SceneChecks, sceneChecks } from "../checks/results";
import type { DrawingSource } from "../drawing/world";
import { fromWorld } from "../drawing/world";
import { planRun, type RouteUse } from "../run/plan";
import { brief } from "./context";

/** Where a route to or from `object` starts: just outside its footprint, on the side facing
 * `toward`, with room for half the corridor. */
export function endPoint(object: SceneObject, toward: { x: number; z: number }, corridorM: number): Vec {
  const p = object.transform.position_m;
  const dx = toward.x - p.x;
  const dz = toward.z - p.z;
  const length = Math.hypot(dx, dz) || 1;
  const ux = dx / length;
  const uz = dz / length;
  // In the object's own frame, the distance from its centre to its outline along (ux, uz).
  const yaw = object.transform.rotation_rad.y;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const lx = ux * c - uz * s;
  const lz = ux * s + uz * c;
  const hw = object.dimensions.width.value_m / 2;
  const hd = object.dimensions.depth.value_m / 2;
  const reach = Math.min(Math.abs(lx) > 1e-9 ? hw / Math.abs(lx) : Infinity, Math.abs(lz) > 1e-9 ? hd / Math.abs(lz) : Infinity);
  const out = reach + corridorM / 2 + 0.05;
  return { x: p.x + ux * out, z: p.z + uz * out };
}

/** The route question between two objects, on the plan, for the existing check. */
export function routeBetween(source: DrawingSource, a: SceneObject, b: SceneObject, widthM: number, allowanceM: number): RouteAsk {
  const corridor = widthM + 2 * allowanceM;
  const t = source.source_to_world;
  const start = fromWorld(t, endPoint(a, b.transform.position_m, corridor));
  const end = fromWorld(t, endPoint(b, a.transform.position_m, corridor));
  return { sourceId: source.id, start, end, width: String(widthM), allowance: String(allowanceM) };
}

export interface RouteAnswer {
  /** One plain sentence. */
  sentence: string;
  outcome: "fits" | "conflict" | "cannot_determine";
  /** Measurements and limits, for the expandable details. */
  details: string[];
  highlight: SceneChecks | null;
}

const m2 = (v: number) => `${v.toFixed(2)} m`;
const pathLength = (path: Vec[]) => path.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - path[i]!.x, p.z - path[i]!.z), 0);

/** The answer for an asked route, from the existing check. */
export function answerAsked(project: Project, ask: RouteAsk): RouteAnswer | null {
  const checks = runChecks(project, ask);
  const route = checks?.now.route;
  if (!checks || !route) return null;
  const width = Number(ask.width) + 2 * Number(ask.allowance);
  const before = checks.drawn.route;
  const sentence =
    route.outcome === "fits"
      ? `Yes: a ${m2(width)} wide path gets through${route.path ? `, ${pathLength(route.path).toFixed(1)} m long` : ""}.`
      : route.outcome === "conflict"
        ? `No: ${brief(route.summary)}.`
        : `Can't tell: ${route.summary.replace(/\.$/, "")}.`;
  const details = [
    `Path width ${m2(width)} (item ${m2(Number(ask.width))} + ${m2(Number(ask.allowance))} each side).`,
    route.summary,
    route.clearanceM !== null ? `Closest clearance from the path's centre line: ${m2(route.clearanceM)}; it needs ${m2(route.needM / 2)}.` : "",
    before && checks.drawn !== checks.now ? `As drawn: ${before.outcome === "fits" ? "it fits" : before.outcome === "conflict" ? "blocked" : "can't tell"}.` : "",
    "Width only, on the reviewed design: turning, heights and the real site are not checked.",
  ].filter(Boolean);
  // The route, its ends and its narrowest point; overlaps elsewhere are not part of the answer.
  const shown = sceneChecks(checks.now, ask);
  const highlight = { ...shown, regions: [], outlines: route.outcome === "fits" ? [] : shown.outlines.filter((o) => o.flag === "conflict") };
  return { sentence, outcome: route.outcome === "fits" ? "fits" : route.outcome === "conflict" ? "conflict" : "cannot_determine", details, highlight };
}

/** The routes the shift uses, checked on the layout as it is. */
export function answerProcess(project: Project, objectId: string | null = null): RouteAnswer | null {
  const process = project.process;
  if (!process) return null;
  const plan = planRun(project, process);
  const named = (r: RouteUse) => `${plan.locations[r.from]?.name} ↔ ${plan.locations[r.to]?.name}`;
  const touches = (r: RouteUse) => objectId === null || plan.locations[r.from]?.objectId === objectId || plan.locations[r.to]?.objectId === objectId;
  const carried = plan.routes.filter((r) => r.uses.some((u) => u.startsWith("carrying")) && touches(r));
  const routes = carried.length ? carried : plan.routes;
  if (!routes.length) return null;
  const blocked = routes.filter((r) => r.outcome === "conflict");
  const unknown = routes.filter((r) => r.outcome !== "conflict" && r.outcome !== "fits");
  const first = blocked[0] ?? unknown[0] ?? null;
  const sentence = blocked.length
    ? `No: ${named(blocked[0]!)} is blocked (${brief(blocked[0]!.summary)}).`
    : unknown.length
      ? `Can't tell for ${named(unknown[0]!)}: ${unknown[0]!.summary.replace(/\.$/, "")}.`
      : objectId
        ? `Yes: ${routes.length === 1 ? `its route (${named(routes[0]!)}) still fits` : `its ${routes.length} routes still fit`}.`
        : `Yes: the shift's ${routes.length} carrying routes all still fit.`;
  const details = routes.map((r) => `${named(r)}: ${r.outcome === "fits" ? `fits, ${r.lengthM?.toFixed(1)} m` : r.summary} (path ${m2(r.corridorM)})`);
  details.push("Width only, on the reviewed design: turning, heights and the real site are not checked.");
  const shown = first ?? routes[0]!;
  const highlight: SceneChecks = {
    outlines: [],
    regions: [],
    route: shown.path && shown.path.length > 1 ? { points: shown.path, outcome: shown.outcome } : null,
    ends: [plan.locations[shown.from]?.at, plan.locations[shown.to]?.at].filter((p): p is Vec => p !== undefined),
    passage: null,
  };
  return { sentence, outcome: blocked.length ? "conflict" : unknown.length ? "cannot_determine" : "fits", details, highlight };
}
