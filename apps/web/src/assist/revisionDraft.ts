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

/**
 * How a changed overall dimension was settled: typed by the user, proposed by the model, or a
 * consequence of the user's own part change (GEN-09), which is the user's but still needs their
 * confirmation, because they did not type the new size.
 */
export type ChangedBasis = "entered" | "proposed" | "part";

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
  // A part came or went at one end: what remains is re-centred, so every kept part shifts by the
  // same amount. That is one change, said once (the parts did not move relative to each other).
  const shift = commonShift(before, after);
  const shifted = (q: GeometryPart, p: GeometryPart) =>
    shift !== null && (["x", "y", "z"] as const).every((a) => Math.abs(p.size_m[a] - q.size_m[a]) < 1e-4 && Math.abs(p.center_m[a] - q.center_m[a] - shift[a]) < 1e-4);
  if (shift) lines.push(`The other parts keep their places relative to each other, but the model is re-centred, so in the scene they move ${moveWords(shift)}`);
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
    if ((a.some((v, i) => Math.abs(v - b[i]!) > 1e-4) && !shifted(q, p)) || q.axis !== p.axis || q.taper !== p.taper || q.narrow_end !== p.narrow_end) {
      reshaped.push(`“${p.label}”: ${partWords(q, p, before, after, shift)}`);
    }
  }
  for (const [line, n] of counted(reshaped)) lines.push(n > 1 ? `${n} × ${line}` : line);
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
    if (basis === "part") return { basis: "entered" as const, confirmed: confirmed.has(k) };
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

// --- One part at a time (GEN-09) ---------------------------------------------------------------

export type Vec = { x: number; y: number; z: number };

/** A part action: the new draft (the overall size follows the parts) and what it did, in words. */
export interface PartAction {
  draft: GeometryDraft;
  line: string;
}

function amount(v: number): string {
  const m = Math.abs(v);
  return m < 0.01 ? `${formatFixed(m * 1000, 0)} mm` : m < 1 ? `${formatFixed(m * 100, 0)} cm` : `${formatFixed(m, 2)} m`;
}

function moveWords(d: Vec): string {
  return (["x", "y", "z"] as const)
    .filter((a) => Math.abs(d[a]) >= 0.0005)
    .map((a) => `${amount(d[a])} ${DIRECTION[a][d[a] > 0 ? 0 : 1]}`)
    .join(" and ");
}

/**
 * How one kept part changed, in words: measured against where it would be if it had only followed
 * the whole object (scaled with the overall size, and re-centred with the rest).
 */
function partWords(q: GeometryPart, p: GeometryPart, before: GeometryDraft, after: GeometryDraft, shift: Vec | null): string {
  const scale = (a: "x" | "y" | "z") => after.envelope_m[a] / before.envelope_m[a];
  const moved = { x: 0, y: 0, z: 0 };
  const grown = { x: 0, y: 0, z: 0 };
  for (const a of ["x", "y", "z"] as const) {
    moved[a] = p.center_m[a] - q.center_m[a] * scale(a) - (shift?.[a] ?? 0);
    grown[a] = p.size_m[a] - q.size_m[a] * scale(a);
  }
  const bits: string[] = [];
  const moves = moveWords(moved);
  if (moves) bits.push(`moved ${moves}`);
  const sizes = (["x", "y", "z"] as const).filter((a) => Math.abs(grown[a]) >= 0.0005).map((a) => `${amount(grown[a])} ${GROWTH[a][grown[a] > 0 ? 0 : 1]}`);
  if (sizes.length) bits.push(`became ${sizes.join(" and ")}`);
  if (q.axis !== p.axis || q.taper !== p.taper || q.narrow_end !== p.narrow_end) bits.push("changed its shape details");
  return bits.join("; ") || "adjusted slightly";
}

/** The move every kept, unchanged-size part shares, when most of them share one (else null). */
function commonShift(before: GeometryDraft, after: GeometryDraft): Vec | null {
  const old = new Map(before.parts.map((p) => [p.id, p]));
  const groups = new Map<string, Vec[]>();
  let kept = 0;
  for (const p of after.parts) {
    const q = old.get(p.id);
    if (!q || (["x", "y", "z"] as const).some((a) => Math.abs(p.size_m[a] - q.size_m[a]) >= 1e-4)) continue;
    kept += 1;
    const d = { x: p.center_m.x - q.center_m.x, y: p.center_m.y - q.center_m.y, z: p.center_m.z - q.center_m.z };
    const key = (["x", "y", "z"] as const).map((a) => Math.round(d[a] * 1e4)).join(",");
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }
  const best = [...groups.values()].sort((a, b) => b.length - a.length)[0];
  if (!best || best.length < 2 || best.length * 2 < kept) return null;
  const d = best[0]!;
  return (["x", "y", "z"] as const).some((a) => Math.abs(d[a]) >= 0.0005) ? d : null;
}

const DIRECTION = { x: ["to the right", "to the left"], y: ["up", "down"], z: ["forward", "back"] } as const;
const GROWTH = { x: ["wider", "narrower"], y: ["taller", "shorter"], z: ["deeper", "shallower"] } as const;

/**
 * Move one part so its centre is at ``center`` (metres, in the object's frame). Null for the only
 * part: moving it would only move the whole object, which is done in the scene.
 */
export function movePart(spec: GeometryDraft, id: string, center: Vec): PartAction | null {
  if (spec.parts.length < 2) return null;
  const part = spec.parts.find((p) => p.id === id)!;
  const moves = (["x", "y", "z"] as const)
    .map((a) => [a, center[a] - part.center_m[a]] as const)
    .filter(([, d]) => Math.abs(d) >= 0.0005)
    .map(([a, d]) => `${amount(d)} ${DIRECTION[a][d > 0 ? 0 : 1]}`);
  const parts = spec.parts.map((p) => (p.id === id ? { ...p, center_m: { x: micro(center.x), y: micro(center.y), z: micro(center.z) } } : p));
  return { draft: withParts(spec, parts), line: `Moved “${part.label}” ${moves.join(" and ") || "nowhere"}` };
}

/** Give one part a new size (metres), about its centre; the floor stays the floor. */
export function resizePart(spec: GeometryDraft, id: string, size: Vec): PartAction {
  const part = spec.parts.find((p) => p.id === id)!;
  const clamped = { x: Math.max(0.005, size.x), y: Math.max(0.005, size.y), z: Math.max(0.005, size.z) };
  const changes = (["x", "y", "z"] as const)
    .map((a) => [a, clamped[a] - part.size_m[a]] as const)
    .filter(([, d]) => Math.abs(d) >= 0.0005)
    .map(([a, d]) => `${amount(d)} ${GROWTH[a][d > 0 ? 0 : 1]}`);
  // Something standing on the floor keeps standing on it as it grows or shrinks.
  const onFloor = part.center_m.y - part.size_m.y / 2 <= 1e-4;
  const center = onFloor ? { ...part.center_m, y: clamped.y / 2 } : part.center_m;
  const parts = spec.parts.map((p) => (p.id === id ? { ...p, center_m: { x: micro(center.x), y: micro(center.y), z: micro(center.z) }, size_m: { x: micro(clamped.x), y: micro(clamped.y), z: micro(clamped.z) } } : p));
  return { draft: withParts(spec, parts), line: `Made “${part.label}” ${changes.join(" and ") || "the same size"}` };
}

/** Remove one part (never the last). */
export function removePart(spec: GeometryDraft, id: string): PartAction | null {
  if (spec.parts.length < 2) return null;
  const part = spec.parts.find((p) => p.id === id)!;
  return { draft: withParts(spec, spec.parts.filter((p) => p.id !== id)), line: `Removed “${part.label}”` };
}
