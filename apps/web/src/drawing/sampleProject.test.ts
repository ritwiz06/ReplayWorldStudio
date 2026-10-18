// The committed sample fixtures/scenes/sample-factory.json is produced here from the DXF reading,
// and served by the API as the "sample" fixture. Regenerate after an intended change with:
// pnpm --filter @replay-world/web exec vitest run -u src/drawing/sampleProject.test.ts
import { readFileSync } from "node:fs";
import { type DrawingAnalysis, validateDrawingAnalysis, validateProject } from "@replay-world/contracts";
import { describe, expect, it } from "vitest";
import { checkLayout } from "../checks/layout";
import { checkRoute } from "../checks/route";
import { serializeProject } from "../editing/projectFile";
import { SAMPLE_ROUTE, sampleProject } from "./sampleProject";
import { drawingSource, toWorld } from "./world";

const data: unknown = JSON.parse(readFileSync(new URL("../../../../fixtures/drawings/layout-checks-mm.analysis.json", import.meta.url), "utf8"));
const checked = validateDrawingAnalysis(data);
if (!checked.ok) throw new Error("analysis");

describe("the public sample", () => {
  const project = sampleProject(checked.value as DrawingAnalysis);

  it("matches the committed fixture the API serves", async () => {
    expect(validateProject(project).ok).toBe(true);
    await expect(serializeProject(project)).toMatchFileSnapshot("../../../../fixtures/scenes/sample-factory.json");
  });

  it("is reviewed: its aisle route fits, and its layout shows the turned mixer's overlap", () => {
    const t = drawingSource(project)!.source_to_world;
    const route = checkRoute(project, { start: toWorld(t, SAMPLE_ROUTE.start), end: toWorld(t, SAMPLE_ROUTE.end), widthM: 1.2, allowanceM: 0.1 })!;
    expect(route.outcome).toBe("fits");
    expect(checkLayout(project)!.outcome).toBe("conflict");
    expect(project.scene.edit_log).toEqual([]);
  });
});
