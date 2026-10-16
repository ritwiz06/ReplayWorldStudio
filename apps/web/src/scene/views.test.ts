import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";
import { outlineTransparent, TRANSPARENT_EDGE } from "./modelLoader";
import { viewCamera } from "./views";

describe("review views (GEN-07)", () => {
  it("use the cameras the API's visibility checks render from", () => {
    // services/api/src/replay_world_api/assist/visibility.py, camera(): a 1.8 x 2.0 x 0.6 m rack.
    expect(viewCamera("front-right", [1.8, 2, 0.6])).toEqual({ eye: [3.2, 3.2, 4.2], target: [0, 1, 0] });
    expect(viewCamera("rear-left", [1.8, 2, 0.6])).toEqual({ eye: [-3.2, 3.2, -4.2], target: [0, 1, 0] });
    const low = viewCamera("low-front", [1.8, 2, 0.6]);
    expect(low.eye.map((v) => +v.toFixed(6))).toEqual([2.2, 0.24, 5.2]);
    expect(low.target.map((v) => +v.toFixed(6))).toEqual([0, 0.8, 0]);
  });
});

describe("transparent parts (GEN-06)", () => {
  it("get readable edges and stop hiding what is behind them; opaque parts are untouched", () => {
    const scene = new Group();
    const glass = new Mesh(new BoxGeometry(1, 1, 0.02), new MeshStandardMaterial({ transparent: true, opacity: 0.25 }));
    const steel = new Mesh(new BoxGeometry(1, 0.1, 1), new MeshStandardMaterial());
    scene.add(glass, steel);
    outlineTransparent(scene);
    const edges = glass.children.find((c) => c.name === "transparent-edges");
    expect(edges).toBeDefined();
    expect(((edges as Mesh).material as MeshStandardMaterial).color.getHexString()).toBe(TRANSPARENT_EDGE.slice(1));
    expect((glass.material as MeshStandardMaterial).depthWrite).toBe(false);
    expect(steel.children).toHaveLength(0);
    expect((steel.material as MeshStandardMaterial).depthWrite).toBe(true);
  });
});
