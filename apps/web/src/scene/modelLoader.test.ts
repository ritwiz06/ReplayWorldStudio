// Loads the real catalog GLB files in Node and checks them against the demo's catalog records.
import { readFileSync } from "node:fs";
import type { GltfVisual, Project, SceneObject } from "@replay-world/contracts";
import { Box3 } from "three";
import { describe, expect, it } from "vitest";
import { fitDistortion, isStretched } from "./fit";
import { instanceModel, loadCatalogModel, parseCatalogModel, sha256Hex } from "./modelLoader";
import { worldBounds } from "./placement";

const repo = new URL("../../../../", import.meta.url);
const demo = JSON.parse(readFileSync(new URL("fixtures/scenes/industrial-demo.json", repo), "utf8")) as Project;
const bytesOf = (uri: string): ArrayBuffer => {
  const buffer = readFileSync(new URL(`assets/catalog/${uri}`, repo));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
};
const gltfAssets = demo.catalog.filter((a) => a.visual.type === "gltf");
const visualOf = (assetId: string) => demo.catalog.find((a) => a.id === assetId)!.visual as GltfVisual;

async function template(visual: GltfVisual) {
  const result = await parseCatalogModel(bytesOf(visual.uri), visual);
  if (!result.ok) throw new Error(result.failure.message);
  return result.scene;
}

function expectBoxesClose(actual: Box3, expected: Box3, tolerance = 1e-4) {
  for (const corner of ["min", "max"] as const)
    for (const axis of ["x", "y", "z"] as const)
      expect(Math.abs(actual[corner][axis] - expected[corner][axis])).toBeLessThanOrEqual(tolerance);
}

describe("catalog glTF models", () => {
  it("has at least three distinct models, reused by several instances", () => {
    expect(gltfAssets.length).toBeGreaterThanOrEqual(3);
    expect(new Set(gltfAssets.map((a) => (a.visual as GltfVisual).sha256)).size).toBe(gltfAssets.length);
    const uses = demo.scene.objects.filter((o) => o.asset_id === "asset-belt-conveyor-3m").length;
    expect(uses).toBeGreaterThan(1);
  });

  it.each(gltfAssets.map((a) => [a.id, a.visual as GltfVisual] as const))(
    "%s matches its recorded hash and bounds and has real detail",
    async (_id, visual) => {
      expect(await sha256Hex(bytesOf(visual.uri))).toBe(visual.sha256);
      const scene = await template(visual);
      let meshes = 0;
      let triangles = 0;
      scene.traverse((node) => {
        const geometry = (node as { geometry?: { index: { count: number } | null } }).geometry;
        if (geometry?.index) {
          meshes += 1;
          triangles += geometry.index.count / 3;
        }
      });
      expect(meshes).toBeGreaterThanOrEqual(4); // several materials, not one painted box
      expect(triangles).toBeGreaterThan(1000);
    },
  );
});

describe("fitting models to recorded dimensions", () => {
  const equipment = demo.scene.objects.filter((o) => o.asset_id !== null);

  it.each(equipment.map((o) => [o.id, o] as const))(
    "%s rests on the floor and fills exactly its recorded footprint",
    async (_id, object) => {
      const visual = visualOf(object.asset_id!);
      const placed = instanceModel(await template(visual), visual, object);
      const drawn = new Box3().setFromObject(placed);
      expectBoxesClose(drawn, worldBounds(object));
      expect(drawn.min.y).toBeCloseTo(object.transform.position_m.y, 4);
      expect(isStretched(visual, object.dimensions)).toBe(false);
    },
  );

  it("rotates the footprint with the instance (staged pallet, quarter turn)", async () => {
    const pallet = demo.scene.objects.find((o) => o.id === "obj-pallet-staged")!;
    const visual = visualOf(pallet.asset_id!);
    const drawn = new Box3().setFromObject(instanceModel(await template(visual), visual, pallet));
    expect(drawn.max.x - drawn.min.x).toBeCloseTo(pallet.dimensions.depth.value_m, 4);
    expect(drawn.max.z - drawn.min.z).toBeCloseTo(pallet.dimensions.width.value_m, 4);
  });

  it("stretches to a different recorded size but flags the distortion", async () => {
    const conveyor = demo.scene.objects.find((o) => o.id === "obj-conveyor-transfer")!;
    const longer: SceneObject = structuredClone(conveyor);
    longer.dimensions.width.value_m = 3.6;
    const visual = visualOf(conveyor.asset_id!);
    const drawn = new Box3().setFromObject(instanceModel(await template(visual), visual, longer));
    expectBoxesClose(drawn, worldBounds(longer));
    expect(fitDistortion(visual, longer.dimensions)).toBeCloseTo(0.2, 9);
    expect(isStretched(visual, longer.dimensions)).toBe(true);
  });
});

describe("refusing models that cannot be trusted", () => {
  const machine = visualOf("asset-guarded-machine-cell");

  it("refuses bytes whose hash differs from the catalog record", async () => {
    const result = await parseCatalogModel(bytesOf("models/belt-conveyor-3m.glb"), machine);
    expect(!result.ok && result.failure.kind).toBe("hash_mismatch");
    expect(!result.ok && result.failure.message).toContain("pnpm assets:build");
  });

  it("refuses bytes that are not binary glTF even when the hash matches", async () => {
    const bytes = new TextEncoder().encode("definitely not a glb").buffer as ArrayBuffer;
    const visual = { ...machine, sha256: await sha256Hex(bytes) };
    const result = await parseCatalogModel(bytes, visual);
    expect(!result.ok && result.failure.kind).toBe("invalid_gltf");
  });

  it("refuses a model whose measured bounds differ from the record", async () => {
    const visual = structuredClone(machine);
    visual.model_bounds_m.max.x += 0.01;
    const result = await parseCatalogModel(bytesOf(machine.uri), visual);
    expect(!result.ok && result.failure).toMatchObject({ kind: "bounds_mismatch" });
    expect(!result.ok && result.failure.message).toContain("10.0 mm");
  });

  it("explains missing files, unsafe paths and an unreachable API", async () => {
    const respond = (status: number, detail: string): typeof fetch => () =>
      Promise.resolve(new Response(JSON.stringify({ detail }), { status }));
    const missing = await loadCatalogModel("u", machine, respond(404, "Model file 'models/x.glb' is not in the catalog library."));
    expect(!missing.ok && missing.failure).toEqual({
      kind: "not_found",
      message: "Model file 'models/x.glb' is not in the catalog library.",
    });
    const unsafe = await loadCatalogModel("u", machine, respond(400, "'../x.glb' is not a catalog path"));
    expect(!unsafe.ok && unsafe.failure.kind).toBe("unsafe_path");
    const offline = await loadCatalogModel("u", machine, () => Promise.reject(new TypeError("Failed to fetch")));
    expect(!offline.ok && offline.failure.kind).toBe("network");
  });
});
