// "Run a day" (SIM-02): a deterministic, event-based production model. Items are created at the
// supply, carried between stations, processed and completed only by events; the 3D playback
// replays this log and never makes anything happen by itself. Workers are limited resources:
// one task at a time, chosen in their own priority order, with walking time, working hours and
// breaks. Buffers are finite, so a full one blocks the station before it. The same input and
// seed always give the same events, whatever the playback speed or camera.
//
// Rules, kept small so a result can be explained:
// - Times are whole milliseconds from the shift start; anything at or after the shift end does
//   not happen. An item counts as completed if its last step ends before the shift ends.
// - A process station's cycle is `workerMs` with a worker present, then `machineMs` on its own.
//   A station with `workerMs = 0` starts by itself when it has an item.
// - When a cycle ends the item goes to the station's output; if that is full the station is
//   blocked, holding the item, until a worker takes one away. The last station completes items.
// - A worker takes a carry only when the item is there and a place is free at the destination
//   (both reserved), and works at a station only when it has an item and is not stopped.
// - A stop (planned, or drawn from the seed) lets a running cycle finish; no cycle starts during
//   it. A break starts at its time, or when the task in hand ends, and lasts its full length.
// - Routes are distances from the layout (route checks); a blocked route is a task that cannot
//   be done. Nothing walks through equipment: there is no shortcut when a route is blocked.

export const ENGINE_VERSION = "rws-run/1";

export interface SimStop {
  startMs: number;
  endMs: number;
  reason: string;
  planned: boolean;
}

export interface SimStation {
  id: string;
  name: string;
  supply: boolean;
  workerMs: number;
  machineMs: number;
  inCap: number;
  outCap: number;
  /** Index into `locations`: where a worker stands to load, unload or pick. */
  location: number;
  plannedStops: SimStop[];
  /** Unplanned stops drawn from the seed: mean gap and mean length (ms). */
  randomStops: { meanBetweenMs: number; meanDurationMs: number } | null;
}

export interface SimTransfer {
  id: string;
  name: string;
  from: number;
  to: number;
  handlingMs: number;
  speedMps: number;
}

export type SimTask = { kind: "station"; station: number } | { kind: "transfer"; transfer: number };

export interface SimWorker {
  id: string;
  name: string;
  tasks: SimTask[];
  /** Location the worker starts the shift at. */
  start: number;
  walkMps: number;
}

export interface SimBreak {
  id: string;
  name: string;
  startMs: number;
  durationMs: number;
}

export interface SimInput {
  shiftMs: number;
  breaks: SimBreak[];
  stations: SimStation[];
  transfers: SimTransfer[];
  workers: SimWorker[];
  locations: string[];
  /** Carrying distance (m) for each transfer, from its station to the next; null when its
   * route is blocked. */
  carryM: (number | null)[];
  /** Walking distance (m) for each worker between two locations when carrying nothing; null
   * when blocked. */
  walkM: (number | null)[][][];
  seed: number;
}

export type RunEvent =
  | { t: number; type: "shift_start" }
  | { t: number; type: "shift_end" }
  | { t: number; type: "walk"; worker: number; from: number; to: number; ms: number; item: number | null; transfer: number | null }
  /** The item leaves the station (or is taken from the supply) at `t`; handling lasts `ms`. */
  | { t: number; type: "pick"; worker: number; item: number; station: number; transfer: number; ms: number; created: boolean }
  /** The item reaches the station's input at `t`, after `ms` of setting it down. */
  | { t: number; type: "drop"; worker: number; item: number; station: number; transfer: number; ms: number }
  /** The item enters the station; the worker works with it for `ms` (none for a station that
   * starts by itself, with `ms` 0). */
  | { t: number; type: "load"; worker: number | null; station: number; item: number; ms: number }
  /** The station runs on its own for `ms`. */
  | { t: number; type: "run"; station: number; item: number; ms: number }
  | { t: number; type: "done"; station: number; item: number; to: "output" | "blocked" | "complete" }
  /** A blocked station's item moves into its output once there is room. */
  | { t: number; type: "release"; station: number; item: number }
  | { t: number; type: "stop"; station: number; ms: number; reason: string; planned: boolean }
  | { t: number; type: "break"; worker: number; ms: number; name: string };

export type StationState = "idle" | "waiting" | "loading" | "running" | "blocked" | "down";
export type WorkerState = "idle" | "walking" | "carrying" | "working" | "break";

export interface Segment<S> {
  t: number;
  state: S;
}

export interface QueuePoint {
  t: number;
  input: number;
  output: number;
}

export interface StationMetrics {
  id: string;
  name: string;
  cycles: number;
  /** Share of the shift in each state (0-1). */
  share: Record<StationState, number>;
  inputMax: number;
  inputMean: number;
  outputMax: number;
  outputMean: number;
}

export interface WorkerMetrics {
  id: string;
  name: string;
  share: Record<WorkerState, number>;
  tasksDone: number;
}

export interface RunMetrics {
  created: number;
  completed: number;
  unfinished: number;
  /** Where the unfinished items were at the shift end. */
  unfinishedAt: { inputs: number; inStations: number; outputs: number; carried: number };
  stations: StationMetrics[];
  workers: WorkerMetrics[];
  /** The process station busiest over the shift (loading plus running), if any worked. */
  busiest: string | null;
}

export interface RunResult {
  engine: string;
  seed: number;
  events: RunEvent[];
  stationStates: Segment<StationState>[][];
  queues: QueuePoint[][];
  stops: SimStop[][];
  metrics: RunMetrics;
  fingerprint: string;
}

/** Deterministic 32-bit generator (mulberry32). */
export function generator(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stable 53-bit hash of a string, as 14 hex digits (cyrb53): identifies an event log. */
export function fingerprint(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

const stringHash = (text: string) => parseInt(fingerprint(text).slice(-8), 16);

/** The stops at each station over the shift: planned ones and those drawn from the seed, in
 * time order, merged where they overlap, all in whole seconds. */
export function stopsFor(input: SimInput): SimStop[][] {
  return input.stations.map((station) => {
    const stops = [...station.plannedStops];
    if (station.randomStops && station.randomStops.meanBetweenMs > 0 && station.randomStops.meanDurationMs > 0) {
      const next = generator((input.seed ^ stringHash(station.id)) >>> 0);
      const draw = (mean: number) => Math.max(1000, Math.round((-Math.log(1 - next()) * mean) / 1000) * 1000);
      let t = 0;
      for (;;) {
        const start = t + draw(station.randomStops.meanBetweenMs);
        if (start >= input.shiftMs) break;
        const end = start + draw(station.randomStops.meanDurationMs);
        stops.push({ startMs: start, endMs: end, reason: "unplanned stop (drawn from the seed)", planned: false });
        t = end;
      }
    }
    stops.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
    const merged: SimStop[] = [];
    for (const stop of stops) {
      const last = merged.at(-1);
      if (last && stop.startMs <= last.endMs) {
        if (stop.endMs > last.endMs) merged[merged.length - 1] = { ...last, endMs: stop.endMs, reason: `${last.reason}; ${stop.reason}`, planned: last.planned && stop.planned };
      } else merged.push({ ...stop });
    }
    return merged;
  });
}

interface StationRun {
  inQ: number[];
  inReserved: number;
  outQ: number[];
  outReserved: number;
  current: number | null;
  phase: "idle" | "loading" | "running" | "blocked";
  claimedBy: number | null;
  cycles: number;
  state: StationState;
}

interface WorkerRun {
  loc: number;
  busy: boolean;
  onBreak: boolean;
  nextBreak: number;
  carrying: number | null;
  activity: WorkerState;
  since: number;
  tasksDone: number;
  share: Record<WorkerState, number>;
}

interface Timer {
  t: number;
  seq: number;
  run: () => void;
}

/** Run the shift. Pure: the result depends only on `input`. */
export function simulate(input: SimInput): RunResult {
  const end = input.shiftMs;
  const stops = stopsFor(input);
  const events: RunEvent[] = [];
  const timers: Timer[] = [];
  let seq = 0;
  let now = 0;
  let nextItem = 0;
  let completed = 0;
  const at = (t: number, run: () => void) => {
    const timer = { t, seq: seq++, run };
    // Insert keeping (t, seq) order; the queue stays small, so a linear insert is enough.
    let i = timers.length;
    while (i > 0 && (timers[i - 1]!.t > t || (timers[i - 1]!.t === t && timers[i - 1]!.seq > timer.seq))) i--;
    timers.splice(i, 0, timer);
  };
  const emit = (event: RunEvent) => {
    if (event.t < end) events.push(event);
  };

  const outgoing = input.stations.map((_, i) => input.transfers.some((t) => t.from === i));
  const stations: StationRun[] = input.stations.map(() => ({ inQ: [], inReserved: 0, outQ: [], outReserved: 0, current: null, phase: "idle", claimedBy: null, cycles: 0, state: "idle" }));
  const stationStates: Segment<StationState>[][] = input.stations.map(() => [{ t: 0, state: "idle" }]);
  const queues: QueuePoint[][] = input.stations.map(() => [{ t: 0, input: 0, output: 0 }]);
  const workers: WorkerRun[] = input.workers.map((w) => ({
    loc: w.start,
    busy: false,
    onBreak: false,
    nextBreak: 0,
    carrying: null,
    activity: "idle",
    since: 0,
    tasksDone: 0,
    share: { idle: 0, walking: 0, carrying: 0, working: 0, break: 0 },
  }));

  const stopped = (s: number, t: number) => stops[s]!.some((stop) => stop.startMs <= t && t < stop.endMs);
  const stopEnd = (s: number, t: number) => stops[s]!.find((stop) => stop.startMs <= t && t < stop.endMs)?.endMs ?? t;

  /** Record a station's state and queue lengths when they change. */
  const observe = () => {
    stations.forEach((st, i) => {
      const station = input.stations[i]!;
      if (station.supply) return;
      const state: StationState =
        st.phase === "blocked" ? "blocked" : st.phase === "loading" ? "loading" : st.phase === "running" ? "running" : stopped(i, now) ? "down" : st.inQ.length > 0 ? "waiting" : "idle";
      const states = stationStates[i]!;
      if (states.at(-1)!.state !== state) {
        if (states.at(-1)!.t === now) states[states.length - 1] = { t: now, state };
        else states.push({ t: now, state });
      }
      const q = queues[i]!;
      const last = q.at(-1)!;
      if (last.input !== st.inQ.length || last.output !== st.outQ.length) {
        const point = { t: now, input: st.inQ.length, output: st.outQ.length };
        if (last.t === now) q[q.length - 1] = point;
        else q.push(point);
      }
    });
  };

  const setActivity = (w: number, activity: WorkerState) => {
    const worker = workers[w]!;
    worker.share[worker.activity] += Math.min(now, end) - Math.min(worker.since, end);
    worker.activity = activity;
    worker.since = now;
  };

  const walkMs = (w: number, from: number, to: number): number | null => {
    if (from === to) return 0;
    const d = input.walkM[w]?.[from]?.[to];
    return d === null || d === undefined ? null : Math.round((d / input.workers[w]!.walkMps) * 1000);
  };

  /** Walk (if needed), then continue. */
  const walk = (w: number, to: number, item: number | null, transfer: number | null, ms: number, then: () => void) => {
    const worker = workers[w]!;
    if (ms === 0 || worker.loc === to) {
      worker.loc = to;
      then();
      return;
    }
    emit({ t: now, type: "walk", worker: w, from: worker.loc, to, ms, item, transfer });
    setActivity(w, item === null ? "walking" : "carrying");
    at(now + ms, () => {
      workers[w]!.loc = to;
      then();
    });
  };

  const free = (w: number) => {
    const worker = workers[w]!;
    worker.busy = false;
    worker.tasksDone++;
    setActivity(w, "idle");
  };

  const finishCycle = (s: number) => {
    const st = stations[s]!;
    const item = st.current!;
    st.cycles++;
    if (!outgoing[s]) {
      st.current = null;
      st.phase = "idle";
      completed++;
      emit({ t: now, type: "done", station: s, item, to: "complete" });
    } else if (st.outQ.length < input.stations[s]!.outCap) {
      st.current = null;
      st.phase = "idle";
      st.outQ.push(item);
      emit({ t: now, type: "done", station: s, item, to: "output" });
    } else {
      st.phase = "blocked";
      emit({ t: now, type: "done", station: s, item, to: "blocked" });
    }
  };

  const runMachine = (s: number) => {
    const station = input.stations[s]!;
    const st = stations[s]!;
    if (station.machineMs === 0) return finishCycle(s);
    st.phase = "running";
    emit({ t: now, type: "run", station: s, item: st.current!, ms: station.machineMs });
    at(now + station.machineMs, () => finishCycle(s));
  };

  /** Start a station's cycle: the worker (if any) is there and the station is not stopped. */
  const startCycle = (s: number, w: number | null) => {
    const station = input.stations[s]!;
    const st = stations[s]!;
    if (stopped(s, now)) {
      // Stopped while the worker walked here: wait at the station until the stop ends.
      if (w !== null) setActivity(w, "idle");
      at(stopEnd(s, now), () => startCycle(s, w));
      return;
    }
    const item = st.inQ.shift()!;
    st.current = item;
    st.claimedBy = null;
    if (w === null || station.workerMs === 0) {
      emit({ t: now, type: "load", worker: null, station: s, item, ms: 0 });
      if (w !== null) free(w);
      return runMachine(s);
    }
    st.phase = "loading";
    emit({ t: now, type: "load", worker: w, station: s, item, ms: station.workerMs });
    setActivity(w, "working");
    at(now + station.workerMs, () => {
      free(w);
      runMachine(s);
    });
  };

  const takeFromOutput = (s: number): number => {
    const st = stations[s]!;
    const item = st.outQ.shift()!;
    st.outReserved--;
    if (st.phase === "blocked") {
      st.outQ.push(st.current!);
      emit({ t: now, type: "release", station: s, item: st.current! });
      st.current = null;
      st.phase = "idle";
    }
    return item;
  };

  const doTransfer = (w: number, k: number) => {
    const transfer = input.transfers[k]!;
    const a = transfer.from;
    const b = transfer.to;
    const fromStation = input.stations[a]!;
    if (!fromStation.supply) stations[a]!.outReserved++;
    stations[b]!.inReserved++;
    const toA = walkMs(w, workers[w]!.loc, fromStation.location)!;
    walk(w, fromStation.location, null, null, toA, () => {
      const created = fromStation.supply;
      const item = created ? nextItem++ : takeFromOutput(a);
      workers[w]!.carrying = item;
      emit({ t: now, type: "pick", worker: w, item, station: a, transfer: k, ms: transfer.handlingMs, created });
      setActivity(w, "carrying");
      at(now + transfer.handlingMs, () => {
        const carryMs = Math.round((input.carryM[k]! / transfer.speedMps) * 1000);
        walk(w, input.stations[b]!.location, item, k, carryMs, () => {
          setActivity(w, "carrying");
          at(now + transfer.handlingMs, () => {
            workers[w]!.carrying = null;
            stations[b]!.inQ.push(item);
            stations[b]!.inReserved--;
            emit({ t: now, type: "drop", worker: w, item, station: b, transfer: k, ms: transfer.handlingMs });
            free(w);
          });
        });
      });
    });
  };

  const transferReady = (w: number, k: number): boolean => {
    const transfer = input.transfers[k]!;
    const a = input.stations[transfer.from]!;
    const b = input.stations[transfer.to]!;
    const from = stations[transfer.from]!;
    const to = stations[transfer.to]!;
    if (input.carryM[k] === null || walkMs(w, workers[w]!.loc, a.location) === null) return false;
    if (!a.supply && from.outQ.length - from.outReserved <= 0) return false;
    return to.inQ.length + to.inReserved < b.inCap;
  };

  const stationReady = (w: number, s: number): boolean => {
    const st = stations[s]!;
    return st.phase === "idle" && st.current === null && st.claimedBy === null && st.inQ.length > 0 && !stopped(s, now) && walkMs(w, workers[w]!.loc, input.stations[s]!.location) !== null;
  };

  const dispatch = () => {
    for (let changed = true; changed; ) {
      changed = false;
      // Stations that need no worker start by themselves.
      input.stations.forEach((station, s) => {
        if (station.supply || station.workerMs > 0) return;
        const st = stations[s]!;
        if (st.phase === "idle" && st.current === null && st.inQ.length > 0 && !stopped(s, now)) {
          startCycle(s, null);
          changed = true;
        }
      });
      input.workers.forEach((spec, w) => {
        const worker = workers[w]!;
        if (worker.busy) return;
        const due = input.breaks[worker.nextBreak];
        if (due && due.startMs <= now) {
          worker.busy = true;
          worker.nextBreak++;
          emit({ t: now, type: "break", worker: w, ms: due.durationMs, name: due.name });
          setActivity(w, "break");
          at(now + due.durationMs, () => {
            worker.busy = false;
            setActivity(w, "idle");
          });
          changed = true;
          return;
        }
        for (const task of spec.tasks) {
          if (task.kind === "station" ? stationReady(w, task.station) : transferReady(w, task.transfer)) {
            worker.busy = true;
            if (task.kind === "station") {
              const s = task.station;
              stations[s]!.claimedBy = w;
              const ms = walkMs(w, worker.loc, input.stations[s]!.location)!;
              walk(w, input.stations[s]!.location, null, null, ms, () => startCycle(s, w));
            } else doTransfer(w, task.transfer);
            changed = true;
            break;
          }
        }
      });
    }
  };

  // Wake the dispatcher when a break or a stop begins or ends, even if nothing else happens then.
  for (const b of input.breaks) at(b.startMs, () => undefined);
  stops.forEach((list, s) =>
    list.forEach((stop) => {
      at(stop.startMs, () => emit({ t: now, type: "stop", station: s, ms: stop.endMs - stop.startMs, reason: stop.reason, planned: stop.planned }));
      at(stop.endMs, () => undefined);
    }),
  );

  emit({ t: 0, type: "shift_start" });
  dispatch();
  observe();
  while (timers.length > 0 && timers[0]!.t < end) {
    now = timers[0]!.t;
    while (timers.length > 0 && timers[0]!.t === now) timers.shift()!.run();
    dispatch();
    observe();
  }
  now = end;
  events.push({ t: end, type: "shift_end" });
  workers.forEach((_, w) => setActivity(w, workers[w]!.activity));

  const created = nextItem;
  const carried = workers.filter((w) => w.carrying !== null).length;
  const inputs = stations.reduce((n, st) => n + st.inQ.length, 0);
  const outputs = stations.reduce((n, st) => n + st.outQ.length, 0);
  const inStations = stations.reduce((n, st) => n + (st.current !== null ? 1 : 0), 0);

  const metrics: RunMetrics = {
    created,
    completed,
    unfinished: created - completed,
    unfinishedAt: { inputs, inStations, outputs, carried },
    stations: input.stations
      .map((station, s) => ({ station, s }))
      .filter(({ station }) => !station.supply)
      .map(({ station, s }) => stationMetrics(station, stations[s]!.cycles, stationStates[s]!, queues[s]!, end)),
    workers: input.workers.map((spec, w) => ({
      id: spec.id,
      name: spec.name,
      tasksDone: workers[w]!.tasksDone,
      share: Object.fromEntries(Object.entries(workers[w]!.share).map(([k, v]) => [k, v / end])) as Record<WorkerState, number>,
    })),
    busiest: null,
  };
  const ranked = [...metrics.stations].sort((a, b) => b.share.loading + b.share.running - (a.share.loading + a.share.running));
  metrics.busiest = ranked[0] && ranked[0].cycles > 0 ? ranked[0].name : null;
  return { engine: ENGINE_VERSION, seed: input.seed, events, stationStates, queues, stops, metrics, fingerprint: fingerprint(JSON.stringify(events)) };
}

function stationMetrics(station: SimStation, cycles: number, states: Segment<StationState>[], queue: QueuePoint[], end: number): StationMetrics {
  const share: Record<StationState, number> = { idle: 0, waiting: 0, loading: 0, running: 0, blocked: 0, down: 0 };
  states.forEach((seg, i) => {
    const until = states[i + 1]?.t ?? end;
    share[seg.state] += (until - seg.t) / end;
  });
  let inputArea = 0;
  let outputArea = 0;
  queue.forEach((p, i) => {
    const until = queue[i + 1]?.t ?? end;
    inputArea += p.input * (until - p.t);
    outputArea += p.output * (until - p.t);
  });
  return {
    id: station.id,
    name: station.name,
    cycles,
    share,
    inputMax: Math.max(...queue.map((p) => p.input)),
    inputMean: inputArea / end,
    outputMax: Math.max(...queue.map((p) => p.output)),
    outputMean: outputArea / end,
  };
}
