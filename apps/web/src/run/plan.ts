// What a run needs from the layout (SIM-01): where each station's worker stands (its access
// point, carried with its object when it moves or turns), and how far apart those places are
// along routes the existing route check (GEO-02) finds clear. A carry uses the item's width
// plus its allowance; a walk with empty hands the worker's own width. A blocked route is a
// move that cannot happen; a route the check cannot determine stops the run, naming why. The
// operating values come only from the process: nothing here reads them from the drawing.
import type { ProcessModel, Project, SceneObject } from "@replay-world/contracts";
import { checkInputs } from "../checks/inputs";
import type { Vec } from "../checks/geometry";
import { checkRoute, type RouteResult } from "../checks/route";
import type { SimInput, SimTask } from "./engine";

export interface RunLocation {
  stationId: string;
  name: string;
  objectId: string;
  at: Vec;
}

export interface RouteUse {
  from: number;
  to: number;
  corridorM: number;
  outcome: RouteResult["outcome"];
  lengthM: number | null;
  path: Vec[] | null;
  summary: string;
  /** Where a route that does not fit is narrowest, and the objects on either side. */
  passage?: { at: Vec; objectIds: string[] } | null;
  /** What needs this route, e.g. "carry Mixer → Machine B" or "Worker 1 walking". */
  uses: string[];
}

export interface RunPlan {
  outcome: "ready" | "blocked" | "cannot_determine" | "needs_input";
  /** Why the run cannot start, or which moves are blocked, in plain words. */
  reasons: string[];
  locations: RunLocation[];
  routes: RouteUse[];
  input: SimInput | null;
  /** Corridor widths (m): each transfer's (carrying) and each worker's (empty-handed). */
  corridors: { transfers: number[]; workers: number[] };
  sceneRevision: number;
}

const S = 1000;
const ms = (seconds: number) => Math.round(seconds * S);
const m = (v: number) => `${v.toFixed(2)} m`;

/** A point in an object's own frame, in world metres (the footprint's convention). */
export function accessPoint(object: SceneObject, local: { x: number; z: number }): Vec {
  const { position_m: p, rotation_rad: r } = object.transform;
  const c = Math.cos(r.y);
  const s = Math.sin(r.y);
  return { x: p.x + local.x * c + local.z * s, z: p.z - local.x * s + local.z * c };
}

const pathLength = (path: Vec[]) => path.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - path[i]!.x, p.z - path[i]!.z), 0);

export function taskOf(process: ProcessModel, task: string): SimTask {
  const [kind, id] = task.split(":") as ["station" | "transfer", string];
  return kind === "station" ? { kind, station: process.stations.findIndex((s) => s.id === id) } : { kind, transfer: process.transfers.findIndex((t) => t.id === id) };
}

export function planRun(project: Project, process: ProcessModel): RunPlan {
  const sceneRevision = project.scene.revision;
  const corridors = {
    transfers: process.transfers.map((t) => t.item_width_m.value + 2 * t.allowance_m.value),
    workers: process.workers.map((w) => w.width_m.value),
  };
  const base = { locations: [] as RunLocation[], routes: [] as RouteUse[], input: null, corridors, sceneRevision };
  const missing: string[] = [];
  const objects = new Map(project.scene.objects.map((o) => [o.id, o]));
  for (const station of process.stations) {
    if (!objects.has(station.object_id)) missing.push(`${station.name} is tied to ${station.object_id}, which is no longer in the layout: choose its object again in Set up a day`);
  }
  if (missing.length > 0) return { ...base, outcome: "needs_input", reasons: missing };
  const inputs = checkInputs(project);
  if (!inputs) return { ...base, outcome: "cannot_determine", reasons: ["Run a day needs a reviewed plan: its routes are checked on the plan's floor (upload a plan, or try the sample hall)"] };
  if (inputs.blockers.length > 0) return { ...base, outcome: "cannot_determine", reasons: inputs.blockers.map((b) => `the plan is not reviewed enough to check routes: ${b}`) };

  const locations: RunLocation[] = process.stations.map((station) => ({
    stationId: station.id,
    name: station.name,
    objectId: station.object_id,
    at: accessPoint(objects.get(station.object_id)!, station.access_m),
  }));

  // One route check per pair of places and corridor width, used both ways.
  const routes: RouteUse[] = [];
  const route = (from: number, to: number, corridorM: number, use: string): RouteUse => {
    const [a, b] = from < to ? [from, to] : [to, from];
    let found = routes.find((r) => r.from === a && r.to === b && Math.abs(r.corridorM - corridorM) < 1e-9);
    if (!found) {
      const result = checkRoute(project, { start: locations[a]!.at, end: locations[b]!.at, widthM: corridorM, allowanceM: 0 });
      const outcome = result?.outcome ?? "cannot_determine";
      found = {
        from: a,
        to: b,
        corridorM,
        outcome,
        lengthM: outcome === "fits" && result?.path ? pathLength(result.path) : null,
        path: result?.path ?? null,
        summary: result?.summary ?? "the route could not be checked",
        passage: outcome !== "fits" && result?.passage ? { at: result.passage.at, objectIds: result.passage.objectIds } : null,
        uses: [],
      };
      routes.push(found);
    }
    if (!found.uses.includes(use)) found.uses.push(use);
    return found;
  };
  const distance = (r: RouteUse, from: number, to: number) => (from === to ? 0 : r.outcome === "fits" ? r.lengthM : null);

  const stationIndex = new Map(process.stations.map((s, i) => [s.id, i]));
  const carryM = process.transfers.map((t) => {
    const from = stationIndex.get(t.from_station)!;
    const to = stationIndex.get(t.to_station)!;
    if (from === to || locations[from]!.at.x === locations[to]!.at.x && locations[from]!.at.z === locations[to]!.at.z) return 0;
    const corridor = t.item_width_m.value + 2 * t.allowance_m.value;
    return distance(route(from, to, corridor, `carrying from ${locations[from]!.name} to ${locations[to]!.name}`), from, to);
  });

  const workers = process.workers.map((w) => {
    const tasks = w.tasks.map((task) => taskOf(process, task));
    const places = new Set<number>();
    for (const task of tasks) {
      if (task.kind === "station") places.add(task.station);
      else {
        const t = process.transfers[task.transfer]!;
        places.add(stationIndex.get(t.from_station)!);
        places.add(stationIndex.get(t.to_station)!);
      }
    }
    const start = tasks[0]!.kind === "station" ? tasks[0]!.station : stationIndex.get(process.transfers[tasks[0]!.transfer]!.from_station)!;
    const matrix = locations.map((_, a) => locations.map((__, b) => (a === b ? 0 : (null as number | null))));
    for (const a of places) {
      for (const b of places) {
        if (a >= b) continue;
        const d = distance(route(a, b, w.width_m.value, `${w.name} walking`), a, b);
        matrix[a]![b] = d;
        matrix[b]![a] = d;
      }
    }
    return { spec: w, tasks, start, matrix };
  });

  const unknown = routes.filter((r) => r.outcome === "cannot_determine");
  if (unknown.length > 0) {
    return {
      ...base,
      locations,
      routes,
      outcome: "cannot_determine",
      reasons: unknown.map((r) => `${locations[r.from]!.name} ↔ ${locations[r.to]!.name} (${m(r.corridorM)} wide, for ${r.uses.join(", ")}): ${r.summary}`),
    };
  }
  const blocked = routes.filter((r) => r.outcome === "conflict");

  const shift = process.shift;
  const input: SimInput = {
    shiftMs: ms(shift.duration_s.value),
    breaks: [...shift.breaks].sort((a, b) => a.start_s.value - b.start_s.value).map((b) => ({ id: b.id, name: b.name, startMs: ms(b.start_s.value), durationMs: ms(b.duration_s.value) })),
    stations: process.stations.map((s, i) => ({
      id: s.id,
      name: s.name,
      supply: s.role === "supply",
      workerMs: ms(s.worker_s?.value ?? 0),
      machineMs: ms(s.machine_s?.value ?? 0),
      inCap: s.input_capacity?.value ?? 0,
      outCap: s.output_capacity?.value ?? 0,
      location: i,
      plannedStops: s.planned_stops.map((p) => ({ startMs: ms(p.start_s.value), endMs: ms(p.start_s.value + p.duration_s.value), reason: p.reason, planned: true })),
      randomStops: s.random_stops ? { meanBetweenMs: ms(s.random_stops.mean_between_s.value), meanDurationMs: ms(s.random_stops.mean_duration_s.value) } : null,
    })),
    transfers: process.transfers.map((t) => ({
      id: t.id,
      name: `${process.stations[stationIndex.get(t.from_station)!]!.name} → ${process.stations[stationIndex.get(t.to_station)!]!.name}`,
      from: stationIndex.get(t.from_station)!,
      to: stationIndex.get(t.to_station)!,
      handlingMs: ms(t.handling_s.value),
      speedMps: t.speed_m_s.value,
    })),
    workers: workers.map(({ spec, tasks, start }) => ({ id: spec.id, name: spec.name, tasks, start, walkMps: spec.walk_speed_m_s.value })),
    locations: locations.map((l) => l.name),
    carryM,
    walkM: workers.map((w) => w.matrix),
    seed: process.seed,
  };
  return {
    ...base,
    locations,
    routes,
    input,
    outcome: blocked.length > 0 ? "blocked" : "ready",
    reasons: blocked.map((r) => `${locations[r.from]!.name} ↔ ${locations[r.to]!.name} is blocked for ${r.uses.join(", ")}: ${r.summary}`),
  };
}
