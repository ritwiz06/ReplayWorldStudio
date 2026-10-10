// Starting shapes for the object builder: small, plain part lists in the same bounded geometry
// specification the language model fills in. They let a user build an object without any
// language model, then adjust its size and parts.
import type { GeometryDraft, GeometryPart } from "@replay-world/contracts";
import { nonEmpty } from "./objectDraft";

type Shape = GeometryPart["shape"];
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
}

export const TEMPLATES: readonly Template[] = [
  {
    key: "box",
    name: "Box",
    category: "box",
    spec: spec([part("body", "body", "rounded_box", "paint_light_grey", [0, 0.4, 0], [1, 0.8, 0.8])]),
  },
  {
    key: "cabinet",
    name: "Cabinet",
    category: "cabinet",
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
    spec: spec([
      ...legs(1.8, 0.6, 2.0, 0.06, "paint_blue"),
      ...[0.15, 0.75, 1.35, 1.95].map((y, i) => part(`beam-${i + 1}`, "shelf", "box", "paint_orange", [0, y, 0], [1.8, 0.08, 0.6])),
    ]),
  },
];
