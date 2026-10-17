import { readFileSync } from "node:fs";
import { type DrawingAnalysis, validateDrawingAnalysis, validateProject } from "@replay-world/contracts";
import { describe, expect, it } from "vitest";
import { createEditor, execute, undo } from "../editing/history";
import { deepFreeze } from "../testing/fixtures";
import { answer, isVerified } from "./checks";
import { compareWithDrawing, summary } from "./compare";
import { buildDrawingProject, drawnFrom, formatSize, sizeIn, toWorld, unitBasis } from "./world";

function analysis(name: string): DrawingAnalysis {
  const data: unknown = JSON.parse(readFileSync(new URL(`../../../../fixtures/drawings/${name}.analysis.json`, import.meta.url), "utf8"));
  const checked = validateDrawingAnalysis(data);
  if (!checked.ok) throw new Error(JSON.stringify(checked.issues));
  return deepFreeze(checked.value);
}

const hall = analysis("hall-mm");
const room = analysis("room-unitless");

describe("a draft world from a drawing", () => {
  it("settles the header's unit and centres the drawing on the world origin", () => {
    const project = buildDrawingProject(hall, "mm");
    expect(validateProject(project).ok).toBe(true);
    const [source] = project.sources;
    expect(source?.drawing?.units.basis).toBe("drawing_header");
    expect(source?.source_to_world).toEqual({
      convention: "plan_xy_to_world_x_neg_z",
      source_unit: "mm",
      metres_per_source_unit: 0.001,
      rotation_about_world_y_rad: 0,
      translation_m: { x: -12, y: 0, z: 8 },
    });
    // Drawing (0, 0) is the hall's south-west corner: world x -12 m, z +8 m (drawing +Y is world -Z).
    expect(toWorld(source!.source_to_world!, { x: 0, y: 0 })).toEqual({ x: -12, z: 8 });
  });

  it("places each drawn object at its drawn footprint with a display height marked as such", () => {
    const project = buildDrawingProject(hall, "mm");
    const press = project.scene.objects.find((o) => o.name === "Press 1")!;
    expect(press.id).toBe("obj-dxf-104");
    expect(press.transform).toEqual({ position_m: { x: -8.5, y: 0, z: 5 }, rotation_rad: { order: "XYZ", x: 0, y: 0, z: 0 } });
    expect([press.dimensions.width.value_m, press.dimensions.depth.value_m]).toEqual([3, 2]);
    expect(press.dimensions.width).toMatchObject({ origin: "drawn", review_status: "unreviewed" });
    expect(press.dimensions.width.source_ref).toBe(
      "Drawn in hall-mm.dxf: LWPOLYLINE 104 on layer EQUIPMENT, the outline as drawn; 1 unit = 1 mm (the drawing's own unit, $INSUNITS). A design drawing's size, not a site measurement.",
    );
    expect(press.dimensions.height).toMatchObject({ value_m: 2.2, origin: "default", review_status: "unreviewed" });
    expect(press.dimensions.height.source_ref).toContain("not in the drawing and not measured");
    expect(isVerified(press.dimensions.height)).toBe(false);
    expect(isVerified(press.dimensions.width)).toBe(false); // design geometry, not a measurement

    const table = project.scene.objects.find((o) => o.name === "Packing table")!;
    expect((table.transform.rotation_rad.y * 180) / Math.PI).toBeCloseTo(15, 3);
    const floor = project.scene.objects[0]!;
    expect([floor.id, floor.name, floor.kind, floor.transform.position_m.y, floor.dimensions.height.value_m]).toEqual(["obj-dxf-floor", "Floor", "structure", -0.1, 0.1]);
    expect(project.sources[0]?.drawing?.review).toMatchObject({
      floor: { choice: "outline", drawn_id: "dxf-101", object_id: "obj-dxf-floor", status: "proposed" },
      scale: { basis: "drawing_unit", unit: "mm", status: "unchecked" },
      omissions: "proposed",
    });
    const walkway = project.scene.objects.find((o) => o.kind === "walkway")!;
    expect(walkway.dimensions.height.value_m).toBe(0.005);
    expect(drawnFrom(project, press.id)?.drawn.refs[0]).toEqual({ handle: "104", layer: "EQUIPMENT", entity: "LWPOLYLINE", block: null });
  });

  it("uses the unit the person chose when the drawing does not say, and says so", () => {
    expect(room.drawing.units.question).not.toBeNull();
    expect(formatSize(room.drawing, "mm")).toBe("12 m × 8 m");
    expect(formatSize(room.drawing, "cm")).toBe("120 m × 80 m");
    expect(sizeIn(room.drawing, "m").width).toBe(12000);
    expect(unitBasis(room.drawing, "mm")).toBe("user_supplied");
    const project = buildDrawingProject(room, "mm");
    expect(validateProject(project).ok).toBe(true);
    expect(project.sources[0]?.drawing?.units.basis).toBe("user_supplied");
    const saw = project.scene.objects.find((o) => o.name === "Saw")!;
    expect(saw.dimensions.width.source_ref).toContain("1 unit = 1 mm (your choice of unit)");
    expect(project.sources[0]?.drawing?.review?.scale).toMatchObject({ basis: "chosen_unit", status: "confirmed" });
  });
});

describe("comparing with the drawing", () => {
  const project = buildDrawingProject(hall, "mm");

  it("finds every object as drawn before anything changes", () => {
    const comparison = compareWithDrawing(project)!;
    expect(comparison.counts).toEqual({ unchanged: 11, changed: 0, removed: 0, added: 0 });
    expect(summary(comparison.counts)).toBe("11 as drawn");
  });

  it("reports a move through the editor, keeps the source link, and undo restores the drawing", () => {
    let editor = createEditor(project);
    const press = project.scene.objects.find((o) => o.name === "Press 1")!;
    const moved = { ...press.transform, position_m: { ...press.transform.position_m, x: press.transform.position_m.x + 2 } };
    const outcome = execute(editor, { baseRevision: 0, command: { type: "set_transform", objectId: press.id, transform: moved } });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    editor = outcome.state;
    const comparison = compareWithDrawing(editor.project)!;
    const change = comparison.changes.find((c) => c.objectId === press.id)!;
    expect([change.status, change.what]).toEqual(["changed", ["moved 2.00 m"]]);
    expect(drawnFrom(editor.project, press.id)?.drawn.refs[0]?.handle).toBe("104");
    const back = undo(editor, editor.project.scene.revision);
    expect(back.ok && compareWithDrawing(back.state.project)!.counts.changed).toBe(0);
  });

  it("lists a removed object and an object that is not in the drawing", () => {
    const editor = createEditor(project);
    const press = project.scene.objects.find((o) => o.name === "Press 2")!;
    const removed = execute(editor, { baseRevision: 0, command: { type: "remove_object", objectId: press.id } });
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    const extra = { ...press, id: "obj-added", name: "New bench" };
    const withExtra = { ...removed.state.project, scene: { ...removed.state.project.scene, objects: [...removed.state.project.scene.objects, extra] } };
    const comparison = compareWithDrawing(withExtra)!;
    expect(comparison.changes.find((c) => c.objectId === press.id)?.status).toBe("removed");
    expect(comparison.changes.find((c) => c.objectId === "obj-added")?.what).toEqual(["added: not in the drawing"]);
  });
});

describe("checks that are not available yet", () => {
  const project = buildDrawingProject(hall, "mm");

  it("answers 'height needed' for an overhead check while heights are only for display", () => {
    const result = answer(project, "overhead");
    expect([result.status, result.title]).toEqual(["height_needed", "Height needed"]);
    expect(result.needs.map((n) => n.name)).toContain("Press 1");
    expect(result.needs.map((n) => n.name)).not.toContain("Floor");
    expect(result.needs.map((n) => n.name)).not.toContain("Walkway 1");
  });

  it("names the missing input for throughput and strength, with no result; clearance points to Check layout", () => {
    for (const question of ["throughput", "strength"] as const) {
      const result = answer(project, question);
      expect(result.status).toBe("not_available");
      expect(result.message).toMatch(/needs/);
    }
    expect(answer(project, "strength").message).toContain("neither is ever inferred");
    const clearance = answer(project, "clearance").message;
    expect(clearance).toContain("Check layout answers part of this");
    expect(clearance).toContain("access and service zones are never assumed");
  });

  it("is still not a result once every height is entered", () => {
    const entered = {
      ...project,
      scene: {
        ...project.scene,
        objects: project.scene.objects.map((o) => ({ ...o, dimensions: { ...o.dimensions, height: { ...o.dimensions.height, origin: "user_supplied" as const } } })),
      },
    };
    expect(answer(entered, "overhead").status).toBe("not_available");
  });
});
