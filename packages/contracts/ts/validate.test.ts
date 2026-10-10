// The browser and the API must agree on what a valid project is. These checks run the
// generated schema against the same fixture files the Python tests use.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, validateProject, type ContractIssue, type Project } from "./index";

const fixturesDir = new URL("../../../fixtures/", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, fixturesDir), "utf8");
const foundation = (): Project => JSON.parse(read("scenes/foundation-scene.json")) as Project;
const loose = (value: unknown) => value as Record<string, unknown>;

function issuesFor(data: unknown): ContractIssue[] {
  const result = validateProject(data);
  if (result.ok) throw new Error("expected the project to be rejected");
  return result.issues;
}

describe("validateProject", () => {
  it("accepts the 0.2.0 foundation fixture with its catalog and per-axis evidence", () => {
    const result = validateProject(foundation());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const project = result.value;
    expect(project.schema_version).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe("0.2.0");
    expect(project.catalog.map((a) => a.id)).toContain("asset-generic-packing-station");
    const packing = project.scene.objects.find((o) => o.id === "obj-packing-station")!;
    expect([packing.dimensions.width.origin, packing.dimensions.height.origin]).toEqual([
      "measured",
      "inferred",
    ]);
    const unknown = project.scene.objects.flatMap((o) => o.parameters).filter((p) => p.state === "unknown");
    expect(unknown.length).toBeGreaterThan(0);
    expect(unknown.every((p) => !("value" in p))).toBe(true);
  });

  it("rejects a negative length at its exact per-axis path", () => {
    expect(issuesFor(JSON.parse(read("invalid/negative-dimension.json")))).toEqual([
      { path: "/scene/objects/4/dimensions/width/value_m", message: "must be > 0" },
    ]);
  });

  it("cannot even parse a non-finite coordinate, because JSON has no NaN", () => {
    expect(() => JSON.parse(read("invalid/nonfinite-coordinate.json"))).toThrow(SyntaxError);
  });

  it("rejects a 0.1.0 document instead of half-reading it", () => {
    const issues = issuesFor(JSON.parse(read("legacy/foundation-scene-0.1.0.json")));
    expect(issues).toContainEqual({ path: "/schema_version", message: "must be equal to constant" });
    expect(issues).toContainEqual({ path: "/", message: "must have required property 'catalog'" });
  });

  it("requires evidence on every axis and refuses the old flat dimension shape", () => {
    const project = foundation();
    delete loose(project.scene.objects[0]!.dimensions.height).origin;
    loose(project.scene.objects[1]!.dimensions).width_m = 0.4;
    expect(issuesFor(project)).toEqual(
      expect.arrayContaining([
        { path: "/scene/objects/0/dimensions/height", message: "must have required property 'origin'" },
        { path: "/scene/objects/1/dimensions", message: "unexpected property 'width_m'" },
      ]),
    );
  });

  it("rejects a number sent as a string and an unexpected property", () => {
    const project = foundation();
    loose(project.scene.objects[0]!.dimensions.width).value_m = "20";
    loose(project).scale = 1;
    expect(issuesFor(project)).toEqual(
      expect.arrayContaining([
        { path: "/scene/objects/0/dimensions/width/value_m", message: "must be number" },
        { path: "/", message: "unexpected property 'scale'" },
      ]),
    );
  });

  it("rejects catalog assets without rights or with a free-text license", () => {
    const project = foundation();
    delete loose(project.catalog[0]).rights;
    project.catalog[1]!.rights.license = "MIT License";
    const issues = issuesFor(project);
    expect(issues).toContainEqual({ path: "/catalog/0", message: "must have required property 'rights'" });
    expect(issues.map((i) => i.path)).toContain("/catalog/1/rights/license");
  });

  it("rejects an unstable asset reference ID", () => {
    const project = foundation();
    project.scene.objects[4]!.asset_id = "Asset With Spaces";
    expect(issuesFor(project).map((i) => i.path)).toContain("/scene/objects/4/asset_id");
  });

  it("rejects an unknown parameter that carries a value", () => {
    const project = foundation();
    const param = project.scene.objects[4]!.parameters[0]!;
    expect(param.state).toBe("unknown");
    Object.assign(param, { value: 30 });
    expect(issuesFor(project).map((i) => i.path)).toContain("/scene/objects/4/parameters/0");
  });

  it("leaves cross-record rules (duplicate IDs, dangling asset references) to the API", () => {
    // Documented boundary: JSON Schema cannot check uniqueness or that a reference resolves.
    expect(validateProject(JSON.parse(read("invalid/duplicate-object-id.json"))).ok).toBe(true);
    expect(validateProject(JSON.parse(read("invalid/dangling-asset-reference.json"))).ok).toBe(true);
  });
});
