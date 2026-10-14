/**
 * Metric floor geometry from one photo and one marked floor rectangle (IMG-01).
 *
 * The user marks the four corners of a rectangle lying on the floor (a rug, a tile, a mat) and
 * types at least one of its side lengths. From that we recover:
 *
 *  - the lens (focal length) when the rectangle's perspective reveals it, otherwise an assumed
 *    field of view;
 *  - the camera's position and orientation relative to the floor, hence its height;
 *  - an image -> floor homography, and a full 3D projection for drawing objects back onto the photo;
 *  - placements (position, yaw, size) for objects the vision model found in the photo.
 *
 * Camera model: a pinhole with the principal point at the image centre, square pixels and no lens
 * distortion. Internally image positions are "centred pixels": x = u*W - W/2, y = v*H - H/2 (y down),
 * and the camera frame is the usual computer-vision one (x right, y down, z forward), so a camera
 * point (X, Y, Z) appears at x = f*X/Z, y = f*Y/Z.
 *
 * Inputs and outputs use normalised image positions: u = fraction of the width from the left, v =
 * fraction of the height from the top.
 *
 * Scene frame (all outputs): metres, right-handed, Y up, floor at y = 0, origin at the centre of the
 * marked rectangle. +X is the camera's right projected onto the floor; the camera stands on the +Z
 * side looking towards -Z. The frame is built from the recovered camera, not from the order in which
 * the corners were clicked, so clockwise and anticlockwise markings give the same (never mirrored)
 * world.
 *
 * Limits worth telling users:
 *  - Accuracy is bounded by how precisely the corners are marked. Larger rectangles, viewed
 *    obliquely (not square-on), give much better results.
 *  - When one side of the rectangle is almost parallel to the photo, its perspective cannot reveal
 *    the lens; a typical field of view is assumed and absolute distances scale with that guess.
 *  - Lens distortion (wide-angle phones) and cropped photos (principal point off-centre) are not
 *    modelled.
 *  - Objects are boxes standing on the floor; anything hidden (the depth of an object seen from the
 *    front) comes from typical proportions, not from the photo.
 */

// ---------------------------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------------------------

export interface ImagePoint {
  u: number;
  v: number;
}

export interface ImageBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** A 3x3 matrix in row-major order. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export interface RectangleInput {
  /** Four corners in order around the rectangle; corner0->1 is the width, corner1->2 the depth. */
  corners: readonly ImagePoint[];
  /** The side the user measured (corner0->1), metres, > 0. */
  widthM: number;
  /** The other side (corner1->2), or null when unknown: it is then derived from perspective. */
  depthM: number | null;
  imageWidthPx: number;
  imageHeightPx: number;
  /** Used only when neither the rectangle's shape nor its two given sides determine the lens. Default 60. */
  assumedVerticalFovDeg?: number;
}

export type FovBasis = "from_rectangle" | "from_sides" | "assumed";

export interface Calibration {
  /**
   * Normalised (u, v, 1) -> scene floor (x, z, w). Scaled so that w = 1 / (the point's depth along
   * the optical axis in metres): w <= 0 means on or above the horizon.
   */
  imageToFloor: Mat3;
  /** Scene floor (x, z, 1) -> normalised (u, v, w); w is the depth along the optical axis (metres). */
  floorToImage: Mat3;
  widthM: number;
  depthM: number;
  depthDerived: boolean;
  verticalFovDeg: number;
  fovBasis: FovBasis;
  /** Camera centre in scene metres; y is its height above the floor. */
  camera: { x: number; y: number; z: number };
  /**
   * Only when both sides are given AND the lens came from the rectangle:
   * (given depth / width) / (perspective depth / width). 1 = consistent.
   */
  consistency: number | null;
  /** Largest distance (pixels) between a marked corner and where the fitted camera puts it. */
  cornerResidualPx: number;
  imageWidthPx: number;
  imageHeightPx: number;
  /** Plain-English caveats to show the user. */
  warnings: string[];
}

export type CalibrationResult = { ok: true; calibration: Calibration } | { ok: false; message: string };

export type Facing = "toward_camera" | "left" | "right" | "away" | "unknown";

export interface PlacementInput {
  box: ImageBox;
  /** The object's front-bottom point nearest the camera, in the photo. */
  contact: ImagePoint;
  facing: Facing;
  /** Typical size (width x, height y, depth z) in metres; only its proportions are used. */
  sizeGuessM: { x: number; y: number; z: number };
}

export interface Placement {
  /** Centre of the object's footprint, scene metres. */
  x: number;
  z: number;
  /** three.js yaw: the object's front (local +Z) points along (sin yaw, 0, cos yaw). */
  yawRad: number;
  widthM: number;
  heightM: number;
  depthM: number;
  /** Which of the object's horizontal dimensions the photo actually shows. */
  visibleExtent: "width" | "depth";
  notes: string[];
}

// ---------------------------------------------------------------------------------------------
// Thresholds (see the comments where each is used)
// ---------------------------------------------------------------------------------------------

/** ln(1.4): how much better one side must fit the outline's span before the facing is overridden. */
const SIDE_DECISION_LOG = Math.log(1.4);
/** Shortest accepted rectangle side, as a fraction of the larger image dimension (~2.5 px at 1280). */
const MIN_SIDE_FRACTION = 0.002;
/** Smallest accepted rectangle area, as a fraction of the image area (about 11 x 11 px at 1280x960). */
const MIN_AREA_FRACTION = 1e-4;
/** sin of the smallest accepted corner turn (~1.1 deg): below it three corners are "in a line". */
const MIN_CORNER_SINE = 0.02;
/**
 * The lens is solved only when both sides' vanishing points lie within this many image sizes
 * (max(W, H)) of the image centre. Farther out the side is within roughly 8 deg of parallel to the
 * photo (for a normal lens) and a one-pixel corner error moves the solved focal length by several
 * per cent or more, so a typical lens is the safer answer.
 */
const MAX_VANISHING_DISTANCE = 5;
const MIN_SOLVED_FOV_DEG = 15;
const MAX_SOLVED_FOV_DEG = 120;
const DEFAULT_FOV_DEG = 60;
/** Relative side disagreement above which the user is warned (both sides given). */
const CONSISTENCY_TOLERANCE = 0.25;
/** Corner fit residual (fraction of max(W, H)) above which the user is warned. */
const MAX_CORNER_RESIDUAL_FRACTION = 0.01;
/**
 * placeObject: if moving the contact point up by 1 % of the image height moves its floor position
 * by more than this many metres, the object's distance is flagged as very uncertain (vision boxes
 * are rarely better than about 1 %; 0.3 m is more than half a typical object's depth).
 */
const HORIZON_SENSITIVITY_M = 0.3;
/** placeObject never fits an object larger than this (metres): something is wrong beyond it. */
const MAX_OBJECT_EXTENT_M = 200;

const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------------------------
// Small linear algebra
// ---------------------------------------------------------------------------------------------

type Vec3 = [number, number, number];
type Vec2 = [number, number];

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const norm = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const normalize = (a: Vec3): Vec3 => scale(a, 1 / norm(a));
const cross2 = (a: Vec2, b: Vec2): number => a[0] * b[1] - a[1] * b[0];

function mul3(a: Mat3, b: Mat3): Mat3 {
  const out: number[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += a[r * 3 + k]! * b[k * 3 + c]!;
      out.push(s);
    }
  }
  return out as Mat3;
}

function allFinite(values: readonly number[]): boolean {
  return values.every((x) => Number.isFinite(x));
}

/** Inverse by the adjugate; null when the matrix is (numerically) singular. */
export function invert3(m: Mat3): Mat3 | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const c00 = e * i - f * h;
  const c01 = -(d * i - f * g);
  const c02 = d * h - e * g;
  const det = a * c00 + b * c01 + c * c02;
  // |det| / (product of row norms) is a scale-free "volume" (1 for orthogonal rows, 0 when singular).
  const rows = Math.hypot(a, b, c) * Math.hypot(d, e, f) * Math.hypot(g, h, i);
  if (!Number.isFinite(det) || !(rows > 0) || !(Math.abs(det) > 1e-12 * rows)) return null;
  const k = 1 / det;
  return [
    c00 * k,
    -(b * i - c * h) * k,
    (b * f - c * e) * k,
    c01 * k,
    (a * i - c * g) * k,
    -(a * f - c * d) * k,
    c02 * k,
    -(a * h - b * g) * k,
    (a * e - b * d) * k,
  ];
}

/** Apply a homography to (x, y, 1); null when the result is at (or numerically near) infinity. */
export function applyHomography(h: Mat3, x: number, y: number): [number, number] | null {
  const X = h[0] * x + h[1] * y + h[2];
  const Y = h[3] * x + h[4] * y + h[5];
  const w = h[6] * x + h[7] * y + h[8];
  const magnitude = Math.max(Math.abs(X), Math.abs(Y), Math.abs(w));
  if (!Number.isFinite(magnitude) || !(Math.abs(w) > 1e-12 * magnitude)) return null;
  return [X / w, Y / w];
}

// ---------------------------------------------------------------------------------------------
// Homography (exact four-point DLT)
// ---------------------------------------------------------------------------------------------

/**
 * Hartley normalisation: translate the points' centroid to the origin and scale so their mean
 * distance from it is sqrt(2). Without it the DLT matrix mixes entries of order 1 and order
 * (pixels)^2 and loses most of its precision.
 */
function hartley(points: readonly Vec2[]): { pts: Vec2[]; t: Mat3; tInv: Mat3 } | null {
  let cx = 0;
  let cy = 0;
  for (const p of points) {
    cx += p[0];
    cy += p[1];
  }
  cx /= points.length;
  cy /= points.length;
  let mean = 0;
  for (const p of points) mean += Math.hypot(p[0] - cx, p[1] - cy);
  mean /= points.length;
  if (!Number.isFinite(mean) || !(mean > 0)) return null;
  const s = Math.SQRT2 / mean;
  return {
    pts: points.map((p): Vec2 => [(p[0] - cx) * s, (p[1] - cy) * s]),
    t: [s, 0, -s * cx, 0, s, -s * cy, 0, 0, 1],
    tInv: [1 / s, 0, cx, 0, 1 / s, cy, 0, 0, 1],
  };
}

/** True when some three of the four (normalised) points are collinear. */
function anyThreeCollinear(p: readonly Vec2[]): boolean {
  const triples: [number, number, number][] = [
    [0, 1, 2],
    [0, 1, 3],
    [0, 2, 3],
    [1, 2, 3],
  ];
  return triples.some(([i, j, k]) => {
    const a = p[i]!;
    const b = p[j]!;
    const c = p[k]!;
    return Math.abs(cross2([b[0] - a[0], b[1] - a[1]], [c[0] - a[0], c[1] - a[1]])) < 1e-9;
  });
}

/**
 * Null vector of an 8x9 matrix by Gaussian elimination with complete pivoting. Complete pivoting
 * picks the free unknown automatically (rather than forcing h33 = 1, which fails when the true h33
 * is zero) and detects rank deficiency from the pivot sizes.
 */
function nullVector8x9(a: number[][]): number[] | null {
  const m = a.map((row) => row.slice());
  const col = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  let largest = 0;
  for (const row of m) for (const x of row) largest = Math.max(largest, Math.abs(x));
  if (!(largest > 0)) return null;
  for (let k = 0; k < 8; k++) {
    let best = 0;
    let bi = k;
    let bj = k;
    for (let i = k; i < 8; i++) {
      for (let j = k; j < 9; j++) {
        const x = Math.abs(m[i]![col[j]!]!);
        if (x > best) {
          best = x;
          bi = i;
          bj = j;
        }
      }
    }
    if (!(best > 1e-12 * largest)) return null; // rank < 8: the four correspondences are degenerate
    [m[k], m[bi]] = [m[bi]!, m[k]!];
    [col[k], col[bj]] = [col[bj]!, col[k]!];
    const pivotRow = m[k]!;
    const pivot = pivotRow[col[k]!]!;
    for (let i = k + 1; i < 8; i++) {
      const row = m[i]!;
      const factor = row[col[k]!]! / pivot;
      if (factor === 0) continue;
      for (let j = 0; j < 9; j++) row[j] = row[j]! - factor * pivotRow[j]!;
    }
  }
  const x = new Array<number>(9).fill(0);
  x[col[8]!] = 1;
  for (let k = 7; k >= 0; k--) {
    const row = m[k]!;
    let s = 0;
    for (let j = k + 1; j < 9; j++) s += row[col[j]!]! * x[col[j]!]!;
    x[col[k]!] = -s / row[col[k]!]!;
  }
  return x;
}

/**
 * The homography mapping four source points exactly onto four destination points (the direct
 * linear transform on Hartley-normalised coordinates). Null when either set has three collinear
 * points, a repeated point, or the result is singular. The overall scale is arbitrary (the largest
 * entry is 1 in magnitude).
 */
export function homography(src: readonly [number, number][], dst: readonly [number, number][]): Mat3 | null {
  if (src.length !== 4 || dst.length !== 4) return null;
  if (!allFinite([...src.flat(), ...dst.flat()])) return null;
  const ns = hartley(src);
  const nd = hartley(dst);
  if (!ns || !nd || anyThreeCollinear(ns.pts) || anyThreeCollinear(nd.pts)) return null;
  // Each correspondence (x, y) -> (X, Y) gives two rows of A h = 0 (from X = h1.p / h3.p, etc.).
  const rows: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = ns.pts[i]!;
    const [X, Y] = nd.pts[i]!;
    rows.push([x, y, 1, 0, 0, 0, -X * x, -X * y, -X]);
    rows.push([0, 0, 0, x, y, 1, -Y * x, -Y * y, -Y]);
  }
  const h = nullVector8x9(rows);
  if (!h) return null;
  const hn = h as Mat3;
  const full = mul3(nd.tInv, mul3(hn, ns.t));
  const biggest = Math.max(...full.map(Math.abs));
  if (!Number.isFinite(biggest) || !(biggest > 0)) return null;
  const out = full.map((x) => x / biggest) as Mat3;
  return invert3(out) ? out : null;
}

// ---------------------------------------------------------------------------------------------
// Rectangle -> camera
// ---------------------------------------------------------------------------------------------

/** Proper crossing of segments ab and cd (shared endpoints and touching do not count). */
function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const o = (p: Vec2, q: Vec2, r: Vec2) => Math.sign(cross2([q[0] - p[0], q[1] - p[1]], [r[0] - p[0], r[1] - p[1]]));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

/** Plain-English reason the marked quadrilateral cannot be a usable rectangle, or null. */
function quadProblem(p: readonly Vec2[], W: number, H: number): string | null {
  const edges: Vec2[] = p.map((a, i): Vec2 => {
    const b = p[(i + 1) % 4]!;
    return [b[0] - a[0], b[1] - a[1]];
  });
  const lengths = edges.map((e) => Math.hypot(e[0], e[1]));
  if (lengths.some((l) => l < MIN_SIDE_FRACTION * Math.max(W, H))) {
    return "Two corners of the rectangle are almost on top of each other. Mark the four corners further apart.";
  }
  if (segmentsCross(p[0]!, p[1]!, p[2]!, p[3]!) || segmentsCross(p[1]!, p[2]!, p[3]!, p[0]!)) {
    return "The rectangle's sides cross over each other. Place the corners in order around the rectangle.";
  }
  // sin of the turn at each corner: ~0 means the corner lies on the line through its neighbours.
  const turns = edges.map((e, i) => {
    const next = edges[(i + 1) % 4]!;
    return cross2(e, next) / (lengths[i]! * lengths[(i + 1) % 4]!);
  });
  if (turns.some((s) => Math.abs(s) < MIN_CORNER_SINE)) {
    return "Three corners of the rectangle are almost in a straight line. Mark the four corners of a real rectangle.";
  }
  if (!(turns.every((s) => s > 0) || turns.every((s) => s < 0))) {
    return "The marked shape is not convex. Mark the four corners of the rectangle in order around it.";
  }
  let area2 = 0;
  for (let i = 0; i < 4; i++) area2 += cross2(p[i]!, p[(i + 1) % 4]!);
  if (Math.abs(area2) / 2 < MIN_AREA_FRACTION * W * H) {
    return "The marked rectangle is too small in the photo. Choose a larger rectangle on the floor.";
  }
  return null;
}

interface Lens {
  f: number;
  basis: FovBasis;
  /** Why the lens was assumed (completes "the rectangle ..."). */
  reason?: string;
}

/**
 * Focal length from the rectangle. G maps the unit square to the image (centred pixels); its first
 * two columns g1, g2 are the images of the rectangle's two side directions, i.e. their vanishing
 * points in homogeneous form, proportional to K r1 and K r2 with K = diag(f, f, 1). The sides are
 * perpendicular, so (K^-1 g1) . (K^-1 g2) = 0:
 *   (g1x g2x + g1y g2y) / f^2 + g1z g2z = 0   =>   f^2 = -(g1x g2x + g1y g2y) / (g1z g2z).
 * (Equivalently f^2 = -v1 . v2 for the two vanishing points.) When a side is nearly parallel to the
 * photo its vanishing point runs off to infinity (gz -> 0) and f is unconstrained.
 */
function solveLens(g1: Vec3, g2: Vec3, W: number, H: number, assumedFovDeg: number): Lens {
  const assumed = (reason: string): Lens => ({
    f: H / 2 / Math.tan((assumedFovDeg * DEG) / 2),
    basis: "assumed",
    reason,
  });
  const size = Math.max(W, H);
  const farVanishing = (g: Vec3) => Math.hypot(g[0], g[1]) > MAX_VANISHING_DISTANCE * size * Math.abs(g[2]);
  if (farVanishing(g1) || farVanishing(g2)) {
    return assumed("has a side almost parallel to the photo, so its perspective cannot reveal the lens");
  }
  const f2 = -(g1[0] * g2[0] + g1[1] * g2[1]) / (g1[2] * g2[2]);
  if (!Number.isFinite(f2) || !(f2 > 0)) {
    return assumed("does not look like a rectangle seen through an ordinary lens");
  }
  const f = Math.sqrt(f2);
  const fov = (2 * Math.atan(H / 2 / f)) / DEG;
  if (fov < MIN_SOLVED_FOV_DEG || fov > MAX_SOLVED_FOV_DEG) {
    return assumed(`would imply an implausible ${Math.round(fov)}° lens`);
  }
  return { f, basis: "from_rectangle" };
}

/**
 * Focal length from both measured sides, for a rectangle whose shape alone cannot reveal the lens
 * (typically one seen face-on). With K = diag(f, f, 1), |K^-1 g|^2 = (gx^2 + gy^2) / f^2 + gz^2,
 * and the given sides fix |K^-1 g2| / |K^-1 g1| = rho = depth / width:
 *   f^2 = (A2 - rho^2 A1) / (rho^2 z1^2 - z2^2),   Ai = gix^2 + giy^2.
 * Null when no positive focal length fits or it implies an implausible lens.
 */
function lensFromSides(g1: Vec3, g2: Vec3, rho: number, H: number): number | null {
  const a1 = g1[0] * g1[0] + g1[1] * g1[1];
  const a2 = g2[0] * g2[0] + g2[1] * g2[1];
  const den = rho * rho * g1[2] * g1[2] - g2[2] * g2[2];
  const f2 = (a2 - rho * rho * a1) / den;
  if (!Number.isFinite(f2) || !(f2 > 0)) return null;
  const f = Math.sqrt(f2);
  const fov = (2 * Math.atan(H / 2 / f)) / DEG;
  return fov >= MIN_SOLVED_FOV_DEG && fov <= MAX_SOLVED_FOV_DEG ? f : null;
}

const pct = (x: number) => Math.round(Math.abs(x) * 100);

/**
 * Calibrate the camera against the floor from the user's rectangle.
 *
 * Steps: (1) solve the lens from the rectangle's perspective (or assume it); (2) the floor
 * homography H maps rectangle coordinates (a along corner0->1, b along corner0->3, metres) to
 * centred pixels; (3) decompose M = K^-1 H = lambda [r1 r2 t] into a camera pose; (4) re-express
 * everything in the scene frame (see the module header).
 */
export function calibrateFromRectangle(input: RectangleInput): CalibrationResult {
  const fail = (message: string): CalibrationResult => ({ ok: false, message });
  const { corners, widthM, depthM } = input;
  const W = input.imageWidthPx;
  const H = input.imageHeightPx;
  const assumedFov = input.assumedVerticalFovDeg ?? DEFAULT_FOV_DEG;

  if (!(Number.isFinite(W) && W > 0 && Number.isFinite(H) && H > 0)) return fail("The photo's size is unknown.");
  if (!(Number.isFinite(assumedFov) && assumedFov > 1 && assumedFov < 179)) {
    return fail("The assumed field of view must be between 1° and 179°.");
  }
  if (!(Number.isFinite(widthM) && widthM > 0)) return fail("Enter the rectangle's width in metres (more than 0).");
  if (depthM !== null && !(Number.isFinite(depthM) && depthM > 0)) {
    return fail("The rectangle's depth must be more than 0 metres, or left blank.");
  }
  if (corners.length !== 4) return fail("Mark exactly four corners of the rectangle.");
  if (!corners.every((c) => Number.isFinite(c.u) && Number.isFinite(c.v) && c.u >= 0 && c.u <= 1 && c.v >= 0 && c.v <= 1)) {
    return fail("All four corners must be inside the photo.");
  }

  const px = corners.map((c): Vec2 => [c.u * W - W / 2, c.v * H - H / 2]);
  const problem = quadProblem(px, W, H);
  if (problem) return fail(problem);

  // (1) Lens. G: unit square -> corners (centred pixels).
  const G = homography(
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    px,
  );
  if (!G) return fail("The corners do not describe a usable rectangle.");
  const g1: Vec3 = [G[0], G[3], G[6]];
  const g2: Vec3 = [G[1], G[4], G[7]];
  const g3: Vec3 = [G[2], G[5], G[8]];
  let lens = solveLens(g1, g2, W, H, assumedFov);
  if (lens.basis === "assumed" && depthM !== null) {
    const fitted = lensFromSides(g1, g2, depthM / widthM, H);
    if (fitted !== null) lens = { f: fitted, basis: "from_sides" };
  }
  const f = lens.f;
  const kInv = (g: Vec3): Vec3 => [g[0] / f, g[1] / f, g[2]];
  const k1 = kInv(g1);
  const k2 = kInv(g2);
  const k3 = kInv(g3);
  // K^-1 g1 and K^-1 g2 are the rectangle's side vectors (unit square scaled to the real sides),
  // up to a common factor, so their length ratio is the perspective depth/width aspect.
  const aspect = norm(k2) / norm(k1);
  const depth = depthM ?? widthM * aspect;

  // (2)+(3) Pose. The metric floor homography is H = G diag(1/width, 1/depth, 1); with
  // M = K^-1 H = [m1 m2 m3] = lambda [r1 r2 t] (r1, r2 the rectangle axes in camera coordinates,
  // t the camera-frame position of corner0).
  const m1 = scale(k1, 1 / widthM);
  const m2 = scale(k2, 1 / depth);
  const m3 = k3;
  const n1 = norm(m1);
  const n2 = norm(m2);
  // H is only known up to sign: pick the one that puts corner0 in front of the camera (t_z > 0).
  const sign = m3[2] >= 0 ? 1 : -1;
  // With noisy corners, given sides that disagree, or an assumed lens, m1 and m2 are neither
  // exactly equal in length nor exactly perpendicular. The geometric mean shares the scale error
  // between the two sides, and the symmetric orthonormalisation below shares the angle error
  // (c bisects a and b; c +/- d are the closest perpendicular pair that keeps that bisector).
  const lambda = 1 / Math.sqrt(n1 * n2);
  const a = scale(m1, sign / n1);
  const b = scale(m2, sign / n2);
  const c = normalize(add(a, b));
  const d = normalize(sub(a, b));
  const r1 = scale(add(c, d), Math.SQRT1_2);
  const r2 = scale(sub(c, d), Math.SQRT1_2);
  const r3 = cross(r1, r2);
  const t = scale(m3, sign * lambda);
  if (!allFinite([...r1, ...r2, ...t])) return fail("The corners do not describe a usable rectangle.");

  const rectCorners: Vec2[] = [
    [0, 0],
    [widthM, 0],
    [widthM, depth],
    [0, depth],
  ];
  const toCamera = (p: Vec3): Vec3 => add(add(add(scale(r1, p[0]), scale(r2, p[1])), scale(r3, p[2])), t);
  if (rectCorners.some(([pa, pb]) => !(toCamera([pa, pb, 0])[2] > 0))) {
    return fail("The marked rectangle cannot be in front of the camera. Check the corners.");
  }

  // Camera centre in rectangle coordinates: X_cam = R P + t = 0  =>  P = -R^T t.
  const cRect: Vec3 = [-dot(r1, t), -dot(r2, t), -dot(r3, t)];
  const height = Math.abs(cRect[2]);
  if (!(height > 1e-3 * norm(cRect))) {
    return fail("The camera appears level with the marked rectangle, so the floor cannot be measured.");
  }
  // The floor normal that points towards the camera is world "up".
  const up = Math.sign(cRect[2]);
  // Image "down" (camera +y) in rectangle coordinates is row 1 of R. For a floor it points
  // downwards (against "up"); a positive component means the plane is above the camera, as for a
  // ceiling or anything above the horizon. (A camera looking straight down gives ~0: accepted.)
  if (up * r3[1] > 0.05) {
    return fail("The marked rectangle appears to be above the camera (above the horizon). Mark a rectangle lying on the floor.");
  }

  // (4) Scene frame, expressed in rectangle coordinates: ey = up, ex = camera right (row 0 of R)
  // with its vertical part removed, ez = ex x ey (so the camera, looking along -ez, is on +Z).
  const rightFlat: Vec3 = [r1[0], r2[0], 0];
  if (norm(rightFlat) < 0.1) {
    return fail("The photo appears to be turned on its side. Rotate it upright and mark the rectangle again.");
  }
  const ex = normalize(rightFlat);
  const ey: Vec3 = [0, 0, up];
  const ez = cross(ex, ey);
  const origin: Vec3 = [widthM / 2, depth / 2, 0];
  // Scene -> camera: X_cam = R (origin + B p) + t, B = [ex ey ez]; so Rs = R B, ts = R origin + t.
  const rotateRect = (v: Vec3): Vec3 => add(add(scale(r1, v[0]), scale(r2, v[1])), scale(r3, v[2]));
  const rsX = rotateRect(ex);
  const rsZ = rotateRect(ez);
  const ts = add(rotateRect(origin), t);
  const rel = sub(cRect, origin);
  const camera = { x: dot(ex, rel), y: dot(ey, rel), z: dot(ez, rel) };

  // Floor (x, z, 1) -> centred pixels: K [rsX rsZ ts]; then centred -> normalised:
  // u = x/W + 1/2, v = y/H + 1/2 (applied homogeneously). The third row stays the optical depth.
  const kCol = (v: Vec3): Vec3 => [(f * v[0]) / W + v[2] / 2, (f * v[1]) / H + v[2] / 2, v[2]];
  const cx = kCol(rsX);
  const cz = kCol(rsZ);
  const c0 = kCol(ts);
  const floorToImage: Mat3 = [cx[0], cz[0], c0[0], cx[1], cz[1], c0[1], cx[2], cz[2], c0[2]];
  const imageToFloor = invert3(floorToImage);
  if (!imageToFloor || !allFinite([...floorToImage, ...imageToFloor, camera.x, camera.y, camera.z])) {
    return fail("The corners do not describe a usable rectangle.");
  }

  // How well the single fitted camera reproduces the marked corners.
  let residual = 0;
  rectCorners.forEach(([pa, pb], i) => {
    const q = sub([pa, pb, 0], origin);
    const img = applyHomography(floorToImage, dot(ex, q), dot(ez, q));
    const corner = corners[i]!;
    residual = img ? Math.max(residual, Math.hypot((img[0] - corner.u) * W, (img[1] - corner.v) * H)) : Infinity;
  });

  const warnings: string[] = [];
  const verticalFovDeg = (2 * Math.atan(H / 2 / f)) / DEG;
  if (lens.basis === "assumed") {
    warnings.push(
      `The lens was assumed to have a ${Math.round(verticalFovDeg)}° vertical field of view because the rectangle ${lens.reason ?? "cannot reveal it"}. Distances may be off if the photo used a different lens; a rectangle seen at an angle works better.`,
    );
  }
  if (lens.basis === "from_sides") {
    warnings.push(
      `The lens (${Math.round(verticalFovDeg)}° vertical view) was worked out from your two side lengths, because the rectangle is seen almost face-on. Measure both sides carefully: an error in either changes every distance.`,
    );
  }
  if (depthM === null) {
    warnings.push(
      `The rectangle's depth (${depth.toFixed(2)} m) was worked out from perspective and is approximate. Measure it for better accuracy.`,
    );
  }
  let consistency: number | null = null;
  if (depthM !== null && lens.basis === "from_rectangle") {
    consistency = depthM / widthM / aspect;
    if (Math.abs(consistency - 1) > CONSISTENCY_TOLERANCE) {
      warnings.push(
        `The two side lengths disagree with the photo's perspective by ${pct(consistency - 1)} %. Check the measurements and that each corner sits on the rectangle's corner.`,
      );
    }
  }
  const residualWarned = consistency !== null && Math.abs(consistency - 1) > CONSISTENCY_TOLERANCE;
  if (!residualWarned && residual > MAX_CORNER_RESIDUAL_FRACTION * Math.max(W, H)) {
    warnings.push(
      `The marked corners do not fit a single camera exactly (up to ${Math.round(residual)} px off), so positions are approximate.`,
    );
  }

  return {
    ok: true,
    calibration: {
      imageToFloor,
      floorToImage,
      widthM,
      depthM: depth,
      depthDerived: depthM === null,
      verticalFovDeg,
      fovBasis: lens.basis,
      camera,
      consistency,
      cornerResidualPx: residual,
      imageWidthPx: W,
      imageHeightPx: H,
      warnings,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Image <-> scene
// ---------------------------------------------------------------------------------------------

/** Points deeper than this along the optical axis (metres) are treated as on the horizon. */
const MAX_DEPTH_M = 1e6;

/** The floor point (scene metres) seen at image point p; null on or above the horizon. */
export function floorPoint(cal: Calibration, p: ImagePoint): { x: number; z: number } | null {
  if (!Number.isFinite(p.u) || !Number.isFinite(p.v)) return null;
  const h = cal.imageToFloor;
  const X = h[0] * p.u + h[1] * p.v + h[2];
  const Z = h[3] * p.u + h[4] * p.v + h[5];
  const w = h[6] * p.u + h[7] * p.v + h[8]; // = 1 / depth (see Calibration.imageToFloor)
  if (!(w > 1 / MAX_DEPTH_M)) return null;
  return { x: X / w, z: Z / w };
}

/**
 * The full 3x4 projection (scene -> normalised image, homogeneous) rebuilt from the calibration:
 * its x, z and constant columns are floorToImage's, and the y column is the one that sends the
 * camera centre to (0, 0, 0): h0 Cx + p_y Cy + h1 Cz + h2 = 0. The third row is the optical depth.
 */
function projection(cal: Calibration): number[][] {
  const F = cal.floorToImage;
  const { x: Cx, y: Cy, z: Cz } = cal.camera;
  return [0, 1, 2].map((r) => {
    const h0 = F[r * 3]!;
    const h1 = F[r * 3 + 1]!;
    const h2 = F[r * 3 + 2]!;
    return [h0, -(h0 * Cx + h1 * Cz + h2) / Cy, h1, h2];
  });
}

function project(P: number[][], x: number, y: number, z: number): ImagePoint | null {
  const row = (r: number) => {
    const p = P[r]!;
    return p[0]! * x + p[1]! * y + p[2]! * z + p[3]!;
  };
  const w = row(2);
  if (!(w > 1e-6) || !Number.isFinite(w)) return null;
  return { u: row(0) / w, v: row(1) / w };
}

/** Where scene point (x, y, z) appears in the photo; null if it is behind the camera. */
export function imagePointOf(cal: Calibration, x: number, y: number, z: number): ImagePoint | null {
  if (!allFinite([x, y, z])) return null;
  return project(projection(cal), x, y, z);
}

/**
 * Metric height of a vertical segment standing on the floor at image point `base` whose top
 * appears on image row `topV`.
 *
 * The vertical through the floor point B is X(s) = (Bx, s, Bz). Its image row is
 * v(s) = (V0 + s Vy) / (W0 + s Wy) (rows of the projection), and v(s) = topV is linear in s:
 *   s = (topV W0 - V0) / (Vy - topV Wy).
 * Only the row of the top is used: a tilted camera makes verticals lean in the photo, so the top is
 * generally not straight above `base` and its column follows from the geometry. Null when the base
 * is not on the floor, the top is below the base or behind the camera, or the row never meets the
 * vertical (it would reach the vertical vanishing point).
 */
export function heightAt(cal: Calibration, base: ImagePoint, topV: number): number | null {
  const B = floorPoint(cal, base);
  if (!B || !Number.isFinite(topV)) return null;
  const P = projection(cal);
  const rowAt = (r: number): [number, number] => {
    const p = P[r]!;
    return [p[0]! * B.x + p[2]! * B.z + p[3]!, p[1]!];
  };
  const [V0, Vy] = rowAt(1);
  const [W0, Wy] = rowAt(2);
  const denom = Vy - topV * Wy;
  if (!(Math.abs(denom) > 1e-12 * (Math.abs(Vy) + Math.abs(Wy)))) return null;
  const s = (topV * W0 - V0) / denom;
  if (!Number.isFinite(s) || !(s > 0) || !(W0 + s * Wy > 1e-6)) return null;
  return s;
}

// ---------------------------------------------------------------------------------------------
// Object placement
// ---------------------------------------------------------------------------------------------

/** Smallest x >= 0 at which the monotone predicate `over` turns true (bisection); null if > max. */
function firstOver(over: (x: number) => boolean, start: number): number | null {
  if (over(0)) return 0;
  let hi = Math.max(start, 0.05);
  while (!over(hi)) {
    hi *= 2;
    if (hi > MAX_OBJECT_EXTENT_M) return null;
  }
  let lo = 0;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (over(mid)) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

const positiveRatio = (a: number, b: number) => (Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0 ? a / b : 1);

function wrapAngle(a: number): number {
  let x = a;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x <= -Math.PI) x += 2 * Math.PI;
  return x;
}

/**
 * Place a box-shaped object from its image box and floor contact point.
 *
 * F = floorPoint(contact) is the front-bottom point nearest the camera. The face of the object
 * that the camera sees runs along the floor direction `et` through F (perpendicular to the
 * direction to the camera for toward_camera / away / unknown, along X for left / right); the hidden
 * dimension runs away from the camera and is set from the typical proportions in `sizeGuessM`.
 *
 * The visible extent and height are then fitted so that the projected 3D box touches the image
 * box's left, right and top edges. This starts from (and refines) the simple estimates: the floor
 * distance between (box.left, contact.v) and (box.right, contact.v), and heightAt(contact, box.top).
 * The refinement matters because, seen from above, the box's top edges spread wider than its
 * bottom edge and its far top edge sets the image box's top; both bias the simple estimates by
 * around 10 % at ordinary room distances.
 */
export function placeObject(cal: Calibration, input: PlacementInput): Placement | null {
  const { box, contact, sizeGuessM: guess } = input;
  if (!allFinite([box.left, box.top, box.right, box.bottom, contact.u, contact.v])) return null;
  if (!(box.right > box.left && box.bottom > box.top)) return null;
  const F = floorPoint(cal, contact);
  if (!F) return null;
  const notes: string[] = [];
  const P = projection(cal);

  // Which horizontal side the photo shows is decided by the photo, not by the stated facing (a
  // vision model calls a table "facing right" as readily as "towards the camera"): the outline's
  // span on the floor is compared with the typical width and depth, and facing only orients it.
  let facing = input.facing;
  const spanL = floorPoint(cal, { u: box.left, v: contact.v });
  const spanR = floorPoint(cal, { u: box.right, v: contact.v });
  if (spanL && spanR && guess.x > 0 && guess.z > 0 && Math.abs(Math.log(guess.x / guess.z)) > SIDE_DECISION_LOG) {
    const span = Math.hypot(spanR.x - spanL.x, spanR.z - spanL.z);
    const misfitWidth = Math.abs(Math.log(span / guess.x));
    const misfitDepth = Math.abs(Math.log(span / guess.z));
    const sidewaysNow = facing === "left" || facing === "right";
    if (sidewaysNow && misfitWidth + SIDE_DECISION_LOG < misfitDepth) {
      facing = "toward_camera";
      notes.push("Turned so its longer side faces the camera, which matches its outline better than the suggested facing.");
    } else if (!sidewaysNow && misfitDepth + SIDE_DECISION_LOG < misfitWidth) {
      facing = "right";
      notes.push("Turned end-on to the camera, which matches its outline better than the suggested facing; check which way it faces.");
    }
  }

  const sideways = facing === "left" || facing === "right";
  // Normal of the visible face, pointing at the camera side. Objects are taken to stand square
  // to the floor rectangle (rooms are mostly laid out along their walls), so the visible face is
  // the one on the camera's side of the scene: +Z or -Z.
  const faceNormal: Vec2 = [0, cal.camera.z >= F.z ? 1 : -1];
  const away: Vec2 = [-faceNormal[0], -faceNormal[1]];
  // Along the visible face, oriented so that moving along it moves right in the photo.
  let et: Vec2 = [faceNormal[1], -faceNormal[0]];
  const f0 = project(P, F.x, 0, F.z);
  const f1 = project(P, F.x + 0.01 * et[0], 0, F.z + 0.01 * et[1]);
  if (f0 && f1 && f1.u < f0.u) et = [-et[0], -et[1]];

  // hidden extent = ratio * visible extent
  const ratio = sideways ? positiveRatio(guess.x, guess.z) : positiveRatio(guess.z, guess.x);
  const guessVisible = sideways ? guess.z : guess.x;

  /** Image extremes of the box spanning [-aL, aR] along et, hidden extent away, height h. */
  const extremes = (aL: number, aR: number, h: number) => {
    const hidden = ratio * (aL + aR);
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    for (const s of [-aL, aR]) {
      for (const q of [0, hidden]) {
        for (const y of [0, h]) {
          const p = project(P, F.x + s * et[0] + q * away[0], y, F.z + s * et[1] + q * away[1]);
          if (!p) return null;
          minU = Math.min(minU, p.u);
          maxU = Math.max(maxU, p.u);
          minV = Math.min(minV, p.v);
        }
      }
    }
    return { minU, maxU, minV };
  };

  // Simple estimates: floor distances along the contact row; height from the box top.
  const along = (p: { x: number; z: number } | null) => (p ? (p.x - F.x) * et[0] + (p.z - F.z) * et[1] : null);
  const leftAlong = along(floorPoint(cal, { u: box.left, v: contact.v }));
  const rightAlong = along(floorPoint(cal, { u: box.right, v: contact.v }));
  let aL = leftAlong === null ? 0.5 : Math.max(0, -leftAlong);
  let aR = rightAlong === null ? 0.5 : Math.max(0, rightAlong);
  const simpleHeight = heightAt(cal, contact, box.top);
  let h = simpleHeight ?? (guess.y > 0 ? guess.y : 1);

  // Coordinate descent: each unknown is monotone in its own edge; the coupling between them (the
  // top corners widen the box, the hidden depth raises its top) is weak, so a few rounds converge.
  let fitted = true;
  for (let round = 0; round < 12 && fitted; round++) {
    const nextR = firstOver((x) => {
      const e = extremes(aL, x, h);
      return !e || e.maxU >= box.right;
    }, aR);
    if (nextR === null) fitted = false;
    else aR = nextR;
    const nextL = firstOver((x) => {
      const e = extremes(x, aR, h);
      return !e || e.minU <= box.left;
    }, aL);
    if (nextL === null) fitted = false;
    else aL = nextL;
    const nextH = firstOver((x) => {
      const e = extremes(aL, aR, x);
      return !e || e.minV <= box.top;
    }, h);
    if (nextH === null || nextH < 1e-3) fitted = false;
    else h = nextH;
  }

  const final = fitted ? extremes(aL, aR, h) : null;
  const matched =
    final !== null &&
    Math.abs(final.maxU - box.right) < 2e-3 &&
    Math.abs(final.minU - box.left) < 2e-3 &&
    Math.abs(final.minV - box.top) < 2e-3;
  if (!matched) {
    // Fall back to the simple estimates.
    aL = leftAlong === null ? 0 : Math.max(0, -leftAlong);
    aR = rightAlong === null ? 0 : Math.max(0, rightAlong);
    notes.push("The object's outline could not be matched exactly; its size is approximate.");
  }
  const visible = aL + aR;
  if (!(visible > 0)) return null;
  const hidden = ratio * visible;

  if (matched) {
    notes.push("Height estimated from the photo.");
  } else if (simpleHeight !== null) {
    h = simpleHeight;
    notes.push("Height estimated from the photo.");
  } else {
    h = guessVisible > 0 && guess.y > 0 ? (guess.y * visible) / guessVisible : visible;
    notes.push("Height could not be measured in the photo; estimated from typical proportions.");
  }
  notes.push(sideways ? "Hidden width estimated from typical proportions." : "Hidden depth estimated from typical proportions.");
  if (facing === "unknown") notes.push("Facing direction unknown; assumed to face the camera.");
  if (contact.u < box.left || contact.u > box.right || contact.v < box.top || contact.v > box.bottom) {
    notes.push("The contact point lies outside the object's box; the position may be off.");
  }

  // How far the floor point moves when the contact moves up by 1 % of the image height.
  const nudged = floorPoint(cal, { u: contact.u, v: contact.v - 0.01 });
  if (!nudged || Math.hypot(nudged.x - F.x, nudged.z - F.z) > HORIZON_SENSITIVITY_M) {
    notes.push("The object's front point is nearly on the horizon, so its distance is very uncertain.");
  }

  const lateral = (aR - aL) / 2;
  const x = F.x + lateral * et[0] + (hidden / 2) * away[0];
  const z = F.z + lateral * et[1] + (hidden / 2) * away[1];
  const facingCamera = Math.atan2(faceNormal[0], faceNormal[1]);
  const yawRad =
    facing === "left" ? -Math.PI / 2 : facing === "right" ? Math.PI / 2 : facing === "away" ? wrapAngle(facingCamera + Math.PI) : facingCamera;

  return {
    x,
    z,
    yawRad,
    widthM: sideways ? hidden : visible,
    heightM: h,
    depthM: sideways ? visible : hidden,
    visibleExtent: sideways ? "depth" : "width",
    notes,
  };
}
