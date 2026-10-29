// The "Try rearranging a workshop" example: fixtures/scenes/workshop.json is made by this code
// from the reader's analysis of fixtures/drawings/workshop-mm.dxf and the catalog's manifest, the
// way an uploaded drawing becomes a world. Its story is computed, not written: the bench at the
// spot beside the doorway blocks the way to packing; moved 0.5 m clear, the walk is shorter and
// the shift makes more. Regenerate after an intended change with:
//   pnpm --filter @replay-world/web exec vitest run -u src/examples/workshop.test.ts
import { readFileSync } from "node:fs";
import { type DrawingAnalysis, type Project, validateProject } from "@replay-world/contracts";
import { describe, expect, it } from "vitest";
import { applyCommand } from "../editing/commands";
import { serializeProject } from "../editing/projectFile";
import { runDay } from "../run/day";
import { planRun } from "../run/plan";
import { type ManifestModel, WORKSHOP_TASK, workshopProject } from "./workshop";

const root = new URL("../../../../", import.meta.url);
const analysis = JSON.parse(readFileSync(new URL("fixtures/drawings/workshop-mm.analysis.json", root), "utf8")) as DrawingAnalysis;
const manifest = (JSON.parse(readFileSync(new URL("assets/catalog/models/manifest.json", root), "utf8")) as { models: ManifestModel[] }).models;
const project = workshopProject(analysis, manifest);

function benchAt(base: Project, dz: number): Project {
  const bench = base.scene.objects.find((o) => o.id === WORKSHOP_TASK.objectId)!;
  const transform = { ...bench.transform, position_m: { ...bench.transform.position_m, x: WORKSHOP_TASK.spot.x, z: WORKSHOP_TASK.spot.z + dz } };
  const moved = applyCommand(base, { baseRevision: base.scene.revision, command: { type: "set_transform", objectId: bench.id, transform } });
  if (!moved.ok) throw new Error(moved.rejection.message);
  return moved.project;
}
const toPacking = (p: Project) => planRun(p, p.process!).routes.find((r) => r.uses.some((u) => u === "carrying from Assembly bench to Packing table"))!;

describe("the workshop example", () => {
  it("is the committed fixture, a valid project made from its drawing", async () => {
    expect(validateProject(project).ok).toBe(true);
    await expect(serializeProject(project)).toMatchFileSnapshot("../../../../fixtures/scenes/workshop.json");
  });

  it("runs as drawn, with every route clear", () => {
    expect(planRun(project, project.process!).outcome).toBe("ready");
    expect(runDay(project, project.process!, "edited").result!.metrics.completed).toBe(166);
  });

  it("blocks the way to packing with the bench beside the doorway, and clears it 0.5 m further on", () => {
    const blocked = benchAt(project, 0);
    expect(toPacking(blocked).outcome).toBe("conflict");
    expect(toPacking(blocked).summary).toContain("narrows to 0.57 m between Partition and Assembly bench");
    expect(runDay(blocked, blocked.process!, "edited").result!.metrics.completed).toBe(0);
    const clear = benchAt(project, 0.5);
    expect(toPacking(clear).outcome).toBe("fits");
    expect(toPacking(clear).lengthM!).toBeLessThan(toPacking(project).lengthM! - 3);
    expect(runDay(clear, clear.process!, "edited").result!.metrics.completed).toBe(174);
  });
});
