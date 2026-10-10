import type { Project } from "@replay-world/contracts";
import { Ray, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { beginDrag, dragCommand, dragTo, SNAP_ON } from "../scene/drag";
import { fixture, objectOf } from "../testing/fixtures";
import type { EditCommand } from "./commands";
import { createEditor, execute, HISTORY_LIMIT, redo, undo, type EditorState, type Outcome } from "./history";

const demo = () => fixture("scenes/industrial-demo.json");

function ok(outcome: Outcome): EditorState {
  if (!outcome.ok) throw new Error(outcome.rejection.message);
  return outcome.state;
}

const run = (state: EditorState, command: EditCommand) => ok(execute(state, { baseRevision: state.project.scene.revision, command }));
const back = (state: EditorState) => ok(undo(state, state.project.scene.revision));
const forward = (state: EditorState) => ok(redo(state, state.project.scene.revision));
const x = (project: Project, id: string) => objectOf(project, id).transform.position_m.x;

function moveTo(project: Project, id: string, value: number): EditCommand {
  const t = objectOf(project, id).transform;
  return { type: "set_transform", objectId: id, transform: { ...t, position_m: { ...t.position_m, x: value } } };
}

describe("undo and redo", () => {
  it("walks back and forward through edits, advancing the revision every step", () => {
    let state = createEditor(demo());
    state = run(state, moveTo(state.project, "obj-cell-filling", -4));
    state = run(state, moveTo(state.project, "obj-cell-filling", -3));
    expect([x(state.project, "obj-cell-filling"), state.project.scene.revision, state.undo.length]).toEqual([-3, 2, 2]);

    state = back(state);
    expect([x(state.project, "obj-cell-filling"), state.project.scene.revision]).toEqual([-4, 3]);
    state = back(state);
    expect([x(state.project, "obj-cell-filling"), state.project.scene.revision, state.redo.length]).toEqual([-5.195, 4, 2]);
    expect(state.project.scene.edit_log).toEqual([]);
    expect(undo(state, 4)).toMatchObject({ ok: false, rejection: { kind: "no_change", message: "Nothing to undo." } });
  });

  it("an edit after undo clears the redo branch", () => {
    let state = createEditor(demo());
    state = run(state, moveTo(state.project, "obj-cell-filling", -4));
    state = back(state);
    expect(state.redo).toHaveLength(1);
    state = run(state, { type: "remove_object", objectId: "obj-cabinet-2" });
    expect(state.redo).toEqual([]);
    const outcome = redo(state, state.project.scene.revision);
    expect(outcome.ok ? null : outcome.rejection).toEqual({ kind: "no_change", message: "Nothing to redo." });
    // The log holds only edits in effect: the undone move is gone, the removal remains.
    expect(state.project.scene.edit_log.map((r) => [r.type, r.revision])).toEqual([["object_removed", 3]]);
  });

  it("redo restores the same objects and selection target as the original edit", () => {
    let state = createEditor(demo());
    state = run(state, { type: "set_dimensions", objectId: "obj-conveyor-infeed", values: { width: 3.6 } });
    const edited = state.project.scene.objects;
    state = forward(back(state));
    expect(state.project.scene.objects).toStrictEqual(edited);
    expect(state.undo.at(-1)?.change.objectId).toBe("obj-conveyor-infeed");
    expect(state.project.scene.edit_log.map((r) => r.revision)).toEqual([3]);
  });

  it("refuses undo and redo prepared against an older revision", () => {
    let state = createEditor(demo());
    state = run(state, moveTo(state.project, "obj-cell-filling", -4));
    const stale = undo(state, 0);
    expect(stale.ok ? null : stale.rejection.kind).toBe("conflict");
    expect(stale.state).toBe(state);
  });

  it("keeps at most HISTORY_LIMIT undo steps", () => {
    let state = createEditor(demo());
    for (let i = 1; i <= HISTORY_LIMIT + 5; i++) state = run(state, moveTo(state.project, "obj-cell-filling", i / 100));
    expect(state.undo).toHaveLength(HISTORY_LIMIT);
    expect(state.project.scene.edit_log).toHaveLength(HISTORY_LIMIT + 5);
  });
});

describe("a handle drag", () => {
  /** A ray straight down onto the floor at (x, z), as from the top view. */
  const down = (px: number, pz: number) => new Ray(new Vector3(px, 30, pz), new Vector3(0, -1, 0));
  const view = new Vector3(0, -1, 0);

  it("is one undo step however many pointer moves it takes", () => {
    let state = createEditor(demo());
    const cell = objectOf(state.project, "obj-cell-filling");
    const frame = beginDrag("move-xz", cell, down(cell.transform.position_m.x, -1.2), view)!;
    let preview = cell;
    for (let i = 1; i <= 40; i++) preview = dragTo(frame, down(cell.transform.position_m.x + i * 0.0371, -1.2 + i * 0.01), SNAP_ON);
    expect(state.project.scene.revision).toBe(0); // previews never touch the project
    const command = dragCommand(cell, preview)!;
    state = run(state, command);
    expect(state.undo).toHaveLength(1);
    expect(objectOf(state.project, cell.id).transform.position_m).toEqual({ x: -3.71, y: 0, z: -0.8 });
    state = back(state);
    expect(objectOf(state.project, cell.id)).toStrictEqual(cell);
  });

  it("stores exactly what typing the snapped value stores", () => {
    const start = createEditor(demo());
    const cell = objectOf(start.project, "obj-cell-filling");
    const frame = beginDrag("move-x", cell, down(-5.195, -1.2), view)!;
    const dragged = run(start, dragCommand(cell, dragTo(frame, down(-5.195 + 1.3071, -1.2), SNAP_ON))!);
    const typed = run(start, moveTo(start.project, cell.id, Number("-3.89")));
    expect(dragged.project).toStrictEqual(typed.project);
  });

  it("resizes symmetrically like a typed width, and rotates in snapped degrees", () => {
    const start = createEditor(demo());
    const conveyor = objectOf(start.project, "obj-conveyor-infeed");
    // The +X face is at x = -7.7 + 1.5; dragging it 0.3 m outwards widens the belt by 0.6 m.
    const frame = beginDrag("size-x+", conveyor, new Ray(new Vector3(-6.2, 0.475, 10), new Vector3(0, 0, -1)), new Vector3(0, 0, -1))!;
    const preview = dragTo(frame, new Ray(new Vector3(-5.9, 0.475, 10), new Vector3(0, 0, -1)), SNAP_ON);
    expect(preview.transform).toBe(conveyor.transform);
    const resized = run(start, dragCommand(conveyor, preview)!);
    const typed = run(start, { type: "set_dimensions", objectId: conveyor.id, values: { width: 3.6 } });
    expect(resized.project).toStrictEqual(typed.project);

    const pallet = objectOf(start.project, "obj-pallet-staged");
    const ring = beginDrag("rotate-y", pallet, down(8.4 + 1, 4.2), view)!;
    // A quarter turn anticlockwise seen from above (towards -Z) adds 90°: 90° → 180°.
    const turned = dragTo(ring, down(8.4, 4.2 - 1), SNAP_ON);
    expect(turned.transform.rotation_rad.y).toBe(Math.PI);
    // A small wobble that stays in the start's snap cell changes nothing.
    expect(dragTo(ring, down(8.4 + 1, 4.2 - 0.05), SNAP_ON)).toBe(pallet);
  });
});
