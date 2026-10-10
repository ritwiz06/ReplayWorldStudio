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

/** Per-axis factor that turns the model's metre extents into the instance's dimensions. */
export function fitScale(visual: GltfVisual, dimensions: Dimensions): Vec3Tuple {
  const [ex, ey, ez] = modelExtents(visual);
  return [dimensions.width.value_m / ex, dimensions.height.value_m / ey, dimensions.depth.value_m / ez];
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
