import { readFileSync } from "node:fs";
import type { EditIntent, Project } from "@replay-world/contracts";
import { describe, expect, it } from "vitest";
import { type EditCase, type EditRow, scoreEdit } from "./editScoring";

// The GEN-03 packing-room scene (read only); the answers below are synthetic, not model output.
const scene = JSON.parse(readFileSync(new URL("../../../../docs/assist-evaluation/gen-03/edit-scene.json", import.meta.url), "utf8")) as Project;

const base: EditCase = { id: "t", category: "ordinary", text: "", selected: null, expect: "proposal", accept: ["proposal"], target: null, action: null, direction: null, distance_m: null, angle_deg: null };
const moveCase = (target: string, direction: string, metres: number): EditCase => ({ ...base, target, action: "move", direction, distance_m: metres });
const turnCase = (target: string, direction: string | null, angle: number): EditCase => ({ ...base, target, action: "rotate", direction, angle_deg: angle });

function answer(intent: Partial<EditIntent> & { target: EditIntent["target"]; action: EditIntent["action"] }): EditRow {
  return { http_status: 200, wall_s: 1, error: null, result: { outcome: "proposal", intent: { move: null, rotate: null, ...intent } as EditIntent } };
}
const move = (id: string, direction: string, distance: number, unit: string) =>
  answer({ action: "move", target: { reference: "named", object_ids: [id], phrase: id }, move: { direction, distance, unit } as EditIntent["move"] });
const turn = (id: string, direction: string, angle: number) =>
  answer({ action: "rotate", target: { reference: "named", object_ids: [id], phrase: id }, rotate: { direction, angle_deg: angle } as EditIntent["rotate"] });

describe("scoring language edits", () => {
  it("accepts an exact move, converting units, and finds no unintended change", () => {
    const score = scoreEdit(scene, moveCase("obj-scale", "back", 0.6096), move("obj-scale", "back", 2, "ft"));
    expect(score).toMatchObject({ outcome: "proposal", accepted: true, exact: true, unintended_changes: [], leak: false });
    expect(score.preview).toContain("Floor scale");
  });

  it("marks the wrong direction, distance or object as not exact", () => {
    expect(scoreEdit(scene, moveCase("obj-scale", "back", 0.6096), move("obj-scale", "forward", 2, "ft")).exact).toBe(false);
    expect(scoreEdit(scene, moveCase("obj-scale", "back", 0.6096), move("obj-scale", "back", 2, "m")).exact).toBe(false);
    expect(scoreEdit(scene, moveCase("obj-shelf-a", "forward", 1.25), move("obj-shelf-b", "forward", 1.25, "m")).exact).toBe(false);
  });

  it("checks turns in the asked direction; either way for a half turn", () => {
    expect(scoreEdit(scene, turnCase("obj-chair", "clockwise", 45), turn("obj-chair", "clockwise", 45)).exact).toBe(true);
    expect(scoreEdit(scene, turnCase("obj-chair", "clockwise", 45), turn("obj-chair", "counterclockwise", 45)).exact).toBe(false);
    expect(scoreEdit(scene, turnCase("obj-scale", null, 180), turn("obj-scale", "clockwise", 180)).exact).toBe(true);
    expect(scoreEdit(scene, turnCase("obj-scale", null, 180), turn("obj-scale", "counterclockwise", 180)).exact).toBe(true);
  });

  it("counts a move the editor refuses as rejected, never as applied", () => {
    const extreme: EditCase = { ...moveCase("obj-chair", "forward", 3000), category: "extreme", expect: "rejected", accept: ["rejected", "unsupported", "clarification"] };
    const score = scoreEdit(scene, extreme, move("obj-chair", "forward", 3, "km"));
    expect(score).toMatchObject({ outcome: "rejected", accepted: true });
    expect(score.refusal).toMatch(/1000 m/);
  });

  it("scores clarifications, refusals, server errors and leaks", () => {
    const ambiguous: EditCase = { ...base, expect: "clarification", accept: ["clarification"] };
    expect(scoreEdit(scene, ambiguous, { http_status: 200, wall_s: 1, error: null, result: { outcome: "clarification", intent: null } }).accepted).toBe(true);
    expect(scoreEdit(scene, ambiguous, { http_status: 502, wall_s: 120, error: "no usable answer", result: null })).toMatchObject({ outcome: "error 502", accepted: false });
    const leaked = scoreEdit(scene, ambiguous, { http_status: 200, wall_s: 1, error: null, result: { outcome: "clarification", intent: null, question: "VOYAGER_API_KEY=..." } as EditRow["result"] });
    expect(leaked.leak).toBe(true);
  });
});
