// "Set up a day" (SIM-01): nothing is filled in from the drawing, what is missing is named, the
// values become a process marked as entered, and a setup made from the example runs the same.
import { readFileSync } from "node:fs";
import { type DrawingAnalysis, validateDrawingAnalysis, validateProject } from "@replay-world/contracts";
import { describe, expect, it } from "vitest";
import { sampleProject } from "../drawing/sampleProject";
import { applyCommand } from "../editing/commands";
import { createEditor, execute, redo, undo } from "../editing/history";
import { runDay } from "./day";
import { SAMPLE_PROCESS } from "./example";
import { buildProcess, type DayDraft, draftFrom, emptyDraft, emptyStation } from "./setup";

const data: unknown = JSON.parse(readFileSync(new URL("../../../../fixtures/drawings/layout-checks-mm.analysis.json", import.meta.url), "utf8"));
const checked = validateDrawingAnalysis(data);
if (!checked.ok) throw new Error("analysis");
const sample = sampleProject(checked.value as DrawingAnalysis);
const project = { ...sample, process: null };

describe("Set up a day", () => {
  it("starts empty and names everything a run needs", () => {
    const { process, needs } = buildProcess(project, emptyDraft());
    expect(process).toBeNull();
    expect(needs).toEqual([
      "What moves through the process (for example “batch” or “carton”)",
      "Where material is taken from (the first step)",
      "At least one station after the material, in order",
      "At least one worker",
      "When the shift starts (hh:mm)",
      "How long the shift lasts (hours)",
    ]);
  });

  it("names a missing or wrong value exactly, station by station", () => {
    const draft: DayDraft = { ...emptyDraft(), itemName: "tray", supplyObjectId: "obj-dxf-106", stations: [{ ...emptyStation("obj-dxf-113"), workerS: "ninety", inCap: "1.5" }] };
    const { needs } = buildProcess(project, draft);
    expect(needs).toContain("Confirm that material is always available at Rack A (the run assumes it)");
    expect(needs).toContain("Packing table: time with a worker (seconds, 0 if none) (“ninety” is not a number)");
    expect(needs).toContain("Packing table: how many items can queue in front of it: a whole number, at least 1");
    expect(needs).toContain("Packing table: how far from its front side the worker stands (m)");
    expect(needs).toContain("Carrying Rack A → Packing table: carrying speed (m/s)");
    expect(needs).toContain("Someone to carry items to Packing table (tick it for a worker)");
  });

  it("turns the example into entered values that run exactly the same", () => {
    const draft = draftFrom(SAMPLE_PROCESS);
    const { process, needs } = buildProcess(project, draft);
    expect(needs).toEqual([]);
    expect(validateProject({ ...project, process: process! }).ok).toBe(true);
    expect(new Set(JSON.stringify(process).match(/"basis":"(\w+)"/g))).toEqual(new Set(['"basis":"entered"']));
    expect(process!.example_note).toBeNull();
    const example = runDay(sample, SAMPLE_PROCESS, "edited").result!;
    const entered = runDay(project, process!, "edited").result!;
    expect(entered.metrics.completed).toBe(example.metrics.completed);
    expect(entered.events.length).toBe(example.events.length);
  });

  it("is one undoable step that changes no object", () => {
    const { process } = buildProcess(project, draftFrom(SAMPLE_PROCESS));
    const editor = createEditor(project);
    const set = execute(editor, { baseRevision: 0, command: { type: "set_process", process: process!, summary: "3 stations, 3 workers, entered values" } });
    if (!set.ok) throw new Error(set.rejection.message);
    expect(set.state.project.process).toBe(process);
    expect(set.state.project.scene.objects).toEqual(project.scene.objects);
    expect(set.state.project.scene.edit_log).toEqual([{ type: "process_set", revision: 1, summary: "3 stations, 3 workers, entered values" }]);
    expect(validateProject(set.state.project).ok).toBe(true);
    const back = undo(set.state, 1);
    if (!back.ok) throw new Error(back.rejection.message);
    expect(back.state.project.process).toBeNull();
    expect(back.state.project.scene.edit_log).toEqual([]);
    const again = redo(back.state, 2);
    if (!again.ok) throw new Error(again.rejection.message);
    expect(again.state.project.process).toBe(process);
    const same = applyCommand(again.state.project, { baseRevision: 3, command: { type: "set_process", process: process!, summary: "again" } });
    expect(!same.ok && same.rejection.kind).toBe("no_change");
  });
});
