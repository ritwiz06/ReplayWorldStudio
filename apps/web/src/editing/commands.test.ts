import { validateProject, type Project, type Transform } from "@replay-world/contracts";
import { describe, expect, it } from "vitest";
import { fixture, objectOf } from "../testing/fixtures";
import { applyCommand, EDIT_SOURCE_REF, reapplyChange, revertChange, type EditCommand } from "./commands";
import { copyId, copyName, instanceId, instanceName } from "./newObjects";
import { degToRad } from "./units";

const foundation = () => fixture("scenes/foundation-scene.json");
const demo = () => fixture("scenes/industrial-demo.json");

function moved(project: Project, id: string, x: number): Transform {
  const t = objectOf(project, id).transform;
  return { ...t, position_m: { ...t.position_m, x } };
}

function apply(project: Project, command: EditCommand) {
  const result = applyCommand(project, { baseRevision: project.scene.revision, command });
  if (!result.ok) throw new Error(result.rejection.message);
  return result;
}

describe("command validation", () => {
  // The fixtures are deep-frozen: an engine that mutated its input would throw here.
  it("rejects a command prepared against another revision, leaving the project untouched", () => {
    const project = demo();
    const command: EditCommand = { type: "set_transform", objectId: "obj-cell-filling", transform: moved(project, "obj-cell-filling", -4) };
    const result = applyCommand(project, { baseRevision: 3, command });
    expect(result).toEqual({
      ok: false,
      rejection: { kind: "conflict", message: "The scene changed (revision 0) since this edit was prepared at revision 3; it was not applied." },
    });
    // After one accepted edit the old base revision is stale.
    const first = apply(project, command);
    const stale = applyCommand(first.project, { baseRevision: 0, command: { ...command, transform: moved(project, "obj-cell-filling", -3) } });
    expect(stale.ok ? null : stale.rejection.kind).toBe("conflict");
  });

  it.each([
    ["NaN position", { type: "set_transform", objectId: "obj-cell-filling", transform: { position_m: { x: Number.NaN, y: 0, z: 0 }, rotation_rad: { order: "XYZ", x: 0, y: 0, z: 0 } } }, "position.x"],
    ["far-away position", { type: "set_transform", objectId: "obj-cell-filling", transform: { position_m: { x: 0, y: 0, z: 1e6 }, rotation_rad: { order: "XYZ", x: 0, y: 0, z: 0 } } }, "position.z"],
    ["infinite rotation", { type: "set_transform", objectId: "obj-cell-filling", transform: { position_m: { x: 0, y: 0, z: 0 }, rotation_rad: { order: "XYZ", x: 0, y: Number.POSITIVE_INFINITY, z: 0 } } }, "rotation.y"],
    ["zero width", { type: "set_dimensions", objectId: "obj-cell-filling", values: { width: 0 } }, "dimensions.width"],
    ["negative depth", { type: "set_dimensions", objectId: "obj-cell-filling", values: { depth: -1 } }, "dimensions.depth"],
    ["huge height", { type: "set_dimensions", objectId: "obj-cell-filling", values: { height: 5000 } }, "dimensions.height"],
    ["bad new ID", { type: "add_instance", assetId: "asset-pallet-cartons", objectId: "Obj Pallet", name: "Pallet", transform: { position_m: { x: 0, y: 0, z: 0 }, rotation_rad: { order: "XYZ", x: 0, y: 0, z: 0 } } }, "id"],
    ["duplicate ID", { type: "add_instance", assetId: "asset-pallet-cartons", objectId: "obj-cabinet-1", name: "Pallet", transform: { position_m: { x: 0, y: 0, z: 0 }, rotation_rad: { order: "XYZ", x: 0, y: 0, z: 0 } } }, "id"],
    ["empty name", { type: "duplicate_object", sourceId: "obj-cabinet-1", objectId: "obj-cabinet-9", name: " ", transform: { position_m: { x: 0, y: 0, z: 0 }, rotation_rad: { order: "XYZ", x: 0, y: 0, z: 0 } } }, "name"],
  ] as [string, EditCommand, string][])("rejects %s as invalid without changing anything", (_label, command, field) => {
    const project = demo();
    const result = applyCommand(project, { baseRevision: 0, command });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.kind).toBe("invalid");
    expect(result.rejection.field).toBe(field);
    expect(project.scene.revision).toBe(0);
  });

  it("rejects a multi-axis resize entirely when any axis is invalid", () => {
    const project = demo();
    const result = applyCommand(project, { baseRevision: 0, command: { type: "set_dimensions", objectId: "obj-conveyor-infeed", values: { width: 3.6, depth: Number.NaN } } });
    expect(result.ok ? null : result.rejection).toEqual({ kind: "invalid", message: "The depth must be a finite number.", field: "dimensions.depth" });
  });

  it("reports unknown objects and assets, and refuses edits that change nothing", () => {
    const project = demo();
    const cases: [EditCommand, string][] = [
      [{ type: "remove_object", objectId: "obj-nope" }, "not_found"],
      [{ type: "add_instance", assetId: "asset-nope", objectId: "obj-x", name: "X", transform: moved(project, "obj-floor", 0) }, "not_found"],
      [{ type: "set_transform", objectId: "obj-floor", transform: objectOf(project, "obj-floor").transform }, "no_change"],
      [{ type: "set_dimensions", objectId: "obj-floor", values: { width: 22 } }, "no_change"],
      [{ type: "set_dimensions", objectId: "obj-floor", values: {} }, "invalid"],
    ];
    for (const [command, kind] of cases) {
      const result = applyCommand(project, { baseRevision: 0, command });
      expect(result.ok ? "ok" : result.rejection.kind).toBe(kind);
    }
  });
});

describe("accepted commands", () => {
  it("moves an object, records the previous transform and advances the revision by one", () => {
    const project = demo();
    const before = objectOf(project, "obj-cell-filling");
    const { project: next, change } = apply(project, { type: "set_transform", objectId: before.id, transform: moved(project, before.id, -4.5) });
    expect(next.scene.revision).toBe(1);
    expect(objectOf(next, before.id).transform.position_m.x).toBe(-4.5);
    expect(objectOf(next, before.id).dimensions).toBe(before.dimensions); // untouched evidence
    expect(change.label).toBe("Move Filling cell");
    expect(next.scene.edit_log).toEqual([
      { type: "object_edited", revision: 1, object_id: before.id, transform: { before: before.transform, after: moved(project, before.id, -4.5) }, dimensions: [] },
    ]);
    expect(validateProject(next).ok).toBe(true);
  });

  it("marks an edited axis user-supplied and keeps the previous value and evidence in the record", () => {
    const project = foundation();
    const packing = objectOf(project, "obj-packing-station");
    expect(packing.dimensions.width).toMatchObject({ origin: "measured", uncertainty_m: { lower: 1.19, upper: 1.21 } });
    const { project: next, change } = apply(project, { type: "set_dimensions", objectId: packing.id, values: { width: 1.35, height: 1.4 } });
    const edited = objectOf(next, packing.id).dimensions;
    expect(edited.width).toEqual({ value_m: 1.35, origin: "user_supplied", source_ref: EDIT_SOURCE_REF, review_status: "unreviewed", uncertainty_m: null });
    // Height was given its current value, so it is not an edit: its inferred evidence stays.
    expect(edited.height).toBe(packing.dimensions.height);
    expect(edited.depth).toBe(packing.dimensions.depth);
    expect(change.label).toBe("Resize Packing station (placeholder) (width)");
    expect(next.scene.edit_log.at(-1)).toEqual({
      type: "object_edited",
      revision: 1,
      object_id: packing.id,
      transform: null,
      dimensions: [{ axis: "width", before: packing.dimensions.width, after: edited.width }],
    });
  });

  it("adds a catalog instance at its nominal size with the nominal evidence and a fresh ID", () => {
    const project = demo();
    const asset = project.catalog.find((a) => a.id === "asset-electrical-cabinet-800")!;
    const id = instanceId(project, asset);
    expect(id).toBe("obj-electrical-cabinet-800");
    const transform = moved(project, "obj-floor", 3);
    const { project: next } = apply(project, { type: "add_instance", assetId: asset.id, objectId: id, name: instanceName(project, asset), transform });
    const added = objectOf(next, id);
    expect(added).toEqual({ id, name: "Electrical cabinet, 800 mm", kind: "equipment", asset_id: asset.id, transform, dimensions: asset.nominal_dimensions, parameters: [] });
    expect(added.dimensions).not.toBe(asset.nominal_dimensions); // a copy, not shared state
    expect(next.scene.objects.at(-1)).toBe(added);
    expect(next.scene.edit_log).toEqual([{ type: "object_added", revision: 1, object_id: id, asset_id: asset.id, duplicate_of: null }]);
    // The next instance gets the next free ID and name.
    expect(instanceId(next, asset)).toBe("obj-electrical-cabinet-800-2");
    expect(instanceName(next, asset)).toBe("Electrical cabinet, 800 mm (2)");
  });

  it("duplicates an object with its evidence, asset and parameters, right after the source", () => {
    const project = demo();
    const source = objectOf(project, "obj-conveyor-infeed");
    const id = copyId(project, source);
    expect([id, copyName(project, source)]).toEqual(["obj-conveyor-infeed-2", "Infeed conveyor (copy)"]);
    const transform = moved(project, source.id, -7.7 + 3.5);
    const { project: next } = apply(project, { type: "duplicate_object", sourceId: source.id, objectId: id, name: "Infeed conveyor (copy)", transform });
    const index = next.scene.objects.findIndex((o) => o.id === source.id);
    const copy = next.scene.objects[index + 1]!;
    expect(copy).toEqual({ ...source, id, name: "Infeed conveyor (copy)", transform });
    expect(next.scene.edit_log.at(-1)).toEqual({ type: "object_added", revision: 1, object_id: id, asset_id: source.asset_id, duplicate_of: source.id });
    expect(copyId(next, copy)).toBe("obj-conveyor-infeed-3");
  });

  it("removes an object, keeps its snapshot in the record and retires its ID", () => {
    const project = demo();
    const cabinet = objectOf(project, "obj-cabinet-2");
    const { project: next } = apply(project, { type: "remove_object", objectId: cabinet.id });
    expect(next.scene.objects.some((o) => o.id === cabinet.id)).toBe(false);
    expect(next.scene.edit_log).toEqual([{ type: "object_removed", revision: 1, object: cabinet }]);
    const reuse = applyCommand(next, { baseRevision: 1, command: { type: "add_instance", assetId: "asset-electrical-cabinet-800", objectId: cabinet.id, name: "Cabinet", transform: cabinet.transform } });
    expect(reuse.ok ? null : reuse.rejection.message).toBe("Object ID 'obj-cabinet-2' is already used in this project; IDs are never reused.");
  });
});

describe("inverses", () => {
  const commands = (project: Project): [string, EditCommand][] => [
    ["move and rotate", { type: "set_transform", objectId: "obj-pallet-staged", transform: { position_m: { x: 7.5, y: 0, z: 3 }, rotation_rad: { order: "XYZ", x: 0, y: degToRad(45), z: 0 } } }],
    ["resize", { type: "set_dimensions", objectId: "obj-cell-inspection", values: { width: 2.6, depth: 2.2 } }],
    ["add", { type: "add_instance", assetId: "asset-pallet-cartons", objectId: "obj-pallet-cartons", name: "Pallet", transform: moved(project, "obj-pallet-staged", 9.5) }],
    ["duplicate", { type: "duplicate_object", sourceId: "obj-cabinet-1", objectId: "obj-cabinet-3", name: "Cabinet (copy)", transform: moved(project, "obj-cabinet-1", 0.4) }],
    ["remove", { type: "remove_object", objectId: "obj-conveyor-transfer" }],
  ];

  it.each(commands(demo()))("undo of %s restores the exact objects and log; redo re-applies it", (_label, command) => {
    const project = demo();
    const applied = apply(project, command);
    const undone = revertChange(applied.project, applied.change, 1, 1);
    if (!undone.ok) throw new Error(undone.rejection.message);
    expect(undone.project.scene.objects).toStrictEqual(project.scene.objects);
    expect(undone.project.scene.edit_log).toStrictEqual([]);
    expect(undone.project.scene.revision).toBe(2);
    expect(undone.project.catalog).toBe(project.catalog);

    const redone = reapplyChange(undone.project, applied.change, 2);
    if (!redone.ok) throw new Error(redone.rejection.message);
    expect(redone.project.scene.objects).toStrictEqual(applied.project.scene.objects);
    expect(redone.project.scene.revision).toBe(3);
    expect(redone.project.scene.edit_log).toStrictEqual([{ ...applied.project.scene.edit_log[0], revision: 3 }]);
    expect(validateProject(redone.project).ok).toBe(true);
  });

  it("refuses an undo prepared against an older revision", () => {
    const project = demo();
    const applied = apply(project, { type: "remove_object", objectId: "obj-cabinet-1" });
    const stale = revertChange(applied.project, applied.change, 1, 0);
    expect(stale.ok ? null : stale.rejection.kind).toBe("conflict");
  });
});
