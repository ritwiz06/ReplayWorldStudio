// Matching imported equipment to catalog models (UX-05): suggestions need name evidence, a
// name that says nothing gets a question, and applying a model changes only which model draws
// the object - never its id, name, placement, dimensions, evidence, links or the run.
import { readFileSync } from "node:fs";
import { type CatalogAsset, type Project, validateProject } from "@replay-world/contracts";
import { describe, expect, it } from "vitest";
import { applyCommand, type CommandRequest } from "../editing/commands";
import { createEditor, execute, redo, undo } from "../editing/history";
import { runDay } from "../run/day";
import { equipmentToImprove, fitOf, matchEquipment } from "./appearance";

const load = (name: string): Project => {
  const checked = validateProject(JSON.parse(readFileSync(new URL(`../../../../fixtures/scenes/${name}.json`, import.meta.url), "utf8")));
  if (!checked.ok) throw new Error(name);
  return checked.value;
};
const sample = load("sample-factory");
const library: CatalogAsset[] = [...load("foundation-scene").catalog, ...load("industrial-demo").catalog];
const cabinet = library.find((a) => a.id === "asset-electrical-cabinet-800")!;
const cell = library.find((a) => a.id === "asset-guarded-machine-cell")!;

const byName = (project: Project) => new Map(matchEquipment(project, equipmentToImprove(project), library).map((m) => [m.object.name, m]));

describe("suggestions", () => {
  it("suggest only where the names agree on what the thing is", () => {
    const matches = byName(sample);
    const electrical = matches.get("Electrical cabinet")!;
    expect(electrical.kind).toBe("suggested");
    expect(electrical.kind === "suggested" && electrical.best.asset.id).toBe(cabinet.id);
    expect(electrical.kind === "suggested" && electrical.best.generic).toBe(true);
    const panel = matches.get("Control panel")!;
    expect(panel.kind === "suggested" && panel.best.asset.id).toBe(cabinet.id);
    // A name that says nothing about the kind of equipment is a question, whatever its footprint.
    expect(matches.get("Machine B")!.kind).toBe("ask");
    // Named, but no catalog model is that kind of thing.
    for (const name of ["Mixer", "Packing table", "Water tank", "Rack A"]) expect(matches.get(name)!.kind).toBe("none");
  });

  it("say what fitting a model does to it, and refuse a model far from the recorded size", () => {
    const electrical = sample.scene.objects.find((o) => o.name === "Electrical cabinet")!; // 1 × 0.3 m, 2 m assumed high; the model is 0.541 m deep
    const warnings = fitOf(electrical, cabinet)!;
    expect(warnings.some((w) => /Squeezed to 55 % of its depth/.test(w))).toBe(true);
    expect(warnings.some((w) => /height is assumed/.test(w))).toBe(true);
    const rack = sample.scene.objects.find((o) => o.name === "Rack A")!; // 15 m long
    expect(fitOf(rack, cabinet)).toBeNull();
  });
});

describe("applying a model", () => {
  const editor = createEditor(sample);
  const machine = sample.scene.objects.find((o) => o.name === "Machine B")!;
  const electrical = sample.scene.objects.find((o) => o.name === "Electrical cabinet")!;
  const request = (project: Project, changes: { objectId: string; assetId: string | null; expected: string | null }[]): CommandRequest => ({
    baseRevision: project.scene.revision,
    command: { type: "set_appearance", changes, assets: [cabinet, cell] },
  });

  it("changes only which model draws each object, in one undoable step that keeps the run", () => {
    const outcome = execute(editor, request(sample, [
      { objectId: electrical.id, assetId: cabinet.id, expected: null },
      { objectId: machine.id, assetId: cell.id, expected: null },
    ]));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const after = outcome.state.project;
    for (const before of [electrical, machine]) {
      const now = after.scene.objects.find((o) => o.id === before.id)!;
      expect({ ...now, asset_id: before.asset_id }).toEqual(before); // id, name, placement, dimensions and evidence
    }
    expect(after.catalog.map((a) => a.id)).toEqual([cabinet.id, cell.id]);
    expect(after.process).toBe(sample.process); // station references untouched
    expect(after.sources).toBe(sample.sources); // drawing links untouched
    expect(after.scene.edit_log.at(-1)).toMatchObject({ type: "appearance_changed", summary: expect.stringContaining("display only"), reference_source_id: null });
    // The run reads the same layout: identical events and metrics.
    const a = runDay(sample, sample.process!, "edited");
    const b = runDay(after, after.process!, "edited");
    expect(b.result!.fingerprint).toBe(a.result!.fingerprint);
    expect(b.result!.metrics).toEqual(a.result!.metrics);
    // One undo restores the models and the catalog; redo brings both back.
    const undone = undo(outcome.state, after.scene.revision);
    expect(undone.ok && undone.state.project.scene.objects).toEqual(sample.scene.objects);
    expect(undone.ok && undone.state.project.catalog).toEqual([]);
    const again = undone.ok ? redo(undone.state, undone.state.project.scene.revision) : null;
    expect(again?.ok && again.state.project.catalog.map((a) => a.id)).toEqual([cabinet.id, cell.id]);
  });

  it("refuses a stale review, a listed-twice object and a model of another kind; a late revision too", () => {
    const stale = applyCommand(sample, request(sample, [{ objectId: electrical.id, assetId: cabinet.id, expected: "asset-something-else" }]));
    expect(!stale.ok && stale.rejection.kind).toBe("conflict");
    const twice = applyCommand(sample, request(sample, [
      { objectId: electrical.id, assetId: cabinet.id, expected: null },
      { objectId: electrical.id, assetId: cell.id, expected: null },
    ]));
    expect(!twice.ok && twice.rejection.message).toMatch(/listed twice/);
    const wall = sample.scene.objects.find((o) => o.kind === "structure" && o.name !== "Floor")!;
    const structure = applyCommand(sample, request(sample, [{ objectId: wall.id, assetId: cabinet.id, expected: null }]));
    expect(!structure.ok && structure.rejection.message).toMatch(/is a model for equipment, not for/);
    const late = applyCommand(sample, { ...request(sample, [{ objectId: electrical.id, assetId: cabinet.id, expected: null }]), baseRevision: sample.scene.revision - 1 });
    expect(!late.ok && late.rejection.kind).toBe("conflict");
  });
});
