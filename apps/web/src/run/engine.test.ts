// Known answers for the "Run a day" engine (SIM-02). Every expected count is worked out by hand
// from the rules in engine.ts, on processes small enough to follow step by step.
import { describe, expect, it } from "vitest";
import { type RunEvent, type SimInput, type SimStation, type SimTask, simulate, stopsFor } from "./engine";

const S = 1000;

function station(id: string, location: number, over: Partial<SimStation> = {}): SimStation {
  return { id, name: id, supply: false, workerMs: 0, machineMs: 60 * S, inCap: 1, outCap: 1, location, plannedStops: [], randomStops: null, ...over };
}

const supply: SimStation = { ...station("supply", 0), supply: true, workerMs: 0, machineMs: 0, inCap: 0, outCap: 0 };

/** A line of stations with one carry between each pair; every distance is `d` metres. */
function line(stations: SimStation[], workers: { tasks: SimTask[]; start?: number }[], over: Partial<SimInput> & { d?: number; handlingMs?: number } = {}): SimInput {
  const d = over.d ?? 0;
  const n = stations.length;
  const transfers = stations.slice(1).map((_, i) => ({ id: `t${i}`, name: `t${i}`, from: i, to: i + 1, handlingMs: over.handlingMs ?? 0, speedMps: 1 }));
  const matrix = Array.from({ length: n }, (_, a) => Array.from({ length: n }, (_, b) => (a === b ? 0 : d)));
  return {
    shiftMs: 3600 * S,
    breaks: [],
    stations,
    transfers,
    workers: workers.map((w, i) => ({ id: `w${i}`, name: `Worker ${i + 1}`, tasks: w.tasks, start: w.start ?? 0, walkMps: 1 })),
    locations: stations.map((s) => s.id),
    carryM: transfers.map(() => d),
    walkM: workers.map(() => matrix),
    seed: 1,
    ...over,
  };
}

const carry = (transfer: number): SimTask => ({ kind: "transfer", transfer });
const work = (s: number): SimTask => ({ kind: "station", station: s });
/** Follow every item through the events: each move starts where the item is, so nothing
 * appears, vanishes or skips a step. Returns where each item ended. */
function conserved(events: RunEvent[]): Map<number, string> {
  const where = new Map<number, string>();
  const move = (item: number, from: string | null, to: string) => {
    expect(where.get(item) ?? null).toBe(from);
    where.set(item, to);
  };
  for (const e of events) {
    if (e.type === "pick") move(e.item, e.created ? null : `out:${e.station}`, `carried:${e.worker}`);
    if (e.type === "drop") move(e.item, `carried:${e.worker}`, `in:${e.station}`);
    if (e.type === "load") move(e.item, `in:${e.station}`, `station:${e.station}`);
    if (e.type === "done") move(e.item, `station:${e.station}`, e.to === "complete" ? "complete" : e.to === "output" ? `out:${e.station}` : `station:${e.station}`);
    if (e.type === "release") move(e.item, `station:${e.station}`, `out:${e.station}`);
  }
  return where;
}

const done = (events: RunEvent[]) => events.filter((e) => e.type === "done" && e.to === "complete").map((e) => e.t / S);

describe("Run a day engine: known answers", () => {
  it("counts output: one carrier feeding a 60 s machine 10 m away", () => {
    // Picks at 0 and 20 s fill the machine and its one-place input; after that each item is
    // fetched when the machine takes the previous one, so it completes every 60 s from 70 s.
    const run = simulate(line([supply, station("press", 1)], [{ tasks: [carry(0)] }], { d: 10 }));
    expect(done(run.events).slice(0, 3)).toEqual([70, 130, 190]);
    conserved(run.events);
    expect(run.metrics.completed).toBe(59); // 70 + 60k < 3600 for k = 0..58
    expect(run.metrics.created).toBe(61);
    expect(run.metrics.unfinished).toBe(2);
    expect(run.metrics.unfinishedAt).toEqual({ inputs: 1, inStations: 1, outputs: 0, carried: 0 });
  });

  it("blocks a station whose output is full, and releases it when an item is taken away", () => {
    // A 10 s cutter feeds a 100 s welder through one-place buffers: the welder completes every
    // 100 s from 110 s, and the cutter spends most of the shift blocked, holding an item.
    const input = line([supply, station("cutter", 1, { machineMs: 10 * S }), station("welder", 2, { machineMs: 100 * S })], [{ tasks: [carry(1), carry(0)] }], { shiftMs: 1000 * S });
    const run = simulate(input);
    expect(done(run.events)).toEqual([110, 210, 310, 410, 510, 610, 710, 810, 910]);
    conserved(run.events);
    const cutter = run.metrics.stations.find((s) => s.id === "cutter")!;
    const welder = run.metrics.stations.find((s) => s.id === "welder")!;
    expect(run.events.find((e) => e.type === "done" && e.to === "blocked")?.t).toBe(40 * S);
    expect(run.events.find((e) => e.type === "release")?.t).toBe(110 * S);
    expect(cutter.share.blocked).toBeGreaterThan(0.75);
    expect(welder.share.running).toBeCloseTo(0.99, 5); // running from 10 s to the end
    expect(cutter.outputMax).toBe(1);
  });

  it("takes a break when it is due or as soon as the task in hand ends, for its full length", () => {
    // A 100 s manual station worked by its only worker; the break is at 250 s for 100 s, during
    // a cycle that ends at 300 s, so the break runs 300-400 s and one item is lost to it.
    const input = line([supply, station("pack", 1, { workerMs: 100 * S, machineMs: 0 })], [{ tasks: [carry(0), work(1)] }], { shiftMs: 1000 * S, breaks: [{ id: "b", name: "Break", startMs: 250 * S, durationMs: 100 * S }] });
    const run = simulate(input);
    expect(done(run.events)).toEqual([100, 200, 300, 500, 600, 700, 800, 900]);
    expect(run.events.find((e) => e.type === "break")).toEqual({ t: 300 * S, type: "break", worker: 0, ms: 100 * S, name: "Break" });
    expect(run.metrics.workers[0]!.share.break).toBeCloseTo(0.1, 6);
    const without = simulate({ ...input, breaks: [] });
    expect(without.metrics.completed).toBe(9);
  });

  it("starts no cycle during a stop, letting the running one finish", () => {
    // A 100 s machine with a stop from 150 s to 400 s: the cycle running at 150 s ends at 200 s,
    // nothing starts until 400 s, so two cycles are lost and it is down 200-400 s.
    const input = line([supply, station("oven", 1, { machineMs: 100 * S, inCap: 5, plannedStops: [{ startMs: 150 * S, endMs: 400 * S, reason: "planned stop", planned: true }] })], [{ tasks: [carry(0)] }], { shiftMs: 1000 * S });
    const run = simulate(input);
    expect(done(run.events)).toEqual([100, 200, 500, 600, 700, 800, 900]);
    conserved(run.events);
    const oven = run.metrics.stations[0]!;
    expect(oven.share.down).toBeCloseTo(0.2, 6);
    expect(run.events.filter((e) => e.type === "stop")).toEqual([{ t: 150 * S, type: "stop", station: 1, ms: 250 * S, reason: "planned stop", planned: true }]);
  });

  it("never gives one worker two tasks at once: one worker for two manual stations halves the output", () => {
    const stations = [supply, station("a", 1, { workerMs: 100 * S, machineMs: 0 }), station("b", 2, { workerMs: 100 * S, machineMs: 0 })];
    const one = simulate(line(stations, [{ tasks: [carry(1), work(2), carry(0), work(1)] }], { shiftMs: 1000 * S }));
    const two = simulate(line(stations, [{ tasks: [carry(1), work(2)] }, { tasks: [carry(0), work(1)] }], { shiftMs: 1000 * S }));
    expect(done(one.events)).toEqual([200, 400, 600, 800]);
    expect(done(two.events)).toEqual([200, 300, 400, 500, 600, 700, 800, 900]);
    // Each worker's timed activities never overlap.
    for (const run of [one, two]) {
      const busy = new Map<number, [number, number][]>();
      for (const e of run.events) {
        const worker = "worker" in e ? e.worker : null;
        if (worker === null) continue;
        if (e.type === "load" || e.type === "walk" || e.type === "pick" || e.type === "break") busy.set(worker, [...(busy.get(worker) ?? []), [e.t, e.t + e.ms]]);
        if (e.type === "drop") busy.set(worker, [...(busy.get(worker) ?? []), [e.t - e.ms, e.t]]);
      }
      for (const spans of busy.values()) {
        const sorted = [...spans].sort((a, b) => a[0] - b[0]);
        sorted.slice(1).forEach((s, i) => expect(s[0]).toBeGreaterThanOrEqual(sorted[i]![1]));
      }
    }
  });

  it("conserves items: every item created is completed or still somewhere at every moment", () => {
    const stations = [supply, station("a", 1, { workerMs: 20 * S, machineMs: 50 * S, inCap: 2, outCap: 2 }), station("b", 2, { workerMs: 30 * S, machineMs: 0, inCap: 3 })];
    const run = simulate(line(stations, [{ tasks: [carry(0), work(1)] }, { tasks: [carry(1), work(2)] }], { d: 7, handlingMs: 5 * S }));
    const where = conserved(run.events);
    const final = [...where.values()];
    expect(final.length).toBe(run.metrics.created);
    expect(final.filter((w) => w === "complete").length).toBe(run.metrics.completed);
    expect(run.metrics.created - run.metrics.completed).toBe(run.metrics.unfinished);
    const at = run.metrics.unfinishedAt;
    expect(at.inputs + at.inStations + at.outputs + at.carried).toBe(run.metrics.unfinished);
  });

  it("moves nothing along a blocked route", () => {
    const input = line([supply, station("press", 1)], [{ tasks: [carry(0)] }], { d: 10 });
    const run = simulate({ ...input, carryM: [null] });
    expect(run.metrics).toMatchObject({ created: 0, completed: 0, unfinished: 0 });
    expect(run.events.map((e) => e.type)).toEqual(["shift_start", "shift_end"]);
  });

  it("gives the same events for the same input and seed, and draws unplanned stops from the seed", () => {
    const input = line([supply, station("press", 1, { machineMs: 30 * S, inCap: 3, randomStops: { meanBetweenMs: 600 * S, meanDurationMs: 60 * S } })], [{ tasks: [carry(0)] }], { d: 5 });
    const a = simulate(input);
    const b = simulate(structuredClone(input));
    expect(b.fingerprint).toBe(a.fingerprint);
    expect(b.events).toEqual(a.events);
    const other = simulate({ ...input, seed: 2 });
    expect(other.fingerprint).not.toBe(a.fingerprint);
    const stops = stopsFor(input)[1]!;
    expect(stops.length).toBeGreaterThan(0);
    for (const stop of stops) expect([stop.startMs % S, stop.endMs % S]).toEqual([0, 0]);
  });
});
