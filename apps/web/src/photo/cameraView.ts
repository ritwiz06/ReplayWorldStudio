// The viewpoint of the camera that took a source photo, reconstructed by the photo import, so the
// 3D scene can be compared with the photo from the same place and with the same lens.
import type { PhotoCalibration } from "@replay-world/contracts";
import type { FixedView } from "../scene/CameraRig";

/** Furthest the photo view looks along the floor; beyond it the target is pulled in. */
const MAX_TARGET_M = 30;

/**
 * The reconstructed camera that took the photo: its position, the floor point at the centre of
 * the photo as the target (or a level view the same way when the centre is above the horizon),
 * and its lens. Null when the calibration cannot give a direction.
 */
export function photoCameraView(calibration: PhotoCalibration): FixedView | null {
  const h = calibration.image_to_floor;
  const c = calibration.camera.position_m;
  const floorAt = (u: number, v: number) => {
    const x = h[0]! * u + h[1]! * v + h[2]!;
    const z = h[3]! * u + h[4]! * v + h[5]!;
    const w = h[6]! * u + h[7]! * v + h[8]!;
    return w > 0 ? { x: x / w, z: z / w } : null;
  };
  const position: FixedView["position"] = [c.x, c.y, c.z];
  const centre = floorAt(0.5, 0.5);
  if (centre) {
    const d = Math.hypot(centre.x - c.x, c.y, centre.z - c.z);
    const k = Math.min(1, MAX_TARGET_M / d);
    return { position, target: [c.x + (centre.x - c.x) * k, c.y - c.y * k, c.z + (centre.z - c.z) * k], fovDeg: calibration.camera.vertical_fov_deg };
  }
  const low = floorAt(0.5, 0.95);
  if (!low) return null;
  const len = Math.hypot(low.x - c.x, low.z - c.z);
  if (!(len > 1e-6)) return null;
  return { position, target: [c.x + ((low.x - c.x) / len) * 10, c.y, c.z + ((low.z - c.z) / len) * 10], fovDeg: calibration.camera.vertical_fov_deg };
}
