// "Improve model" (GEN-02): the working copy of a placed generated object's specification, the
// plain-words list of what a revision changes, and the plan for which objects change and how
// their sizes are handled. Pure functions; the dialog in components/ImproveModel.tsx uses them.
import type { CatalogAsset, Dimensions, GeometryDraft, GeometryPart, GeometrySpec, Length, Project, RevisedDimensions, SceneObject } from "@replay-world/contracts";
import type { RevisedObjectRequest } from "../editing/commands";
import { formatFixed } from "../editing/units";
import { ENVELOPE_LIMITS } from "./objectDraft";

export type DimensionKey = keyof Dimensions;
export const DIMENSION_KEYS: readonly DimensionKey[] = ["width", "height", "depth"];
export const AXIS: Record<DimensionKey, "x" | "y" | "z"> = { width: "x", height: "y", depth: "z" };
const LABEL: Record<DimensionKey, string> = { width: "Width", height: "Height", depth: "Depth" };

/** How a changed overall dimension was settled: typed by the user, or proposed by the model. */
export type ChangedBasis = "entered" | "proposed";

const micro = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
const metres = (v: number) => `${formatFixed(v, 3)} m`;
const words = (material: string) => material.replaceAll("_", " ");

/** The parts, re-centred on the floor, with the overall size following them (as in the builder). */
export function withParts(spec: GeometryDraft, parts: GeometryPart[]): GeometryDraft {
  if (parts.length === 0) return spec;
  const lo = { x: Infinity, y: Infinity, z: Infinity };
  const hi = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const p of parts) {
    for (const a of ["x", "y", "z"] as const) {
      lo[a] = Math.min(lo[a], p.center_m[a] - p.size_m[a] / 2);
      hi[a] = Math.max(hi[a], p.center_m[a] + p.size_m[a] / 2);
    }
  }
  const shift = { x: -(lo.x + hi.x) / 2, y: -lo.y, z: -(lo.z + hi.z) / 2 };
  const centred = parts.map((p) => ({ ...p, center_m: { x: micro(p.center_m.x + shift.x), y: micro(p.center_m.y + shift.y), z: micro(p.center_m.z + shift.z) } }));
  const size = (a: "x" | "y" | "z") => Math.min(ENVELOPE_LIMITS.max, Math.max(ENVELOPE_LIMITS.min, micro(hi[a] - lo[a])));
  return { ...spec, envelope_m: { x: size("x"), y: size("y"), z: size("z") }, parts: centred as GeometryDraft["parts"] };
}

/** A new overall size on one axis; the API fits (scales) the parts to it. */
export function withSize(spec: GeometryDraft, key: DimensionKey, value: number): GeometryDraft {
  return { ...spec, envelope_m: { ...spec.envelope_m, [AXIS[key]]: micro(value) } };
}

/** Every part of one colour given another, the simplest appearance correction. */
export function recolour(spec: GeometryDraft, from: GeometryPart["material"], to: GeometryPart["material"]): GeometryDraft {
  return { ...spec, parts: spec.parts.map((p) => (p.material === from ? { ...p, material: to } : p)) as GeometryDraft["parts"] };
}

/** Colours in use, most parts first. */
export function colourGroups(parts: readonly GeometryPart[]): [GeometryPart["material"], number][] {
  const counts = new Map<GeometryPart["material"], number>();
  for (const p of parts) counts.set(p.material, (counts.get(p.material) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]);
}

export const sameSpec = (a: GeometryDraft, b: GeometryDraft) => JSON.stringify(a) === JSON.stringify(b);

/** Overall dimensions whose value differs between two specifications (beyond 1 µm). */
export function changedSizes(before: GeometryDraft, after: GeometryDraft): DimensionKey[] {
  return DIMENSION_KEYS.filter((k) => Math.abs(before.envelope_m[AXIS[k]] - after.envelope_m[AXIS[k]]) > 1e-6);
}

const MAX_CHANGES = 40;

/** Identical lines once each, with how often they occurred, in first-seen order. */
function counted(items: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  return counts;
}

/**
 * What a revision changes, in plain words: overall size, parts added and removed, and each
 * remaining part's shape, colour, name and (relative to the whole object) size or position. A
 * part scaled with the whole object does not count as changed.
 */
export function specChanges(before: GeometryDraft, after: GeometryDraft): string[] {
  const lines: string[] = [];
  for (const k of changedSizes(before, after)) lines.push(`${LABEL[k]} ${metres(before.envelope_m[AXIS[k]])} → ${metres(after.envelope_m[AXIS[k]])}`);
  const old = new Map(before.parts.map((p) => [p.id, p]));
  const now = new Map(after.parts.map((p) => [p.id, p]));
  const removed = before.parts.filter((p) => !now.has(p.id));
  const added = after.parts.filter((p) => !old.has(p.id));
  if (removed.length) lines.push(`Removed ${[...counted(removed.map((p) => `“${p.label}”`))].map(([t, n]) => (n > 1 ? `${n} × ${t}` : t)).join(", ")}`);
  for (const [text, n] of counted(added.map((p) => `“${p.label}” (${p.shape.replace("_", " ")}, ${words(p.material)})`))) {
    lines.push(n > 1 ? `Added ${n} × ${text}` : `Added ${text}`);
  }
  const recoloured = new Map<string, string[]>();
  const reshaped: string[] = [];
  const rel = (p: GeometryPart, spec: GeometryDraft) =>
    (["x", "y", "z"] as const).map((a) => [p.center_m[a] / spec.envelope_m[a], p.size_m[a] / spec.envelope_m[a]]).flat();
  for (const p of after.parts) {
    const q = old.get(p.id);
    if (!q) continue;
    if (q.label !== p.label) lines.push(`Renamed “${q.label}” → “${p.label}”`);
    if (q.shape !== p.shape) lines.push(`“${p.label}”: shape ${q.shape.replace("_", " ")} → ${p.shape.replace("_", " ")}`);
    if (q.material !== p.material) {
      const key = `${words(q.material)} → ${words(p.material)}`;
      recoloured.set(key, [...(recoloured.get(key) ?? []), p.label]);
    }
    const a = rel(q, before);
    const b = rel(p, after);
    if (a.some((v, i) => Math.abs(v - b[i]!) > 1e-4) || q.axis !== p.axis || q.taper !== p.taper || q.narrow_end !== p.narrow_end) {
      reshaped.push(`“${p.label}”`);
    }
  }
  for (const [label, n] of counted(reshaped)) lines.push(n > 1 ? `${n} × ${label}: resized or moved` : `${label}: resized or moved`);
  for (const [change, labels] of recoloured) {
    lines.push(labels.length === 1 ? `“${labels[0]}”: colour ${change}` : `Colour ${change} on ${labels.length} parts`);
  }
  if (lines.length > MAX_CHANGES) return [...lines.slice(0, MAX_CHANGES - 1), `…and ${lines.length - MAX_CHANGES + 1} more changes`];
  return lines;
}

/**
 * How each overall dimension of the revision was settled. An unchanged dimension is "kept": the
 * previous value and evidence carry over exactly, so changing parts or colours never turns an
 * estimate (or a size taken from a photo) into a measurement.
 */
export function revisedDimensions(before: GeometryDraft, after: GeometryDraft, bases: Partial<Record<DimensionKey, ChangedBasis>>, confirmed: ReadonlySet<DimensionKey>): RevisedDimensions {
  const changed = new Set(changedSizes(before, after));
  const entry = (k: DimensionKey) => {
    if (!changed.has(k)) return { basis: "kept" as const, confirmed: true };
    const basis = bases[k] ?? "entered";
    return { basis, confirmed: basis === "entered" || confirmed.has(k) };
  };
  return { width: entry("width"), height: entry("height"), depth: entry("depth") };
}

/** What happens to one axis of one object when it switches to the revised model. */
export type AxisPlan =
  /** Unchanged by the revision. */
  | { key: DimensionKey; mode: "same"; value: number }
  /** The object used the model's size, so it takes the new size and its evidence. */
  | { key: DimensionKey; mode: "follows"; before: number; after: number }
  /** The object has its own (edited or measured) size: kept, and the model is stretched to it -
   * unless the user chose the model's new size ("adopt"). */
  | { key: DimensionKey; mode: "own"; value: number; modelSize: number; adopt: boolean };

export interface InstancePlan {
  object: SceneObject;
  axes: AxisPlan[];
}

const sameLength = (a: Length, b: Length) => JSON.stringify(a) === JSON.stringify(b);

/** Objects that use the asset, the selected one first. */
export function instancesOf(project: Project, assetId: string, selectedId: string): SceneObject[] {
  const all = project.scene.objects.filter((o) => o.asset_id === assetId);
  return [...all.filter((o) => o.id === selectedId), ...all.filter((o) => o.id !== selectedId)];
}

/**
 * The exact effect on every object that would change. `adopt` lists "objectId:axis" pairs whose
 * own size the user chose to replace with the model's new size.
 */
export function instancePlan(objects: readonly SceneObject[], previous: CatalogAsset, newSize: GeometryDraft["envelope_m"], adopt: ReadonlySet<string>): InstancePlan[] {
  return objects.map((object) => ({
    object,
    axes: DIMENSION_KEYS.map((key): AxisPlan => {
      const own = object.dimensions[key];
      const after = newSize[AXIS[key]];
      const nominal = previous.nominal_dimensions[key];
      const modelChanged = Math.abs(after - nominal.value_m) > 1e-6;
      if (!modelChanged) return { key, mode: "same", value: own.value_m };
      if (sameLength(own, nominal)) return { key, mode: "follows", before: own.value_m, after };
      return { key, mode: "own", value: own.value_m, modelSize: after, adopt: adopt.has(`${object.id}:${key}`) };
    }),
  }));
}

/**
 * The command's per-object dimensions once the revised asset exists: following and adopted axes
 * take the revised nominal value and evidence; every other axis keeps the object's own.
 */
export function revisedObjects(plan: readonly InstancePlan[], revised: CatalogAsset): RevisedObjectRequest[] {
  return plan.map(({ object, axes }) => {
    const dimensions: RevisedObjectRequest["dimensions"] = {};
    for (const a of axes) {
      if (a.mode === "follows" || (a.mode === "own" && a.adopt)) dimensions[a.key] = structuredClone(revised.nominal_dimensions[a.key]);
    }
    return { objectId: object.id, dimensions };
  });
}

/** The version chain of a generated asset within the project, oldest first. */
export function versionsOf(project: Project, asset: CatalogAsset): CatalogAsset[] {
  const byId = new Map(project.catalog.map((a) => [a.id, a]));
  const chain: CatalogAsset[] = [asset];
  let current = asset;
  while (current.generation?.revision) {
    const earlier = byId.get(current.generation.revision.revises);
    if (!earlier || chain.includes(earlier)) break;
    chain.unshift(earlier);
    current = earlier;
  }
  return chain;
}

export const versionOf = (asset: CatalogAsset) => asset.generation?.revision?.version ?? 1;

/** True when the specification is the same as the one the asset was built from. */
export const isUnchanged = (asset: CatalogAsset, spec: GeometrySpec | GeometryDraft) => asset.generation !== null && sameSpec(asset.generation.spec, spec);
