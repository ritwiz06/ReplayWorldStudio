// Attached models drawn through a recorded correction (ENR-01): the browser's turn is the
// contract's, the corrected bounds are checked against the record, and the "contain" fit keeps
// proportions inside the recorded envelope. Uses the fixtures in fixtures/models/.
import { readFileSync } from "node:fs";
import type { Dimensions, GltfVisual } from "@replay-world/contracts";
import { describe, expect, it } from "vitest";
import { correctedPoint, envelopeFill, fitScale } from "./fit";
import { parseCatalogModel, sha256Hex } from "./modelLoader";

const models = new URL("../../../../fixtures/models/", import.meta.url);
const bytes = (name: string): ArrayBuffer => {
  const b = readFileSync(new URL(name, models));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const length = (value_m: number) => ({ value_m, origin: "drawn" as const, source_ref: null, review_status: "unreviewed" as const, uncertainty_m: null });
const dims = (w: number, h: number, d: number): Dimensions => ({ width: length(w), height: length(h), depth: length(d) });

async function visual(name: string, up: "+Y" | "+Z", turns: number, file: [number[], number[]], offset: number[], bounds: [number[], number[]], fit: GltfVisual["fit"] = "contain"): Promise<GltfVisual> {
  const xyz = (v: number[]) => ({ x: v[0]!, y: v[1]!, z: v[2]! });
  return {
    type: "gltf",
    uri: `uploaded/${name}`,
    sha256: await sha256Hex(bytes(name)),
    metres_per_model_unit: 1,
    up_axis: "+Y",
    front_axis: "+Z",
    origin: "bottom_centre",
    model_bounds_m: { min: xyz(bounds[0]), max: xyz(bounds[1]) },
    fit,
    max_fit_distortion: 0.05,
    correction: { up_axis: up, turns, file_bounds: { min: xyz(file[0]), max: xyz(file[1]) }, offset: xyz(offset) },
  };
}

describe("the correction map", () => {
  it("is the contract's: up axis to +Y, then quarter turns clockwise seen from above", () => {
    expect(correctedPoint("+Z", 0, [1, 2, 3])).toEqual([1, 3, -2]);
    expect(correctedPoint("+Y", 1, [1, 0, 0])).toEqual([-0, 0, 1]); // +X turns to +Z (toward the viewer of the plan)
    expect(correctedPoint("-X", 2, [1, 2, 3])).toEqual([-2, -1, -3]);
  });
});

describe("an attached model drawn through its correction", () => {
  it("measures to its recorded bounds after nested node transforms and a quarter turn", async () => {
    // nested.glb is (0, 0, -2) to (2, 2, 0) as written; turned once it spans x 0..2, z 0..2.
    const v = await visual("nested.glb", "+Y", 1, [[0, 0, -2], [2, 2, 0]], [-1, 0, -1], [[-1, 0, -1], [1, 2, 1]]);
    const result = await parseCatalogModel(bytes("nested.glb"), v);
    expect(result.ok).toBe(true);
  });

  it("stands a Z-up file upright, and refuses a record its file does not measure to", async () => {
    const upright = await visual("z-up.glb", "+Z", 0, [[-0.6, -0.4, 0], [0.6, 0.4, 2]], [0, 0, 0], [[-0.6, 0, -0.4], [0.6, 2, 0.4]]);
    expect((await parseCatalogModel(bytes("z-up.glb"), upright)).ok).toBe(true);
    const wrong = { ...upright, correction: { ...upright.correction!, up_axis: "+Y" as const } };
    const result = await parseCatalogModel(bytes("z-up.glb"), wrong);
    expect(!result.ok && result.failure.kind).toBe("bounds_mismatch");
  });
});

describe("the contain fit", () => {
  it("keeps proportions inside the recorded envelope, and says how much of it is filled", async () => {
    const v = await visual("off-centre.glb", "+Y", 0, [[2, 0, 3], [3, 1.5, 4]], [-2.5, 0, -3.5], [[-0.5, 0, -0.5], [0.5, 1.5, 0.5]]);
    const recorded = dims(1.5, 1.6, 1.0); // a machine's drawn footprint, assumed height
    expect(fitScale(v, recorded)).toEqual([1, 1, 1].map(() => 1.0)); // 1 x 1.5 x 1 fits as it is
    const smaller = dims(0.5, 3, 2);
    const [s] = fitScale(v, smaller);
    expect(fitScale(v, smaller)).toEqual([s, s, s]);
    expect(s).toBe(0.5);
    expect(envelopeFill(v, smaller).map((f) => Math.round(f * 100))).toEqual([100, 25, 25]);
    expect(fitScale({ ...v, fit: "scale_to_dimensions" }, smaller)).toEqual([0.5, 2, 2]); // stretching is explicit
  });
});
