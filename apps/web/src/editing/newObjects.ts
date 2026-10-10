// IDs and names for objects the editor adds. IDs are unique within the project and never reuse
// one that the edit log still mentions (a removed object's ID stays retired).
import type { CatalogAsset, Project, SceneObject } from "@replay-world/contracts";
import { usedObjectIds } from "./commands";

const MAX_ID_LENGTH = 128;

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** `base` itself if unused (and `allowBase`), otherwise `base-2`, `base-3`, … */
function unique(used: ReadonlySet<string>, base: string, allowBase: boolean): string {
  const clipped = (suffix: string) => base.slice(0, MAX_ID_LENGTH - suffix.length).replace(/-+$/, "") + suffix;
  if (allowBase && !used.has(clipped(""))) return clipped("");
  for (let n = 2; ; n++) {
    const id = clipped(`-${n}`);
    if (!used.has(id)) return id;
  }
}

/** ID for a new instance of `asset`, e.g. `obj-belt-conveyor-3m` or `obj-belt-conveyor-3m-2`. */
export function instanceId(project: Project, asset: CatalogAsset): string {
  const base = `obj-${slug(asset.id.replace(/^asset-/, "")) || "instance"}`;
  return unique(usedObjectIds(project), base, true);
}

/** ID for a copy of `source`: `obj-cell-filling-2`, then `-3` (a copy of a copy counts on). */
export function copyId(project: Project, source: SceneObject): string {
  return unique(usedObjectIds(project), source.id.replace(/-\d+$/, ""), false);
}

function uniqueName(project: Project, first: string, nth: (n: number) => string): string {
  const names = new Set(project.scene.objects.map((o) => o.name));
  if (!names.has(first)) return first;
  for (let n = 2; ; n++) {
    if (!names.has(nth(n))) return nth(n);
  }
}

/** The asset's name, then "Belt conveyor, 3 m (2)" and so on. */
export function instanceName(project: Project, asset: CatalogAsset): string {
  return uniqueName(project, asset.name, (n) => `${asset.name} (${n})`);
}

/** "Filling cell (copy)", then "Filling cell (copy 2)". */
export function copyName(project: Project, source: SceneObject): string {
  const original = source.name.replace(/ \(copy(?: \d+)?\)$/, "");
  return uniqueName(project, `${original} (copy)`, (n) => `${original} (copy ${n})`);
}
