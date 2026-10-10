// Maps contract transforms onto Three.js. The world frame (right-handed, +Y up, metres) is the
// same as Three.js's, so positions and Euler angles carry over without conversion. The one
// convention to apply: `position_m` is the bounding-box bottom-centre, so the box mesh sits
// half its height above the object's origin in the object's local frame.
import type { SceneObject } from "@replay-world/contracts";
import { Box3, BoxGeometry, Euler, Group, Mesh } from "three";

type Vec3Tuple = [x: number, y: number, z: number];

export interface Placement {
  /** Object origin (bounding-box bottom-centre) in world metres. */
  position: Vec3Tuple;
  /** Euler rotation in radians, Three.js "XYZ" order, as in the contract. */
  rotation: [x: number, y: number, z: number, order: "XYZ"];
  /** Box size along local X, Y, Z in metres. */
  size: Vec3Tuple;
  /** Box-centre offset from the object origin, in the object's local frame. */
  meshOffset: Vec3Tuple;
}

export function placementOf(object: Pick<SceneObject, "transform" | "dimensions">): Placement {
  const { position_m: p, rotation_rad: r } = object.transform;
  const { width, height, depth } = object.dimensions;
  return {
    position: [p.x, p.y, p.z],
    rotation: [r.x, r.y, r.z, r.order],
    size: [width.value_m, height.value_m, depth.value_m],
    meshOffset: [0, height.value_m / 2, 0],
  };
}

/** World-space axis-aligned bounds of the rendered box, built exactly as the viewport builds it. */
export function worldBounds(object: Pick<SceneObject, "transform" | "dimensions">): Box3 {
  const placement = placementOf(object);
  const group = new Group();
  group.position.set(...placement.position);
  group.rotation.copy(new Euler(...placement.rotation));
  const mesh = new Mesh(new BoxGeometry(...placement.size));
  mesh.position.set(...placement.meshOffset);
  group.add(mesh);
  group.updateMatrixWorld(true);
  return new Box3().setFromObject(mesh);
}
