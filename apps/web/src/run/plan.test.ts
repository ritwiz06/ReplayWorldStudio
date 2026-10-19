// The sample hall's example shift on the real layout (SIM-01..04): every station is reachable
// along routes the route check finds clear; moving Machine B into the aisle blocks the material
// route honestly instead of walking through it; a move that changes no route changes nothing;
// and what playback shows at a moment depends only on that moment.
import { readFileSync } from "node:fs";
import { type DrawingAnalysis, type Project, validateDrawingAnalysis, validateProject } from "@replay-world/contracts";
import { describe, expect, it } from "vitest";
import { SAMPLE_MOVE_TO, sampleProject } from "../drawing/sampleProject";
import { drawingSource, toWorld } from "../drawing/world";
import { compareDays, plural, runDay, runOriginal } from "./day";
import { SAMPLE_PROCESS } from "./example";
import { accessPoint } from "./plan";

const data: unknown = JSON.parse(readFileSync(new URL("../../../../fixtures/drawings/layout-checks-mm.analysis.json", import.meta.url), "utf8"));
const checked = validateDrawingAnalysis(data);
if (!checked.ok) throw new Error("analysis");
const project = sampleProject(checked.value as DrawingAnalysis);

function moved(p: Project, id: string, x: number, z: number): Project {
  return { ...p, scene: { ...p.scene, revision: p.scene.revision + 1, objects: p.scene.objects.map((o) => (o.id === id ? { ...o, transform: { ...o.transform, position_m: { ...o.transform.position_m, x, z } } } : o)) } };
}

describe("the sample hall's example shift", () => {
  it("comes with the sample, every value an example assumption", () => {
    expect(project.process).toEqual(SAMPLE_PROCESS);
    expect(validateProject(project).ok).toBe(true);
    const values = JSON.stringify(SAMPLE_PROCESS).match(/"basis":"(\w+)"/g)!;
    expect(new Set(values)).toEqual(new Set(['"basis":"example"']));
    expect(SAMPLE_PROCESS.example_note).toMatch(/assumption/);
  });

  it("finds every route clear and runs a full shift: workers, transfers, queues, stops and output", () => {
    const day = runDay(project, SAMPLE_PROCESS, "edited");
    expect(day.plan.outcome).toBe("ready");
    expect(day.plan.routes.every((r) => r.outcome === "fits" && r.lengthM! > 0)).toBe(true);
    const run = day.result!;
    expect(run.engine).toBe("rws-run/1");
    const types = new Set(run.events.map((e) => e.type));
    for (const t of ["pick", "walk", "drop", "load", "run", "done", "stop", "break"]) expect(types).toContain(t);
    expect(run.metrics.completed).toBeGreaterThan(80);
    expect(run.metrics.created - run.metrics.completed).toBe(run.metrics.unfinished);
    const packing = run.metrics.stations.find((s) => s.id === "packing")!;
    expect(packing.inputMax).toBe(4); // a queue forms in front of the slowest step
    expect(run.metrics.busiest).toBe("Packing table");
    expect(run.metrics.stations.find((s) => s.id === "machine-b")!.share.down).toBeCloseTo(1200 / 28800, 2);
    // Running it again gives the same events.
    expect(runDay(project, SAMPLE_PROCESS, "edited").result!.fingerprint).toBe(run.fingerprint);
  });

  it("blocks the material route when Machine B stands in the aisle, and says so", () => {
    const at = toWorld(drawingSource(project)!.source_to_world, SAMPLE_MOVE_TO);
    const edited = moved(project, "obj-dxf-111", at.x, at.z);
    const original = runOriginal(edited, SAMPLE_PROCESS)!;
    const day = runDay(edited, SAMPLE_PROCESS, "edited");
    expect(day.plan.outcome).toBe("blocked");
    expect(day.plan.reasons[0]).toMatch(/^Rack A \(material\) ↔ Mixer is blocked .*narrows to 0\.50 m between Rack A and Machine B/);
    expect(day.result!.metrics).toMatchObject({ created: 0, completed: 0 });
    expect(original.result!.metrics.completed).toBe(runDay(project, SAMPLE_PROCESS, "original").result!.metrics.completed);
    const comparison = compareDays(original, day, SAMPLE_PROCESS);
    expect(comparison.rows[0]).toMatchObject({ label: "Completed batches", after: "0", worse: true });
    expect(comparison.explanation[0]).toMatch(/^Rack A \(material\) ↔ Mixer is blocked in the edited layout/);
    expect(comparison.explanation).toContain(`Output goes from ${original.result!.metrics.completed} to 0 completed batches (−${original.result!.metrics.completed}).`);
  });

  it("changes nothing when a move changes no route", () => {
    const tank = project.scene.objects.find((o) => o.name === "Water tank")!;
    const edited = moved(project, tank.id, tank.transform.position_m.x, tank.transform.position_m.z + 0.5);
    const comparison = compareDays(runOriginal(edited, SAMPLE_PROCESS)!, runDay(edited, SAMPLE_PROCESS, "edited"), SAMPLE_PROCESS);
    expect(comparison.identical).toBe(true);
    expect(comparison.explanation[0]).toMatch(/moving equipment alone does not change the result/);
  });

  it("explains a shorter route by its length and the entered speed", () => {
    const table = project.scene.objects.find((o) => o.name === "Packing table")!;
    const edited = moved(project, table.id, table.transform.position_m.x + 4, table.transform.position_m.z);
    const comparison = compareDays(runOriginal(edited, SAMPLE_PROCESS)!, runDay(edited, SAMPLE_PROCESS, "edited"), SAMPLE_PROCESS);
    expect(comparison.identical).toBe(false);
    expect(comparison.explanation.some((line) => /^Machine B ↔ Packing table is \d+\.\d m in the original layout and \d+\.\d m now \(−\d\.\d m\): about \d+ s less each way at the entered 1\.0 m\/s\.$/.test(line))).toBe(true);
  });

  it("shows the same moment the same way whatever was shown before (playback cannot change it)", () => {
    const day = runDay(project, SAMPLE_PROCESS, "edited");
    const replay = day.replay!;
    const moments = [0, 3_600_000, 1_234_567, 28_799_000, 10_800_500, 600_000];
    const forward = moments.map((t) => JSON.stringify(replay.frame(t)));
    const backward = [...moments].reverse().map((t) => JSON.stringify(replay.frame(t))).reverse();
    expect(backward).toEqual(forward);
    const late = replay.frame(28_799_000);
    expect(late.clock).toBe("13:59");
    expect(late.completed).toBe(day.result!.metrics.completed);
    // At the shift start Worker 1 is on the way to fetch the first batch.
    const start = replay.frame(5_000);
    expect(start.workers[0]!.activity).toBe("walking");
  });

  it("keeps a station's access point with its object when it moves and turns", () => {
    const mixer = project.scene.objects.find((o) => o.name === "Mixer")!;
    const at = accessPoint(mixer, { x: 1.591, z: 1.591 });
    expect([at.x, at.z].map((v) => Number(v.toFixed(2)))).toEqual([0.25, -3.6]);
    expect(plural("batch")).toBe("batches");
    expect(plural("tray")).toBe("trays");
    expect(plural("body")).toBe("bodies");
  });
});
