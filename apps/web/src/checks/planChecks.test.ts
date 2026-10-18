// IMP-03 with GEO-01/02: a plan picture's outlines are evidence only as far as they were traced.
// The hall of fixtures/plans/packing-hall.pdf (page 2, as the API renders it: 3000 x 2122 px,
// about 71.4 px per metre), its known geometry in plans.truth.json, and a draft whose boxes are
// a little too wide everywhere, as the vision model's are.
import { readFileSync } from "node:fs";
import type { DrawingAnalysis, PlanPoint, PlanProposal, Project } from "@replay-world/contracts";
import { validateProject } from "@replay-world/contracts";
import { describe, expect, it } from "vitest";
import type { ReviewCorrection } from "../drawing/review";
import { buildPlanProject, drawingSource, pictureScale, proposedDrawing } from "../drawing/world";
import type { EditCommand } from "../editing/commands";
import { createEditor, type EditorState, execute, redo, undo } from "../editing/history";
import { checkLayout } from "./layout";
import { checkRoute, type RouteRequest } from "./route";

const truth = JSON.parse(readFileSync(new URL("../../../../fixtures/plans/plans.truth.json", import.meta.url), "utf8"));
const hall = truth["packing-hall.pdf"];
const W = 3000;
const H = 2122;
const PX = hall.px_per_m as number;
const SHA = "1".repeat(64);

const analysis: DrawingAnalysis = {
  filename: "packing-hall.pdf",
  sha256: SHA,
  warnings: [],
  drawing: {
    reader: "rws-plan-image/1",
    file: { uri: `drawings/${SHA}.pdf`, bytes: 3336 },
    raster: { uri: `drawings/${SHA}-p2.png`, media_type: "image/png", sha256: "2".repeat(64), width_px: W, height_px: H, page: 2, page_count: 2, dpi: 181.43 },
    dxf_version: null,
    units: { insunits: null, declared: null, measurement: null, question: "mark a length", basis: null },
    layers: ["page 2"],
    extent_min: { x: 0, y: 0 },
    extent_max: { x: W, y: H },
    lines: [],
    labels: [],
    objects: [],
    skipped: [],
    omitted: [],
    review: null,
  },
};

/** Plan pixels (y up) -> picture fractions, with the box grown by `grow` pixels each side. */
const box = ([x0, y0, x1, y1]: number[], grow = 0) => ({ left: (x0! - grow) / W, right: (x1! + grow) / W, top: 1 - (y1! + grow) / H, bottom: 1 - (y0! - grow) / H });
const name = (n: string) => hall.objects.find((o: { name: string }) => o.name === n);

/** The model's draft: every box about 0.07 m too wide on each side (5 px). */
const proposal: PlanProposal = {
  floor: hall.floor.map(([x, y]: number[]) => ({ u: x! / W, v: 1 - y! / H })),
  walls: [],
  objects: hall.objects.map((o: { name: string; kind: "equipment" | "keep_clear"; px: number[] }, i: number) => ({ id: `plan-${i + 1}`, label: o.name, named_on_plan: true, kind: o.kind, box: box(o.px, 5) })),
  texts: [],
};

const [ka, kb] = [hall.known_length.a, hall.known_length.b] as [number, number][];
const known = (tolerance: number) => pictureScale({ x: ka![0]!, y: ka![1]! }, { x: kb![0]!, y: kb![1]! }, 24, tolerance);

function run(editor: EditorState, command: EditCommand): EditorState {
  const outcome = execute(editor, { baseRevision: editor.project.scene.revision, command });
  if (!outcome.ok) throw new Error(outcome.rejection.message);
  const valid = validateProject(outcome.state.project);
  if (!valid.ok) throw new Error(JSON.stringify(valid.issues.slice(0, 3)));
  return outcome.state;
}
const review = (e: EditorState, correction: ReviewCorrection) => run(e, { type: "review_drawing", sourceId: e.project.sources[0]!.id, correction });
const drawn = (p: Project, label: string) => drawingSource(p)!.drawing.objects.find((o) => o.label === label)!;
const object = (p: Project, n: string) => p.scene.objects.find((o) => o.name === n)!;

function reviewed(tolerance = 4): EditorState {
  const project = buildPlanProject(analysis, proposedDrawing(analysis, proposal), known(tolerance));
  expect(validateProject(project).ok).toBe(true);
  let e = createEditor(project);
  e = review(e, { kind: "accept_floor" });
  e = review(e, { kind: "accept_remaining" });
  return review(e, { kind: "accept_omissions" });
}

/** Three corners of a true rectangle (as a careful person would click them). */
const corners = ([x0, y0, x1, y1]: number[]): [PlanPoint, PlanPoint, PlanPoint] => [
  { x: x0!, y: y0! },
  { x: x1!, y: y0! },
  { x: x1!, y: y1! },
];
const traceAll = (e: EditorState, names: string[], tolerance: number) =>
  names.reduce((editor, n) => review(editor, { kind: "trace", drawnId: drawn(editor.project, n).id, corners: corners(name(n).px), tolerance }), e);
const traceFloor = (e: EditorState, tolerance: number) => review(e, { kind: "trace_floor", outline: hall.floor.map(([x, y]: number[]) => ({ x: x!, y: y! })), tolerance });

/** Metres from the hall's outer south-west corner -> world. */
function world(project: Project, x: number, y: number) {
  const t = drawingSource(project)!.source_to_world;
  const px = 302.38 + x * PX;
  const py = 579.56 + y * PX; // the hall's outer south-west corner on the page
  return { x: px * t.metres_per_source_unit + t.translation_m.x, z: -py * t.metres_per_source_unit + t.translation_m.z };
}
// From inside the aisle (open only to the east) to beyond its east end.
const aisle = (p: Project): RouteRequest => ({ start: world(p, 1.5, 8.1), end: world(p, 16.0, 8.1), widthM: 1.2, allowanceM: 0.1 });

describe("IMP-03: a plan picture's draft and the checks", () => {
  it("builds a valid draft whose outlines are approximate, at the known length's scale", () => {
    const e = reviewed();
    const source = drawingSource(e.project)!;
    expect(source.kind).toBe("pdf");
    expect(source.source_to_world.source_unit).toBe("px");
    expect(source.source_to_world.metres_per_source_unit).toBeCloseTo(1 / PX, 6);
    expect(source.drawing.objects.filter((o) => o.footprint_fit === "approximate")).toHaveLength(7); // the floor and six objects
    expect(object(e.project, "Rack 1").dimensions.width).toMatchObject({ origin: "drawn" });
    expect(object(e.project, "Rack 1").dimensions.width.value_m).toBeCloseTo(12.14, 2); // 12 m drawn, the box 0.07 m wider each side
    expect(object(e.project, "Rack 1").dimensions.width.source_ref).toContain("a box the vision model proposed (approximate)");
  });

  it("never fits on proposed outlines, however close they are: it names what to trace", () => {
    const e = reviewed();
    const route = checkRoute(e.project, aisle(e.project))!;
    expect(route.outcome).toBe("cannot_determine");
    expect(route.summary).toContain("the floor's outline is only proposed from the picture: trace the floor in the review");
    const floored = traceFloor(e, 4);
    const now = checkRoute(floored.project, aisle(floored.project))!;
    expect(now.outcome).toBe("cannot_determine");
    expect(now.uncertainOnRoute.join(" ")).toMatch(/Rack [12]'s outline was only proposed from the plan picture: trace it/);
    const layout = checkLayout(floored.project)!;
    expect(layout.outcome).toBe("cannot_determine");
  });

  it("fits once the floor and both racks are traced to within 0.06 m and the scale to 0.5 %", () => {
    const e = traceAll(traceFloor(reviewed(4), 4), ["Rack 1", "Rack 2"], 4);
    const route = checkRoute(e.project, aisle(e.project))!;
    expect(route.outcome).toBe("fits");
    expect(route.passage!.widthM).toBeCloseTo(1.8, 2);
    expect(route.tested.join(" ")).toContain("traced outlines widened by up to 0.06 m and the corridor by 0.5 % for the scale");
    expect(route.tested.join(" ")).toContain("outlines only proposed from the picture kept 0.50 m farther away");
    expect(object(e.project, "Rack 1").dimensions.width.value_m).toBeCloseTo(12, 2);
    expect(drawingSource(e.project)!.drawing.review.objects.find((o) => o.drawn_id === drawn(e.project, "Rack 1").id)?.status).toBe("corrected");
  });

  it("cannot tell when the tracing is too coarse for the aisle's 0.20 m margin", () => {
    const e = traceAll(traceFloor(reviewed(4), 20), ["Rack 1", "Rack 2"], 20); // 0.28 m each
    const route = checkRoute(e.project, aisle(e.project))!;
    expect(route.outcome).toBe("cannot_determine");
    expect(route.summary).toContain("within the precision the plan was traced to");
  });

  it("is blocked when the traced packing table is moved into the aisle's mouth", () => {
    let e = traceAll(traceFloor(reviewed(4), 4), ["Rack 1", "Rack 2", "Packing table"], 4);
    const table = object(e.project, "Packing table");
    const at = world(e.project, 11.0, 8.1);
    e = run(e, { type: "set_transform", objectId: table.id, transform: { ...table.transform, position_m: { x: at.x, y: 0, z: at.z } } });
    const blocked = checkRoute(e.project, aisle(e.project))!;
    expect(blocked.outcome).toBe("conflict");
    expect(blocked.passage!.widthM).toBeCloseTo(0.4, 1);
    expect(blocked.passage!.between).toContain("Packing table");
  });

  it("overlaps closer than the tracing can tell are not conflicts", () => {
    let e = traceAll(traceFloor(reviewed(4), 4), ["Rack 1", "Rack 2"], 12); // 0.17 m tolerance
    const rack = object(e.project, "Rack 2");
    const up = world(e.project, 6.5, 6.6 + 1.7); // 0.1 m short of Rack 1's bottom edge at y 9.0
    e = run(e, { type: "set_transform", objectId: rack.id, transform: { ...rack.transform, position_m: { x: up.x, y: 0, z: up.z } } });
    const layout = checkLayout(e.project)!;
    const pair = layout.findings.find((f) => f.objectIds.length === 2 && f.message.includes("Rack 1") && f.message.includes("Rack 2"))!;
    expect(pair.state).toBe("cannot_determine");
    expect(pair.message).toMatch(/0\.10 m apart on the plan, within the ±0\.\d\d m the outlines and scale were marked to: too close to tell/);
  });

  it("adds a missed object, removes a wrong one, and undoes and redoes each", () => {
    const start = reviewed();
    const added = review(start, { kind: "trace", drawnId: null, corners: [{ x: 2100, y: 700 }, { x: 2200, y: 700 }, { x: 2200, y: 780 }], tolerance: 4, name: "Pallet stack" });
    const stack = object(added.project, "Pallet stack");
    expect(stack.dimensions.width.value_m).toBeCloseTo(100 / PX, 3);
    expect(drawingSource(added.project)!.drawing.review.objects.at(-1)!.status).toBe("added");
    const removed = review(added, { kind: "object", drawnId: drawn(added.project, "Conveyor").id, action: "not_an_object" });
    expect(removed.project.scene.objects.some((o) => o.name === "Conveyor")).toBe(false);
    const back = (s: EditorState) => {
      const o = undo(s, s.project.scene.revision);
      if (!o.ok) throw new Error(o.rejection.message);
      return o.state;
    };
    const forward = (s: EditorState) => {
      const o = redo(s, s.project.scene.revision);
      if (!o.ok) throw new Error(o.rejection.message);
      return o.state;
    };
    const twice = back(back(removed));
    expect(twice.project.sources).toEqual(start.project.sources);
    expect(twice.project.scene.objects).toEqual(start.project.scene.objects);
    expect(forward(forward(twice)).project.sources).toEqual(removed.project.sources);
  });
});
