import type { GeometryDraft, GeometryPart } from "@replay-world/contracts";
import { describe, expect, it } from "vitest";
import { generatedAsset } from "../testing/fixtures";
import { changedSizes, instancePlan, movePart, recolour, removePart, resizePart, revisedDimensions, revisedObjects, specChanges, withParts, withSize } from "./revisionDraft";

const part = (id: string, label: string, material: GeometryPart["material"], center: [number, number, number], size: [number, number, number]): GeometryPart => ({
  id,
  label,
  shape: "box",
  material,
  center_m: { x: center[0], y: center[1], z: center[2] },
  size_m: { x: size[0], y: size[1], z: size[2] },
  axis: null,
  taper: null,
  narrow_end: null,
  basis: "inferred",
});

// A solid cabinet: one body on a plinth.
const cabinet: GeometryDraft = {
  format: "rws-geometry/1",
  envelope_m: { x: 0.8, y: 1.8, z: 0.4 },
  parts: [part("body", "body", "wood", [0, 0.95, 0], [0.8, 1.7, 0.4]), part("plinth", "plinth", "steel_dark", [0, 0.05, 0], [0.8, 0.1, 0.4])],
};

describe("revision changes in plain words", () => {
  it("lists colours, added and removed parts, and size changes", () => {
    const shelves = withParts(cabinet, [
      part("side-left", "left side", "wood", [-0.39, 0.9, 0], [0.02, 1.8, 0.4]),
      part("side-right", "right side", "wood", [0.39, 0.9, 0], [0.02, 1.8, 0.4]),
      part("plinth", "plinth", "paint_white", [0, 0.05, 0], [0.8, 0.1, 0.4]),
    ]);
    expect(specChanges(cabinet, shelves)).toEqual(['Removed “body”', "Added “left side” (box, wood)", "Added “right side” (box, wood)", "“plinth”: colour steel dark → paint white"]);
    const wider = withSize(cabinet, "width", 1.2);
    // The dialog compares against the fitted preview, in which every part is scaled with the
    // whole object; such a part is not reported as changed.
    const scaled: GeometryDraft = { ...wider, parts: cabinet.parts.map((p) => ({ ...p, size_m: { ...p.size_m, x: 1.2 } })) as GeometryDraft["parts"] };
    expect(specChanges(cabinet, scaled)).toEqual(["Width 0.800 m → 1.200 m"]);
    expect(specChanges(cabinet, recolour(cabinet, "wood", "paint_blue"))).toEqual(["“body”: colour wood → paint blue"]);
  });

  it("keeps the evidence of unchanged sizes; changed ones are entered or confirmed proposals", () => {
    const recoloured = recolour(cabinet, "wood", "paint_white");
    expect(revisedDimensions(cabinet, recoloured, {}, new Set())).toEqual({
      width: { basis: "kept", confirmed: true },
      height: { basis: "kept", confirmed: true },
      depth: { basis: "kept", confirmed: true },
    });
    const taller = withSize(cabinet, "height", 2.0);
    expect(revisedDimensions(cabinet, taller, { height: "proposed" }, new Set()).height).toEqual({ basis: "proposed", confirmed: false });
    expect(revisedDimensions(cabinet, taller, { height: "proposed" }, new Set(["height"])).height).toEqual({ basis: "proposed", confirmed: true });
    expect(revisedDimensions(cabinet, taller, {}, new Set()).height).toEqual({ basis: "entered", confirmed: true });
  });
});

describe("which objects change, and how", () => {
  const asset = generatedAsset();
  const follower = { id: "obj-a", name: "A", kind: "equipment" as const, asset_id: asset.id, transform: { position_m: { x: 0, y: 0, z: 0 }, rotation_rad: { order: "XYZ" as const, x: 0, y: 0, z: 0 } }, dimensions: structuredClone(asset.nominal_dimensions), parameters: [] };
  const measured = {
    ...follower,
    id: "obj-b",
    name: "B",
    dimensions: { ...structuredClone(asset.nominal_dimensions), width: { value_m: 2.4, origin: "user_supplied" as const, source_ref: "Measured on site", review_status: "confirmed" as const, uncertainty_m: null } },
  };
  const wider = { x: 2.6, y: asset.nominal_dimensions.height.value_m, z: asset.nominal_dimensions.depth.value_m };

  it("lets an object that used the model's size follow it, and keeps an object's own size unless chosen", () => {
    const plan = instancePlan([follower, measured], asset, wider, new Set());
    expect(plan.map((p) => p.axes[0])).toEqual([
      { key: "width", mode: "follows", before: 2.2, after: 2.6 },
      { key: "width", mode: "own", value: 2.4, modelSize: 2.6, adopt: false },
    ]);
    expect(plan[0]!.axes[1]).toEqual({ key: "height", mode: "same", value: 1.2 });
    const revised = { ...asset, nominal_dimensions: { ...asset.nominal_dimensions, width: { ...asset.nominal_dimensions.width, value_m: 2.6 } } };
    expect(revisedObjects(plan, revised)).toEqual([
      { objectId: "obj-a", dimensions: { width: revised.nominal_dimensions.width } },
      { objectId: "obj-b", dimensions: {} },
    ]);
    const adopted = instancePlan([measured], asset, wider, new Set(["obj-b:width"]));
    expect(revisedObjects(adopted, revised)).toEqual([{ objectId: "obj-b", dimensions: { width: revised.nominal_dimensions.width } }]);
  });
});

describe("one part at a time (GEN-09)", () => {
  const cabinet: GeometryDraft = {
    format: "rws-geometry/1",
    envelope_m: { x: 0.6, y: 1.9, z: 0.4 },
    parts: [
      { id: "plinth", label: "plinth", shape: "box", material: "paint_anthracite", center_m: { x: 0, y: 0.05, z: 0 }, size_m: { x: 0.6, y: 0.1, z: 0.4 }, axis: null, taper: null, narrow_end: null, basis: "inferred" },
      { id: "body", label: "body", shape: "box", material: "paint_light_grey", center_m: { x: 0, y: 1.0, z: 0 }, size_m: { x: 0.6, y: 1.8, z: 0.4 }, axis: null, taper: null, narrow_end: null, basis: "inferred" },
      { id: "lamp", label: "lamp", shape: "box", material: "signal_green", center_m: { x: 0.2, y: 1.85, z: 0 }, size_m: { x: 0.1, y: 0.1, z: 0.1 }, axis: null, taper: null, narrow_end: null, basis: "inferred" },
    ] as unknown as GeometryDraft["parts"],
  };

  it("moves a part inside the object without changing the overall size, and says how far", () => {
    const moved = movePart(cabinet, "lamp", { x: -0.2, y: 1.85, z: 0 })!;
    expect(moved.line).toBe("Moved “lamp” 40 cm to the left");
    expect(moved.draft.envelope_m).toEqual(cabinet.envelope_m);
    expect(changedSizes(cabinet, moved.draft)).toEqual([]);
  });

  it("lets the overall size follow a part that reaches out, for the user to confirm", () => {
    const raised = movePart(cabinet, "lamp", { x: 0.2, y: 1.95, z: 0 })!;
    expect(raised.draft.envelope_m.y).toBeCloseTo(2.0, 6);
    expect(changedSizes(cabinet, raised.draft)).toEqual(["height"]);
    // A size changed by a part edit is the user's, but is not settled until confirmed.
    expect(revisedDimensions(cabinet, raised.draft, { height: "part" }, new Set()).height).toEqual({ basis: "entered", confirmed: false });
    expect(revisedDimensions(cabinet, raised.draft, { height: "part" }, new Set(["height"])).height).toEqual({ basis: "entered", confirmed: true });
  });

  it("resizes a part about its centre and keeps a floor-standing part on the floor", () => {
    const wider = resizePart(cabinet, "plinth", { x: 0.6, y: 0.2, z: 0.4 });
    expect(wider.line).toBe("Made “plinth” 10 cm taller");
    const plinth = wider.draft.parts.find((p) => p.id === "plinth")!;
    expect(plinth.center_m.y - plinth.size_m.y / 2).toBeCloseTo(0, 6);
  });

  it("removes a part (never the last one) and the overall size follows what is left", () => {
    const lampless = removePart(cabinet, "lamp")!;
    expect(lampless.line).toBe("Removed “lamp”");
    expect(lampless.draft.parts.map((p) => p.id)).toEqual(["plinth", "body"]);
    expect(changedSizes(cabinet, lampless.draft)).toEqual([]); // the body also reaches the top
    const without = removePart(cabinet, "plinth")!;
    expect(changedSizes(cabinet, without.draft)).toEqual(["height"]); // nothing reaches the floor now
    expect(without.draft.envelope_m.y).toBeCloseTo(1.8, 6);
    expect(removePart({ ...cabinet, parts: [cabinet.parts[0]!] } as GeometryDraft, "plinth")).toBeNull();
    // Moving the only part would only move the whole object: that is done in the scene.
    expect(movePart({ ...cabinet, parts: [cabinet.parts[0]!] } as GeometryDraft, "plinth", { x: 0.1, y: 0.05, z: 0 })).toBeNull();
  });

  it("says a re-centred model once, and a tiny change in millimetres", () => {
    // The lamp sticks out to the right; removing it re-centres what is left.
    const wide = movePart(cabinet, "lamp", { x: 0.35, y: 1.85, z: 0 })!;
    const lines = specChanges(wide.draft, removePart(wide.draft, "lamp")!.draft);
    expect(lines).toContain("Width 0.700 m → 0.600 m");
    expect(lines).toContain("Removed “lamp”");
    expect(lines.find((l) => l.includes("re-centred"))).toBe("The other parts keep their places relative to each other, but the model is re-centred, so in the scene they move 5 cm to the right");
    expect(lines.some((l) => l.includes("resized or moved"))).toBe(false);
    expect(resizePart(cabinet, "lamp", { x: 0.096, y: 0.1, z: 0.1 }).line).toBe("Made “lamp” 4 mm narrower");
    // A part the user moved and resized is listed with exact amounts, not "resized or moved".
    const panel = movePart(resizePart(cabinet, "body", { x: 0.6, y: 1.8, z: 0.02 }).draft, "body", { x: 0, y: 1.0, z: -0.19 })!;
    expect(specChanges(cabinet, panel.draft)).toEqual(["“body”: moved 19 cm back; became 38 cm shallower"]);
  });
});
