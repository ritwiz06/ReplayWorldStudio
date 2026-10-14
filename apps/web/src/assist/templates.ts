// Starting shapes for the object builder: small, plain part lists in the same bounded geometry
// specification the language model fills in. They let a user build an object without any
// language model, then adjust its size and parts.
import type { GeometryDraft, GeometryPart, ProposedPhotoObject } from "@replay-world/contracts";
import { nonEmpty } from "./objectDraft";

type Shape = GeometryPart["shape"];
export type PhotoTemplate = ProposedPhotoObject["template"];
type Material = GeometryPart["material"];
type V = [number, number, number];

function part(id: string, label: string, shape: Shape, material: Material, center: V, size: V, extra: Partial<GeometryPart> = {}): GeometryPart {
  return {
    id,
    label,
    shape,
    material,
    center_m: { x: center[0], y: center[1], z: center[2] },
    size_m: { x: size[0], y: size[1], z: size[2] },
    axis: null,
    taper: null,
    narrow_end: null,
    basis: "entered",
    ...extra,
  };
}

/** The envelope is the union of the parts (each template is authored centred on the floor). */
function spec(parts: GeometryPart[]): GeometryDraft {
  const extent = (a: "x" | "y" | "z") =>
    Math.max(...parts.map((p) => p.center_m[a] + p.size_m[a] / 2)) - Math.min(...parts.map((p) => p.center_m[a] - p.size_m[a] / 2));
  const round = (v: number) => Math.round(v * 1e6) / 1e6;
  return { format: "rws-geometry/1", envelope_m: { x: round(extent("x")), y: round(extent("y")), z: round(extent("z")) }, parts: nonEmpty(parts) };
}

const legs = (w: number, d: number, h: number, t: number, material: Material): GeometryPart[] =>
  ([[-1, -1], [1, -1], [-1, 1], [1, 1]] as const).map(([sx, sz], i) =>
    part(`leg-${i + 1}`, "leg", "box", material, [(sx * (w - t)) / 2, h / 2, (sz * (d - t)) / 2], [t, h, t]),
  );

/** Example descriptions offered in the describe step (and used by the tests). */
export const EXAMPLE_DESCRIPTIONS = [
  "a guarded conveyor about 2.2 m long with a control screen",
  "a cylindrical water tank 1.5 m tall with a cone-shaped bottom on four legs",
  "a workbench 1.8 m wide with a monitor and a drawer unit",
] as const;

export interface Template {
  key: string;
  name: string;
  category: string;
  spec: GeometryDraft;
  /** The main surface: a photo's colour replaces this material (other parts keep theirs). */
  primary: Material;
}

export const TEMPLATES: readonly Template[] = [
  {
    key: "box",
    name: "Box",
    category: "box",
    primary: "paint_light_grey",
    spec: spec([part("body", "body", "rounded_box", "paint_light_grey", [0, 0.4, 0], [1, 0.8, 0.8])]),
  },
  {
    key: "cabinet",
    name: "Cabinet",
    category: "cabinet",
    primary: "paint_light_grey",
    spec: spec([
      part("plinth", "plinth", "box", "paint_anthracite", [0, 0.05, 0], [0.6, 0.1, 0.4]),
      part("body", "cabinet body", "rounded_box", "paint_light_grey", [0, 1.0, -0.01], [0.6, 1.8, 0.38]),
      part("door", "door", "rounded_box", "paint_light_grey", [0, 1.0, 0.19], [0.56, 1.72, 0.02]),
      part("handle", "handle", "box", "steel_dark", [0.22, 1.0, 0.2075], [0.03, 0.16, 0.015]),
    ]),
  },
  {
    key: "table",
    name: "Workbench",
    category: "workbench",
    primary: "wood",
    spec: spec([
      part("top", "worktop", "box", "wood", [0, 0.88, 0], [1.5, 0.04, 0.75]),
      ...legs(1.5, 0.75, 0.86, 0.05, "steel_dark"),
      part("shelf", "lower shelf", "box", "steel_dark", [0, 0.2, 0], [1.4, 0.02, 0.65]),
    ]),
  },
  {
    key: "tank",
    name: "Tank",
    category: "tank",
    primary: "stainless_steel",
    spec: spec([
      part("shell", "tank shell", "cylinder", "stainless_steel", [0, 1.1, 0], [1.2, 1.4, 1.2], { axis: "y" }),
      part("cone", "conical bottom", "frustum", "stainless_steel", [0, 0.25, 0], [1.2, 0.3, 1.2], { taper: 0.2, narrow_end: "bottom" }),
      part("lid", "lid", "cylinder", "stainless_steel", [0, 1.83, 0], [1.24, 0.06, 1.24], { axis: "y" }),
      ...legs(1.2, 1.2, 0.4, 0.06, "steel_dark").map((p) => ({ ...p, size_m: { ...p.size_m, y: 0.9 }, center_m: { ...p.center_m, y: 0.45 } })),
    ]),
  },
  {
    key: "conveyor",
    name: "Conveyor",
    category: "conveyor",
    primary: "aluminium",
    spec: spec([
      part("belt", "belt", "box", "rubber_black", [0, 0.86, 0], [2, 0.02, 0.6]),
      part("frame-l", "side frame", "box", "aluminium", [0, 0.8, -0.33], [2, 0.12, 0.05]),
      part("frame-r", "side frame", "box", "aluminium", [0, 0.8, 0.33], [2, 0.12, 0.05]),
      part("drum-a", "end drum", "cylinder", "aluminium", [-0.95, 0.81, 0], [0.1, 0.1, 0.62], { axis: "z" }),
      part("drum-b", "end drum", "cylinder", "aluminium", [0.95, 0.81, 0], [0.1, 0.1, 0.62], { axis: "z" }),
      ...legs(1.9, 0.6, 0.74, 0.045, "steel_dark"),
    ]),
  },
  {
    key: "rack",
    name: "Shelving rack",
    category: "rack",
    primary: "paint_orange",
    spec: spec([
      ...legs(1.8, 0.6, 2.0, 0.06, "paint_blue"),
      ...[0.15, 0.75, 1.35, 1.95].map((y, i) => part(`beam-${i + 1}`, "shelf", "box", "paint_orange", [0, y, 0], [1.8, 0.08, 0.6])),
    ]),
  },
  {
    key: "chair",
    name: "Chair",
    category: "chair",
    primary: "fabric_grey",
    spec: spec([
      part("seat", "seat", "rounded_box", "fabric_grey", [0, 0.45, 0.02], [0.5, 0.07, 0.48]),
      part("back", "backrest", "rounded_box", "fabric_grey", [0, 0.72, -0.21], [0.5, 0.46, 0.06]),
      ...legs(0.46, 0.46, 0.42, 0.035, "steel_dark").map((p) => ({ ...p, center_m: { ...p.center_m, z: p.center_m.z + 0.02 } })),
    ]),
  },
  {
    key: "sofa",
    name: "Sofa",
    category: "sofa",
    primary: "fabric_grey",
    spec: spec([
      part("base", "seat base", "rounded_box", "fabric_grey", [0, 0.26, 0.04], [1.9, 0.36, 0.78]),
      part("back", "backrest", "rounded_box", "fabric_grey", [0, 0.6, -0.3], [1.9, 0.48, 0.24]),
      part("arm-l", "armrest", "rounded_box", "fabric_grey", [-0.86, 0.4, 0.04], [0.18, 0.6, 0.78]),
      part("arm-r", "armrest", "rounded_box", "fabric_grey", [0.86, 0.4, 0.04], [0.18, 0.6, 0.78]),
      ...legs(1.8, 0.8, 0.08, 0.05, "steel_dark"),
    ]),
  },
  {
    key: "plant",
    name: "Potted plant",
    category: "plant",
    primary: "plastic_grey",
    spec: spec([
      part("pot", "pot", "frustum", "plastic_grey", [0, 0.2, 0], [0.4, 0.4, 0.4], { taper: 0.75, narrow_end: "bottom" }),
      part("leaves", "foliage", "sphere", "paint_green", [0, 0.75, 0], [0.6, 0.7, 0.6]),
    ]),
  },
  {
    key: "screen",
    name: "Screen on a stand",
    category: "screen",
    primary: "plastic_black",
    spec: spec([
      part("base", "stand base", "box", "plastic_black", [0, 0.025, 0], [0.6, 0.05, 0.4]),
      part("pole", "stand", "cylinder", "aluminium", [0, 0.55, -0.05], [0.06, 1.0, 0.06], { axis: "y" }),
      part("frame", "screen frame", "rounded_box", "plastic_black", [0, 1.1, 0], [1.1, 0.66, 0.07]),
      part("face", "screen", "box", "hmi_screen", [0, 1.1, 0.036], [1.02, 0.58, 0.004]),
    ]),
  },
  {
    key: "machine",
    name: "Machine",
    category: "machine",
    primary: "paint_light_grey",
    spec: spec([
      part("plinth", "plinth", "box", "paint_anthracite", [0, 0.05, 0], [1.4, 0.1, 0.9]),
      part("body", "machine body", "rounded_box", "paint_light_grey", [0, 0.75, 0], [1.4, 1.3, 0.9]),
      part("panel", "control panel", "box", "hmi_screen", [0.45, 1.0, 0.452], [0.3, 0.2, 0.004]),
      part("light", "stack light", "cylinder", "signal_green", [-0.6, 1.5, -0.3], [0.07, 0.2, 0.07], { axis: "y" }),
    ]),
  },
  {
    key: "pallet",
    name: "Pallet with cartons",
    category: "pallet",
    primary: "cardboard",
    spec: spec([
      part("pallet", "pallet", "box", "pallet_wood", [0, 0.072, 0], [1.2, 0.144, 0.8]),
      part("load", "cartons", "rounded_box", "cardboard", [0, 0.144 + 0.43, 0], [1.16, 0.86, 0.76]),
    ]),
  },
];

/** The builder template that draws each shape family a photo object can have. */
export const PHOTO_TEMPLATE_KEY: Record<PhotoTemplate, string> = {
  box: "box",
  cabinet: "cabinet",
  table: "table",
  chair: "chair",
  shelf: "rack",
  sofa: "sofa",
  tank: "tank",
  conveyor: "conveyor",
  machine: "machine",
  screen: "screen",
  plant: "plant",
  pallet: "pallet",
};

/** A template's specification with its main surface in `material` (a photo's colour). */
export function templateSpec(key: PhotoTemplate, material: GeometryPart["material"] | null): GeometryDraft {
  const template = TEMPLATES.find((t) => t.key === PHOTO_TEMPLATE_KEY[key]) ?? TEMPLATES[0]!;
  if (!material) return structuredClone(template.spec);
  const parts = template.spec.parts.map((p) => (p.material === template.primary ? { ...p, material } : p));
  return { ...template.spec, parts: nonEmpty(parts) };
}
