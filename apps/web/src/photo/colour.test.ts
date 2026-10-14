import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { APPEARANCE_SRGB, nearestAppearance, suggestAppearance } from "./colour";

describe("photo colours", () => {
  it("mirrors the server's material colours", () => {
    const python = readFileSync(new URL("../../../../services/api/src/replay_world_api/objects/materials.py", import.meta.url), "utf8");
    for (const [material, hex] of Object.entries(APPEARANCE_SRGB)) {
      const match = new RegExp(`"${material}": MaterialSpec\\(\\s*"(#[0-9a-f]{6})"`).exec(python);
      expect(match?.[1], material).toBe(hex);
    }
  });

  it("matches photo colours to the nearest appearance", () => {
    expect(nearestAppearance([120, 30, 40])).toBe("paint_red");
    expect(nearestAppearance([74, 28, 34])).toBe("paint_red"); // dark maroon plastic chair, not black
    expect(["wood", "pallet_wood", "cardboard"]).toContain(nearestAppearance([216, 200, 168])); // beige laminate, not safety yellow
    expect(nearestAppearance([128, 130, 134])).toBe("plastic_grey");
    expect(nearestAppearance([168, 122, 79])).toBe("wood");
    expect(nearestAppearance([30, 30, 32])).toBe("plastic_black");
    expect(nearestAppearance([240, 240, 236])).toBe("paint_white");
    expect(nearestAppearance([40, 95, 170])).toBe("paint_blue");
  });

  it("suggests the colour that stands out from the surroundings", () => {
    // A red chair-like shape over a grey-blue floor that also shows through the outline.
    const width = 40;
    const height = 40;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const chair = x >= 14 && x < 26 && y >= 10 && y < 20;
        data.set(chair ? [120, 30, 40, 255] : [110, 120, 140, 255], (y * width + x) * 4);
      }
    }
    const pixels = { data, width, height };
    // The outline is larger than the red part, so the floor is the most common colour inside it.
    expect(suggestAppearance(pixels, { left: 0.3, top: 0.2, right: 0.7, bottom: 0.8 })).toBe("paint_red");
    // A grey object is left to the model's suggestion.
    const grey = new Uint8ClampedArray(data);
    for (let i = 0; i < grey.length; i += 4) if (grey[i] === 120) grey.set([60, 60, 62], i);
    expect(suggestAppearance({ data: grey, width, height }, { left: 0.3, top: 0.2, right: 0.7, bottom: 0.8 })).toBeNull();
    // An outline over plain floor has nothing that stands out.
    expect(suggestAppearance(pixels, { left: 0.0, top: 0.6, right: 0.3, bottom: 0.95 })).toBeNull();
    expect(suggestAppearance(pixels, { left: 1.1, top: 0, right: 1.5, bottom: 1 })).toBeNull();
  });
});
