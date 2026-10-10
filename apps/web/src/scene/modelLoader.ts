// Loads catalog glTF models without trusting the transport: the bytes must match the sha256
// recorded in the catalog, parse as binary glTF, and measure the bounds the catalog records.
// Any failure is reported with an actionable message; nothing else is drawn in its place.
import type { GltfVisual, SceneObject } from "@replay-world/contracts";
import { Box3, Group, type Mesh, type Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { renderScale } from "./fit";
import { placementOf } from "./placement";

export type ModelFailureKind =
  | "not_found"
  | "unsafe_path"
  | "http"
  | "network"
  | "hash_mismatch"
  | "invalid_gltf"
  | "bounds_mismatch";

export interface ModelFailure {
  kind: ModelFailureKind;
  message: string;
}

export type ModelResult = { ok: true; scene: Group } | { ok: false; failure: ModelFailure };

/** Largest allowed difference between measured and recorded model bounds. */
export const BOUNDS_TOLERANCE_M = 1e-3;

const REBUILD = "Rebuild with `pnpm assets:build` and `pnpm fixtures:build`, or restore the recorded file.";

function fail(kind: ModelFailureKind, message: string): ModelResult {
  return { ok: false, failure: { kind, message } };
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Verify and parse downloaded bytes against their catalog record. */
export async function parseCatalogModel(bytes: ArrayBuffer, visual: GltfVisual): Promise<ModelResult> {
  const digest = await sha256Hex(bytes);
  if (digest !== visual.sha256) {
    return fail(
      "hash_mismatch",
      `${visual.uri} does not match the sha256 recorded in the catalog (received ${digest.slice(0, 12)}…), so it was not displayed. ${REBUILD}`,
    );
  }
  let scene: Group;
  try {
    scene = (await new GLTFLoader().parseAsync(bytes, "")).scene;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return fail("invalid_gltf", `${visual.uri} is not a valid binary glTF file (${reason}). ${REBUILD}`);
  }

  const box = new Box3().setFromObject(scene);
  const unit = visual.metres_per_model_unit;
  const recorded = visual.model_bounds_m;
  const error = Math.max(
    ...(["x", "y", "z"] as const).flatMap((a) => [
      Math.abs(box.min[a] * unit - recorded.min[a]),
      Math.abs(box.max[a] * unit - recorded.max[a]),
    ]),
  );
  if (!(error <= BOUNDS_TOLERANCE_M)) {
    return fail(
      "bounds_mismatch",
      `${visual.uri} measures differently from its catalog record (up to ${(error * 1000).toFixed(1)} mm), so its fit to recorded dimensions cannot be trusted. ${REBUILD}`,
    );
  }

  scene.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mesh.castShadow = materials.every((m) => !m.transparent); // glazing should not cast solid shadows
    mesh.receiveShadow = true;
  });
  return { ok: true, scene };
}

/** Download a model from the API's catalog library and verify it. */
export async function loadCatalogModel(
  url: string,
  visual: GltfVisual,
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  signal?: AbortSignal,
): Promise<ModelResult> {
  let response: Response;
  try {
    response = await fetchImpl(url, { signal: signal ?? null });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    return fail("network", `Could not download ${visual.uri} from the API. Check that the API is running.`);
  }
  if (!response.ok) {
    let detail = "";
    try {
      const body: unknown = await response.json();
      if (typeof body === "object" && body !== null && "detail" in body && typeof body.detail === "string") {
        detail = body.detail;
      }
    } catch {
      // Not JSON; fall back to the generic message below.
    }
    if (response.status === 404) return fail("not_found", detail || `${visual.uri} is not in the catalog library. ${REBUILD}`);
    if (response.status === 400) return fail("unsafe_path", detail || `${visual.uri} is not an allowed catalog path.`);
    return fail("http", `The API returned HTTP ${response.status} for ${visual.uri}. ${detail}`.trim());
  }
  return parseCatalogModel(await response.arrayBuffer(), visual);
}

/**
 * Place a verified model at an instance: the clone shares geometry and materials with the
 * template, is scaled from file units to the instance's recorded dimensions, and sits at the
 * instance's bottom-centre with its rotation. Used by the viewport and by the tests.
 */
export function instanceModel(template: Object3D, visual: GltfVisual, object: SceneObject): Group {
  const placement = placementOf(object);
  const root = new Group();
  root.position.set(...placement.position);
  root.rotation.set(...placement.rotation);
  const model = template.clone(true);
  model.scale.set(...renderScale(visual, object.dimensions));
  root.add(model);
  root.updateMatrixWorld(true);
  return root;
}
