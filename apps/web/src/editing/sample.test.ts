// The committed sample fixtures/edited/foundation-edited.json is produced by this engine from
// the foundation fixture. pytest and the API validate the same file with the Pydantic models,
// so the browser and Python agree on what a saved, edited project looks like.
// Regenerate after an intended change with: pnpm --filter @replay-world/web exec vitest run -u src/editing/sample.test.ts
import { validateProject, type Project } from "@replay-world/contracts";
import { describe, expect, it } from "vitest";
import { fixture, objectOf } from "../testing/fixtures";
import type { EditCommand } from "./commands";
import { createEditor, execute, undo, type EditorState } from "./history";
import { copyId, copyName, instanceId, instanceName } from "./newObjects";
import { serializeProject } from "./projectFile";
import { degToRad } from "./units";

function step(state: EditorState, command: (project: Project) => EditCommand): EditorState {
  const outcome = execute(state, { baseRevision: state.project.scene.revision, command: command(state.project) });
  if (!outcome.ok) throw new Error(outcome.rejection.message);
  return outcome.state;
}

export function editedFoundation(): Project {
  let s = createEditor(fixture("scenes/foundation-scene.json"));
  const place = (x: number, z: number, yaw = 0) => ({
    position_m: { x, y: 0, z },
    rotation_rad: { order: "XYZ" as const, x: 0, y: yaw, z: 0 },
  });
  s = step(s, () => ({ type: "set_transform", objectId: "obj-infeed-conveyor", transform: place(-6.5, 0) })); // r1
  s = step(s, () => ({ type: "set_dimensions", objectId: "obj-packing-station", values: { width: 1.35 } })); // r2
  s = step(s, (p) => ({ type: "set_transform", objectId: "obj-packing-station", transform: { ...objectOf(p, "obj-packing-station").transform, rotation_rad: { order: "XYZ", x: 0, y: degToRad(180), z: 0 } } })); // r3
  s = step(s, (p) => {
    const asset = p.catalog.find((a) => a.id === "asset-generic-processing-station")!;
    return { type: "add_instance", assetId: asset.id, objectId: instanceId(p, asset), name: instanceName(p, asset), transform: place(2, 3.5) };
  }); // r4
  s = step(s, (p) => {
    const cube = objectOf(p, "obj-reference-cube");
    return { type: "duplicate_object", sourceId: cube.id, objectId: copyId(p, cube), name: copyName(p, cube), transform: place(7, 2) };
  }); // r5
  s = step(s, () => ({ type: "remove_object", objectId: "obj-column-c1" })); // r6
  const undone = undo(s, s.project.scene.revision); // r7: the column comes back, record r6 leaves the log
  if (!undone.ok) throw new Error(undone.rejection.message);
  s = undone.state;
  s = step(s, () => ({ type: "set_dimensions", objectId: "obj-reference-cube-2", values: { height: 1.5 } })); // r8
  s = step(s, () => ({ type: "remove_object", objectId: "obj-process-station" })); // r9
  return s.project;
}

describe("the edited sample project", () => {
  const project = editedFoundation();
  const text = serializeProject(project);

  it("matches the committed sample that the Python contract tests validate", async () => {
    await expect(text).toMatchFileSnapshot("../../../../fixtures/edited/foundation-edited.json");
  });

  it("records only the edits in effect, with the gap left by the undone removal", () => {
    expect(project.scene.revision).toBe(9);
    expect(project.scene.edit_log.map((r) => `${r.revision}:${r.type}`)).toEqual([
      "1:object_edited",
      "2:object_edited",
      "3:object_edited",
      "4:object_added",
      "5:object_added",
      "8:object_edited",
      "9:object_removed",
    ]);
    expect(project.scene.objects.map((o) => o.id)).toContain("obj-column-c1");
    expect(project.fixture).toEqual(fixture("scenes/foundation-scene.json").fixture);
  });

  it("survives a JSON round trip exactly and still passes the contract schema", () => {
    const reopened = JSON.parse(text) as Project;
    expect(reopened).toStrictEqual(project);
    expect(serializeProject(reopened)).toBe(text);
    expect(validateProject(reopened).ok).toBe(true);
  });
});
