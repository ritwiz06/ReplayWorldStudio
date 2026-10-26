// A reference photo of one object (ENR-01): what the object looks like now, what a proposal
// starts from, and how the photo is kept with the world. Pure functions; the dialog in
// components/PhotoLook.tsx uses them. A reference photo places and measures nothing: the
// object's recorded size stays the envelope of any look made from it.
import type { CatalogAsset, GeometryDraft, GeometrySpec, ImageBox, Project, SceneObject, SourceDocument, StoredPhoto } from "@replay-world/contracts";

/** How the object is drawn now. */
export type CurrentLook =
  | { kind: "stand-in" }
  | { kind: "generated"; asset: CatalogAsset; spec: GeometrySpec }
  | { kind: "uploaded"; asset: CatalogAsset }
  | { kind: "catalog"; asset: CatalogAsset };

export function currentLook(project: Project, object: SceneObject): CurrentLook {
  const asset = project.catalog.find((a) => a.id === object.asset_id);
  if (!asset) return { kind: "stand-in" };
  if (asset.generation) return { kind: "generated", asset, spec: asset.generation.spec };
  return asset.upload ? { kind: "uploaded", asset } : { kind: "catalog", asset };
}

/** "its stand-in", "the attached file guarded-cell.glb", … */
export function lookName(look: CurrentLook): string {
  switch (look.kind) {
    case "stand-in":
      return "its stand-in (a plain block at its recorded size)";
    case "generated":
      return `the generated model “${look.asset.name}”`;
    case "uploaded":
      return `the attached file ${look.asset.upload!.filename}`;
    case "catalog":
      return `the catalog model “${look.asset.name}”`;
  }
}

/** The object's recorded size as an envelope (x width, y height, z depth). */
export const envelopeOf = (object: SceneObject) => ({ x: object.dimensions.width.value_m, y: object.dimensions.height.value_m, z: object.dimensions.depth.value_m });

/** One plain block filling the recorded size: what a look starts from when the object is not
 * drawn with a generated model (the same block the API starts from). */
export function blockSpec(object: SceneObject): GeometryDraft {
  const e = envelopeOf(object);
  return {
    format: "rws-geometry/1",
    envelope_m: e,
    parts: [{ id: "body", label: "body", shape: "box", material: "paint_light_grey", center_m: { x: 0, y: e.y / 2, z: 0 }, size_m: { ...e }, axis: null, taper: null, narrow_end: null, basis: "inferred" }],
  };
}

const sameSize = (a: GeometryDraft["envelope_m"], b: GeometryDraft["envelope_m"]) => (["x", "y", "z"] as const).every((k) => Math.abs(a[k] - b[k]) <= 0.001);

/** What a proposal starts from: the current generated model when it has the object's recorded
 * size, otherwise the recorded size as one block. */
export function startFrom(project: Project, object: SceneObject): { spec: GeometryDraft; basedOn: string | null } {
  const look = currentLook(project, object);
  if (look.kind === "generated" && sameSize(look.spec.envelope_m, envelopeOf(object))) return { spec: look.spec, basedOn: look.asset.id };
  return { spec: blockSpec(object), basedOn: null };
}

/** A crop as the person left it: fractions rounded to 0.01, at least 0.05 wide and high. */
export function roundCrop(box: ImageBox): ImageBox {
  const r = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;
  let [left, right] = [r(Math.min(box.left, box.right)), r(Math.max(box.left, box.right))];
  let [top, bottom] = [r(Math.min(box.top, box.bottom)), r(Math.max(box.top, box.bottom))];
  if (right - left < 0.05) [left, right] = left + 0.05 <= 1 ? [left, r(left + 0.05)] : [r(right - 0.05), right];
  if (bottom - top < 0.05) [top, bottom] = top + 0.05 <= 1 ? [top, r(top + 0.05)] : [r(bottom - 0.05), bottom];
  return { left, top, right, bottom };
}

export const isWhole = (box: ImageBox) => box.left === 0 && box.top === 0 && box.right === 1 && box.bottom === 1;

/** The reference photos kept for an object. */
export const referencesOf = (project: Project, objectId: string): SourceDocument[] =>
  project.sources.filter((s) => s.kind === "reference_photo" && s.reference?.object_ids.includes(objectId));

/** The reference photo source to keep: the same photo's existing source, now also showing this
 * object, or a new one. Never an IMG-01 room photo: no floor, scale or camera is derived. */
export function referenceSourceFor(project: Project, stored: StoredPhoto, objectId: string, note: string | null): SourceDocument {
  const existing = project.sources.find((s) => s.kind === "reference_photo" && s.sha256 === stored.sha256);
  if (existing) {
    const ids = existing.reference!.object_ids;
    return ids.includes(objectId) ? existing : { ...existing, reference: { ...existing.reference!, object_ids: [...ids, objectId] as typeof ids } };
  }
  const used = new Set(project.sources.map((s) => s.id));
  let id = `src-ref-${stored.sha256.slice(0, 12)}`;
  for (let n = 2; used.has(id); n++) id = `src-ref-${stored.sha256.slice(0, 12)}-${n}`;
  return {
    id,
    kind: "reference_photo",
    filename: stored.filename,
    sha256: stored.sha256,
    source_to_world: null,
    import_warnings: ["A reference photo of objects in this world: it places and measures nothing."],
    image: stored.image,
    photo_import: null,
    drawing: null,
    reference: { object_ids: [objectId], note },
  };
}
