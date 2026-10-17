import { readFileSync } from "node:fs";
import { type DrawingAnalysis, type Project, validateDrawingAnalysis, validateProject } from "@replay-world/contracts";
import { describe, expect, it } from "vitest";
import type { EditCommand } from "../editing/commands";
import { createEditor, type EditorState, execute, redo, undo } from "../editing/history";
import { deepFreeze } from "../testing/fixtures";
import { compareWithDrawing } from "./compare";
import { checkReadiness, finalise } from "./readiness";
import { previewReference, type ReviewCorrection, reviewItems } from "./review";
import { buildDrawingProject, drawingSource, drawnFrom, FLOOR_OBJECT_ID } from "./world";

function analysis(name: string): DrawingAnalysis {
  const data: unknown = JSON.parse(readFileSync(new URL(`../../../../fixtures/drawings/${name}.analysis.json`, import.meta.url), "utf8"));
  const checked = validateDrawingAnalysis(data);
  if (!checked.ok) throw new Error(JSON.stringify(checked.issues));
  return deepFreeze(checked.value);
}

const sourceId = (p: Project) => p.sources[0]!.id;
const object = (p: Project, name: string) => p.scene.objects.find((o) => o.name === name)!;

/** Apply one command and return the editor; fails the test if it is refused. */
function run(editor: EditorState, command: EditCommand): EditorState {
  const outcome = execute(editor, { baseRevision: editor.project.scene.revision, command });
  if (!outcome.ok) throw new Error(outcome.rejection.message);
  expect(validateProject(outcome.state.project).ok).toBe(true);
  return outcome.state;
}

const review = (editor: EditorState, correction: ReviewCorrection) => run(editor, { type: "review_drawing", sourceId: sourceId(editor.project), correction });

const back = (editor: EditorState) => {
  const outcome = undo(editor, editor.project.scene.revision);
  if (!outcome.ok) throw new Error(outcome.rejection.message);
  return outcome.state;
};
const forward = (editor: EditorState) => {
  const outcome = redo(editor, editor.project.scene.revision);
  if (!outcome.ok) throw new Error(outcome.rejection.message);
  return outcome.state;
};

describe("reviewing the warehouse drawing made to fool the first reading", () => {
  const start = createEditor(buildDrawingProject(analysis("warehouse-cm"), "mm"));

  it("proposes the site boundary as the floor at a scale that is ten times too small", () => {
    const items = reviewItems(drawingSource(start.project)!);
    expect(items.map((i) => [i.id, i.done, i.title])).toEqual([
      ["floor", false, "Is this the floor?"],
      ["scale", false, "Is this the right scale?"],
      ["objects", false, "Are these the right objects?"],
      ["omissions", false, "What the drawing leaves out"],
    ]);
    expect(items[1]!.detail).toBe("1 unit = 1 mm (the drawing's own unit, $INSUNITS); the floor is 6 m × 4 m");
    expect(object(start.project, "Rack A").dimensions.width.value_m).toBe(1.6);
  });

  it("uses the building outline as the floor; the site boundary is no longer an object", () => {
    const editor = review(start, { kind: "floor", to: "dxf-102" });
    const source = drawingSource(editor.project)!;
    expect(source.drawing.review.floor).toEqual({ choice: "outline", drawn_id: "dxf-102", object_id: FLOOR_OBJECT_ID, status: "corrected" });
    expect(source.drawing.review.objects.find((o) => o.drawn_id === "dxf-101")?.status).toBe("not_an_object");
    expect(editor.project.scene.objects.some((o) => o.name === "Wall outline 1")).toBe(false); // the outline is the floor now
    const floor = object(editor.project, "Floor");
    expect([floor.dimensions.width.value_m, floor.dimensions.depth.value_m]).toEqual([3, 2]);
    const record = editor.project.scene.edit_log.at(-1)!;
    expect(record.type === "drawing_reviewed" && record.correction).toBe(
      "Floor: Wall outline 1 (LWPOLYLINE 102 on layer A-WALL), instead of Floor (LWPOLYLINE 101 on layer SITE-BOUNDARY)",
    );
    const undone = back(editor);
    expect(undone.project.sources).toEqual(start.project.sources);
    expect(undone.project.scene.objects).toEqual(start.project.scene.objects);
    expect(forward(undone).project.sources).toEqual(editor.project.sources);
  });

  it("finds the scale conflict from one known length and keeps both the header and the measurement", () => {
    const floored = review(start, { kind: "floor", to: "dxf-102" });
    const source = drawingSource(floored.project)!;
    const a = { x: 1600, y: 2000 };
    const b = { x: 2200, y: 2000 };
    expect(previewReference(source, a, b, 6)).toMatchObject({ drawingLength: 600, metresPerUnit: 0.01, unitMetresPerUnit: 0.001, agrees: false });
    const moved = run(floored, {
      type: "set_transform",
      objectId: object(floored.project, "Rack A").id,
      transform: { ...object(floored.project, "Rack A").transform, position_m: { ...object(floored.project, "Rack A").transform.position_m, x: object(floored.project, "Rack A").transform.position_m.x + 0.5 } },
    });
    const editor = review(moved, { kind: "reference", a, b, realLengthM: 6, use: "reference" });
    const after = drawingSource(editor.project)!;
    expect(after.drawing.units.declared).toBe("mm"); // the drawing's own reading is kept
    expect(after.drawing.review.scale).toMatchObject({ basis: "reference_length", unit: "mm", metres_per_unit: 0.01, status: "measured" });
    expect(after.drawing.review.scale.reference).toMatchObject({ real_length_m: 6, drawing_length: 600, compared_with: 0.001, agrees: false });
    expect(after.source_to_world.metres_per_source_unit).toBe(0.01);
    const floor = object(editor.project, "Floor");
    expect([floor.dimensions.width.value_m, floor.dimensions.depth.value_m]).toEqual([30, 20]);
    expect(object(editor.project, "Rack A").dimensions.width).toMatchObject({ value_m: 16, origin: "drawn" });
    expect(object(editor.project, "Rack A").dimensions.width.source_ref).toContain("1 unit = 1 cm (from your known length of 6.00 m)");
    // The person's half-metre move stays half a metre.
    const rack = compareWithDrawing(editor.project)!.changes.find((c) => c.label === "Rack A")!;
    expect(rack.what).toEqual(["moved 0.50 m"]);
    const undone = back(editor);
    expect(undone.project.sources).toEqual(moved.project.sources);
    expect(undone.project.scene.objects).toEqual(moved.project.scene.objects);
  });

  it("can keep the drawing's unit despite the measurement, recorded as the person's decision", () => {
    const editor = review(start, { kind: "reference", a: { x: 1600, y: 2000 }, b: { x: 2200, y: 2000 }, realLengthM: 6, use: "unit" });
    const scale = drawingSource(editor.project)!.drawing.review.scale;
    expect([scale.basis, scale.status, scale.metres_per_unit, scale.reference?.agrees]).toEqual(["drawing_unit", "confirmed", 0.001, false]);
  });

  it("corrects kinds and marks a title block as not an object, each undoable", () => {
    const zone = drawingSource(start.project)!.drawing.objects.find((o) => o.label === "Pallet drop zone")!;
    let editor = review(start, { kind: "object", drawnId: zone.id, action: "correct", objectKind: "keep_clear" });
    const marked = object(editor.project, "Pallet drop zone");
    expect([marked.kind, marked.dimensions.height.value_m, marked.dimensions.height.origin]).toEqual(["keep_clear", 0.005, "default"]);
    expect(drawnFrom(editor.project, marked.id)?.status).toBe("corrected");
    const title = drawingSource(editor.project)!.drawing.objects.find((o) => o.label === "Warehouse W2 (synthetic)")!;
    editor = review(editor, { kind: "object", drawnId: title.id, action: "not_an_object" });
    expect(editor.project.scene.objects.some((o) => o.id === title.object_id)).toBe(false);
    const undone = back(editor);
    expect(undone.project.scene.objects.some((o) => o.id === title.object_id)).toBe(true);
    const again = forward(undone);
    // Made an object again later: its ID was used, so it gets a new one, linked from the drawing.
    const remade = review(again, { kind: "object", drawnId: title.id, action: "make_object", objectKind: "equipment" });
    const relinked = drawingSource(remade.project)!.drawing.objects.find((o) => o.id === title.id)!;
    expect(relinked.object_id).toBe(`${title.object_id}-2`);
    expect(remade.project.scene.objects.some((o) => o.id === relinked.object_id)).toBe(true);
  });
});

describe("what a later check may claim", () => {
  const hall = createEditor(buildDrawingProject(analysis("hall-mm"), "mm"));
  const press = object(hall.project, "Press 1").id;
  const bench = object(hall.project, "Workbench").id;

  it("never passes on an unreviewed drawing", () => {
    const readiness = checkReadiness(hall.project, [press], { height: false });
    expect(readiness.level).toBe("review_needed");
    expect(readiness.reasons).toEqual([
      "Press 1 is not reviewed yet",
      "the scale is not checked yet",
      "the floor is only proposed",
      "what the drawing leaves out is not yet accepted",
    ]);
    expect(finalise(true, readiness).state).toBe("not_evaluated");
  });

  it("gives a design-layout result once the drawing is reviewed, never an as-built one", () => {
    let editor = review(hall, { kind: "accept_floor" });
    editor = review(editor, { kind: "unit", unit: "mm" });
    editor = review(editor, { kind: "accept_remaining" });
    editor = review(editor, { kind: "accept_omissions" });
    const footprint = checkReadiness(editor.project, [press], { height: false });
    expect([footprint.level, footprint.reasons]).toEqual(["design_layout", []]);
    expect(finalise(true, footprint)).toEqual({
      state: "passed",
      label: "Passes on the design layout: the design drawing hall-mm.dxf (scale confirmed), not the site as built",
    });
    // A height assumed for display, and a box that only encloses an L-shaped bench, give no pass.
    expect(finalise(true, checkReadiness(editor.project, [press], { height: true })).state).toBe("height_needed");
    const approximate = checkReadiness(editor.project, [bench], { height: false });
    expect([approximate.level, approximate.reasons]).toEqual(["review_needed", ["Workbench's box only encloses its drawn shape (enter its size to use it)"]]);
  });

  it("treats a migrated or undone review the same way: the undo of an acceptance blocks again", () => {
    const accepted = review(hall, { kind: "accept_floor" });
    expect(checkReadiness(back(accepted).project, [press], { height: false }).reasons).toContain("the floor is only proposed");
  });
});
