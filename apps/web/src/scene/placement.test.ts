import { readFileSync } from "node:fs";
import type { Project, SceneObject } from "@replay-world/contracts";
import { describe, expect, it } from "vitest";
import { worldBounds } from "./placement";

const project = JSON.parse(
  readFileSync(new URL("../../../../fixtures/scenes/foundation-scene.json", import.meta.url), "utf8"),
) as Project;
const object = (id: string): SceneObject => {
  const found = project.scene.objects.find((o) => o.id === id);
  if (!found) throw new Error(`fixture has no object ${id}`);
  return found;
};

function extents(id: string) {
  const b = worldBounds(object(id));
  return {
    x: [b.min.x, b.max.x],
    y: [b.min.y, b.max.y],
    z: [b.min.z, b.max.z],
  };
}

// Three.js stores geometry in float32 (~1e-7 relative precision), while the contract is float64.
// Rendering is therefore held to a 1 micrometre tolerance, not to float64 exactness.
const RENDER_TOLERANCE_DIGITS = 6;

function expectClose(actual: number[], expected: number[]) {
  expected.forEach((value, i) => expect(actual[i]).toBeCloseTo(value, RENDER_TOLERANCE_DIGITS));
}

describe("placement of contract objects in the renderer", () => {
  it("stands floor objects on y = 0 with their full height above it", () => {
    const column = extents("obj-column-c1");
    expectClose(column.y, [0, 6]);
    expectClose(column.x, [3.8, 4.2]);
    expectClose(column.z, [-3.2, -2.8]);
  });

  it("puts the floor slab's top surface at y = 0", () => {
    expectClose(extents("obj-floor").y, [-0.2, 0]);
  });

  it("swaps footprint extents for a quarter turn about +Y", () => {
    // Packing station: width 1.2 m (local X), depth 1.0 m (local Z), rotated pi/2.
    const packing = extents("obj-packing-station");
    expectClose(packing.x, [2.0, 3.0]);
    expectClose(packing.z, [-0.6, 0.6]);
    expectClose(packing.y, [0, 1.4]);
  });

  it("keeps the reference cube exactly 1 m on every axis", () => {
    const cube = extents("obj-reference-cube");
    for (const [min, max] of [cube.x, cube.y, cube.z]) expect(max! - min!).toBeCloseTo(1, RENDER_TOLERANCE_DIGITS);
  });
});
