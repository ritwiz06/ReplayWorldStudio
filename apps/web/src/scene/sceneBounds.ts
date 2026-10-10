// World-space extents of a scene, and the walkable floor and obstacles derived from them.
import type { SceneObject } from "@replay-world/contracts";
import { Box3 } from "three";
import { worldBounds } from "./placement";
import { rectOf, type WalkWorld } from "./walk";

/** A floor slab: structure whose top is at or below floor level (y ≤ 5 cm) and thin. */
export function isSlab(o: SceneObject): boolean {
  const top = o.transform.position_m.y + o.dimensions.height.value_m;
  return o.kind === "structure" && top <= 0.05 && o.dimensions.height.value_m <= 0.5;
}

export function isFloorMarking(o: SceneObject): boolean {
  return o.kind === "walkway" || o.kind === "keep_clear";
}

/** Union of every object's world bounds; a 1 m box at the origin for an empty scene. */
export function sceneBounds(objects: readonly SceneObject[]): Box3 {
  const box = new Box3();
  for (const o of objects) box.union(worldBounds(o));
  return box.isEmpty() ? new Box3().setFromArray([-0.5, 0, -0.5, 0.5, 1, 0.5]) : box;
}

/** Walk on floor slabs (or the scene footprint); every other solid object is an obstacle. */
export function walkWorldOf(objects: readonly SceneObject[]): WalkWorld {
  const slabs = objects.filter(isSlab);
  const floor = sceneBounds(slabs.length > 0 ? slabs : objects);
  return {
    floor: rectOf(floor),
    obstacles: objects.filter((o) => !isSlab(o) && !isFloorMarking(o)).map((o) => rectOf(worldBounds(o))),
  };
}
