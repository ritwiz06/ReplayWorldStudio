// A new look for an existing object, however the world was made (ENR-01): one general command
// changes only which model draws the object, keeps a reference photo in the same step, and
// leaves ids, sizes, evidence, links, the process and the run as they were.
import { readFileSync } from "node:fs";
import { type CatalogAsset, type Project, type StoredPhoto, validateProject } from "@replay-world/contracts";
import { describe, expect, it } from "vitest";
import { applyCommand } from "../editing/commands";
import { createEditor, execute, redo, undo } from "../editing/history";
import { operatingKey, runDay } from "../run/day";
import { blockSpec, currentLook, referenceSourceFor, referencesOf, roundCrop, startFrom } from "./reference";

const load = (name: string): Project => {
  const checked = validateProject(JSON.parse(readFileSync(new URL(`../../../../fixtures/scenes/${name}.json`, import.meta.url), "utf8")));
  if (!checked.ok) throw new Error(name);
  return checked.value;
};
const demo = load("industrial-demo"); // placed from the catalog: no drawing, no sources at all
const sample = load("sample-factory"); // imported from a DXF
const stored: StoredPhoto = {
  filename: "office.jpg",
  sha256: "a".repeat(64),
  image: { uri: `photos/${"a".repeat(64)}.jpg`, media_type: "image/jpeg", width_px: 1024, height_px: 678, bytes: 100_000 },
};
const cabinetId = "obj-cabinet-1";
const look = (project: Project): CatalogAsset => ({ ...sample.catalog[0], ...project.catalog.find((a) => a.id === "asset-guarded-machine-cell")!, id: "asset-look-test", kind: "equipment" });

describe("a look for a world without a drawing", () => {
  const editor = createEditor(demo);
  const cabinet = demo.scene.objects.find((o) => o.id === cabinetId)!;
  const asset = look(demo);
  const reference = referenceSourceFor(demo, stored, cabinetId, null);

  it("changes only the model, keeps the reference photo in the same step, and undoes both", () => {
    const outcome = execute(editor, {
      baseRevision: demo.scene.revision,
      command: { type: "set_appearance", changes: [{ objectId: cabinetId, assetId: asset.id, expected: cabinet.asset_id, reason: "from a reference photo" }], assets: [asset], reference },
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const after = outcome.state.project;
    const now = after.scene.objects.find((o) => o.id === cabinetId)!;
    expect({ ...now, asset_id: cabinet.asset_id }).toEqual(cabinet);
    expect(after.sources.map((s) => s.kind)).toEqual(["reference_photo"]);
    expect(referencesOf(after, cabinetId)).toHaveLength(1);
    expect(after.scene.edit_log.at(-1)).toMatchObject({
      type: "appearance_changed",
      objects: [{ object_id: cabinetId, asset_before: cabinet.asset_id, asset_after: asset.id, reason: "from a reference photo" }],
      reference_source_id: reference.id,
    });
    expect(validateProject(after).ok).toBe(true);
    // A reference photo places and measures nothing: the run's inputs are the same.
    expect(operatingKey(after, after.process)).toBe(operatingKey(demo, demo.process));
    const undone = undo(outcome.state, after.scene.revision);
    expect(undone.ok && undone.state.project.sources).toEqual([]);
    expect(undone.ok && undone.state.project.scene.objects).toEqual(demo.scene.objects);
    const again = undone.ok ? redo(undone.state, undone.state.project.scene.revision) : null;
    expect(again?.ok && again.state.project.sources).toEqual([reference]);
  });

  it("refuses a look prepared for an older look, an area, and a late revision", () => {
    const base = { changes: [{ objectId: cabinetId, assetId: asset.id, expected: "asset-something-else" }], assets: [asset] };
    const stale = applyCommand(demo, { baseRevision: demo.scene.revision, command: { type: "set_appearance", ...base } });
    expect(!stale.ok && stale.rejection.kind).toBe("conflict");
    const area = applyCommand(demo, { baseRevision: demo.scene.revision, command: { type: "set_appearance", changes: [{ objectId: "obj-walkway-main", assetId: null, expected: null }], assets: [] } });
    expect(!area.ok && area.rejection.message).toMatch(/is an area/);
    const late = applyCommand(demo, { baseRevision: demo.scene.revision - 1, command: { type: "set_appearance", ...base } });
    expect(!late.ok && late.rejection.kind).toBe("conflict");
  });
});

describe("a reference photo kept by itself", () => {
  it("changes no object, and the same photo for another object extends the same source", () => {
    const first = referenceSourceFor(sample, stored, "obj-dxf-111", "the machine's front");
    const kept = applyCommand(sample, { baseRevision: sample.scene.revision, command: { type: "attach_reference", source: first } });
    expect(kept.ok).toBe(true);
    if (!kept.ok) return;
    expect(kept.project.scene.objects).toEqual(sample.scene.objects);
    expect(kept.project.scene.edit_log.at(-1)).toMatchObject({ type: "source_attached", source_id: first.id });
    const both = referenceSourceFor(kept.project, stored, "obj-dxf-10f", null);
    expect([both.id, both.reference?.object_ids]).toEqual([first.id, ["obj-dxf-111", "obj-dxf-10f"]]);
    const extended = applyCommand(kept.project, { baseRevision: kept.project.scene.revision, command: { type: "attach_reference", source: both } });
    expect(extended.ok && extended.project.sources.filter((s) => s.kind === "reference_photo")).toHaveLength(1);
    const again = applyCommand(kept.project, { baseRevision: kept.project.scene.revision, command: { type: "attach_reference", source: first } });
    expect(!again.ok && again.rejection.kind).toBe("no_change");
    // The drawing world's run is unaffected by a reference photo.
    expect(runDay(kept.project, sample.process!, "edited").result!.fingerprint).toBe(runDay(sample, sample.process!, "edited").result!.fingerprint);
  });
});

describe("what a proposal starts from", () => {
  it("is the recorded size as one block unless the generated model has that size", () => {
    const cabinet = demo.scene.objects.find((o) => o.id === cabinetId)!;
    expect(currentLook(demo, cabinet).kind).toBe("catalog");
    const start = startFrom(demo, cabinet);
    expect(start.basedOn).toBeNull();
    expect(start.spec).toEqual(blockSpec(cabinet));
    expect(start.spec.envelope_m).toEqual({ x: 0.8, y: cabinet.dimensions.height.value_m, z: cabinet.dimensions.depth.value_m });
  });

  it("rounds a crop to whole percent, ordered, and at least 5 % each way", () => {
    expect(roundCrop({ left: 0.571, top: 0.62, right: 0.399, bottom: 0.3604 })).toEqual({ left: 0.4, top: 0.36, right: 0.57, bottom: 0.62 });
    expect(roundCrop({ left: 0.98, top: 0.5, right: 0.99, bottom: 0.5 })).toEqual({ left: 0.94, top: 0.5, right: 0.99, bottom: 0.55 });
  });
});
