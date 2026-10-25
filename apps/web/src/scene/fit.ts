// How a glTF model relates to an instance's recorded physical dimensions (contract 0.3.0):
// the model is authored with its bounding-box bottom-centre at the origin, so scaling it about
// the origin keeps it standing on the floor and centred on the instance's footprint. The
// per-axis scale makes the drawn bounds equal the recorded dimensions; it never changes them.
import type { Dimensions, GltfVisual } from "@replay-world/contracts";

export type Vec3Tuple = [x: number, y: number, z: number];

/** Model extents in metres (width X, height Y, depth Z), from the catalog record. */
export function modelExtents(visual: GltfVisual): Vec3Tuple {
  const { min, max } = visual.model_bounds_m;
  return [max.x - min.x, max.y - min.y, max.z - min.z];
}

/** Per-axis factor that turns the model's metre extents into the instance's dimensions. With
 * the "contain" fit (0.15.0) one factor for every axis: the largest that keeps the model inside
 * the recorded envelope, so its proportions are kept and the unused space stays visible. */
export function fitScale(visual: GltfVisual, dimensions: Dimensions): Vec3Tuple {
  const [ex, ey, ez] = modelExtents(visual);
  const per: Vec3Tuple = [dimensions.width.value_m / ex, dimensions.height.value_m / ey, dimensions.depth.value_m / ez];
  if (visual.fit !== "contain") return per;
  const s = Math.min(...per);
  return [s, s, s];
}

/** How much of the recorded envelope a model fills on each axis (1 = all of it). */
export function envelopeFill(visual: GltfVisual, dimensions: Dimensions): Vec3Tuple {
  const [ex, ey, ez] = modelExtents(visual);
  const [sx, sy, sz] = fitScale(visual, dimensions);
  return [(ex * sx) / dimensions.width.value_m, (ey * sy) / dimensions.height.value_m, (ez * sz) / dimensions.depth.value_m];
}

type Up = NonNullable<GltfVisual["correction"]>["up_axis"];

/** A file point in the corrected frame (0.15.0): the file's up axis turned to +Y, then quarter
 * turns clockwise seen from above. The same map as the contract's `corrected_point`. */
export function correctedPoint(up: Up, turns: number, [x, y, z]: Vec3Tuple): Vec3Tuple {
  let p: Vec3Tuple = { "+Y": [x, y, z], "-Y": [x, -y, -z], "+Z": [x, z, -y], "-Z": [x, -z, y], "+X": [-y, x, z], "-X": [y, -x, z] }[up] as Vec3Tuple;
  for (let i = 0; i < ((turns % 4) + 4) % 4; i++) p = [-p[2], p[1], p[0]];
  return p;
}

/** Scale applied to the loaded scene: file units → metres, then the fit. */
export function renderScale(visual: GltfVisual, dimensions: Dimensions): Vec3Tuple {
  const unit = visual.metres_per_model_unit;
  const [sx, sy, sz] = fitScale(visual, dimensions);
  return [sx * unit, sy * unit, sz * unit];
}

/** Largest departure of any per-axis fit factor from 1 (0.1 = 10 % stretch or squash). */
export function fitDistortion(visual: GltfVisual, dimensions: Dimensions): number {
  return Math.max(...fitScale(visual, dimensions).map((s) => Math.abs(s - 1)));
}

/** True when the drawn model no longer represents its proportions faithfully. */
export function isStretched(visual: GltfVisual, dimensions: Dimensions): boolean {
  return fitDistortion(visual, dimensions) > visual.max_fit_distortion + 1e-9;
}
