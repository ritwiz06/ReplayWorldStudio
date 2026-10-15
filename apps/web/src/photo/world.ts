// From a reviewed photo to an editable world (IMG-01). The review holds the user's decisions
// (which objects, their outlines, floor points, shapes, colours, typed sizes) and the floor
// rectangle of known size; this module turns them into placements with explicit evidence,
// the requests that build each object's provisional model, and finally the new project with
// its photo source. Nothing here talks to the API; nothing is applied until the user creates
// the world.
import {
  SCHEMA_VERSION,
  type CatalogAsset,
  type GeneratedAssetRequest,
  type GeometryPart,
  type ImageBox,
  type ImagePoint,
  type ImageProposal,
  type LanguageModelRef,
  type Length,
  type PhotoObservation,
  type Project,
  type ProposedPhotoObject,
  type ReviewedLength,
  type SceneObject,
  type StoredPhoto,
} from "@replay-world/contracts";
import { type PhotoTemplate, templateSpec } from "../assist/templates";
import { quantizeDegrees, quantizeMetres, radToDeg, degToRad, wrapDegrees } from "../editing/units";
import { type Calibration, floorPoint, placeObject } from "./floor";

export type Facing = ProposedPhotoObject["facing"];
type Material = GeometryPart["material"];

export interface ReviewItem {
  id: string;
  label: string;
  template: PhotoTemplate;
  material: Material;
  box: ImageBox;
  contact: ImagePoint | null;
  contactBasis: "box_bottom" | "model_point" | "user" | null;
  facing: Facing;
  sizeGuess: { x: number; y: number; z: number };
  foundBy: "model" | "user";
  decision: "accepted" | "rejected";
  onFloor: boolean;
  notes: string[];
  /** Values the user typed; they replace what the photo suggests. */
  entered: { width?: number; height?: number; depth?: number; yawDeg?: number };
}

export interface ScaleInput {
  corners: [ImagePoint, ImagePoint, ImagePoint, ImagePoint];
  feature: string;
  widthM: number | null;
  depthM: number | null;
  /** How the user knows the sizes they entered; null until they say (required to create). */
  sizeBasis: "measured" | "assumed" | null;
}

export function reviewItemsFrom(proposal: ImageProposal): ReviewItem[] {
  return proposal.objects.map((o) => ({
    id: o.id,
    label: o.label,
    template: o.template,
    material: o.material,
    box: { ...o.box },
    contact: o.floor_contact ? { ...o.floor_contact } : null,
    contactBasis: o.contact_basis,
    facing: o.facing,
    sizeGuess: { ...o.size_guess_m },
    foundBy: "model",
    decision: o.suggest_accept ? "accepted" : "rejected",
    onFloor: o.on_floor,
    notes: [...o.notes],
    entered: {},
  }));
}

/** An object the user outlined themselves (missed by the model, or without the model). */
export function userItem(items: readonly ReviewItem[], box: ImageBox): ReviewItem {
  const used = new Set(items.map((i) => i.id));
  let n = items.length + 1;
  while (used.has(`obs-${n}`)) n++;
  return {
    id: `obs-${n}`,
    label: "object",
    template: "box",
    material: "paint_light_grey",
    box,
    contact: { u: (box.left + box.right) / 2, v: box.bottom },
    contactBasis: "user",
    facing: "toward_camera",
    sizeGuess: { x: 1, y: 1, z: 1 },
    foundBy: "user",
    decision: "accepted",
    onFloor: true,
    notes: ["Marked by you."],
    entered: {},
  };
}

export type DimensionSource = "photo" | "hidden" | "entered";

export interface PlacedItem {
  item: ReviewItem;
  x: number;
  z: number;
  yawRad: number;
  width: number;
  height: number;
  depth: number;
  source: { width: DimensionSource; height: DimensionSource; depth: DimensionSource; yaw: "photo" | "entered" };
  notes: string[];
}

const mm = (v: number) => quantizeMetres(v, 1);
const clampLength = (v: number) => Math.min(Math.max(v, 0.02), 30);

/** Where each accepted object goes, with the photo's values or the user's typed ones. */
export function placeItems(cal: Calibration, items: readonly ReviewItem[]): Map<string, PlacedItem | { problem: string }> {
  const result = new Map<string, PlacedItem | { problem: string }>();
  for (const item of items) {
    if (item.decision !== "accepted") continue;
    if (!item.contact) {
      result.set(item.id, { problem: "Mark where it meets the floor (drag its floor point onto the photo)." });
      continue;
    }
    const placement = placeObject(cal, { box: item.box, contact: item.contact, facing: item.facing, sizeGuessM: item.sizeGuess });
    if (!placement) {
      result.set(item.id, { problem: "Its floor point is above the horizon or outside the floor: move it onto the floor." });
      continue;
    }
    const visibleIsWidth = placement.visibleExtent === "width";
    const e = item.entered;
    const yawDeg = e.yawDeg ?? wrapDegrees(quantizeDegrees(radToDeg(placement.yawRad), 0.1));
    result.set(item.id, {
      item,
      x: mm(placement.x),
      z: mm(placement.z),
      yawRad: degToRad(yawDeg),
      width: mm(clampLength(e.width ?? placement.widthM)),
      height: mm(clampLength(e.height ?? placement.heightM)),
      depth: mm(clampLength(e.depth ?? placement.depthM)),
      source: {
        width: e.width !== undefined ? "entered" : visibleIsWidth ? "photo" : "hidden",
        height: e.height !== undefined ? "entered" : "photo",
        depth: e.depth !== undefined ? "entered" : visibleIsWidth ? "hidden" : "photo",
        yaw: e.yawDeg !== undefined ? "entered" : "photo",
      },
      notes: placement.notes,
    });
  }
  return result;
}

export const isPlaced = (p: PlacedItem | { problem: string } | undefined): p is PlacedItem => p !== undefined && "item" in p;

function titleCase(label: string): string {
  const text = label.trim() || "Object";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

interface Context {
  filename: string;
  feature: string;
  visionModel: LanguageModelRef | null;
}

function reviewed(source: DimensionSource, ref: string): ReviewedLength {
  return source === "entered"
    ? { basis: "entered", quote: null, confirmed: true, source_ref: null }
    : { basis: "photo", quote: null, confirmed: false, source_ref: ref.slice(0, 500) };
}

/** The request that builds one object's provisional model and its evidence. */
export function assetRequest(placed: PlacedItem, ctx: Context): GeneratedAssetRequest {
  const { item } = placed;
  const where = `From photo ${ctx.filename} (${item.id})`;
  const visible = `${where}: the visible ${placed.source.width === "photo" ? "front" : "side"} projected onto the floor with the ${ctx.feature} as scale reference (approximate)`;
  const hidden = `${where}: hidden in the photo; estimated from the typical proportions of a ${item.label} (approximate)`;
  const height = `${where}: estimated from the photo with the reconstructed camera (approximate)`;
  const spec = templateSpec(item.template, item.material);
  return {
    name: titleCase(item.label).slice(0, 80),
    kind: "equipment",
    method: "photo",
    description: `${item.label} seen in ${ctx.filename}`.slice(0, 500),
    language_model: item.foundBy === "model" ? ctx.visionModel : null,
    spec: { ...spec, envelope_m: { x: placed.width, y: placed.height, z: placed.depth } },
    dimensions: {
      width: reviewed(placed.source.width, placed.source.width === "photo" ? visible : hidden),
      height: reviewed(placed.source.height, height),
      depth: reviewed(placed.source.depth, placed.source.depth === "photo" ? visible : hidden),
    },
    stated_facts: [],
    inferred_facts: [
      `Seen in the photo as "${item.label}"`,
      `Drawn with the ${item.template} shape family`,
      ...placed.notes,
    ].slice(0, 12),
    not_modelled: [],
  };
}

const length = (value: number, origin: Length["origin"], ref: string, confirmed: boolean): Length => ({
  value_m: mm(value),
  origin,
  source_ref: ref.slice(0, 500),
  review_status: confirmed ? "confirmed" : "unreviewed",
  uncertainty_m: null,
});

/** Evidence text for a scale side the user gave: measured, or an assumption, said plainly. */
function givenRef(scale: ScaleInput, side: "width" | "depth"): string {
  return scale.sizeBasis === "measured"
    ? `Measured by the user: the ${scale.feature}'s ${side}`
    : `Assumed by the user: a typical ${side} for the ${scale.feature}, not measured`;
}

const yawOnly = (yaw: number) => ({ order: "XYZ" as const, x: 0, y: yaw, z: 0 });

function uniqueName(names: Set<string>, name: string): string {
  if (!names.has(name)) return name;
  for (let n = 2; ; n++) if (!names.has(`${name} (${n})`)) return `${name} (${n})`;
}

export interface WorldInput {
  stored: StoredPhoto;
  scale: ScaleInput & { widthM: number };
  calibration: Calibration;
  items: readonly ReviewItem[];
  placed: Map<string, PlacedItem | { problem: string }>;
  /** Built asset per accepted, placed item id. */
  assets: Map<string, CatalogAsset>;
  visionModel: LanguageModelRef | null;
  visibleText: readonly string[];
}

/** The complete new project: floor, scale reference, objects, and the photo source. */
export function buildPhotoProject(input: WorldInput): Project {
  const { stored, scale, calibration: cal } = input;
  const tag = stored.sha256.slice(0, 8);
  const sourceId = `src-photo-${tag}`;
  const objects: SceneObject[] = [];
  const names = new Set<string>();
  const linked = new Map<string, string>();

  // Footprint extent of everything placed, to size the floor.
  const xs: number[] = [];
  const zs: number[] = [];
  const corners = scale.corners.map((c) => floorPoint(cal, c));
  for (const c of corners) {
    if (!c) continue;
    xs.push(c.x);
    zs.push(c.z);
  }

  let n = 0;
  for (const item of input.items) {
    const placed = input.placed.get(item.id);
    const asset = input.assets.get(item.id);
    if (!isPlaced(placed) || !asset) continue;
    n++;
    const id = `obj-photo-${n}-${item.template}`;
    const name = uniqueName(names, asset.name);
    names.add(name);
    linked.set(item.id, id);
    const reach = Math.hypot(placed.width, placed.depth) / 2;
    xs.push(placed.x - reach, placed.x + reach);
    zs.push(placed.z - reach, placed.z + reach);
    objects.push({
      id,
      name,
      kind: "equipment",
      asset_id: asset.id,
      transform: { position_m: { x: placed.x, y: 0, z: placed.z }, rotation_rad: yawOnly(placed.yawRad) },
      dimensions: structuredClone(asset.nominal_dimensions),
      parameters: [],
    });
  }

  const margin = 1.0;
  const minX = Math.min(...xs) - margin;
  const maxX = Math.max(...xs) + margin;
  const minZ = Math.min(...zs) - margin;
  const maxZ = Math.max(...zs) + margin;
  const floorRef = "Extent of the objects placed from the photo plus 1 m; not the real room size";
  const floor: SceneObject = {
    id: "obj-floor",
    name: "Floor (around the photo's objects)",
    kind: "structure",
    asset_id: null,
    transform: { position_m: { x: mm((minX + maxX) / 2), y: -0.1, z: mm((minZ + maxZ) / 2) }, rotation_rad: yawOnly(0) },
    dimensions: {
      width: length(maxX - minX, "default", floorRef, false),
      height: length(0.1, "default", "Nominal slab thickness for display", false),
      depth: length(maxZ - minZ, "default", floorRef, false),
    },
    parameters: [],
  };
  // The scale rectangle, drawn on the floor where the photo puts it. Its given sides are the
  // user's: measured (confirmed) or an assumed typical size (unreviewed), never more than that.
  const [c0, c1] = corners;
  const yaw = c0 && c1 ? Math.atan2(-(c1.z - c0.z), c1.x - c0.x) : 0;
  const depthGiven = scale.depthM !== null;
  const measured = scale.sizeBasis === "measured";
  const reference: SceneObject = {
    id: "obj-scale-reference",
    name: `Scale reference: ${scale.feature}`.slice(0, 500),
    kind: "reference",
    asset_id: null,
    transform: { position_m: { x: 0, y: 0, z: 0 }, rotation_rad: yawOnly(mm(yaw)) },
    dimensions: {
      width: length(cal.widthM, "user_supplied", givenRef(scale, "width"), measured),
      height: length(0.005, "default", "Drawn as a thin marking on the floor", false),
      depth: depthGiven
        ? length(cal.depthM, "user_supplied", givenRef(scale, "depth"), measured)
        : length(cal.depthM, "inferred", `Derived from the photo's perspective (approximate)`, false),
    },
    parameters: [],
  };

  const observations: PhotoObservation[] = input.items.map((item) => {
    const objectId = linked.get(item.id) ?? null;
    return {
      id: item.id,
      label: item.label.slice(0, 80) || "object",
      box: { ...item.box },
      floor_contact: item.contact ? { ...item.contact } : null,
      contact_basis: item.contact ? item.contactBasis : null,
      found_by: item.foundBy,
      decision: objectId ? "accepted" : "rejected",
      object_id: objectId,
      notes: item.notes.slice(0, 12),
    };
  });

  const catalog = [...new Map([...input.assets.values()].map((a) => [a.id, a])).values()];
  return {
    schema_version: SCHEMA_VERSION,
    id: `proj-photo-${tag}`,
    name: `Room from ${input.stored.filename}`.slice(0, 500),
    units: { length: "m", time: "s", mass: "kg", angle: "rad" },
    world_frame: { handedness: "right", up_axis: "+Y", floor_plane: "XZ" },
    fixture: null,
    sources: [
      {
        id: sourceId,
        kind: "photo",
        filename: input.stored.filename,
        sha256: stored.sha256,
        source_to_world: null,
        import_warnings: cal.warnings.slice(0, 20),
        image: stored.image,
        photo_import: {
          vision_model: input.visionModel,
          calibration: {
            reference: {
              feature: scale.feature,
              corners: [{ ...scale.corners[0] }, { ...scale.corners[1] }, { ...scale.corners[2] }, { ...scale.corners[3] }],
              width: reference.dimensions.width,
              depth: reference.dimensions.depth,
              size_basis: scale.sizeBasis ?? "not_stated",
            },
            image_to_floor: [...cal.imageToFloor],
            camera: { vertical_fov_deg: cal.verticalFovDeg, fov_basis: cal.fovBasis, position_m: { ...cal.camera } },
            notes: cal.warnings.slice(0, 20),
          },
          observations,
          visible_text: input.visibleText.filter((t) => t.trim()).slice(0, 20),
        },
      },
    ],
    catalog,
    scene: { id: `scene-photo-${tag}`, name: `Room from ${input.stored.filename}`.slice(0, 500), revision: 0, objects: [floor, reference, ...objects], edit_log: [] },
  };
}
