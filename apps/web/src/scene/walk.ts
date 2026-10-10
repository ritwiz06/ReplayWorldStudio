// Human-scale walking: eye height, speed, collision with object footprints and floor limits.
// Pure functions so the behaviour can be tested without a browser.
import type { Box3 } from "three";

export const EYE_HEIGHT_M = 1.6;
export const WALK_SPEED_M_S = 1.4;
export const RUN_MULTIPLIER = 2.5;
export const TURN_RATE_RAD_S = 1.6;
export const BODY_RADIUS_M = 0.25;
export const MAX_PITCH_RAD = (80 * Math.PI) / 180;

/** Floor-plane rectangle in world X/Z. */
export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface WalkWorld {
  /** Where the walker may stand. */
  floor: Rect;
  /** Footprints the walker cannot enter. */
  obstacles: Rect[];
}

/** Position on the floor (eye height is fixed) and view angles. Yaw 0 faces world -Z. */
export interface WalkPose {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
}

export interface WalkInput {
  /** -1 backwards … 1 forwards. */
  forward: number;
  /** -1 left … 1 right. */
  strafe: number;
  /** -1 turn left … 1 turn right. */
  turn: number;
  run: boolean;
}

export function rectOf(box: Box3): Rect {
  return { minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z };
}

export function isBlocked(world: WalkWorld, x: number, z: number): boolean {
  const r = BODY_RADIUS_M;
  const f = world.floor;
  if (x < f.minX + r || x > f.maxX - r || z < f.minZ + r || z > f.maxZ - r) return true;
  return world.obstacles.some((o) => x > o.minX - r && x < o.maxX + r && z > o.minZ - r && z < o.maxZ + r);
}

/** Advance the walker by `dt` seconds. Movement slides along obstacles axis by axis. */
export function stepWalker(pose: WalkPose, input: WalkInput, dt: number, world: WalkWorld): WalkPose {
  const yaw = pose.yaw - input.turn * TURN_RATE_RAD_S * dt;
  const speed = WALK_SPEED_M_S * (input.run ? RUN_MULTIPLIER : 1) * dt;
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  let dx = fx * input.forward + Math.cos(yaw) * input.strafe;
  let dz = fz * input.forward - Math.sin(yaw) * input.strafe;
  const length = Math.hypot(dx, dz);
  if (length > 1) {
    dx /= length;
    dz /= length;
  }
  let { x, z } = pose;
  if (!isBlocked(world, x + dx * speed, z)) x += dx * speed;
  if (!isBlocked(world, x, z + dz * speed)) z += dz * speed;
  return { x, z, yaw, pitch: pose.pitch };
}

/** Change view angles by a look gesture (radians), keeping pitch within comfortable limits. */
export function look(pose: WalkPose, dYaw: number, dPitch: number): WalkPose {
  const pitch = Math.min(MAX_PITCH_RAD, Math.max(-MAX_PITCH_RAD, pose.pitch + dPitch));
  return { ...pose, yaw: pose.yaw + dYaw, pitch };
}

/** Start near the open (+Z, south) edge of the floor, looking across the area towards -Z. */
export function walkStart(world: WalkWorld): WalkPose {
  const f = world.floor;
  const x = (f.minX + f.maxX) / 2;
  for (let back = 1.5; back < f.maxZ - f.minZ; back += 0.5) {
    const z = f.maxZ - back;
    if (!isBlocked(world, x, z)) return { x, z, yaw: 0, pitch: -0.08 };
  }
  return { x, z: (f.minZ + f.maxZ) / 2, yaw: 0, pitch: 0 };
}

/** Stand a few metres from an object, preferring its front (+Z), facing it. */
export function walkPoseFacing(target: Rect, world: WalkWorld, distance = 2.5): WalkPose {
  const cx = (target.minX + target.maxX) / 2;
  const cz = (target.minZ + target.maxZ) / 2;
  const candidates: [number, number][] = [
    [cx, target.maxZ + distance],
    [target.maxX + distance, cz],
    [target.minX - distance, cz],
    [cx, target.minZ - distance],
  ];
  for (const [x, z] of candidates) {
    if (!isBlocked(world, x, z)) {
      return { x, z, yaw: Math.atan2(-(cx - x), -(cz - z)), pitch: -0.15 };
    }
  }
  return walkStart(world);
}
