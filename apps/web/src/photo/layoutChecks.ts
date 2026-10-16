// Two different kinds of overlap in a photo-made layout (IMG-02), kept apart because they mean
// different things:
//
// * in the photo: two outlines overlap because one object stands in front of the other. That is
//   how the camera saw them; the one further back is partly hidden, so its hidden side is a guess.
// * in 3D: two footprints intersect on the floor plan. Unless the objects can share that space
//   (a chair tucked under a table), it is a placement error (a hidden depth guessed too deep, or
//   a floor point in the wrong place), and the user should move, resize or turn one of them.
//   Nothing here checks clearance or real-world fit: footprints are rectangles.
//
// Pure functions over the placements; nothing here changes the review or talks to the API.
import type { ImageBox } from "@replay-world/contracts";
import type { PlacedItem } from "./world";

export type Point = readonly [number, number];

export interface PhotoOverlap {
  front: string;
  behind: string;
  /** Overlap as a share of the smaller outline. */
  share: number;
  text: string;
}

export interface FootprintClash {
  a: string;
  b: string;
  /** A seat and a table or desk: probably a chair tucked under it, which is fine if so. */
  tucked: boolean;
  areaM2: number;
  /** How far one would have to move to clear the other (the smallest separating distance). */
  depthM: number;
  /** The shared floor area, for drawing on the plan. */
  polygon: Point[];
  text: string;
}

/** How an object is named in the texts: its label, or a numbered label from the review. */
export type Namer = (p: PlacedItem) => string;
const byLabel: Namer = (p) => `“${p.item.label}”`;

const SEATS = new Set(["chair", "sofa"]);
const UNDER = new Set(["table"]);

/** Outlines that overlap by at least this share of the smaller one are listed. */
export const PHOTO_OVERLAP_SHARE = 0.08;
/** Footprints that intersect by less than this are treated as touching, not clashing. */
export const CLASH_DEPTH_M = 0.02;
const CLASH_AREA_M2 = 0.005;

const pct = (v: number) => `${Math.round(v * 100)} %`;
const metres = (v: number) => (v < 1 ? `${Math.round(v * 100)} cm` : `${v.toFixed(2)} m`);

function boxArea(b: ImageBox): number {
  return Math.max(0, b.right - b.left) * Math.max(0, b.bottom - b.top);
}

function boxIntersection(a: ImageBox, b: ImageBox): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Overlap of two outlines as a share of the smaller one (0 when apart). */
export function outlineOverlap(a: ImageBox, b: ImageBox): number {
  const smaller = Math.min(boxArea(a), boxArea(b));
  return smaller > 0 ? boxIntersection(a, b) / smaller : 0;
}

/** Intersection over union of two outlines (for duplicates). */
export function outlineIoU(a: ImageBox, b: ImageBox): number {
  const inter = boxIntersection(a, b);
  const union = boxArea(a) + boxArea(b) - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * Outlines that overlap in the photo. The nearer object is the one that meets the floor lower in
 * the picture (closer to the camera); the other is partly hidden behind it.
 */
export function photoOverlaps(placed: readonly PlacedItem[], name: Namer = byLabel): PhotoOverlap[] {
  const out: PhotoOverlap[] = [];
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i]!;
      const b = placed[j]!;
      const share = outlineOverlap(a.item.box, b.item.box);
      if (share < PHOTO_OVERLAP_SHARE) continue;
      const lower = (p: PlacedItem) => p.item.contact?.v ?? p.item.box.bottom;
      const [front, behind] = lower(a) >= lower(b) ? [a, b] : [b, a];
      out.push({
        front: front.item.id,
        behind: behind.item.id,
        share,
        text:
          `In the photo, ${name(behind)} is partly behind ${name(front)} (their outlines overlap ${pct(share)}). ` +
          `That is how the camera saw them, not a problem in 3D; what is hidden of ${name(behind)} is a guess.`,
      });
    }
  }
  return out.sort((x, y) => y.share - x.share);
}

/** The four floor corners of a placed object, in the scene frame (x right, z towards the camera). */
export function footprint(p: Pick<PlacedItem, "x" | "z" | "yawRad" | "width" | "depth">): Point[] {
  const c = Math.cos(p.yawRad);
  const s = Math.sin(p.yawRad);
  return (
    [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const
  ).map(([u, w]) => {
    const lx = (u * p.width) / 2;
    const lz = (w * p.depth) / 2;
    return [p.x + lx * c + lz * s, p.z - lx * s + lz * c] as const;
  });
}

function area(poly: readonly Point[]): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i]!;
    const [x2, z2] = poly[(i + 1) % poly.length]!;
    sum += x1 * z2 - x2 * z1;
  }
  return Math.abs(sum) / 2;
}

/** Sutherland-Hodgman: the part of a convex polygon inside another convex polygon. */
function clip(subject: readonly Point[], clipper: readonly Point[]): Point[] {
  let out: Point[] = [...subject];
  // Orientation of the clipper decides which side of each edge is inside.
  const sign = Math.sign(
    clipper.reduce((acc, [x1, z1], i) => {
      const [x2, z2] = clipper[(i + 1) % clipper.length]!;
      return acc + (x1 * z2 - x2 * z1);
    }, 0),
  );
  for (let i = 0; i < clipper.length && out.length; i++) {
    const [ax, az] = clipper[i]!;
    const [bx, bz] = clipper[(i + 1) % clipper.length]!;
    const inside = ([x, z]: Point) => sign * ((bx - ax) * (z - az) - (bz - az) * (x - ax)) >= -1e-12;
    const input = out;
    out = [];
    for (let k = 0; k < input.length; k++) {
      const p = input[k]!;
      const q = input[(k + 1) % input.length]!;
      const pin = inside(p);
      const qin = inside(q);
      if (pin) out.push(p);
      if (pin !== qin) {
        const dx = q[0] - p[0];
        const dz = q[1] - p[1];
        const den = (bx - ax) * dz - (bz - az) * dx;
        if (Math.abs(den) > 1e-15) {
          const t = ((bx - ax) * (az - p[1]) - (bz - az) * (ax - p[0])) / den;
          out.push([p[0] + t * dx, p[1] + t * dz]);
        }
      }
    }
  }
  return out;
}

/** The smallest distance one footprint must move to clear the other (separating axes). */
function separation(a: readonly Point[], b: readonly Point[]): number {
  let best = Infinity;
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const [x1, z1] = poly[i]!;
      const [x2, z2] = poly[(i + 1) % poly.length]!;
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 1e-12) continue;
      const nx = -(z2 - z1) / len;
      const nz = (x2 - x1) / len;
      const project = (p: readonly Point[]) => p.map(([x, z]) => x * nx + z * nz);
      const pa = project(a);
      const pb = project(b);
      const overlap = Math.min(Math.max(...pa), Math.max(...pb)) - Math.max(Math.min(...pa), Math.min(...pb));
      if (overlap <= 0) return 0;
      best = Math.min(best, overlap);
    }
  }
  return best === Infinity ? 0 : best;
}

/** Footprints that would stand in the same place on the floor. */
export function footprintClashes(placed: readonly PlacedItem[], name: Namer = byLabel): FootprintClash[] {
  const out: FootprintClash[] = [];
  const shapes = placed.map((p) => footprint(p));
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i]!;
      const b = placed[j]!;
      const depth = separation(shapes[i]!, shapes[j]!);
      if (depth < CLASH_DEPTH_M) continue;
      const polygon = clip(shapes[i]!, shapes[j]!);
      const shared = area(polygon);
      if (shared < CLASH_AREA_M2) continue;
      const guessed = [a, b].filter((p) => ["hidden", "unseen"].includes(p.source.depth) || ["hidden", "unseen"].includes(p.source.width)).map(name);
      const why = guessed.length
        ? `${guessed.join(" and ")} ${guessed.length > 1 ? "have" : "has"} a hidden side whose size is a guess, a common cause.`
        : "A floor point in the wrong place is a common cause.";
      const tucked = (SEATS.has(a.item.template) && UNDER.has(b.item.template)) || (SEATS.has(b.item.template) && UNDER.has(a.item.template));
      out.push({
        a: a.item.id,
        b: b.item.id,
        tucked,
        areaM2: shared,
        depthM: depth,
        polygon,
        text: tucked
          ? `In 3D, the floor footprints of ${name(a)} and ${name(b)} overlap by ${shared.toFixed(2)} m² (${metres(depth)} deep): probably a seat tucked under the table, which is fine if so.`
          : `In 3D, the floor footprints of ${name(a)} and ${name(b)} overlap by ${shared.toFixed(2)} m² ` +
            `(${metres(depth)} deep). If they cannot share that floor space (a chair can tuck under a table; two machines cannot), ` +
            `move, resize or turn one. ${why}`,
      });
    }
  }
  return out;
}
