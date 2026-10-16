import type { ImageBox, ImageProposal, ProposedPhotoObject } from "@replay-world/contracts";
import { describe, expect, it } from "vitest";
import {
  type Annotation,
  calibrate,
  distribution,
  geometryOf,
  type GtObject,
  initialWorld,
  klmSeconds,
  manualWorld,
  matchProposals,
  NO_ACTIONS,
  rectFrame,
  reviewedWorld,
} from "./evaluation";

// A pinhole camera written independently of the app (the convention of three.js's camera:
// looking from position to target, y up, vertical field of view), for known answers.
const CAM = { position: [0.4, 1.6, 6.5] as const, target: [0, 0.8, 0] as const, vfov: 60, w: 1280, h: 960 };
function project([x, y, z]: readonly [number, number, number]): { u: number; v: number } {
  const [px, py, pz] = CAM.position;
  const f = [CAM.target[0] - px, CAM.target[1] - py, CAM.target[2] - pz];
  const n = Math.hypot(...f);
  const fwd = f.map((v) => v / n);
  const right = [-fwd[2]!, 0, fwd[0]!];
  const rn = Math.hypot(...right);
  const r = right.map((v) => v / rn);
  const up = [r[1]! * fwd[2]! - r[2]! * fwd[1]!, r[2]! * fwd[0]! - r[0]! * fwd[2]!, r[0]! * fwd[1]! - r[1]! * fwd[0]!];
  const d = [x - px, y - py, z - pz];
  const dot = (a: readonly number[]) => a[0]! * d[0]! + a[1]! * d[1]! + a[2]! * d[2]!;
  const t = Math.tan((CAM.vfov * Math.PI) / 360);
  return { u: 0.5 + dot(r) / dot(fwd) / (2 * t * (CAM.w / CAM.h)), v: 0.5 - dot(up) / dot(fwd) / (2 * t) };
}
// The floor mat, the calibration rectangle: 3 m x 2 m centred at z = 2.5, square to the room.
const MAT_Z = 2.5;
const corners = [
  [-1.5, -1],
  [1.5, -1],
  [1.5, 1],
  [-1.5, 1],
].map(([x, z]) => project([x!, 0, MAT_Z + z!]));

/** A box-shaped object square to the room, its outline its projected 3D box. */
function gt(id: string, cls: GtObject["class"], [x, z]: [number, number], [w, h, d]: [number, number, number], extra: Partial<GtObject> = {}): GtObject {
  const pts = [-1, 1].flatMap((sx) => [-1, 1].flatMap((sz) => [0, h].map((y) => project([x + (sx * w) / 2, y, z + (sz * d) / 2]))));
  const box = { left: Math.min(...pts.map((p) => p.u)), right: Math.max(...pts.map((p) => p.u)), top: Math.min(...pts.map((p) => p.v)), bottom: Math.max(...pts.map((p) => p.v)) };
  return {
    id,
    class: cls,
    centre_m: [x, z - MAT_Z],
    yaw_deg: 0,
    size: { width_m: w, depth_m: d, height_m: h },
    tolerance_m: 0,
    visibility: "visible",
    visible_fraction: 1,
    visible_box: box,
    amodal_box: box,
    cut_off: [],
    on_floor: true,
    counted: true,
    reason: null,
    ...extra,
  };
}

function annotation(objects: GtObject[]): Annotation {
  return {
    format: "rws-img03-annotation/1",
    image: { file: "t.jpg", sha256: "0".repeat(64), width_px: CAM.w, height_px: CAM.h, stratum: "synthetic", scene_type: "office", split: "development" },
    camera: { position_m: [...CAM.position], target_m: [...CAM.target], vertical_fov_deg: CAM.vfov },
    rectangle: { corners, width_m: 3, depth_m: 2, tolerance_m: 0 },
    objects,
  };
}

/** What the model would say: the outline, its floor point at the outline's bottom, a typical size. */
function proposed(id: string, label: string, template: ProposedPhotoObject["template"], box: ImageBox, size: [number, number, number], accept = true): ProposedPhotoObject {
  return {
    id,
    label,
    category: template,
    template,
    material: "paint_light_grey",
    box,
    floor_contact: { u: (box.left + box.right) / 2, v: box.bottom },
    contact_basis: "box_bottom",
    on_floor: true,
    visibility: "full",
    cut_off: [],
    facing: "toward_camera",
    size_guess_m: { x: size[0], y: size[1], z: size[2] },
    suggest_accept: accept,
    notes: [],
  } as ProposedPhotoObject;
}
const proposal = (objects: ProposedPhotoObject[]): ImageProposal => ({ objects, floor_rectangles: [], visible_text: [] }) as unknown as ImageProposal;
const union = (a: ImageBox, b: ImageBox): ImageBox => ({ left: Math.min(a.left, b.left), top: Math.min(a.top, b.top), right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom) });

describe("IMG-03 scoring, on known answers", () => {
  it("measures in metres in the rectangle's frame: an exact outline gives a small error", () => {
    const a = annotation([gt("crate", "box", [0.6, -1.0], [1.0, 0.8, 0.6])]);
    const cal = calibrate(a);
    const frame = rectFrame(cal, a.rectangle.corners);
    // The camera, found from the rectangle alone, is where the camera is.
    expect(frame.camera.y).toBeCloseTo(1.6, 2);
    expect(frame.camera.x).toBeCloseTo(0.4, 2);
    expect(frame.camera.z).toBeCloseTo(6.5 - MAT_Z, 2);
    const box = a.objects[0]!.visible_box!;
    const world = initialWorld(cal, proposal([proposed("obs-1", "crate", "box", box, [1.0, 0.8, 0.6])]), a.objects);
    const [row] = geometryOf(world, a.objects, frame);
    expect(row!.centreErrorM).toBeLessThan(0.08);
    expect(Math.abs(row!.acrossErrorM)).toBeLessThan(0.05);
    expect(row!.nearHorizon).toBe(false);
    expect(row!.estimatesLabelled).toBe(true);
  });

  it("matches two similar cabinets one to one; a box around both finds one; a second outline is a duplicate", () => {
    const objects = [gt("cab-a", "cabinet", [-0.45, -2], [0.8, 2.0, 0.5]), gt("cab-b", "cabinet", [0.45, -2], [0.8, 2.0, 0.5])];
    const [a, b] = objects.map((o) => o.visible_box!);
    expect(matchProposals([a!, b!], objects)).toMatchObject({ tp: 2, fp: 0, fn: 0, groups: 0 });
    const both = matchProposals([union(a!, b!)], objects);
    expect(both).toMatchObject({ tp: 1, fp: 0, fn: 1, groups: 1 });
    const shifted = { ...a!, left: a!.left + 0.004, right: a!.right + 0.004 };
    expect(matchProposals([a!, shifted], objects)).toMatchObject({ tp: 1, fp: 1, fn: 1, duplicates: 1 });
  });

  it("counts a table outlined with its chairs as one find, and the reviewer splits it into all three", () => {
    const objects = [gt("table", "table", [0, -1.5], [1.4, 0.75, 0.8]), gt("chair-l", "chair", [-0.4, -0.85], [0.5, 0.9, 0.5]), gt("chair-r", "chair", [0.4, -0.85], [0.5, 0.9, 0.5])];
    const group = objects.map((o) => o.visible_box!).reduce(union);
    const a = annotation(objects);
    const p = proposal([proposed("obs-1", "table with chairs", "table", group, [1.4, 0.75, 0.8])]);
    const m = matchProposals([group], objects);
    expect(m).toMatchObject({ tp: 1, fn: 2, groups: 1 });
    // It overlaps the table enough to find it; it also covers both chairs, so it is a group.
    expect(m.proposals[0]).toMatchObject({ status: "tp", gt: "table", covers: ["table", "chair-l", "chair-r"] });
    const cal = calibrate(a);
    const reviewed = reviewedWorld(cal, p, objects);
    expect(reviewed.actions.split).toBe(1);
    expect(new Set([...reviewed.gtOf.values()].filter(Boolean))).toEqual(new Set(["table", "chair-l", "chair-r"]));
    expect(geometryOf(reviewed, objects, rectFrame(cal, a.rectangle.corners))).toHaveLength(3);
  });

  it("keeps every later proposal on its own object after a split earlier in the list", () => {
    // Regression: a split inserts pieces, which once shifted later proposals onto the wrong objects.
    const objects = [
      gt("table", "table", [0, -1.5], [1.4, 0.75, 0.8]),
      gt("chair-l", "chair", [-0.4, -0.85], [0.5, 0.9, 0.5]),
      gt("chair-r", "chair", [0.4, -0.85], [0.5, 0.9, 0.5]),
      gt("shelf", "shelf", [2.2, -3], [1.2, 1.8, 0.4]),
      gt("plant", "plant", [-2.2, -2.5], [0.5, 1.2, 0.5]),
    ];
    const group = objects.slice(0, 3).map((o) => o.visible_box!).reduce(union);
    const p = proposal([
      proposed("obs-1", "table with chairs", "table", group, [1.4, 0.75, 0.8]),
      proposed("obs-2", "shelf", "shelf", objects[3]!.visible_box!, [1.2, 1.8, 0.4]),
      proposed("obs-3", "plant", "plant", objects[4]!.visible_box!, [0.5, 1.2, 0.5]),
    ]);
    const reviewed = reviewedWorld(calibrate(annotation(objects)), p, objects);
    expect(reviewed.gtOf.get("obs-2")).toBe("shelf");
    expect(reviewed.gtOf.get("obs-3")).toBe("plant");
    expect(reviewed.placed.map((x) => reviewed.gtOf.get(x.item.id)).sort()).toEqual(["chair-l", "chair-r", "plant", "shelf", "table"]);
  });

  it("scores a partly hidden object on what shows: its visible width comes out short", () => {
    const whole = gt("cabinet", "cabinet", [0.2, -3], [1.2, 1.8, 0.5]);
    const b = whole.visible_box!;
    const hidden = { ...whole, visibility: "partly_visible" as const, visible_fraction: 0.5, visible_box: { ...b, left: (b.left + b.right) / 2 } };
    const a = annotation([hidden]);
    const cal = calibrate(a);
    const world = initialWorld(cal, proposal([proposed("obs-1", "cabinet", "cabinet", hidden.visible_box, [0.9, 1.8, 0.5])]), a.objects);
    expect(matchProposals([hidden.visible_box], a.objects).tp).toBe(1);
    const [row] = geometryOf(world, a.objects, rectFrame(cal, a.rectangle.corners));
    expect(row!.visibility).toBe("partly_visible");
    expect(row!.acrossErrorM).toBeLessThan(-0.4);
  });

  it("puts a far object near the horizon in its own stratum: a floor point 4 px off moves it metres, and the app says so", () => {
    const far = gt("pallet-far", "pallet", [0.5, -14], [1.2, 1.0, 0.8]);
    const a = annotation([far]);
    const cal = calibrate(a);
    const b = far.visible_box!;
    const off = { ...b, bottom: b.bottom - 4 / CAM.h };
    const world = initialWorld(cal, proposal([proposed("obs-1", "pallet", "pallet", off, [1.2, 1.0, 0.8])]), a.objects);
    const [row] = geometryOf(world, a.objects, rectFrame(cal, a.rectangle.corners));
    expect(row!.depressionDeg).toBeLessThan(6);
    expect(row!.nearHorizon).toBe(true);
    expect(row!.flagged).toBe(true);
    expect(row!.centreErrorM).toBeGreaterThan(1);
  });

  it("builds the manual baseline from outlines alone, and estimates effort from a declared model", () => {
    const objects = [gt("crate", "box", [0.6, -1.0], [1.0, 0.8, 0.6]), gt("cab", "cabinet", [-1, -2], [0.8, 2, 0.5], { visibility: "partly_visible" })];
    const cal = calibrate(annotation(objects));
    const world = manualWorld(cal, objects);
    expect(world.placed).toHaveLength(2);
    expect(world.actions).toEqual({ ...NO_ACTIONS, add: 2, shape: 2, visibility: 1 });
    expect(klmSeconds(world.actions)).toBe(2 * 8 + 2 * 3 + 3);
    expect(distribution([3, 1, 2])).toEqual({ n: 3, median: 2, p90: 2.8, max: 3 });
  });
});
