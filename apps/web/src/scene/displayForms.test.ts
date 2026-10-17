import type { SceneObject } from "@replay-world/contracts";
import { describe, expect, it } from "vitest";
import { displayForm, partsOf } from "./displayForms";

const length = (value_m: number, origin: "measured" | "default" | "user_supplied") => ({ value_m, origin, source_ref: "x", review_status: "unreviewed" as const, uncertainty_m: null });

function object(name: string, heightOrigin: "default" | "user_supplied" = "default", assetId: string | null = null): SceneObject {
  return {
    id: "obj-a",
    name,
    kind: "equipment",
    asset_id: assetId,
    transform: { position_m: { x: 0, y: 0, z: 0 }, rotation_rad: { order: "XYZ", x: 0, y: 0, z: 0 } },
    dimensions: { width: length(6, "measured"), height: length(2.4, heightOrigin), depth: length(1.1, "measured") },
    parameters: [],
  };
}

describe("display forms", () => {
  it("are chosen by name only for model-less equipment whose height is assumed", () => {
    expect(displayForm(object("Pallet rack"))).toBe("rack");
    expect(displayForm(object("Packing table"))).toBe("table");
    expect(displayForm(object("Workbench"))).toBe("table");
    expect(displayForm(object("Infeed conveyor"))).toBe("conveyor");
    expect(displayForm(object("Press 1"))).toBe("box");
    expect(displayForm(object("Pallet rack", "user_supplied"))).toBe("box"); // a real height: no stand-in
    expect(displayForm(object("Pallet rack", "default", "asset-rack"))).toBe("box"); // it has a model
  });

  it("stay inside the recorded box", () => {
    for (const form of ["rack", "table", "conveyor"] as const) {
      for (const [w, h, d] of [
        [6, 2.4, 1.1],
        [1.1, 2.4, 6],
        [0.8, 0.9, 0.6],
      ] as const) {
        const parts = partsOf(form, w, h, d);
        expect(parts.length).toBeGreaterThan(2);
        for (const { centre, size } of parts) {
          expect(Math.abs(centre[0]) + size[0] / 2).toBeLessThanOrEqual(w / 2 + 1e-9);
          expect(centre[1] - size[1] / 2).toBeGreaterThanOrEqual(-1e-9);
          expect(centre[1] + size[1] / 2).toBeLessThanOrEqual(h + 1e-9);
          expect(Math.abs(centre[2]) + size[2] / 2).toBeLessThanOrEqual(d / 2 + 1e-9);
        }
      }
    }
  });
});
