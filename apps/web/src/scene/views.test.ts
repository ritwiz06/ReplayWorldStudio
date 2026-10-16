import { BoxGeometry, Group, Mesh, MeshStandardMaterial, type Vector2, type WebGLRenderer } from "three";
import type { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
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
    const edges = glass.children.filter((c) => c.name === "transparent-edges");
    // A dark outline under a light core: readable on light and dark grounds.
    expect(edges.map((e) => ((e as Mesh).material as MeshStandardMaterial).color.getHexString())).toEqual([
      TRANSPARENT_EDGE.outline.slice(1),
      TRANSPARENT_EDGE.core.slice(1),
    ]);
    expect((glass.material as MeshStandardMaterial).depthWrite).toBe(false);
    expect(steel.children).toHaveLength(0);
    expect((steel.material as MeshStandardMaterial).depthWrite).toBe(true);
  });

  it("keep their screen width in every placed copy, not only in the original (GEN-09)", () => {
    // The scene and the preview draw clones; a clone drops an object's own render hook, which
    // left the lines without the canvas size, so the placed glass had no visible edges.
    const scene = new Group();
    scene.add(new Mesh(new BoxGeometry(1, 1, 0.02), new MeshStandardMaterial({ transparent: true, opacity: 0.25 })));
    outlineTransparent(scene);
    const placed = scene.clone(true);
    const edge = placed.children[0]!.children.find((c) => c.name === "transparent-edges") as Mesh;
    const material = edge.material as LineMaterial;
    const renderer = { getDrawingBufferSize: (v: Vector2) => v.set(1280, 720) } as unknown as WebGLRenderer;
    material.onBeforeRender(renderer, null as never, null as never, null as never, edge, null as never);
    expect(material.resolution.toArray()).toEqual([1280, 720]);
  });
});
