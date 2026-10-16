import { describe, expect, it } from "vitest";
import { looksLikeGroup, mergeItems, pieceLabels, splitItem, suggestions, templateFor, unmergeItem, unsplitItem } from "./corrections";
import type { ReviewItem } from "./world";

function item(id: string, label: string, box: [number, number, number, number], extra: Partial<ReviewItem> = {}): ReviewItem {
  const [left, top, right, bottom] = box;
  return {
    id,
    label,
    template: "table",
    material: "wood_light",
    box: { left, top, right, bottom },
    contact: { u: (left + right) / 2, v: bottom },
    contactBasis: "box_bottom",
    facing: "toward_camera",
    sizeGuess: { x: 1, y: 1, z: 1 },
    foundBy: "model",
    decision: "accepted",
    onFloor: true,
    notes: [],
    entered: {},
    visibility: "visible",
    derivedFrom: null,
    replacedBy: null,
    corrections: [],
    ...extra,
  } as ReviewItem;
}

describe("corrections to the photo's objects (IMG-02)", () => {
  it("names the pieces of a group outline", () => {
    expect(pieceLabels("rectangular table with chairs", 3)).toEqual(["rectangular table", "chair", "chair"]);
    expect(pieceLabels("desks and benches", 2)).toEqual(["desk", "bench"]);
    expect(pieceLabels("shelving", 2)).toEqual(["shelving 1", "shelving 2"]);
    expect(templateFor("chair", "table")).toBe("chair");
    expect(templateFor("thing", "box")).toBe("box");
  });

  it("splits one outline into pieces that name it, keeping the original as split", () => {
    const items = [item("obs-1", "rectangular table with chairs", [0.1, 0.6, 0.5, 0.9]), item("obs-2", "lamp", [0.7, 0.1, 0.8, 0.3])];
    const { items: after, pieces } = splitItem(items, "obs-1", 3);
    expect(pieces).toEqual(["obs-1-a", "obs-1-b", "obs-1-c"]);
    expect(after.map((i) => [i.id, i.decision])).toEqual([
      ["obs-1", "split"],
      ["obs-1-a", "accepted"],
      ["obs-1-b", "accepted"],
      ["obs-1-c", "accepted"],
      ["obs-2", "accepted"],
    ]);
    const [, table, chair] = after;
    expect([table!.label, table!.template, chair!.label, chair!.template]).toEqual(["rectangular table", "table", "chair", "chair"]);
    expect(chair!.derivedFrom).toBe("obs-1");
    expect(chair!.box.left).toBeCloseTo(0.1 + 0.4 / 3, 9);
    expect(chair!.contact).toEqual({ u: (chair!.box.left + chair!.box.right) / 2, v: 0.9 });
    expect(chair!.corrections[0]).toContain("Split by you from “rectangular table with chairs” (obs-1)");
    expect(after[0]!.corrections[0]).toContain("Split by you into “rectangular table” (obs-1-a)");
    // Undone: the pieces go, and the original outline is used again.
    expect(unsplitItem(after, "obs-1")).toEqual(items);
  });

  it("merges an outline drawn twice into one, keeping the other as merged, and can undo it", () => {
    const items = [item("obs-1", "chair", [0.1, 0.5, 0.3, 0.9]), item("obs-2", "chair", [0.12, 0.52, 0.32, 0.92])];
    const after = mergeItems(items, "obs-1", "obs-2");
    expect(after[0]!.box).toEqual(items[0]!.box); // the kept outline stays as it is
    expect(after[1]).toMatchObject({ decision: "merged", replacedBy: "obs-1" });
    expect(after[1]!.corrections).toEqual(["Merged by you into “chair” (obs-1)."]);
    const back = unmergeItem(after, "obs-2");
    expect(back.map((i) => [i.decision, i.box, i.corrections])).toEqual(items.map((i) => [i.decision, i.box, i.corrections]));
  });

  it("suggests splitting a group outline and merging an outline drawn twice", () => {
    const items = [
      item("obs-1", "oval table with chairs", [0.5, 0.5, 0.9, 0.9]),
      item("obs-2", "plastic chair", [0.1, 0.5, 0.2, 0.9]),
      item("obs-3", "chair", [0.11, 0.51, 0.21, 0.91]),
      item("obs-4", "chair", [0.6, 0.1, 0.7, 0.3], { decision: "rejected" }),
    ];
    // The tighter outline is the one to keep.
    expect(suggestions(items).map((s) => [s.kind, s.ids])).toEqual([
      ["split", ["obs-1"]],
      ["merge", ["obs-2", "obs-3"]],
    ]);
    const loose = [item("p", "chair", [0.1, 0.4, 0.4, 0.9]), item("c", "plastic chair", [0.15, 0.5, 0.35, 0.9])];
    expect(suggestions(loose)[0]!.ids).toEqual(["c", "p"]);
    // What is on or around one object is not a group, and a chair inside a group outline is not
    // a duplicate of it.
    for (const label of ["left machine with yellow safety cage", "teacher's desk with computers", "storage cabinet with colorful bins"]) {
      expect(looksLikeGroup(item("x", label, [0, 0, 1, 1]))).toBe(false);
    }
    expect(suggestions([item("t", "table with chairs", [0, 0, 1, 1]), item("c", "plastic chair", [0.1, 0.1, 0.3, 0.5])]).map((s) => s.kind)).toEqual(["split"]);
  });
});
