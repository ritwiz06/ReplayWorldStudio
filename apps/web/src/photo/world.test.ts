import { readFileSync } from "node:fs";
import { type CatalogAsset, type Project, validateProject } from "@replay-world/contracts";
import { describe, expect, it } from "vitest";
import { calibrateFromRectangle } from "./floor";
import { assetRequest, buildPhotoProject, isPlaced, type PlacedItem, placeItems, type ReviewItem, type ScaleInput } from "./world";

// The repository's industrial demo rendered from its walk view (fixtures/photos/factory-walk.png,
// 1328 x 1000, camera at x 0, height 1.6, z 6, 70 deg). The scale reference is the walkway between
// the floor grid lines x = -3 and x = +3 (6 m wide, the walkway 1.8 m deep); its corners are the
// exact projections of those floor points. The boxes are the vision model's recorded answer
// (fixtures/assist/recorded/image-factory-walk.json).
const scale: ScaleInput & { widthM: number } = {
  corners: [
    { u: 0.2073, v: 0.6507 },
    { u: 0.7927, v: 0.6507 },
    { u: 0.934, v: 0.7511 },
    { u: 0.066, v: 0.7511 },
  ],
  feature: "walkway between floor grid lines 6 m apart",
  widthM: 6,
  depthM: 1.8,
  sizeBasis: "measured",
};

function item(id: string, label: string, template: ReviewItem["template"], box: ReviewItem["box"], facing: ReviewItem["facing"], size: [number, number, number]): ReviewItem {
  return {
    id,
    label,
    template,
    material: "plastic_grey",
    box,
    contact: { u: (box.left + box.right) / 2, v: box.bottom },
    contactBasis: "box_bottom",
    facing,
    sizeGuess: { x: size[0], y: size[1], z: size[2] },
    foundBy: "model",
    decision: "accepted",
    onFloor: true,
    notes: [],
    entered: {},
  };
}

const items: ReviewItem[] = [
  item("obs-1", "left machine with yellow safety cage", "machine", { left: 0.0, top: 0.375, right: 0.218, bottom: 0.615 }, "toward_camera", [2.0, 1.5, 0.8]),
  item("obs-2", "center machine with yellow safety cage", "machine", { left: 0.398, top: 0.365, right: 0.575, bottom: 0.615 }, "toward_camera", [1.8, 1.5, 0.8]),
  item("obs-3", "left conveyor belt", "conveyor", { left: 0.185, top: 0.5, right: 0.4, bottom: 0.605 }, "left", [2.0, 0.5, 0.5]),
  item("obs-4", "right conveyor belt", "conveyor", { left: 0.575, top: 0.5, right: 0.795, bottom: 0.605 }, "right", [2.0, 0.5, 0.5]),
  item("obs-5", "stacked cardboard boxes on pallet", "box", { left: 0.845, top: 0.495, right: 0.995, bottom: 0.61 }, "toward_camera", [1.2, 1.0, 0.8]),
  { ...item("obs-6", "monitor on left machine", "screen", { left: 0.085, top: 0.435, right: 0.14, bottom: 0.495 }, "toward_camera", [0.3, 0.2, 0.2]), decision: "rejected", contact: null, contactBasis: null, onFloor: false },
];

// Ground truth from fixtures/scenes/industrial-demo.json, in the scene frame (origin at the
// rectangle's centre, demo z 1.5): centre x, centre z, width, height.
const truth: Record<string, [number, number, number, number]> = {
  "obs-1": [-5.195, -2.7, 2.01, 2.47],
  "obs-2": [-0.185, -2.7, 2.01, 2.47],
  "obs-3": [-2.69, -2.7, 3.0, 0.95],
  "obs-4": [2.32, -2.7, 3.0, 0.95],
  "obs-5": [5.6, -2.7, 1.202, 1.022],
};

function calibrate() {
  const result = calibrateFromRectangle({ corners: scale.corners, widthM: scale.widthM, depthM: scale.depthM, imageWidthPx: 1328, imageHeightPx: 1000 });
  if (!result.ok) throw new Error(result.message);
  return result.calibration;
}

describe("photo world", () => {
  it("recovers the render's camera and places every object near its true position", () => {
    const cal = calibrate();
    expect(cal.fovBasis).toBe("from_sides");
    expect(cal.verticalFovDeg).toBeCloseTo(70, 0);
    expect(Math.hypot(cal.camera.x, cal.camera.y - 1.6, cal.camera.z - 4.5)).toBeLessThan(0.02);
    const placed = placeItems(cal, items);
    expect(placed.has("obs-6")).toBe(false); // rejected: never placed
    for (const [id, [x, z, width, height]] of Object.entries(truth)) {
      const p = placed.get(id);
      if (!isPlaced(p)) throw new Error(`${id} was not placed`);
      // The hidden depth is a guess, so the centre may sit up to ~0.3 m off in z.
      expect(Math.abs(p.x - x), `${id} x`).toBeLessThan(0.3);
      expect(Math.abs(p.z - z), `${id} z`).toBeLessThan(0.35);
      expect(Math.abs(p.width - width) / width, `${id} width`).toBeLessThan(0.15);
      expect(Math.abs(p.height - height) / height, `${id} height`).toBeLessThan(0.15);
      expect(p.yawRad, `${id} square to the rectangle`).toBeCloseTo(0, 6);
    }
  });

  it("keeps typed values as user evidence and the rest as photo evidence", () => {
    const cal = calibrate();
    const typed = items.map((i) => (i.id === "obs-5" ? { ...i, entered: { width: 1.2, depth: 0.8 } } : i));
    const placed = placeItems(cal, typed).get("obs-5") as PlacedItem;
    expect([placed.width, placed.depth]).toEqual([1.2, 0.8]);
    const request = assetRequest(placed, { filename: "factory-walk.png", feature: scale.feature, visionModel: null });
    expect(request.method).toBe("photo");
    expect(request.dimensions.width).toEqual({ basis: "entered", quote: null, confirmed: true, source_ref: null });
    expect(request.dimensions.height.basis).toBe("photo");
    expect(request.dimensions.height.confirmed).toBe(false);
    expect(request.dimensions.height.source_ref).toContain("factory-walk.png (obs-5)");
  });

  it("builds a project the contract accepts, linking each accepted observation to its object", () => {
    const cal = calibrate();
    const placed = placeItems(cal, items);
    const sample = (JSON.parse(readFileSync(new URL("../../../../fixtures/scenes/foundation-scene.json", import.meta.url), "utf8")) as Project).catalog[0]!;
    const assets = new Map<string, CatalogAsset>();
    for (const [id, p] of placed) if (isPlaced(p)) assets.set(id, { ...sample, id: `asset-${id}`, name: p.item.label });
    const sha = "a".repeat(64);
    const project = buildPhotoProject({
      stored: { filename: "factory-walk.png", sha256: sha, image: { uri: `photos/${sha}.png`, media_type: "image/png", width_px: 1328, height_px: 1000, bytes: 1000 } },
      scale,
      calibration: cal,
      items,
      placed,
      assets,
      visionModel: { service: "ASU Voyager", base_url: "https://openai.rc.asu.edu/v1", model: "qwen3-vl-32b-instruct" },
      visibleText: [],
    });
    const result = validateProject(project);
    expect(result.ok ? [] : result.issues).toEqual([]);
    const source = project.sources[0]!;
    expect([source.kind, source.source_to_world, source.image?.uri]).toEqual(["photo", null, `photos/${sha}.png`]);
    const observations = source.photo_import!.observations;
    const ids = new Set(project.scene.objects.map((o) => o.id));
    expect(observations.filter((o) => o.decision === "accepted").every((o) => o.object_id !== null && ids.has(o.object_id))).toBe(true);
    expect(observations.find((o) => o.id === "obs-6")).toMatchObject({ decision: "rejected", object_id: null });
    expect(project.scene.objects.filter((o) => o.kind === "equipment")).toHaveLength(5);
    const reference = project.scene.objects.find((o) => o.id === "obj-scale-reference")!;
    expect([reference.dimensions.width.origin, reference.dimensions.depth.origin]).toEqual(["user_supplied", "user_supplied"]);
    expect(source.photo_import!.calibration.camera.fov_basis).toBe("from_sides");
    expect(source.photo_import!.calibration.reference.size_basis).toBe("measured");
    expect(reference.dimensions.width).toMatchObject({ review_status: "confirmed", source_ref: expect.stringContaining("Measured by the user") });
  });

  it("records an assumed scale as an assumption, never as a measurement", () => {
    const cal = calibrate();
    const placed = placeItems(cal, items);
    const sha = "b".repeat(64);
    const assumed = { ...scale, depthM: null, sizeBasis: "assumed" as const };
    const project = buildPhotoProject({
      stored: { filename: "classroom.jpg", sha256: sha, image: { uri: `photos/${sha}.jpg`, media_type: "image/jpeg", width_px: 1024, height_px: 684, bytes: 1000 } },
      scale: assumed,
      calibration: cal,
      items: [],
      placed,
      assets: new Map(),
      visionModel: null,
      visibleText: [],
    });
    const reference = project.sources[0]!.photo_import!.calibration.reference;
    expect(reference.size_basis).toBe("assumed");
    expect(reference.width).toMatchObject({ origin: "user_supplied", review_status: "unreviewed" });
    expect(reference.width.source_ref).toMatch(/^Assumed by the user: .*not measured$/);
    expect(JSON.stringify(project)).not.toContain("Measured by the user");
  });
});
