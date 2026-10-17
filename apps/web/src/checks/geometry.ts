// Plain 2D geometry on the floor plane (world x, z in metres) for the layout and route checks.
// Every function is exact for straight-edged polygons; nothing here samples or approximates.
import type { SceneObject } from "@replay-world/contracts";

export interface Vec {
  x: number;
  z: number;
}

export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, z: a.z - b.z });
const dot = (a: Vec, b: Vec) => a.x * b.x + a.z * b.z;
const cross = (a: Vec, b: Vec) => a.x * b.z - a.z * b.x;
export const length = (a: Vec) => Math.hypot(a.x, a.z);

/** An object's footprint rectangle on the floor: its corners, turned by its yaw. */
export function footprint(object: SceneObject): Vec[] {
  const { position_m: p, rotation_rad: r } = object.transform;
  const hw = object.dimensions.width.value_m / 2;
  const hd = object.dimensions.depth.value_m / 2;
  // A turn about +Y by `yaw` maps local +X to (cos, -sin) in world (x, z).
  const c = Math.cos(r.y);
  const s = Math.sin(r.y);
  return [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ].map(([u, v]) => ({ x: p.x + u! * c + v! * s, z: p.z - u! * s + v! * c }));
}

export function bounds(poly: readonly Vec[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  return {
    minX: Math.min(...poly.map((p) => p.x)),
    maxX: Math.max(...poly.map((p) => p.x)),
    minZ: Math.min(...poly.map((p) => p.z)),
    maxZ: Math.max(...poly.map((p) => p.z)),
  };
}

export function inside(p: Vec, poly: readonly Vec[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) hit = !hit;
  }
  return hit;
}

export function segmentDistance(p: Vec, a: Vec, b: Vec): number {
  const ab = sub(b, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1)));
  return length(sub(p, { x: a.x + ab.x * t, z: a.z + ab.z * t }));
}

/** Distance from a point to a polygon's edges (0 on an edge). */
export function edgeDistance(p: Vec, poly: readonly Vec[], closed = true): number {
  let best = Infinity;
  const n = closed ? poly.length : poly.length - 1;
  for (let i = 0; i < n; i++) best = Math.min(best, segmentDistance(p, poly[i]!, poly[(i + 1) % poly.length]!));
  return best;
}

/** Distance from a point to a filled polygon (0 inside). */
export function pointDistance(p: Vec, poly: readonly Vec[]): number {
  return inside(p, poly) ? 0 : edgeDistance(p, poly);
}

function segmentsCross(a: Vec, b: Vec, c: Vec, d: Vec): boolean {
  const d1 = cross(sub(b, a), sub(c, a));
  const d2 = cross(sub(b, a), sub(d, a));
  const d3 = cross(sub(d, c), sub(a, c));
  const d4 = cross(sub(d, c), sub(b, c));
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Shortest distance between two filled polygons (0 when they touch or overlap). */
export function polygonGap(a: readonly Vec[], b: readonly Vec[]): number {
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (segmentsCross(a[i]!, a[(i + 1) % a.length]!, b[j]!, b[(j + 1) % b.length]!)) return 0;
    }
  }
  if (inside(a[0]!, b) || inside(b[0]!, a)) return 0;
  let best = Infinity;
  for (const p of a) best = Math.min(best, edgeDistance(p, b));
  for (const p of b) best = Math.min(best, edgeDistance(p, a));
  return best;
}

/** How far two convex polygons overlap: the smallest push along any edge normal that would
 * separate them (0 when they only touch or are apart). Separating-axis test. */
export function overlapDepth(a: readonly Vec[], b: readonly Vec[]): number {
  let depth = Infinity;
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const e = sub(poly[(i + 1) % poly.length]!, poly[i]!);
      const n = { x: -e.z, z: e.x };
      const len = length(n);
      if (len === 0) continue;
      const axis = { x: n.x / len, z: n.z / len };
      const pa = a.map((p) => dot(p, axis));
      const pb = b.map((p) => dot(p, axis));
      const overlap = Math.min(Math.max(...pa), Math.max(...pb)) - Math.max(Math.min(...pa), Math.min(...pb));
      if (overlap <= 0) return 0;
      depth = Math.min(depth, overlap);
    }
  }
  return depth;
}

/** The overlapping area of two convex polygons (Sutherland-Hodgman clipping), as a polygon. */
export function overlapRegion(subject: readonly Vec[], clip: readonly Vec[]): Vec[] {
  let output = [...subject];
  const orientation = Math.sign(signedArea(clip)) || 1;
  for (let i = 0; i < clip.length && output.length > 0; i++) {
    const a = clip[i]!;
    const b = clip[(i + 1) % clip.length]!;
    const inner = (p: Vec) => orientation * cross(sub(b, a), sub(p, a)) >= 0;
    const input = output;
    output = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j]!;
      const q = input[(j + 1) % input.length]!;
      if (inner(q)) {
        if (!inner(p)) output.push(intersect(p, q, a, b));
        output.push(q);
      } else if (inner(p)) output.push(intersect(p, q, a, b));
    }
  }
  return output;
}

function intersect(p: Vec, q: Vec, a: Vec, b: Vec): Vec {
  const r = sub(q, p);
  const s = sub(b, a);
  const t = cross(sub(a, p), s) / (cross(r, s) || 1e-12);
  return { x: p.x + r.x * t, z: p.z + r.z * t };
}

export function signedArea(poly: readonly Vec[]): number {
  let area = 0;
  for (let i = 0; i < poly.length; i++) area += cross(poly[i]!, poly[(i + 1) % poly.length]!);
  return area / 2;
}

export const area = (poly: readonly Vec[]) => Math.abs(signedArea(poly));

/** How far a polygon's corners reach outside another polygon (0 when all are inside). */
export function outsideBy(inner: readonly Vec[], outer: readonly Vec[]): number {
  let worst = 0;
  for (const p of inner) if (!inside(p, outer)) worst = Math.max(worst, edgeDistance(p, outer));
  return worst;
}

/** Distance along a ray to the nearest edge of the given polygons and polylines. */
export function rayDistance(origin: Vec, direction: Vec, shapes: readonly { points: readonly Vec[]; closed: boolean }[], limit: number): number {
  let best = limit;
  for (const shape of shapes) {
    const n = shape.closed ? shape.points.length : shape.points.length - 1;
    for (let i = 0; i < n; i++) {
      const a = shape.points[i]!;
      const b = shape.points[(i + 1) % shape.points.length]!;
      const s = sub(b, a);
      const denom = cross(direction, s);
      if (Math.abs(denom) < 1e-12) continue;
      const t = cross(sub(a, origin), s) / denom;
      const u = cross(sub(a, origin), direction) / denom;
      if (t >= 0 && u >= 0 && u <= 1) best = Math.min(best, t);
    }
  }
  return best;
}
