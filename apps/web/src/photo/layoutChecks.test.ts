import { describe, expect, it } from "vitest";
import { footprint, footprintClashes, outlineIoU, photoOverlaps } from "./layoutChecks";
import type { PlacedItem, ReviewItem } from "./world";

function placed(id: string, label: string, box: [number, number, number, number], at: Partial<PlacedItem> = {}): PlacedItem {
  const [left, top, right, bottom] = box;
  const item = { id, label, box: { left, top, right, bottom }, contact: { u: (left + right) / 2, v: bottom } } as ReviewItem;
  return {
    item,
    x: 0,
    z: 0,
    yawRad: 0,
    width: 1,
    height: 1,
    depth: 1,
    source: { width: "photo", height: "photo", depth: "hidden", yaw: "photo", position: "photo" },
    fromPhoto: { x: 0, z: 0 },
    photoPlaced: true,
    notes: [],
    ...at,
  };
}

describe("overlaps in the photo and in 3D (IMG-02)", () => {
  it("lists outlines that overlap in the photo with the nearer object in front, and says it is not a 3D problem", () => {
    const table = placed("t", "table", [0.3, 0.5, 0.7, 0.8]);
    const chair = placed("c", "chair", [0.6, 0.45, 0.75, 0.7], { x: 2 });
    const [overlap] = photoOverlaps([table, chair]);
    expect(overlap).toMatchObject({ front: "t", behind: "c" });
    expect(overlap!.text).toContain("“chair” is partly behind “table”");
    expect(overlap!.text).toContain("not a problem in 3D");
    // Apart in the picture: nothing listed.
    expect(photoOverlaps([table, placed("l", "lamp", [0.05, 0.1, 0.15, 0.3])])).toEqual([]);
  });

  it("finds footprints that would stand in the same place, with the area, depth and the likely cause", () => {
    const machine = placed("m", "machine", [0, 0, 0.5, 0.5], { width: 2, depth: 1.6 });
    const cabinet = placed("k", "cabinet", [0.5, 0, 0.7, 0.5], { x: 1.2, z: -0.2, width: 0.8, depth: 0.6 });
    const [clash] = footprintClashes([machine, cabinet]);
    // machine spans x -1..1; cabinet spans x 0.8..1.6, z -0.5..0.1: 0.2 m x 0.6 m shared.
    expect(clash!.areaM2).toBeCloseTo(0.12, 6);
    expect(clash!.depthM).toBeCloseTo(0.2, 6);
    expect(clash!.text).toContain("overlap by 0.12 m² (20 cm deep). If they cannot share that floor space");
    expect(clash!.text).toContain("“machine” and “cabinet” have a hidden side whose size is a guess");
    // Moved clear (or only touching), there is nothing to say.
    expect(footprintClashes([machine, { ...cabinet, x: 1.4 }])).toEqual([]);
    expect(footprintClashes([machine, { ...cabinet, x: 1.39 }])).toEqual([]);
  });

  it("says a chair tucked under a table is probably fine, and numbers objects as the review does", () => {
    const table = placed("t", "table", [0, 0, 1, 1], { width: 1.6, depth: 0.8 });
    table.item.template = "table";
    const chair = placed("c", "chair", [0, 0, 1, 1], { z: 0.5, width: 0.45, depth: 0.45 });
    chair.item.template = "chair";
    const [clash] = footprintClashes([table, chair], (p) => `#${p.item.id === "t" ? 1 : 2} “${p.item.label}”`);
    expect(clash!.tucked).toBe(true);
    expect(clash!.text).toContain("#1 “table” and #2 “chair” overlap by");
    expect(clash!.text).toContain("probably a seat tucked under the table");
  });

  it("turns footprints with the object (a turned table clears a chair it would hit square on)", () => {
    const corners = footprint({ x: 0, z: 0, yawRad: Math.PI / 2, width: 2, depth: 1 });
    expect(corners.map(([x, z]) => [+x.toFixed(6), +z.toFixed(6)])).toEqual([
      [-0.5, 1],
      [-0.5, -1],
      [0.5, -1],
      [0.5, 1],
    ]);
    const table = placed("t", "table", [0, 0, 1, 1], { width: 2, depth: 1 });
    const chair = placed("c", "chair", [0, 0, 1, 1], { x: 0.9, width: 0.4, depth: 0.4 });
    expect(footprintClashes([table, chair])).toHaveLength(1);
    expect(footprintClashes([{ ...table, yawRad: Math.PI / 2 }, chair])).toEqual([]);
  });

  it("measures how much two outlines are the same object (duplicates)", () => {
    expect(outlineIoU({ left: 0, top: 0, right: 1, bottom: 1 }, { left: 0, top: 0, right: 1, bottom: 1 })).toBe(1);
    expect(outlineIoU({ left: 0, top: 0, right: 0.5, bottom: 1 }, { left: 0.5, top: 0, right: 1, bottom: 1 })).toBe(0);
  });
});
