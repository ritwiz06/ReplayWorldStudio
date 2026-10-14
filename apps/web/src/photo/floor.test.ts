import { describe, expect, it } from "vitest";
import {
  applyHomography,
  calibrateFromRectangle,
  floorPoint,
  heightAt,
  homography,
  imagePointOf,
  invert3,
  placeObject,
  type Calibration,
  type ImagePoint,
  type Mat3,
  type RectangleInput,
} from "./floor";

// ---------------------------------------------------------------------------------------------
// An independent synthetic camera. World frame: metres, Y up, floor at y = 0. The camera yaws
// about +Y (three.js convention: yaw 0 looks along -Z) and pitches down; no roll.
// ---------------------------------------------------------------------------------------------

type V3 = [number, number, number];
const W = 1280;
const H = 960;
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const rad = (deg: number) => (deg * Math.PI) / 180;

interface TestCamera {
  position: V3;
  yawDeg: number;
  project(p: V3): ImagePoint;
  /** Scene coordinates the calibration should report, given the rectangle centre. */
  toScene(p: V3, origin: V3): V3;
}

function makeCamera(opts: { fovDeg: number; height: number; pitchDownDeg: number; yawDeg: number; x?: number; z?: number }): TestCamera {
  const position: V3 = [opts.x ?? 0, opts.height, opts.z ?? 0];
  const yaw = rad(opts.yawDeg);
  const pitch = rad(opts.pitchDownDeg);
  const right: V3 = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const forward: V3 = [-Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
  // Image "down" completes the right-handed (right, down, forward) camera frame.
  const down: V3 = [
    forward[1] * right[2] - forward[2] * right[1],
    forward[2] * right[0] - forward[0] * right[2],
    forward[0] * right[1] - forward[1] * right[0],
  ];
  const f = H / 2 / Math.tan(rad(opts.fovDeg) / 2);
  // The scene frame by definition: X = camera right on the floor, Z = minus camera forward on the floor.
  const sceneX: V3 = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const sceneZ: V3 = [Math.sin(yaw), 0, Math.cos(yaw)];
  return {
    position,
    yawDeg: opts.yawDeg,
    project(p) {
      const d = sub(p, position);
      const zc = dot(d, forward);
      if (zc <= 0) throw new Error("test point behind the camera");
      return { u: (f * dot(d, right)) / zc / W + 0.5, v: (f * dot(d, down)) / zc / H + 0.5 };
    },
    toScene(p, origin) {
      const d = sub(p, origin);
      return [dot(d, sceneX), p[1], dot(d, sceneZ)];
    },
  };
}

/** World corners of a w x d rectangle centred at `centre`, turned by `turnDeg` about Y. */
function rectangle(centre: V3, w: number, d: number, turnDeg: number): V3[] {
  const a = rad(turnDeg);
  const ax: V3 = [Math.cos(a), 0, -Math.sin(a)];
  const az: V3 = [Math.sin(a), 0, Math.cos(a)];
  const at = (s: number, t: number): V3 => [centre[0] + s * ax[0] + t * az[0], 0, centre[2] + s * ax[2] + t * az[2]];
  return [at(-w / 2, -d / 2), at(w / 2, -d / 2), at(w / 2, d / 2), at(-w / 2, d / 2)];
}

/** Deterministic pseudo-random numbers in [0, 1). */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const camera = makeCamera({ fovDeg: 55, height: 1.7, pitchDownDeg: 25, yawDeg: 20 });
const rectCentre: V3 = [-1.4, 0, -3.8];
const worldRect = rectangle(rectCentre, 2.0, 1.4, 10);

function input(corners: V3[], widthM: number, depthM: number | null, extra: Partial<RectangleInput> = {}): RectangleInput {
  return { corners: corners.map((c) => camera.project(c)), widthM, depthM, imageWidthPx: W, imageHeightPx: H, ...extra };
}

function calibrate(i: RectangleInput): Calibration {
  const result = calibrateFromRectangle(i);
  if (!result.ok) throw new Error(result.message);
  return result.calibration;
}

/** Random floor points visible in the photo, around the rectangle. */
function floorSamples(cam: TestCamera, n: number): V3[] {
  const random = rng(7);
  const out: V3[] = [];
  while (out.length < n) {
    const p: V3 = [rectCentre[0] - 2.5 + 5 * random(), 0, rectCentre[2] - 2 + 4 * random()];
    const img = cam.project(p);
    if (img.u > 0 && img.u < 1 && img.v > 0 && img.v < 1) out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------

describe("homography helpers", () => {
  it("maps four points exactly and inverts", () => {
    const src: [number, number][] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    const dst: [number, number][] = [
      [100, 200],
      [900, 260],
      [700, 800],
      [150, 650],
    ];
    const h = homography(src, dst)!;
    src.forEach((s, i) => {
      const p = applyHomography(h, s[0], s[1])!;
      expect(p[0]).toBeCloseTo(dst[i]![0], 6);
      expect(p[1]).toBeCloseTo(dst[i]![1], 6);
    });
    const back = invert3(h)!;
    const q = applyHomography(back, 700, 800)!;
    expect(q[0]).toBeCloseTo(1, 9);
    expect(q[1]).toBeCloseTo(1, 9);
  });

  it("rejects degenerate input", () => {
    const square: [number, number][] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    expect(
      homography(square, [
        [0, 0],
        [1, 1],
        [2, 2],
        [0, 5],
      ]),
    ).toBeNull();
    expect(invert3([1, 2, 3, 2, 4, 6, 0, 0, 1] as Mat3)).toBeNull();
    expect(applyHomography([1, 0, 0, 0, 1, 0, 1, 0, 0], 0, 3)).toBeNull();
  });
});

describe("calibration with both sides given", () => {
  const cal = calibrate(input(worldRect, 2.0, 1.4));

  it("recovers the lens, camera height and position", () => {
    expect(cal.fovBasis).toBe("from_rectangle");
    expect(Math.abs(cal.verticalFovDeg - 55)).toBeLessThan(0.5);
    expect(Math.abs(cal.camera.y - 1.7)).toBeLessThan(1e-3);
    const expected = camera.toScene(camera.position, rectCentre);
    expect(Math.abs(cal.camera.x - expected[0])).toBeLessThan(1e-3);
    expect(Math.abs(cal.camera.z - expected[2])).toBeLessThan(1e-3);
    expect(cal.consistency).not.toBeNull();
    expect(Math.abs(cal.consistency! - 1)).toBeLessThan(1e-3);
    expect(cal.depthDerived).toBe(false);
    expect(cal.warnings).toEqual([]);
  });

  it("maps floor points to metres within a millimetre and back to the photo", () => {
    for (const p of floorSamples(camera, 40)) {
      const img = camera.project(p);
      const got = floorPoint(cal, img)!;
      const want = camera.toScene(p, rectCentre);
      expect(Math.hypot(got.x - want[0], got.z - want[2])).toBeLessThan(1e-3);
      const back = imagePointOf(cal, got.x, 0, got.z)!;
      expect(Math.abs(back.u - img.u)).toBeLessThan(1e-9);
      expect(Math.abs(back.v - img.v)).toBeLessThan(1e-9);
    }
  });

  it("projects points above the floor like the real camera", () => {
    const p: V3 = [-0.6, 1.1, -4.2];
    const want = camera.project(p);
    const s = camera.toScene(p, rectCentre);
    const got = imagePointOf(cal, s[0], s[1], s[2])!;
    expect(Math.abs(got.u - want.u)).toBeLessThan(1e-6);
    expect(Math.abs(got.v - want.v)).toBeLessThan(1e-6);
    // Behind the camera.
    const behind = camera.toScene([0, 1, 3], rectCentre);
    expect(imagePointOf(cal, behind[0], behind[1], behind[2])).toBeNull();
  });

  it("returns null above the horizon", () => {
    expect(floorPoint(cal, { u: 0.5, v: 0.02 })).toBeNull();
  });
});

describe("calibration with one side given", () => {
  it("derives the depth from perspective and says it is approximate", () => {
    const cal = calibrate(input(worldRect, 2.0, null));
    expect(cal.depthDerived).toBe(true);
    expect(Math.abs(cal.depthM - 1.4)).toBeLessThan(1e-3);
    expect(cal.consistency).toBeNull();
    expect(cal.warnings.some((w) => /perspective/.test(w) && /approximate/.test(w))).toBe(true);
    expect(Math.abs(cal.camera.y - 1.7)).toBeLessThan(1e-3);
  });
});

describe("corner order", () => {
  const [c0, c1, c2, c3] = worldRect as [V3, V3, V3, V3];
  // Each ordering keeps "first side = the 2.0 m width".
  const orders: [string, V3[]][] = [
    ["anticlockwise from c0", [c0, c1, c2, c3]],
    ["clockwise from c1", [c1, c0, c3, c2]],
    ["anticlockwise from c2", [c2, c3, c0, c1]],
    ["clockwise from c3", [c3, c2, c1, c0]],
  ];
  const probes: V3[] = [
    [-1.4, 0, -3.8],
    [-0.5, 0, -3.5],
    [-2.2, 0, -4.6],
    [-1.0, 0, -3.0],
  ];

  it("produces the same, unmirrored scene frame for every order", () => {
    for (const [name, corners] of orders) {
      const cal = calibrate(input(corners, 2.0, 1.4));
      for (const p of probes) {
        const got = floorPoint(cal, camera.project(p))!;
        const want = camera.toScene(p, rectCentre);
        expect(Math.hypot(got.x - want[0], got.z - want[2]), name).toBeLessThan(1e-3);
      }
      expect(cal.camera.y, name).toBeCloseTo(1.7, 3);
    }
  });

  it("keeps photo-right as +x and nearer-the-camera as +z", () => {
    for (const [name, corners] of orders) {
      const cal = calibrate(input(corners, 2.0, 1.4));
      const centre = floorPoint(cal, { u: 0.5, v: 0.6 })!;
      const right = floorPoint(cal, { u: 0.7, v: 0.6 })!;
      const nearer = floorPoint(cal, { u: 0.5, v: 0.8 })!;
      expect(right.x, name).toBeGreaterThan(centre.x);
      expect(nearer.z, name).toBeGreaterThan(centre.z);
      expect(cal.camera.z, name).toBeGreaterThan(nearer.z);
    }
  });
});

describe("frontal rectangle", () => {
  const frontal = makeCamera({ fovDeg: 55, height: 1.6, pitchDownDeg: 30, yawDeg: 0 });
  const centre: V3 = [0.2, 0, -3.2];
  const corners = rectangle(centre, 2.0, 1.4, 0).map((c) => frontal.project(c));

  it("assumes the lens, warns, and still maps well when the assumption is right", () => {
    const result = calibrateFromRectangle({
      corners,
      widthM: 2.0,
      depthM: null,
      imageWidthPx: W,
      imageHeightPx: H,
      assumedVerticalFovDeg: 55,
    });
    if (!result.ok) throw new Error(result.message);
    const cal = result.calibration;
    expect(cal.fovBasis).toBe("assumed");
    expect(cal.verticalFovDeg).toBeCloseTo(55, 6);
    expect(cal.warnings.some((w) => /assumed/.test(w))).toBe(true);
    expect(Math.abs(cal.depthM - 1.4)).toBeLessThan(1e-3);
    expect(Math.abs(cal.camera.y - 1.6)).toBeLessThan(1e-3);
    for (const p of [centre, [1.0, 0, -2.6] as V3, [-0.9, 0, -4.4] as V3]) {
      const got = floorPoint(cal, frontal.project(p))!;
      const want = frontal.toScene(p, centre);
      expect(Math.hypot(got.x - want[0], got.z - want[2])).toBeLessThan(1e-3);
    }
  });

  it("uses the default 60° lens when none is given and only the width is known", () => {
    const result = calibrateFromRectangle({ corners, widthM: 2.0, depthM: null, imageWidthPx: W, imageHeightPx: H });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.calibration.fovBasis).toBe("assumed");
      expect(result.calibration.verticalFovDeg).toBeCloseTo(60, 6);
      expect(result.calibration.consistency).toBeNull();
    }
  });

  it("solves the lens from both given sides instead of assuming it", () => {
    const result = calibrateFromRectangle({ corners, widthM: 2.0, depthM: 1.4, imageWidthPx: W, imageHeightPx: H });
    if (!result.ok) throw new Error(result.message);
    const cal = result.calibration;
    expect(cal.fovBasis).toBe("from_sides");
    expect(cal.verticalFovDeg).toBeCloseTo(55, 4);
    expect(Math.abs(cal.camera.y - 1.6)).toBeLessThan(1e-3);
    expect(cal.consistency).toBeNull();
    expect(cal.warnings.some((w) => /two side lengths/.test(w))).toBe(true);
    expect(cal.warnings.some((w) => /assumed/.test(w))).toBe(false);
    for (const p of [centre, [1.0, 0, -2.6] as V3, [-0.9, 0, -4.4] as V3]) {
      const got = floorPoint(cal, frontal.project(p))!;
      const want = frontal.toScene(p, centre);
      expect(Math.hypot(got.x - want[0], got.z - want[2])).toBeLessThan(1e-3);
    }
  });
});

describe("inconsistent sides", () => {
  it("reports the disagreement and warns", () => {
    const cal = calibrate(input(worldRect, 2.0, 1.4 * 1.4));
    expect(cal.consistency).toBeCloseTo(1.4, 3);
    expect(cal.warnings.some((w) => /disagree/.test(w) && /40 %/.test(w))).toBe(true);
  });
});

describe("invalid rectangles", () => {
  const good = worldRect.map((c) => camera.project(c));
  const base = { widthM: 2.0, depthM: 1.4, imageWidthPx: W, imageHeightPx: H };
  const expectFailure = (corners: ImagePoint[], pattern: RegExp) => {
    const result = calibrateFromRectangle({ ...base, corners });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(pattern);
  };

  it("rejects self-intersecting corners", () => {
    expectFailure([good[0]!, good[2]!, good[1]!, good[3]!], /cross/);
  });

  it("rejects collinear corners", () => {
    const a = good[0]!;
    const b = good[1]!;
    const mid = { u: (a.u + b.u) / 2, v: (a.v + b.v) / 2 };
    expectFailure([a, mid, b, good[2]!], /straight line/);
  });

  it("rejects a tiny rectangle", () => {
    expectFailure(
      [
        { u: 0.5, v: 0.5 },
        { u: 0.505, v: 0.5 },
        { u: 0.505, v: 0.505 },
        { u: 0.5, v: 0.505 },
      ],
      /too small/,
    );
    expectFailure(
      [
        { u: 0.5, v: 0.5 },
        { u: 0.5005, v: 0.5 },
        { u: 0.6, v: 0.6 },
        { u: 0.4, v: 0.6 },
      ],
      /on top of each other/,
    );
  });

  it("rejects corners outside the photo and bad lengths", () => {
    expectFailure([{ u: -0.1, v: 0.5 }, good[1]!, good[2]!, good[3]!], /inside the photo/);
    expect(calibrateFromRectangle({ ...base, corners: good, widthM: 0 }).ok).toBe(false);
  });

  it("rejects a rectangle above the horizon", () => {
    const upward = makeCamera({ fovDeg: 55, height: 1.7, pitchDownDeg: -10, yawDeg: 15 });
    const ceiling = rectangle([-0.8, 0, -3], 2.0, 1.4, 5).map((c): V3 => [c[0], 3.0, c[2]]);
    const corners = ceiling.map((c) => upward.project(c));
    for (const c of corners) {
      expect(c.u > 0 && c.u < 1 && c.v > 0 && c.v < 1).toBe(true);
    }
    expectFailure(corners, /above the horizon/);
  });
});

describe("heightAt", () => {
  it("measures a vertical post within 1 %", () => {
    const cal = calibrate(input(worldRect, 2.0, 1.4));
    for (const base of [[-0.4, 0, -3.1] as V3, [-2.3, 0, -4.5] as V3]) {
      const top: V3 = [base[0], 1.2, base[2]];
      const h = heightAt(cal, camera.project(base), camera.project(top).v)!;
      expect(Math.abs(h - 1.2) / 1.2).toBeLessThan(0.01);
    }
  });

  it("returns null when the top is below the base", () => {
    const cal = calibrate(input(worldRect, 2.0, 1.4));
    const base = camera.project([-1, 0, -3.5]);
    expect(heightAt(cal, base, base.v + 0.05)).toBeNull();
  });
});

describe("placeObject", () => {
  const cal = calibrate(input(worldRect, 2.0, 1.4));
  const C = camera.position;
  const size = { w: 1.6, h: 0.9, d: 0.7 };

  /** World corners of a box from its front-bottom-centre, front normal and size. */
  function boxCorners(front: V3, normal: V3, w: number, h: number, d: number): V3[] {
    const along: V3 = [normal[2], 0, -normal[0]];
    const out: V3[] = [];
    for (const s of [-w / 2, w / 2]) {
      for (const q of [0, d]) {
        for (const y of [0, h]) {
          out.push([front[0] + s * along[0] - q * normal[0], y, front[2] + s * along[2] - q * normal[2]]);
        }
      }
    }
    return out;
  }

  function imageBox(points: V3[]) {
    const img = points.map((p) => camera.project(p));
    return {
      left: Math.min(...img.map((p) => p.u)),
      right: Math.max(...img.map((p) => p.u)),
      top: Math.min(...img.map((p) => p.v)),
      bottom: Math.max(...img.map((p) => p.v)),
    };
  }

  it("sizes, places and squares a box facing the camera to the floor rectangle", () => {
    const front: V3 = [-0.4, 0, -3.3];
    // Facing the camera's side of the scene (scene +Z), not the camera itself.
    const normal: V3 = [Math.sin(rad(camera.yawDeg)), 0, Math.cos(rad(camera.yawDeg))];
    const centre: V3 = [front[0] - (size.d / 2) * normal[0], 0, front[2] - (size.d / 2) * normal[2]];
    const placement = placeObject(cal, {
      box: imageBox(boxCorners(front, normal, size.w, size.h, size.d)),
      contact: camera.project(front),
      facing: "toward_camera",
      sizeGuessM: { x: 1.6 * 1.2, y: 0.9 * 1.2, z: 0.7 * 1.2 },
    })!;
    expect(placement).not.toBeNull();
    expect(placement.visibleExtent).toBe("width");
    expect(Math.abs(placement.widthM - size.w) / size.w).toBeLessThan(0.03);
    expect(Math.abs(placement.heightM - size.h) / size.h).toBeLessThan(0.03);
    const want = camera.toScene(centre, rectCentre);
    expect(Math.hypot(placement.x - want[0], placement.z - want[2])).toBeLessThan(0.03);
    expect(placement.yawRad).toBeCloseTo(0, 9);
    expect(placement.notes.some((note) => /hidden depth/i.test(note))).toBe(true);
  });

  it("measures the depth of a box facing left", () => {
    // Front faces scene -X; the face towards the camera (scene +Z) shows the object's depth.
    const sceneMinusX: V3 = [-Math.cos(rad(camera.yawDeg)), 0, Math.sin(rad(camera.yawDeg))];
    const sceneZ: V3 = [Math.sin(rad(camera.yawDeg)), 0, Math.cos(rad(camera.yawDeg))];
    const centre: V3 = [-0.9, 0, -3.6];
    const corners: V3[] = [];
    for (const s of [-size.d / 2, size.d / 2]) {
      for (const q of [-size.w / 2, size.w / 2]) {
        for (const y of [0, size.h]) {
          corners.push([centre[0] + s * sceneMinusX[0] + q * sceneZ[0], y, centre[2] + s * sceneMinusX[2] + q * sceneZ[2]]);
        }
      }
    }
    const contact: V3 = [centre[0] + (size.w / 2) * sceneZ[0], 0, centre[2] + (size.w / 2) * sceneZ[2]];
    const placement = placeObject(cal, {
      box: imageBox(corners),
      contact: camera.project(contact),
      facing: "left",
      sizeGuessM: { x: 1.6, y: 0.9, z: 0.7 },
    })!;
    expect(placement.visibleExtent).toBe("depth");
    expect(placement.yawRad).toBeCloseTo(-Math.PI / 2, 9);
    expect(Math.abs(placement.depthM - size.d) / size.d).toBeLessThan(0.03);
    expect(Math.abs(placement.widthM - size.w) / size.w).toBeLessThan(0.03);
    expect(Math.abs(placement.heightM - size.h) / size.h).toBeLessThan(0.03);
    const want = camera.toScene(centre, rectCentre);
    expect(Math.hypot(placement.x - want[0], placement.z - want[2])).toBeLessThan(0.03);
    expect(placement.notes.some((note) => /hidden width/i.test(note))).toBe(true);
  });

  it("lets the outline overrule a facing that contradicts it", () => {
    // A long table seen side-on, which a vision model reported as "facing right".
    const front: V3 = [-0.4, 0, -3.3];
    const toCam = [C[0] - front[0], C[2] - front[2]];
    const len = Math.hypot(toCam[0]!, toCam[1]!);
    const normal: V3 = [toCam[0]! / len, 0, toCam[1]! / len];
    const placement = placeObject(cal, {
      box: imageBox(boxCorners(front, normal, size.w, size.h, size.d)),
      contact: camera.project(front),
      facing: "right",
      sizeGuessM: { x: 1.6, y: 0.9, z: 0.7 },
    })!;
    expect(placement.visibleExtent).toBe("width");
    expect(Math.abs(placement.widthM - size.w) / size.w).toBeLessThan(0.03);
    expect(Math.abs(placement.depthM - size.d) / size.d).toBeLessThan(0.03);
    expect(placement.notes.some((note) => /longer side faces the camera/.test(note))).toBe(true);
  });

  it("flags a front point near the horizon", () => {
    const far: V3 = [-6, 0, -25];
    const img = camera.project(far);
    const placement = placeObject(cal, {
      box: { left: img.u - 0.02, right: img.u + 0.02, top: img.v - 0.03, bottom: img.v },
      contact: img,
      facing: "unknown",
      sizeGuessM: { x: 1, y: 1, z: 1 },
    });
    expect(placement).not.toBeNull();
    expect(placement!.notes.some((note) => /horizon/.test(note))).toBe(true);
    expect(placement!.notes.some((note) => /assumed to face the camera/.test(note))).toBe(true);
  });

  it("returns null for a contact above the horizon", () => {
    expect(
      placeObject(cal, {
        box: { left: 0.4, right: 0.6, top: 0.0, bottom: 0.05 },
        contact: { u: 0.5, v: 0.04 },
        facing: "toward_camera",
        sizeGuessM: { x: 1, y: 1, z: 1 },
      }),
    ).toBeNull();
  });
});
