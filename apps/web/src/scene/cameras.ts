// Camera framing and plan-view maths, kept free of React so they can be tested directly.
import { type Box3, PerspectiveCamera, Vector3 } from "three";
import type { Vec3Tuple } from "./fit";

export interface CameraPose {
  position: Vec3Tuple;
  target: Vec3Tuple;
}

/** Default orbit direction: from the south-east, above the floor (world +X, +Y, +Z). */
export const ORBIT_DIRECTION: Vec3Tuple = [0.62, 0.55, 0.85];

function cornersOf(box: Box3): Vector3[] {
  const out: Vector3[] = [];
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y])
      for (const z of [box.min.z, box.max.z]) out.push(new Vector3(x, y, z));
  return out;
}

/**
 * Place a perspective camera along `direction` from the box centre, as close as possible while
 * every box corner stays within `margin` of the screen edge (in normalised device coordinates).
 * A bounding-sphere distance always fits, so it bounds a binary search for the tightest fit.
 */
export function frameBox(
  box: Box3,
  fovDeg: number,
  aspect: number,
  direction: Vec3Tuple = ORBIT_DIRECTION,
  margin = 0.9,
  minRadius = 1,
): CameraPose {
  const centre = box.getCenter(new Vector3());
  const radius = Math.max(box.getSize(new Vector3()).length() / 2, minRadius);
  const dir = new Vector3(...direction).normalize();
  const vFov = (fovDeg * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
  const camera = new PerspectiveCamera(fovDeg, aspect, 0.01, 1e5);
  const corners = cornersOf(box);
  const fits = (distance: number) => {
    camera.position.copy(centre).addScaledVector(dir, distance);
    camera.lookAt(centre);
    camera.updateMatrixWorld();
    return corners.every((corner) => {
      if (corner.clone().applyMatrix4(camera.matrixWorldInverse).z > -camera.near) return false;
      const ndc = corner.clone().project(camera);
      return Math.abs(ndc.x) <= margin && Math.abs(ndc.y) <= margin;
    });
  };
  let lo = minRadius;
  let hi = radius / Math.sin(Math.min(vFov, hFov) / 2) / margin;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  return { position: centre.clone().addScaledVector(dir, hi).toArray(), target: centre.toArray() };
}

export interface PlanView {
  /** Camera position directly above the box centre. */
  position: Vec3Tuple;
  /** Orthographic zoom in screen pixels per metre. */
  zoom: number;
}

/** Up vector for the plan view: drawing "up" (plan +Y) is world -Z, so -Z points up on screen
 * and world +X points right, matching the source plan convention. */
export const PLAN_UP: Vec3Tuple = [0, 0, -1];

/** Orthographic top view that fits the box's floor footprint inside the viewport. */
export function planView(box: Box3, widthPx: number, heightPx: number, marginPx = 56): PlanView {
  const size = box.getSize(new Vector3());
  const centre = box.getCenter(new Vector3());
  const zoom = Math.min(
    Math.max(widthPx - 2 * marginPx, 1) / Math.max(size.x, 0.1),
    Math.max(heightPx - 2 * marginPx, 1) / Math.max(size.z, 0.1),
  );
  return { position: [centre.x, box.max.y + 50, centre.z], zoom };
}

export interface ScaleBar {
  metres: number;
  pixels: number;
  label: string;
}

const NICE_LENGTHS = [0.5, 1, 2, 5, 10, 20, 50, 100];

/** The longest round-numbered scale bar that fits in `maxPx` (at least ~maxPx / 2.5 long). */
export function scaleBar(pixelsPerMetre: number, maxPx = 180): ScaleBar {
  const fitting = NICE_LENGTHS.filter((m) => m * pixelsPerMetre <= maxPx);
  const metres = fitting.at(-1) ?? NICE_LENGTHS[0]!;
  return { metres, pixels: metres * pixelsPerMetre, label: `${metres} m` };
}
