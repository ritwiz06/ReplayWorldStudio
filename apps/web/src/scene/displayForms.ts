// Simple, recognisable display forms for provisional objects that have no model (ONB-01): a
// rack, a table or bench, a conveyor. The form is chosen from the object's name only and drawn
// inside its recorded box; it is appearance, never evidence, and the object stays labelled
// "height assumed". Everything else stays a plain box.
import type { SceneObject } from "@replay-world/contracts";
import { heightAssumed } from "../evidence";

export type DisplayForm = "rack" | "table" | "conveyor" | "box";

const FORMS: readonly [RegExp, DisplayForm][] = [
  [/rack|shelv|shelf/i, "rack"],
  [/conveyor/i, "conveyor"],
  [/table|bench|desk/i, "table"],
];

/** The display form for an object: only a model-less piece of equipment whose height is
 * assumed gets one, and only when its name says what it is. */
export function displayForm(object: SceneObject): DisplayForm {
  if (object.asset_id !== null || object.kind !== "equipment" || !heightAssumed(object)) return "box";
  return FORMS.find(([pattern]) => pattern.test(object.name))?.[1] ?? "box";
}

/** One solid of a form, in the object's frame (metres; y up from the floor, x along width). */
export interface Part {
  centre: [number, number, number];
  size: [number, number, number];
}

const box = (x: number, y: number, z: number, sx: number, sy: number, sz: number): Part => ({ centre: [x, y, z], size: [sx, sy, sz] });

/** Positions spaced at most `step` apart from -half to +half, ends included. */
function spaced(half: number, step: number): number[] {
  const n = Math.max(1, Math.ceil((2 * half) / step));
  return Array.from({ length: n + 1 }, (_, i) => -half + (2 * half * i) / n);
}

/** The solids that draw `form` within a box of width w, height h and depth d. */
export function partsOf(form: Exclude<DisplayForm, "box">, w: number, h: number, d: number): Part[] {
  const alongX = w >= d;
  const long = alongX ? w : d;
  const short = alongX ? d : w;
  // Place a part given along/across the long axis.
  const at = (along: number, y: number, across: number, sAlong: number, sy: number, sAcross: number) =>
    alongX ? box(along, y, across, sAlong, sy, sAcross) : box(across, y, along, sAcross, sy, sAlong);
  const parts: Part[] = [];
  if (form === "rack") {
    const t = Math.min(0.08, short / 6, long / 6);
    for (const a of spaced(long / 2 - t / 2, 2.8)) for (const c of [-(short / 2 - t / 2), short / 2 - t / 2]) parts.push(at(a, h / 2, c, t, h, t));
    for (const level of [0.12, h / 3, (2 * h) / 3, h - 0.03].filter((y) => y > 0.03 && y < h)) parts.push(at(0, level, 0, long, Math.min(0.05, h / 20), short));
  } else if (form === "table") {
    const top = Math.min(0.05, h / 6);
    const leg = Math.min(0.06, short / 6);
    parts.push(at(0, h - top / 2, 0, long, top, short));
    for (const a of spaced(long / 2 - leg, 2.0)) for (const c of [-(short / 2 - leg), short / 2 - leg]) parts.push(at(a, (h - top) / 2, c, leg, h - top, leg));
  } else {
    const bed = Math.min(0.14, h / 3);
    const leg = Math.min(0.06, short / 6);
    parts.push(at(0, h - bed / 2, 0, long, bed, short * 0.8));
    for (const c of [-(short / 2 - 0.02), short / 2 - 0.02]) parts.push(at(0, h - bed * 0.7, c, long, bed * 1.4, 0.04));
    for (const a of spaced(long / 2 - leg, 1.5)) for (const c of [-(short * 0.35), short * 0.35]) parts.push(at(a, (h - bed) / 2, c, leg, h - bed, leg));
  }
  return parts;
}
