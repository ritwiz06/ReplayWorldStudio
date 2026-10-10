// Test helpers: repository fixtures, deep-frozen so any in-place mutation throws.
import { readFileSync } from "node:fs";
import type { Project } from "@replay-world/contracts";

export function fixture(path: string): Project {
  const text = readFileSync(new URL(`../../../../fixtures/${path}`, import.meta.url), "utf8");
  return deepFreeze(JSON.parse(text) as Project);
}

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export const objectOf = (project: Project, id: string) => {
  const found = project.scene.objects.find((o) => o.id === id);
  if (!found) throw new Error(`no object ${id}`);
  return found;
};
