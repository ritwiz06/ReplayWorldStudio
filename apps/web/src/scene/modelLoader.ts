// Loads catalog glTF models without trusting the transport: the bytes must match the sha256
// recorded in the catalog, parse as binary glTF, and measure the bounds the catalog records.
// Any failure is reported with an actionable message; nothing else is drawn in its place.
import type { GltfVisual, SceneObject } from "@replay-world/contracts";
import { Box3, EdgesGeometry, Group, type Material, type Mesh, type Object3D, Vector2 } from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
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
  outlineTransparent(scene);
  separateCoincidentFaces(scene);
  return { ok: true, scene };
}

/**
 * Faces that two parts share (an armrest flush with the seat it overlaps) would flicker between
 * their colours. Each later material in the file is drawn a little in front, so the later part,
 * usually the detail on the body, wins every such face. Display only; the API's visibility
 * render breaks the same ties the same way.
 */
export function separateCoincidentFaces(scene: Object3D): void {
  let index = 0;
  scene.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh || mesh.name === "transparent-edges") return;
    const materials: Material[] = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of materials) {
      if (m.transparent) continue;
      m.polygonOffset = true;
      // Slope-scaled as well as constant: flush faces are often seen at a grazing angle.
      // Capped, so a later part cannot be pulled in front of a surface it is really behind.
      const step = Math.min(index, 8);
      m.polygonOffsetFactor = -1 * step;
      m.polygonOffsetUnits = -4 * step;
    }
    index += 1;
  });
}

/**
 * Edges for glass and clear plastic (GEN-09): a light core over a wider dark outline, a few pixels
 * wide whatever the zoom, so the outline reads on a light floor and on the dark preview alike
 * (GEN-06's 1-pixel mid-tone line was too faint on light surfaces). The API's visibility check
 * assumes the same colours (services/api/src/replay_world_api/assist/visibility.py).
 */
export const TRANSPARENT_EDGE = { outline: "#0e2f47", core: "#8fd0ff", outlinePx: 3.5, corePx: 1.6 } as const;

/**
 * Faces meeting at more than this angle get an edge line. Low enough for the bevel steps of a
 * rounded box (GEN-09: at 30 degrees the GEN-08 glass door, a rounded box, got no edges at all),
 * and above the 11.25-degree facets of a 32-sided cylinder, so round glass is not striped.
 */
const EDGE_ANGLE_DEG = 12;

/**
 * Make transparent surfaces recognisable without making them opaque: their sharp edges are drawn
 * as lines, and they no longer write depth, so what is behind them stays visible through them.
 * Display only: the verified file and its sha256 are unchanged (this runs after verification).
 */
export function outlineTransparent(scene: Object3D): void {
  const meshes: Mesh[] = [];
  scene.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh) return;
    const materials: Material[] = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (materials.some((m) => m.transparent)) meshes.push(mesh);
  });
  for (const mesh of meshes) {
    const materials: Material[] = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of materials) m.depthWrite = false;
    mesh.renderOrder = 1;
    const segments = new LineSegmentsGeometry().fromEdgesGeometry(new EdgesGeometry(mesh.geometry, EDGE_ANGLE_DEG));
    for (const [colour, width, order] of [
      [TRANSPARENT_EDGE.outline, TRANSPARENT_EDGE.outlinePx, 2],
      [TRANSPARENT_EDGE.core, TRANSPARENT_EDGE.corePx, 3],
    ] as const) {
      const material = new LineMaterial({ color: colour, linewidth: width, worldUnits: false });
      // Screen-space width needs the drawing size, which differs per canvas. The hook is on the
      // material, which every placed copy shares (a cloned object does not keep its own hook).
      const size = new Vector2();
      material.onBeforeRender = (renderer) => {
        renderer.getDrawingBufferSize(size);
        material.resolution.copy(size);
      };
      const edges = new LineSegments2(segments, material);
      edges.name = "transparent-edges";
      edges.renderOrder = order;
      mesh.add(edges);
    }
  }
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
