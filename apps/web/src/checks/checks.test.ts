// GEO-01/02 on fixtures/drawings/layout-checks-mm.dxf, whose outcomes are worked out by hand
// (see scripts/build_dxf_fixtures.py). World metres: drawing (x, y) mm -> (x/1000 - 10, 5 - y/1000).
import { readFileSync } from "node:fs";
import { type DrawingAnalysis, type Project, validateDrawingAnalysis } from "@replay-world/contracts";
import { describe, expect, it } from "vitest";
import type { EditCommand } from "../editing/commands";
import { createEditor, type EditorState, execute } from "../editing/history";
import { deepFreeze } from "../testing/fixtures";
import type { ReviewCorrection } from "../drawing/review";
import { buildDrawingProject } from "../drawing/world";
import { asDrawn } from "./arrangement";
import { checkLayout } from "./layout";
import { checkRoute, type RouteRequest } from "./route";

const data: unknown = JSON.parse(readFileSync(new URL("../../../../fixtures/drawings/layout-checks-mm.analysis.json", import.meta.url), "utf8"));
const checked = validateDrawingAnalysis(data);
if (!checked.ok) throw new Error(JSON.stringify(checked.issues));
const analysis: DrawingAnalysis = deepFreeze(checked.value);

const world = (x: number, y: number) => ({ x: x / 1000 - 10, z: 5 - y / 1000 });
const object = (p: Project, name: string) => p.scene.objects.find((o) => o.name === name)!;

function run(editor: EditorState, command: EditCommand): EditorState {
  const outcome = execute(editor, { baseRevision: editor.project.scene.revision, command });
  if (!outcome.ok) throw new Error(outcome.rejection.message);
  return outcome.state;
}
const review = (e: EditorState, correction: ReviewCorrection) => run(e, { type: "review_drawing", sourceId: e.project.sources[0]!.id, correction });

function reviewed(): EditorState {
  let e = createEditor(buildDrawingProject(analysis, "mm"));
  e = review(e, { kind: "accept_floor" });
  e = review(e, { kind: "unit", unit: "mm" });
  e = review(e, { kind: "accept_remaining" });
  return review(e, { kind: "accept_omissions" });
}

function place(e: EditorState, name: string, x: number, y: number, yawDeg?: number): EditorState {
  const o = object(e.project, name);
  const p = world(x, y);
  const rotation = yawDeg === undefined ? o.transform.rotation_rad : { ...o.transform.rotation_rad, y: (yawDeg * Math.PI) / 180 };
  return run(e, { type: "set_transform", objectId: o.id, transform: { position_m: { x: p.x, y: 0, z: p.z }, rotation_rad: rotation } });
}

const aisle: RouteRequest = { start: world(1000, 5000), end: world(16000, 5000), widthM: 1.2, allowanceM: 0.1 };
const doorway: RouteRequest = { start: world(1000, 5000), end: world(18500, 5000), widthM: 1.2, allowanceM: 0.1 };

describe("GEO-01 footprint and keep-clear checks", () => {
  it("cannot determine anything before the drawing is reviewed", () => {
    const result = checkLayout(buildDrawingProject(analysis, "mm"))!;
    expect(result.outcome).toBe("cannot_determine");
    expect(result.summary).toBe("Cannot determine yet: the scale is not checked yet; the floor is only proposed; what the drawing leaves out is not yet accepted.");
  });

  it("finds the overlap only the mixer's 45-degree turn creates: 0.231 m", () => {
    const result = checkLayout(reviewed().project)!;
    expect(result.outcome).toBe("conflict");
    const [overlap, ...rest] = result.findings;
    expect(rest).toEqual([]);
    expect([overlap!.kind, overlap!.state, overlap!.message]).toEqual(["overlap", "conflict", "Mixer and Control panel overlap by 0.23 m."]);
    expect(overlap!.metres).toBeCloseTo(0.231371, 5); // 8000 + 800·√2 − 8900 mm
    // The nearest pair that does not overlap: Rack A's edge (y 7000) and the mixer's lowest corner (y 7468.6).
    expect(result.closest?.gapM).toBeCloseTo(0.468629, 5);
    expect(new Set(result.closest?.names)).toEqual(new Set(["Mixer", "Rack A"]));
  });

  it("fits once the mixer is square to the panel, 0.10 m clear; a move into the zone is a conflict", () => {
    const square = place(reviewed(), "Mixer", 8000, 8600, 0);
    const fits = checkLayout(square.project)!;
    expect([fits.outcome, fits.findings]).toEqual(["fits", []]);
    expect(fits.summary).toBe("No overlaps, no object in a keep-clear zone and nothing past the floor's edge. Closest: Mixer and Control panel, 0.10 m apart.");
    const intruding = place(square, "Machine B", 13350, 8700); // left edge from x 13800 to 12600 mm
    const conflict = checkLayout(intruding.project)!;
    expect(conflict.outcome).toBe("conflict");
    expect(conflict.findings.map((f) => f.message)).toEqual(["Machine B stands 0.40 m into Keep-clear zone 1."]);
  });

  it("says 'not evaluated accurately' when only the round tank's box overlaps", () => {
    // The table's corner (12300, 1950) is 0.541 m from the tank's centre: outside the 0.5 m tank,
    // inside its 1 m box. The boxes overlap by 0.05 m.
    const e = place(place(reviewed(), "Mixer", 8000, 8600, 0), "Packing table", 12900, 2350);
    const result = checkLayout(e.project)!;
    expect(result.outcome).toBe("cannot_determine");
    const [finding] = result.findings;
    expect(finding!.state).toBe("not_accurate");
    expect(finding!.metres).toBeCloseTo(0.05, 6);
    expect(finding!.message).toContain("Not evaluated accurately: the boxes of");
    expect(finding!.message).toContain("Water tank's box only encloses a round shape");
  });
});

describe("GEO-01/02 follow every kind of change", () => {
  it("a resize narrows the aisle to 1.30 m and blocks the 1.40 m corridor", () => {
    const e = reviewed();
    const rack = object(e.project, "Rack B");
    const wider = run(e, { type: "set_dimensions", objectId: rack.id, values: { depth: 2.4 } }); // y 3000..4000 -> 2300..4700 mm
    // Along the middle of what is left of the aisle (y 4700..6000 mm): no point in it keeps 0.70 m each side.
    const result = checkRoute(wider.project, { ...aisle, start: world(1000, 5350), end: world(16000, 5350) })!;
    expect(result.outcome).toBe("conflict");
    expect(result.passage!.widthM).toBeCloseTo(1.3, 6);
    expect(result.summary).toMatch(/^Blocked at the start: the start point is 0\.65 m from Rack [AB], and the item needs 0\.70 m on each side\.$/);
  });

  it("a reclassified object becomes a zone: the turned mixer stands 0.23 m into it", () => {
    const e = reviewed();
    const panel = e.project.sources[0]!.drawing!.objects.find((d) => d.label === "Control panel")!;
    const zoned = review(e, { kind: "object", drawnId: panel.id, action: "correct", objectKind: "keep_clear" });
    const result = checkLayout(zoned.project)!;
    expect(result.findings.map((f) => f.message)).toEqual(["Mixer stands 0.23 m into Control panel."]);
  });

  it("a scale change scales every answer: in centimetres the overlap is 2.31 m", () => {
    const result = checkLayout(review(reviewed(), { kind: "unit", unit: "cm" }).project)!;
    expect(result.findings.map((f) => f.message)).toEqual(["Mixer and Control panel overlap by 2.31 m."]);
  });

  it("an omitted shape inside a keep-clear zone keeps the zone from being confirmed clear", () => {
    // The zone (2.0 x 1.6 m) moved over the left-out spline at x 17250..17700, y 4500..5500 mm.
    const result = checkLayout(place(reviewed(), "Keep-clear zone 1", 17450, 5000).project)!;
    const uncertain = result.findings.filter((f) => f.kind === "zone_uncertain");
    expect(uncertain.map((f) => f.message)).toEqual([
      "Keep-clear zone 1 contains an omitted SPLINE 117 on layer EQUIPMENT, which is not an object: if it is something standing there, the zone is not clear.",
    ]);
    expect(uncertain[0]!.fix).toContain("upload it again, or check on site");
  });
});

describe("GEO-02 one width-only route", () => {
  it("fits through the 2.00 m aisle for a 1.20 m item with 0.10 m each side", () => {
    const result = checkRoute(reviewed().project, aisle)!;
    expect(result.outcome).toBe("fits");
    expect(result.needM).toBeCloseTo(1.4, 9);
    expect(result.passage!.widthM).toBeCloseTo(2.0, 6);
    expect(new Set(result.passage!.between)).toEqual(new Set(["Rack A", "Rack B"]));
    expect(result.clearanceM!).toBeGreaterThanOrEqual(0.7);
    expect(result.scope).toContain("Width-only route; turning not evaluated.");
  });

  it("is blocked at the 0.80 m doorway, and says where", () => {
    const result = checkRoute(reviewed().project, doorway)!;
    expect(result.outcome).toBe("conflict");
    expect(result.passage!.widthM).toBeCloseTo(0.8, 6);
    expect(result.passage!.between).toEqual(["Partition", "Partition"]);
    expect(result.passage!.at.x).toBeGreaterThanOrEqual(7.0); // in the doorway: drawing x 17000 to 17200
    expect(result.passage!.at.x).toBeLessThanOrEqual(7.2);
    expect(result.summary).toBe("Blocked: the best way through narrows to 0.80 m between Partition and Partition, and the item needs 1.40 m.");
  });

  it("cannot determine a 0.60 m item's route through the doorway: an omitted spline lies just beyond it", () => {
    const result = checkRoute(reviewed().project, { ...doorway, widthM: 0.6, allowanceM: 0 })!;
    expect(result.outcome).toBe("cannot_determine");
    expect(result.uncertainOnRoute).toEqual(["an omitted SPLINE 117 on layer EQUIPMENT"]);
  });

  it("changes with a move: Machine B in the aisle leaves 0.50 m each side; the drawing's arrangement still fits", () => {
    const moved = place(reviewed(), "Machine B", 8500, 5000);
    const now = checkRoute(moved.project, aisle)!;
    expect(now.outcome).toBe("conflict");
    expect(now.passage!.widthM).toBeCloseTo(0.5, 6);
    expect(now.passage!.between).toContain("Machine B");
    expect(now.passage!.objectIds).toContain(object(moved.project, "Machine B").id); // highlighted on the plan and in 3D
    expect(checkRoute(asDrawn(moved.project)!, aisle)!.outcome).toBe("fits");
  });

  it("cannot confirm a route clear while a left-out shape's position is unknown", () => {
    const project = reviewed().project;
    const source = project.sources[0]!;
    const unknown = { ...project, sources: [{ ...source, drawing: { ...source.drawing!, omitted: null } }] };
    const result = checkRoute(unknown, aisle)!;
    expect(result.outcome).toBe("cannot_determine");
    expect(result.summary).toContain("could be anywhere");
  });

  it("cannot determine before the scale is checked", () => {
    expect(checkRoute(buildDrawingProject(analysis, "mm"), aisle)!.outcome).toBe("cannot_determine");
  });
});
