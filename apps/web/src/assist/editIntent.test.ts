import type { EditIntent } from "@replay-world/contracts";
import { describe, expect, it } from "vitest";
import { applyCommand } from "../editing/commands";
import { fixture, objectOf } from "../testing/fixtures";
import { buildEditContext, resolveIntent } from "./editIntent";

const demo = () => fixture("scenes/industrial-demo.json");

function move(id: string, direction: NonNullable<EditIntent["move"]>["direction"], distance: number, unit: NonNullable<EditIntent["move"]>["unit"] = "m"): EditIntent {
  return {
    action: "move",
    target: { reference: "named", object_ids: [id], phrase: id },
    move: { direction, distance, unit, quote: `${distance} ${unit}` },
    rotate: null,
  };
}

function turn(id: string, direction: "clockwise" | "counterclockwise", angle: number): EditIntent {
  return {
    action: "rotate",
    target: { reference: "selected", object_ids: [id], phrase: "it" },
    move: null,
    rotate: { direction, angle_deg: angle, quote: `${angle} degrees` },
  };
}

describe("language edits", () => {
  it("tell the model only ids, names, kinds, placements, sizes and the selection", () => {
    const project = demo();
    const context = buildEditContext(project, "obj-cabinet-1");
    expect(context.revision).toBe(0);
    expect(context.selected_object_id).toBe("obj-cabinet-1");
    expect(context.objects).toHaveLength(project.scene.objects.length);
    expect(context.objects.find((o) => o.id === "obj-cabinet-1")).toEqual({
      id: "obj-cabinet-1",
      name: "Control cabinet 1",
      kind: "equipment",
      position_m: { x: -2, y: 0, z: -7.0295 },
      rotation_y_rad: 0,
      size_m: { x: 0.8, y: 2.078, z: 0.541 },
    });
  });

  it("turn “1 metre left” into an exact move along -X, shown before anything changes", () => {
    const project = demo();
    const resolved = resolveIntent(project, move("obj-cabinet-1", "left", 1, "m"), 0);
    if (!resolved.ok) throw new Error(resolved.message);
    expect(resolved.edit.summary).toBe("Move Control cabinet 1 by 1.000 m left (−X)");
    expect(resolved.edit.changes).toEqual(["x  -2.000 → -3.000 m"]);
    expect(resolved.edit.command).toMatchObject({ type: "set_transform", objectId: "obj-cabinet-1" });
    // Nothing was applied: the project still holds the old position.
    expect(objectOf(project, "obj-cabinet-1").transform.position_m.x).toBe(-2);
    // Applying the command gives exactly the shown value.
    const applied = applyCommand(project, { baseRevision: 0, command: resolved.edit.command });
    expect(applied.ok && objectOf(applied.project, "obj-cabinet-1").transform.position_m).toEqual({ x: -3, y: 0, z: -7.0295 });
  });

  it("convert units and follow the plan directions", () => {
    const project = demo();
    const cases: [EditIntent, string][] = [
      [move("obj-conveyor-infeed", "forward", 500, "mm"), "z  -1.200 → -0.700 m"],
      [move("obj-conveyor-infeed", "back", 30, "cm"), "z  -1.200 → -1.500 m"],
      [move("obj-conveyor-infeed", "right", 2, "ft"), "x  -7.700 → -7.090 m"],
      [move("obj-conveyor-infeed", "up", 4, "in"), "y  0.000 → 0.102 m"],
    ];
    for (const [intent, change] of cases) {
      const resolved = resolveIntent(project, intent, 0);
      expect(resolved.ok && resolved.edit.changes).toEqual([change]);
    }
  });

  it("turn clockwise as seen from above as a negative rotation about +Y", () => {
    const project = demo();
    const cw = resolveIntent(project, turn("obj-pallet-staged", "clockwise", 90), 0);
    const ccw = resolveIntent(project, turn("obj-pallet-staged", "counterclockwise", 90), 0);
    const from = (objectOf(project, "obj-pallet-staged").transform.rotation_rad.y * 180) / Math.PI;
    expect(cw.ok && cw.edit.changes).toEqual([`rotation Y  ${from.toFixed(1)}° → ${(from - 90).toFixed(1)}°`]);
    expect(ccw.ok && ccw.edit.summary).toBe("Turn Staged pallet 90.0° counterclockwise (seen from above)");
  });

  it("refuse, without changing anything, a change the command engine rejects", () => {
    const project = demo();
    const far = resolveIntent(project, move("obj-cabinet-1", "left", 2, "m"), 0);
    expect(far.ok).toBe(true);
    const tooFar = resolveIntent(project, move("obj-cabinet-1", "left", 2000, "m"), 0);
    expect(tooFar).toEqual({ ok: false, message: "Position X must be within ±1000 m." });
  });

  it("refuse a proposal prepared for an older revision (the scene changed meanwhile)", () => {
    const project = demo();
    const edited = applyCommand(project, { baseRevision: 0, command: { type: "remove_object", objectId: "obj-pallet-outfeed" } });
    if (!edited.ok) throw new Error("setup");
    const stale = resolveIntent(edited.project, move("obj-cabinet-1", "left", 1), 0);
    expect(stale.ok ? null : stale.message).toMatch(/scene changed \(revision 1\).*not applied/);
  });

  it("refuse a target that is no longer in the scene", () => {
    expect(resolveIntent(demo(), move("obj-gone", "left", 1), 0)).toEqual({ ok: false, message: "The object 'obj-gone' is no longer in the scene." });
  });
});
