import { describe, expect, it } from "vitest";
import {
  EYE_HEIGHT_M,
  isBlocked,
  look,
  MAX_PITCH_RAD,
  stepWalker,
  walkPoseFacing,
  walkStart,
  WALK_SPEED_M_S,
  type WalkWorld,
} from "./walk";

const world: WalkWorld = {
  floor: { minX: -10, maxX: 10, minZ: -6, maxZ: 6 },
  obstacles: [{ minX: -1, maxX: 1, minZ: -3, maxZ: -1 }], // a machine north of the origin
};
const still = { forward: 0, strafe: 0, turn: 0, run: false };

describe("walking", () => {
  it("keeps a human eye height", () => {
    expect(EYE_HEIGHT_M).toBeGreaterThan(1.5);
    expect(EYE_HEIGHT_M).toBeLessThan(1.8);
  });

  it("walks forward along the view direction at walking speed", () => {
    const pose = { x: 0, z: 4, yaw: 0, pitch: 0 }; // facing -Z
    const next = stepWalker(pose, { ...still, forward: 1 }, 1, world);
    expect(next.x).toBeCloseTo(0, 9);
    expect(next.z).toBeCloseTo(4 - WALK_SPEED_M_S, 9);
    const running = stepWalker(pose, { ...still, forward: 1, run: true }, 1, world);
    expect(4 - running.z).toBeGreaterThan(2 * WALK_SPEED_M_S);
  });

  it("strafes to the right of the view direction", () => {
    const facingWest = { x: 0, z: 4, yaw: Math.PI / 2, pitch: 0 };
    const next = stepWalker(facingWest, { ...still, strafe: 1 }, 1, world);
    expect(next.z).toBeCloseTo(4 - WALK_SPEED_M_S, 9); // right of west is north (-Z)
  });

  it("stops at equipment and slides along it instead of passing through", () => {
    let pose = { x: 0.2, z: 1, yaw: 0, pitch: 0 };
    for (let i = 0; i < 100; i++) pose = stepWalker(pose, { ...still, forward: 1 }, 0.05, world);
    expect(pose.z).toBeGreaterThanOrEqual(-1 + 0.25 - 1e-9); // stopped at the front face + body radius
    const slid = stepWalker({ ...pose, yaw: Math.PI / 4 }, { ...still, forward: 1 }, 0.2, world);
    expect(slid.x).toBeLessThan(pose.x); // still moves sideways along the face
    expect(isBlocked(world, slid.x, slid.z)).toBe(false);
  });

  it("cannot leave the floor", () => {
    let pose = { x: 0, z: 4, yaw: Math.PI, pitch: 0 }; // facing +Z, towards the edge
    for (let i = 0; i < 200; i++) pose = stepWalker(pose, { ...still, forward: 1, run: true }, 0.05, world);
    expect(pose.z).toBeLessThanOrEqual(6 - 0.25);
  });

  it("limits looking up and down", () => {
    expect(look({ x: 0, z: 0, yaw: 0, pitch: 0 }, 0, 10).pitch).toBe(MAX_PITCH_RAD);
    expect(look({ x: 0, z: 0, yaw: 0, pitch: 0 }, 0, -10).pitch).toBe(-MAX_PITCH_RAD);
  });

  it("starts on open floor and can stand in front of a selected object facing it", () => {
    const start = walkStart(world);
    expect(isBlocked(world, start.x, start.z)).toBe(false);
    const front = walkPoseFacing(world.obstacles[0]!, world);
    expect(front.z).toBeCloseTo(-1 + 2.5, 9);
    expect(front.yaw).toBeCloseTo(0, 9); // facing -Z, towards the machine
  });
});
