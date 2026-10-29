// The conversation's deterministic parts (UX-03): what the model is told, which suggestions can
// work, how a route answer and an edit's effect are worded - all from the existing checks.
import { readFileSync } from "node:fs";
import { type Project, validateProject } from "@replay-world/contracts";
import { describe, expect, it } from "vitest";
import { drawingSource } from "../drawing/world";
import { brief, buildChatContext, nameOf, suggestions, type WorldFacts } from "./context";
import { editImpact } from "./impact";
import { answerProcess, endPoint, routeBetween } from "./routes";

const checked = validateProject(JSON.parse(readFileSync(new URL("../../../../fixtures/scenes/sample-factory.json", import.meta.url), "utf8")));
if (!checked.ok) throw new Error("sample");
const sample = checked.value;
const moved = (p: Project, id: string, dz: number): Project => ({
  ...p,
  scene: { ...p.scene, revision: p.scene.revision + 1, objects: p.scene.objects.map((o) => (o.id === id ? { ...o, transform: { ...o.transform, position_m: { ...o.transform.position_m, z: o.transform.position_m.z + dz } } } : o)) },
});
const facts = (f: Partial<WorldFacts>): WorldFacts => ({ hasWorld: true, hasDrawing: true, reviewOpen: false, hasProcess: true, hasRun: false, runStale: false, layoutEdited: false, canUndo: false, hasSelection: false, canExplain: false, outputChanged: null, ...f });

describe("the chat context", () => {
  it("tells the model ids, names, kinds, placements and sizes only, with station names", () => {
    const context = buildChatContext(sample, null);
    expect(Object.keys(context.objects[0]!).sort()).toEqual(["id", "kind", "name", "position_m", "rotation_y_rad", "size_m"]);
    expect(context.objects.find((o) => o.id === "obj-dxf-106")!.name).toBe("Rack A (material)"); // the station name contains the object's
    const renamed: Project = { ...sample, process: { ...sample.process!, stations: sample.process!.stations.map((s) => (s.object_id === "obj-dxf-111" ? { ...s, name: "Former" } : s)) as NonNullable<Project["process"]>["stations"] } } as Project;
    expect(buildChatContext(renamed, null).objects.find((o) => o.id === "obj-dxf-111")!.name).toBe("Former (Machine B)");
    expect(nameOf(renamed, "obj-dxf-111")).toBe("Former (Machine B)");
    expect(nameOf(sample, "obj-dxf-106")).toBe("Rack A (material)");
  });
});

describe("suggestions", () => {
  it("offer the three starting points on an empty project", () => {
    expect(suggestions(facts({ hasWorld: false, hasDrawing: false, hasProcess: false }), false)).toEqual(["workshop", "upload", "example"]);
  });
  it("leave the workshop task's card as the only next step while it is open", () => {
    expect(suggestions(facts({ inTask: true, hasRun: true, layoutEdited: true }), true)).toEqual([]);
  });
  it("offer only what can work now", () => {
    expect(suggestions(facts({}), true)).toEqual(["move_any", "route", "run_example"]);
    expect(suggestions(facts({ hasSelection: true }), false)).toEqual(["move", "route", "run"]);
    expect(suggestions(facts({ hasRun: true, runStale: true, layoutEdited: true, canUndo: true }), true)).toEqual(["run_again", "move_any", "route", "undo"]);
    expect(suggestions(facts({ hasRun: true, layoutEdited: true, canExplain: true, outputChanged: true }), true)[0]).toBe("why");
    expect(suggestions(facts({ hasRun: true, layoutEdited: true, canExplain: true, outputChanged: false }), true)[0]).toBe("compare");
    expect(suggestions(facts({ reviewOpen: true }), false)).toEqual(["capabilities"]);
  });
});

describe("route answers", () => {
  it("shortens a route check's sentence for a card", () => {
    expect(brief("Blocked: the best way through narrows to 0.70 m between Machine B and Rack B, and the item needs 0.80 m.")).toBe("narrows to 0.70 m between Machine B and Rack B; needs 0.80 m");
    expect(brief("Blocked at the destination: the destination point is 0.10 m from Rack B, and the item needs 0.40 m on each side.")).toBe("the end is 0.10 m from Rack B; needs 0.40 m each side");
  });

  it("starts a route outside each object's footprint, facing the other", () => {
    const rack = sample.scene.objects.find((o) => o.id === "obj-dxf-106")!; // 15 × 1 m at z −1.5
    const p = endPoint(rack, { x: -2.5, z: 0 }, 1.4); // toward the aisle (+z)
    expect(p.x).toBeCloseTo(-2.5);
    expect(p.z).toBeCloseTo(-1.5 + 0.5 + 0.7 + 0.05);
    const ask = routeBetween(drawingSource(sample)!, rack, sample.scene.objects.find((o) => o.id === "obj-dxf-113")!, 1.2, 0.1);
    expect(ask).toMatchObject({ width: "1.2", allowance: "0.1" });
  });

  it("answers along the shift's routes, naming a blocked one", () => {
    expect(answerProcess(sample)!.sentence).toBe("Yes: the shift's 3 carrying routes all still fit.");
    const blocked = answerProcess(moved(sample, "obj-dxf-111", 3.5))!;
    expect(blocked.outcome).toBe("conflict");
    expect(blocked.sentence).toMatch(/^No: Rack A \(material\) ↔ Mixer is blocked \(narrows to 0\.70 m between Machine B and Rack B; needs 0\.80 m\)\.$/);
  });
});

describe("an edit's effect, before Apply", () => {
  it("lists the routes it would block and the walks it lengthens, from the checks on both layouts", () => {
    const lines = editImpact(sample, moved(sample, "obj-dxf-111", 3.5), null);
    expect(lines).toContain("Rack A (material) ↔ Mixer would be blocked: narrows to 0.70 m between Machine B and Rack B; needs 0.80 m.");
    expect(editImpact(sample, sample, null)).toEqual([]);
  });
});
