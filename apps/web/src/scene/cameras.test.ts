import { Box3, OrthographicCamera, PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { frameBox, PLAN_UP, planView, scaleBar } from "./cameras";

function corners(box: Box3): Vector3[] {
  const out: Vector3[] = [];
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y])
      for (const z of [box.min.z, box.max.z]) out.push(new Vector3(x, y, z));
  return out;
}

const demoArea = new Box3(new Vector3(-11, -0.2, -7.5), new Vector3(11, 5, 7.5));

describe("orbit framing", () => {
  it.each([
    ["wide viewport", 16 / 9, [0.62, 0.55, 0.85]],
    ["narrow viewport", 0.6, [0.62, 0.55, 0.85]],
    ["from the west", 1.4, [-1, 0.3, 0]],
    ["almost overhead", 1.4, [0.01, 1, 0.01]],
  ] as const)("keeps every corner of the area on screen (%s)", (_label, aspect, direction) => {
    const pose = frameBox(demoArea, 45, aspect, [...direction]);
    const camera = new PerspectiveCamera(45, aspect, 0.1, 1000);
    camera.position.set(...pose.position);
    camera.lookAt(new Vector3(...pose.target));
    camera.updateMatrixWorld();
    for (const corner of corners(demoArea)) {
      const ndc = corner.project(camera);
      expect(Math.abs(ndc.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(ndc.y)).toBeLessThanOrEqual(1);
    }
  });

  it("frames tightly: the area fills most of the view instead of floating in the middle", () => {
    const pose = frameBox(demoArea, 45, 16 / 9);
    const camera = new PerspectiveCamera(45, 16 / 9, 0.1, 1000);
    camera.position.set(...pose.position);
    camera.lookAt(new Vector3(...pose.target));
    camera.updateMatrixWorld();
    const extent = Math.max(...corners(demoArea).map((c) => Math.max(Math.abs(c.clone().project(camera).x), Math.abs(c.clone().project(camera).y))));
    expect(extent).toBeGreaterThan(0.85);
    expect(extent).toBeLessThanOrEqual(0.9 + 1e-6);
  });

  it("frames a single machine closely instead of from across the hall", () => {
    const machine = new Box3(new Vector3(-1, 0, -0.9), new Vector3(1, 2.5, 0.9));
    const pose = frameBox(machine, 45, 1.6);
    const distance = new Vector3(...pose.position).distanceTo(new Vector3(...pose.target));
    expect(distance).toBeGreaterThan(2);
    expect(distance).toBeLessThan(6);
    expect(pose.target).toEqual([0, 1.25, 0]);
  });
});

describe("plan view", () => {
  it("fits the floor footprint with north (-Z) up and +X to the right", () => {
    const [w, h] = [1200, 800];
    const view = planView(demoArea, w, h);
    const camera = new OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 0.1, 1000);
    camera.zoom = view.zoom;
    camera.up.set(...PLAN_UP);
    camera.position.set(...view.position);
    camera.lookAt(view.position[0], 0, view.position[2]);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    for (const corner of corners(demoArea)) {
      const ndc = corner.project(camera);
      expect(Math.abs(ndc.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(ndc.y)).toBeLessThanOrEqual(1);
    }
    expect(new Vector3(10, 0, 0).project(camera).x).toBeGreaterThan(0.5); // east is right
    expect(new Vector3(0, 0, -7).project(camera).y).toBeGreaterThan(0.5); // -Z is up
  });

  it("gives a round-numbered scale bar for any zoom", () => {
    expect(scaleBar(40)).toEqual({ metres: 2, pixels: 80, label: "2 m" });
    expect(scaleBar(10)).toEqual({ metres: 10, pixels: 100, label: "10 m" });
    expect(scaleBar(400).label).toBe("0.5 m");
    for (const zoom of [3, 7.5, 18, 33, 61, 140]) {
      const bar = scaleBar(zoom);
      expect(bar.pixels).toBeLessThanOrEqual(180);
      expect(bar.pixels).toBeGreaterThanOrEqual(60);
    }
  });
});
