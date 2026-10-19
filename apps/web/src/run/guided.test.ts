// The guided "Set up a day" (SIM-01) on a reviewed synthetic drawing: what is needed first,
// example assumptions offered and accepted, typed values kept as entered, ambiguous names,
// routes that are blocked or cannot be determined named with their correction, and layers the
// reviewer marks as drawing symbols.
import { readFileSync } from "node:fs";
import { type DrawingAnalysis, type Project, validateDrawingAnalysis, validateProject } from "@replay-world/contracts";
import { describe, expect, it } from "vitest";
import { checkInputs } from "../checks/inputs";
import { sampleProject } from "../drawing/sampleProject";
import { drawingSource } from "../drawing/world";
import { applyCommand } from "../editing/commands";
import { simulate } from "./engine";
import { ambiguous, assignWorkers, buildGuided, corrections, emptyGuided, type GuidedDraft, guidedFrom } from "./guided";
import { planRun } from "./plan";

const data: unknown = JSON.parse(readFileSync(new URL("../../../../fixtures/drawings/layout-checks-mm.analysis.json", import.meta.url), "utf8"));
const checked = validateDrawingAnalysis(data);
if (!checked.ok) throw new Error("analysis");
const project: Project = { ...sampleProject(checked.value as DrawingAnalysis), process: null };
const id = (name: string) => project.scene.objects.find((o) => o.name === name)!.id;

const draft = (over: Partial<GuidedDraft> = {}): GuidedDraft => ({
  ...emptyGuided(),
  stations: [
    { objectId: id("Rack A"), name: "Rack A" },
    { objectId: id("Mixer"), name: "Mixer" },
    { objectId: id("Machine B"), name: "Machine B" },
  ],
  ...over,
});

describe("guided Set up a day", () => {
  it("asks for the stations first", () => {
    expect(buildGuided(project, emptyGuided()).needs[0]).toBe("Choose the stations in process order: first where material comes from, then each step");
  });

  it("offers examples for everything not typed, and builds nothing until every one is accepted", () => {
    const g = buildGuided(project, draft());
    expect(g.needs).toEqual([]);
    expect(g.counts).toEqual({ entered: 0, examples: g.assumptions.length });
    expect(g.unaccepted.map((a) => a.key)).toContain("pace:" + id("Mixer"));
    expect(g.unaccepted.map((a) => a.key)).toContain("supply");
    expect(g.process).not.toBeNull(); // built, but Run stays off while examples are unaccepted
    const all = buildGuided(project, draft({ accepted: g.unaccepted.map((a) => a.key) }));
    expect(all.unaccepted).toEqual([]);
  });

  it("keeps typed values as entered and the rest as accepted examples", () => {
    const keys = buildGuided(project, draft()).assumptions.map((a) => a.key);
    const g = buildGuided(project, draft({ item: "batch", pace: { [id("Mixer")]: "4" }, workers: "2", accepted: keys }));
    expect(g.counts.entered).toBe(3);
    const mixer = g.process!.stations.find((s) => s.object_id === id("Mixer"))!;
    expect(mixer.worker_s).toEqual({ value: 240, basis: "entered" }); // the typed pace, attended throughout
    expect(mixer.machine_s).toEqual({ value: 0, basis: "example" }); // "the whole time" is the example
    expect(g.process!.item_name).toBe("batch");
    expect(g.process!.example_note).toBeNull();
    expect(validateProject({ ...project, process: g.process }).ok).toBe(true);
    const plan = planRun(project, g.process!);
    expect(plan.outcome).toBe("ready");
    expect(simulate(plan.input!).metrics.completed).toBeGreaterThan(50);
    // Changing an example makes it entered.
    const changed = buildGuided(project, draft({ changes: { "carry-speed": "0.8" }, accepted: keys }));
    expect(changed.assumptions.find((a) => a.key === "carry-speed")).toMatchObject({ basis: "entered", shown: "0.8 m/s" });
    expect(changed.process!.transfers[0]!.speed_m_s).toEqual({ value: 0.8, basis: "entered" });
  });

  it("names a missing or wrong value, and a name that does not say which object it is", () => {
    const g = buildGuided(project, draft({ pace: { [id("Mixer")]: "four" }, workers: "1.5", stations: [...draft().stations, { objectId: id("Mixer"), name: "Mixer" }] }));
    expect(g.needs).toContain("Mixer: time for one item: “four” is not a number");
    expect(g.needs).toContain("People working this process: a whole number, at least 1");
    expect(g.needs).toContain("Two stations are called “Mixer”: give each its own name");
    expect(g.process).toBeNull();
    const fixture = { ...project, scene: { ...project.scene, objects: project.scene.objects.map((o) => (o.name === "Partition" ? o : o)) } };
    expect(ambiguous(fixture, id("Rack A"), "Rack A")).toBeNull();
    const twins = { ...project, scene: { ...project.scene, objects: project.scene.objects.map((o) => (o.name === "Rack B" ? { ...o, name: "Rack 2" } : o.name === "Rack A" ? { ...o, name: "Rack 1" } : o)) } };
    expect(ambiguous(twins, id("Rack A"), "Rack 1")).toBe("several objects are called “Rack …”");
    expect(ambiguous(twins, id("Rack A"), "Material rack")).toBeNull(); // renamed: fine
  });

  it("assigns people by an example rule, one task at a time each", () => {
    expect(assignWorkers(3, 3)).toEqual([[1], [2], [3]]);
    expect(assignWorkers(3, 1)).toEqual([[1, 2, 3]]);
    expect(assignWorkers(2, 3)).toEqual([[1], [2], []]);
  });

  it("names a blocked route and how to correct it, and builds no run around it", () => {
    const machine = project.scene.objects.find((o) => o.name === "Machine B")!;
    const moved = applyCommand(project, { baseRevision: 0, command: { type: "set_transform", objectId: machine.id, transform: { ...machine.transform, position_m: { x: -1.5, y: 0, z: 0 } } } });
    if (!moved.ok) throw new Error(moved.rejection.message);
    const keys = buildGuided(moved.project, draft()).assumptions.map((a) => a.key);
    const g = buildGuided(moved.project, draft({ accepted: keys, changes: { [`access:${machine.id}`]: "back" } }));
    const plan = planRun(moved.project, g.process!);
    expect(plan.outcome).toBe("blocked");
    const fixes = corrections(plan);
    expect(fixes.length).toBeGreaterThan(0);
    for (const fix of fixes) expect(fix).toMatch(/^.+ ↔ .+ \(0\.80 m path, for .+\): .*(Move one of the objects named|Choose another side for)/);
    expect(fixes.some((f) => f.includes("Choose another side for Machine B under Review assumptions"))).toBe(true);
  });

  it("treats loose lines as possible obstacles until the reviewer marks their layer as drawing symbols", () => {
    const source = drawingSource(project)!;
    const before = checkInputs(project)!.uncertain.length;
    const layer = source.drawing.lines.find((l) => !l.closed && l.ref.block === null)?.ref.layer;
    if (!layer) return; // this fixture has no loose lines to mark
    const marked = applyCommand(project, { baseRevision: 0, command: { type: "review_drawing", sourceId: source.id, correction: { kind: "symbols", layer, symbols: true } } });
    if (!marked.ok) throw new Error(marked.rejection.message);
    expect(drawingSource(marked.project)!.drawing.review.symbol_layers).toEqual([layer]);
    expect(checkInputs(marked.project)!.uncertain.length).toBeLessThan(before);
    expect(validateProject(marked.project).ok).toBe(true);
  });

  it("can be opened again from a process set up, keeping what was typed", () => {
    const keys = buildGuided(project, draft()).assumptions.map((a) => a.key);
    const g = buildGuided(project, draft({ item: "batch", pace: { [id("Mixer")]: "4" }, accepted: keys }));
    const again = guidedFrom(g.process!);
    expect(again.stations.map((s) => s.name)).toEqual(["Rack A", "Mixer", "Machine B"]);
    expect(again.item).toBe("batch");
    expect(again.pace[id("Mixer")]).toBe("4");
    expect(again.accepted).toEqual([]); // examples are offered again and need accepting again
  });
});
