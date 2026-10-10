// Handle drags as pure maths: a drag starts on a plane chosen for its handle, each pointer ray
// gives a preview of the object, and only the release becomes a command. Values snap through
// the same unit functions as the numeric fields, so a handle that stops at 2.35 m stores what
// typing "2.35" stores.
import type { SceneObject, Transform } from "@replay-world/contracts";
import { Euler, Plane, type Ray, Vector3 } from "three";
import { AXIS_ORDER, type Axis, type EditCommand } from "../editing/commands";
import { degToRad, quantizeDegrees, quantizeMetres, radToDeg, wrapDegrees } from "../editing/units";

export type EditTool = "select" | "move" | "rotate" | "resize";

export type HandleId =
  | "move-x"
  | "move-y"
  | "move-z"
  | "move-xz"
  | "rotate-y"
  | "size-x+"
  | "size-x-"
  | "size-y+"
  | "size-z+"
  | "size-z-";

export const TOOL_HANDLES: Record<Exclude<EditTool, "select">, readonly HandleId[]> = {
  move: ["move-x", "move-y", "move-z", "move-xz"],
  rotate: ["rotate-y"],
  resize: ["size-x+", "size-x-", "size-z+", "size-z-", "size-y+"],
};

export interface Snap {
  /** Step for positions and dimensions, in millimetres. */
  lengthMm: number;
  /** Step for rotation, in degrees. */
  angleDeg: number;
}

export const SNAP_ON: Snap = { lengthMm: 10, angleDeg: 15 };
export const SNAP_OFF: Snap = { lengthMm: 1, angleDeg: 1 };

export interface DragFrame {
  handle: HandleId;
  /** The object as it was when the drag began. */
  object: SceneObject;
  plane: Plane;
  /** World direction for one-dimensional drags. */
  axis: Vector3 | null;
  /** Where the first pointer ray met the drag plane. */
  start: Vector3;
}

const WORLD: Record<"x" | "y" | "z", Vector3> = {
  x: new Vector3(1, 0, 0),
  y: new Vector3(0, 1, 0),
  z: new Vector3(0, 0, 1),
};

function eulerOf(t: Transform): Euler {
  const r = t.rotation_rad;
  return new Euler(r.x, r.y, r.z, r.order);
}

/** The object's local axis in world space. */
export function localAxis(object: SceneObject, axis: "x" | "y" | "z"): Vector3 {
  return WORLD[axis].clone().applyEuler(eulerOf(object.transform));
}

export function originOf(object: SceneObject): Vector3 {
  const p = object.transform.position_m;
  return new Vector3(p.x, p.y, p.z);
}

/** True when the object turns only about the vertical axis, so the yaw ring is meaningful. */
export function yawOnly(object: SceneObject): boolean {
  const r = object.transform.rotation_rad;
  return r.x === 0 && r.z === 0;
}

const SIZE: Partial<Record<HandleId, { axis: "x" | "y" | "z"; sign: 1 | -1; dimension: Axis }>> = {
  "size-x+": { axis: "x", sign: 1, dimension: "width" },
  "size-x-": { axis: "x", sign: -1, dimension: "width" },
  "size-y+": { axis: "y", sign: 1, dimension: "height" },
  "size-z+": { axis: "z", sign: 1, dimension: "depth" },
  "size-z-": { axis: "z", sign: -1, dimension: "depth" },
};

/** World position of each handle's anchor: the origin for move and rotate, face centres for resize. */
export function handleAnchor(object: SceneObject, handle: HandleId): Vector3 {
  const size = SIZE[handle];
  const origin = originOf(object);
  if (!size) return origin;
  const { width, height, depth } = object.dimensions;
  const half = { x: width.value_m / 2, y: height.value_m, z: depth.value_m / 2 }[size.axis];
  const local = new Vector3(0, size.axis === "y" ? 0 : height.value_m / 2, 0);
  local[size.axis] = size.sign * half;
  return local.applyEuler(eulerOf(object.transform)).add(origin);
}

/** World direction a handle drags along, or null for planar drags. */
export function handleAxis(object: SceneObject, handle: HandleId): Vector3 | null {
  if (handle === "move-x") return WORLD.x.clone();
  if (handle === "move-y") return WORLD.y.clone();
  if (handle === "move-z") return WORLD.z.clone();
  const size = SIZE[handle];
  return size ? localAxis(object, size.axis).multiplyScalar(size.sign) : null;
}

/** A plane containing `axis` through `point`, turned to face the viewer as much as possible. */
function axisPlane(point: Vector3, axis: Vector3, viewDirection: Vector3): Plane {
  const normal = viewDirection.clone().sub(axis.clone().multiplyScalar(viewDirection.dot(axis)));
  if (normal.lengthSq() < 1e-8) normal.copy(Math.abs(axis.y) < 0.9 ? WORLD.y : WORLD.x).cross(axis).cross(axis);
  return new Plane().setFromNormalAndCoplanarPoint(normal.normalize(), point);
}

export function beginDrag(handle: HandleId, object: SceneObject, ray: Ray, viewDirection: Vector3): DragFrame | null {
  const anchor = handleAnchor(object, handle);
  const axis = handleAxis(object, handle);
  const plane = axis ? axisPlane(anchor, axis, viewDirection) : new Plane(WORLD.y.clone(), -object.transform.position_m.y);
  const start = ray.intersectPlane(plane, new Vector3());
  return start ? { handle, object, plane, axis, start } : null;
}

/** A snapped value, or the original when the drag has not left the original's snap cell. */
function snapLength(original: number, raw: number, stepMm: number): number {
  const snapped = quantizeMetres(raw, stepMm);
  return snapped === quantizeMetres(original, stepMm) ? original : snapped;
}

/** Angle of a floor point about `centre`, measured from +X towards -Z (the right-hand rule about +Y). */
const yawOf = (point: Vector3, centre: Vector3) => Math.atan2(-(point.z - centre.z), point.x - centre.x);

/** The object as it would be if the pointer were released on `ray`. */
export function dragTo(frame: DragFrame, ray: Ray, snap: Snap): SceneObject {
  const hit = ray.intersectPlane(frame.plane, new Vector3());
  const object = frame.object;
  if (!hit) return object;
  const delta = hit.clone().sub(frame.start);
  const p = object.transform.position_m;
  const r = object.transform.rotation_rad;
  const withPosition = (x: number, y: number, z: number): SceneObject =>
    x === p.x && y === p.y && z === p.z ? object : { ...object, transform: { ...object.transform, position_m: { x, y, z } } };

  switch (frame.handle) {
    case "move-x":
      return withPosition(snapLength(p.x, p.x + delta.x, snap.lengthMm), p.y, p.z);
    case "move-y":
      return withPosition(p.x, snapLength(p.y, p.y + delta.y, snap.lengthMm), p.z);
    case "move-z":
      return withPosition(p.x, p.y, snapLength(p.z, p.z + delta.z, snap.lengthMm));
    case "move-xz":
      return withPosition(snapLength(p.x, p.x + delta.x, snap.lengthMm), p.y, snapLength(p.z, p.z + delta.z, snap.lengthMm));
    case "rotate-y": {
      const centre = originOf(object);
      const turned = radToDeg(r.y + yawOf(hit, centre) - yawOf(frame.start, centre));
      const snapped = wrapDegrees(quantizeDegrees(turned, snap.angleDeg));
      if (snapped === wrapDegrees(quantizeDegrees(radToDeg(r.y), snap.angleDeg))) return object;
      return { ...object, transform: { ...object.transform, rotation_rad: { ...r, y: degToRad(snapped) } } };
    }
    default: {
      const size = SIZE[frame.handle]!;
      const along = delta.dot(frame.axis!);
      const current = object.dimensions[size.dimension].value_m;
      // Width and depth grow symmetrically about the vertical axis, so the position (the
      // bottom-centre) is unchanged - exactly what typing a new width does. Height grows upwards.
      const raw = current + (size.axis === "y" ? along : 2 * along);
      const value = Math.max(snapLength(current, raw, snap.lengthMm), snap.lengthMm / 1000);
      if (value === current) return object;
      return { ...object, dimensions: { ...object.dimensions, [size.dimension]: { ...object.dimensions[size.dimension], value_m: value } } };
    }
  }
}

/** The single command a finished drag commits, or null when nothing changed. */
export function dragCommand(start: SceneObject, end: SceneObject): EditCommand | null {
  if (end.transform !== start.transform) return { type: "set_transform", objectId: start.id, transform: end.transform };
  const values: Partial<Record<Axis, number>> = {};
  for (const axis of AXIS_ORDER) {
    if (end.dimensions[axis].value_m !== start.dimensions[axis].value_m) values[axis] = end.dimensions[axis].value_m;
  }
  return Object.keys(values).length > 0 ? { type: "set_dimensions", objectId: start.id, values } : null;
}
