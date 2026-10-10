// The browser and the API must agree on what a valid project is. These checks run the
// generated schema against the same fixture files the Python tests use.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, validateProject, type Project } from "./index";

const fixturesDir = new URL("../../../fixtures/", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, fixturesDir), "utf8");
const foundation = (): Project => JSON.parse(read("scenes/foundation-scene.json")) as Project;

function issuesFor(data: unknown) {
  const result = validateProject(data);
  if (result.ok) throw new Error("expected the project to be rejected");
  return result.issues;
}

describe("validateProject", () => {
  it("accepts the foundation fixture and keeps unknown parameters valueless", () => {
    const result = validateProject(foundation());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.schema_version).toBe(SCHEMA_VERSION);
    const unknown = result.value.scene.objects
      .flatMap((o) => o.parameters)
      .filter((p) => p.state === "unknown");
    expect(unknown.length).toBeGreaterThan(0);
    expect(unknown.every((p) => !("value" in p))).toBe(true);
  });

  it("rejects a negative dimension at its exact path", () => {
    const issues = issuesFor(JSON.parse(read("invalid/negative-dimension.json")));
    expect(issues).toEqual([
      { path: "/scene/objects/4/dimensions/width_m", message: "must be > 0" },
    ]);
  });

  it("cannot even parse a non-finite coordinate, because JSON has no NaN", () => {
    expect(() => JSON.parse(read("invalid/nonfinite-coordinate.json"))).toThrow(SyntaxError);
  });

  it("rejects a number sent as a string and an unexpected property", () => {
    const project = foundation() as unknown as Record<string, unknown> & Project;
    (project.scene.objects[0]!.dimensions as unknown as Record<string, unknown>).width_m = "20";
    project.scale = 1;
    expect(issuesFor(project)).toEqual(
      expect.arrayContaining([
        { path: "/scene/objects/0/dimensions/width_m", message: "must be number" },
        { path: "/", message: "unexpected property 'scale'" },
      ]),
    );
  });

  it("rejects an unknown parameter that carries a value", () => {
    const project = foundation();
    const param = project.scene.objects[4]!.parameters[0]!;
    expect(param.state).toBe("unknown");
    Object.assign(param, { value: 30 });
    const paths = issuesFor(project).map((i) => i.path);
    expect(paths).toContain("/scene/objects/4/parameters/0");
  });

  it("rejects a different schema version", () => {
    const project = { ...foundation(), schema_version: "0.0.9" };
    expect(issuesFor(project)).toContainEqual({
      path: "/schema_version",
      message: "must be equal to constant",
    });
  });

  it("leaves cross-field rules such as duplicate IDs to the API", () => {
    // Documented boundary: JSON Schema cannot express uniqueness by property.
    expect(validateProject(JSON.parse(read("invalid/duplicate-object-id.json"))).ok).toBe(true);
  });
});
