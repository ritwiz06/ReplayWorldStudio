// What a run looks like at one moment (SIM-03), derived only from its event log and the
// timelines the engine recorded: where each worker is and what they carry, each station's state
// and queue, and the counts so far. A pure function of (run, time), so pausing, changing speed,
// scrubbing or switching camera can never change what happened.
import type { Vec } from "../checks/geometry";
import type { RunEvent, RunResult, StationState, WorkerState } from "./engine";
import type { RunPlan } from "./plan";

export interface WorkerFrame {
  id: string;
  name: string;
  at: Vec;
  /** Direction of travel (radians about +Y), for the figure to face. */
  heading: number;
  activity: WorkerState;
  /** What they are doing, e.g. "carrying a batch to Mixer". */
  doing: string;
  carrying: boolean;
}

export interface StationFrame {
  id: string;
  name: string;
  objectId: string;
  supply: boolean;
  state: StationState;
  hasItem: boolean;
  input: number;
  output: number;
  inCap: number;
  outCap: number;
  /** Seconds left in the current loading or running phase. */
  remainingS: number | null;
  at: Vec;
}

export interface Frame {
  t: number;
  clock: string;
  created: number;
  completed: number;
  workers: WorkerFrame[];
  stations: StationFrame[];
}

interface Activity {
  start: number;
  end: number;
  kind: "walk" | "pick" | "drop" | "load" | "break";
  event: RunEvent;
  /** Location (index) during, or after, the activity. */
  loc: number;
}

const lastAtOrBefore = <T>(items: readonly T[], t: number, key: (item: T) => number): T | null => {
  let lo = 0;
  let hi = items.length - 1;
  let found: T | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (key(items[mid]!) <= t) {
      found = items[mid]!;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
};

const countAtOrBefore = (sorted: readonly number[], t: number) => {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

export function clockText(startClockS: number, ms: number): string {
  const total = Math.floor(startClockS + ms / 1000);
  const h = Math.floor(total / 3600) % 24;
  const m = Math.floor((total % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export class Replay {
  private readonly activities: Activity[][];
  private readonly carries: [number, number][][];
  private readonly cycles: { start: number; end: number }[][];
  private readonly created: number[];
  private readonly completed: number[];

  constructor(
    readonly run: RunResult,
    readonly plan: RunPlan,
    private readonly startClockS: number,
    private readonly itemName: string,
  ) {
    const input = plan.input!;
    this.activities = input.workers.map(() => []);
    this.carries = input.workers.map(() => []);
    this.cycles = input.stations.map(() => []);
    this.created = [];
    this.completed = [];
    const loc = input.workers.map((w) => w.start);
    const picked = new Map<number, number>();
    for (const e of run.events) {
      if (e.type === "walk") {
        this.activities[e.worker]!.push({ start: e.t, end: e.t + e.ms, kind: "walk", event: e, loc: e.to });
        loc[e.worker] = e.to;
      } else if (e.type === "pick") {
        this.activities[e.worker]!.push({ start: e.t, end: e.t + e.ms, kind: "pick", event: e, loc: input.stations[e.station]!.location });
        picked.set(e.worker, e.t);
        if (e.created) this.created.push(e.t);
      } else if (e.type === "drop") {
        this.activities[e.worker]!.push({ start: e.t - e.ms, end: e.t, kind: "drop", event: e, loc: input.stations[e.station]!.location });
        this.carries[e.worker]!.push([picked.get(e.worker) ?? e.t, e.t]);
        picked.delete(e.worker);
      } else if (e.type === "load") {
        if (e.worker !== null) this.activities[e.worker]!.push({ start: e.t, end: e.t + e.ms, kind: "load", event: e, loc: input.stations[e.station]!.location });
        if (e.ms > 0) this.cycles[e.station]!.push({ start: e.t, end: e.t + e.ms });
      } else if (e.type === "run") {
        this.cycles[e.station]!.push({ start: e.t, end: e.t + e.ms });
      } else if (e.type === "break") {
        this.activities[e.worker]!.push({ start: e.t, end: e.t + e.ms, kind: "break", event: e, loc: loc[e.worker]! });
      } else if (e.type === "done" && e.to === "complete") this.completed.push(e.t);
    }
    // Drops are recorded when they end; keep each worker's activities in start order.
    for (const list of this.activities) list.sort((a, b) => a.start - b.start);
    // Carries still open at the shift end.
    picked.forEach((start, w) => this.carries[w]!.push([start, Number.POSITIVE_INFINITY]));
  }

  /** The route a walk follows, from its start to its end: the carry's corridor, or the
   * worker's own when their hands are empty. */
  private path(from: number, to: number, worker: number, transfer: number | null): Vec[] {
    const corridor = transfer !== null ? this.plan.corridors.transfers[transfer]! : this.plan.corridors.workers[worker]!;
    const [a, b] = from < to ? [from, to] : [to, from];
    const route = this.plan.routes.find((r) => r.from === a && r.to === b && Math.abs(r.corridorM - corridor) < 1e-9 && r.outcome === "fits");
    const points = route?.path ?? [this.plan.locations[from]!.at, this.plan.locations[to]!.at];
    return from < to ? points : [...points].reverse();
  }

  frame(t: number): Frame {
    const input = this.plan.input!;
    const workers = input.workers.map((spec, w): WorkerFrame => {
      const carrying = this.carries[w]!.some(([a, b]) => a <= t && t < b);
      const last = lastAtOrBefore(this.activities[w]!, t, (a) => a.start);
      const home = this.plan.locations[spec.start]!.at;
      if (!last) return { id: spec.id, name: spec.name, at: home, heading: 0, activity: "idle", doing: "waiting for work", carrying };
      const active = t < last.end;
      const place = this.plan.locations[last.loc]!.at;
      const e = last.event;
      if (active && e.type === "walk") {
        const path = this.path(e.from, e.to, w, e.item !== null ? e.transfer : null);
        const { at, heading } = along(path, (t - e.t) / Math.max(e.ms, 1));
        const to = input.stations[input.stations.findIndex((s) => s.location === e.to)]?.name ?? "";
        return { id: spec.id, name: spec.name, at, heading, activity: e.item !== null ? "carrying" : "walking", doing: e.item !== null ? `carrying a ${this.itemName} to ${to}` : `walking to ${to}`, carrying };
      }
      if (active && e.type === "pick") return { id: spec.id, name: spec.name, at: place, heading: 0, activity: "carrying", doing: `picking up a ${this.itemName} at ${input.stations[e.station]!.name}`, carrying };
      if (active && e.type === "drop") return { id: spec.id, name: spec.name, at: place, heading: 0, activity: "carrying", doing: `setting a ${this.itemName} down at ${input.stations[e.station]!.name}`, carrying };
      if (active && e.type === "load") return { id: spec.id, name: spec.name, at: place, heading: 0, activity: "working", doing: `working at ${input.stations[e.station]!.name}`, carrying: false };
      if (active && e.type === "break") return { id: spec.id, name: spec.name, at: place, heading: 0, activity: "break", doing: e.name.toLowerCase(), carrying };
      return { id: spec.id, name: spec.name, at: place, heading: 0, activity: "idle", doing: carrying ? `holding a ${this.itemName}` : "waiting for work", carrying };
    });
    const stations = input.stations.map((spec, s): StationFrame => {
      const state = lastAtOrBefore(this.run.stationStates[s]!, t, (seg) => seg.t)?.state ?? "idle";
      const queue = lastAtOrBefore(this.run.queues[s]!, t, (q) => q.t) ?? { input: 0, output: 0 };
      const cycle = lastAtOrBefore(this.cycles[s]!, t, (c) => c.start);
      const location = this.plan.locations[s]!;
      return {
        id: spec.id,
        name: spec.name,
        objectId: location.objectId,
        supply: spec.supply,
        state: spec.supply ? "idle" : state,
        hasItem: state === "loading" || state === "running" || state === "blocked",
        input: queue.input,
        output: queue.output,
        inCap: spec.inCap,
        outCap: spec.outCap,
        remainingS: cycle && t < cycle.end && (state === "loading" || state === "running") ? Math.ceil((cycle.end - t) / 1000) : null,
        at: location.at,
      };
    });
    return {
      t,
      clock: clockText(this.startClockS, t),
      created: countAtOrBefore(this.created, t),
      completed: countAtOrBefore(this.completed, t),
      workers,
      stations,
    };
  }
}

/** The point a fraction of the way along a polyline, and the direction there. */
export function along(path: readonly Vec[], fraction: number): { at: Vec; heading: number } {
  if (path.length < 2) return { at: path[0] ?? { x: 0, z: 0 }, heading: 0 };
  const lengths = path.slice(1).map((p, i) => Math.hypot(p.x - path[i]!.x, p.z - path[i]!.z));
  const total = lengths.reduce((a, b) => a + b, 0);
  let left = Math.min(Math.max(fraction, 0), 1) * total;
  for (let i = 0; i < lengths.length; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    const heading = Math.atan2(b.x - a.x, b.z - a.z);
    if (left <= lengths[i]! || i === lengths.length - 1) {
      const f = lengths[i]! > 0 ? Math.min(left / lengths[i]!, 1) : 1;
      return { at: { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f }, heading };
    }
    left -= lengths[i]!;
  }
  return { at: path.at(-1)!, heading: 0 };
}
