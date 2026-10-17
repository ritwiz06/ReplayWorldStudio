// GEO-02: can an item of a given width get from one point to another? A width-only route on
// the reviewed floor that keeps clear of equipment, structures and keep-clear zones. The search
// runs on a grid (a distance field over the floor); every route it finds is then checked
// exactly against the polygons, and the narrowest passage is measured exactly with rays.
// Turning, length and height are not evaluated, and nothing here certifies the site.
//
// Uncertain geometry (an outline whose box only encloses it, an unreviewed object, an open line,
// a shape the drawing left out) is avoided first. A route that avoids it too "fits"; one that
// exists only through it is "cannot determine yet"; none even past it is a blockage.
import type { Project } from "@replay-world/contracts";
import { bounds, edgeDistance, inside, length, pointDistance, rayDistance, segmentDistance, sub, type Vec } from "./geometry";
import { checkInputs, type CheckInputs } from "./inputs";

export interface RouteRequest {
  start: Vec;
  end: Vec;
  /** Width of the item that has to pass, in metres. */
  widthM: number;
  /** Extra room kept on each side, in metres. */
  allowanceM: number;
}

export interface Passage {
  at: Vec;
  widthM: number;
  between: string[];
  /** The objects on either side (none for the floor's edge or a line of the drawing). */
  objectIds: string[];
}

export interface RouteResult {
  outcome: "fits" | "conflict" | "cannot_determine";
  summary: string;
  path: Vec[] | null;
  /** The narrowest passage on the route found, or where the best possible route is blocked. */
  passage: Passage | null;
  /** The least distance from the route's centre line to anything it keeps clear of. */
  clearanceM: number | null;
  /** The corridor the item needs: its width plus the allowance on each side. */
  needM: number;
  uncertainOnRoute: string[];
  blockers: string[];
  resolutionM: number;
  scope: string;
  tested: string[];
}

export const SCOPE = "Width-only route; turning not evaluated. A long pallet, a turning forklift or an articulated vehicle may need more room at the turns. Heights are not checked.";

interface Solid {
  name: string;
  points: Vec[];
  closed: boolean;
  id?: string;
}

const m = (v: number) => `${v.toFixed(2)} m`;
const MAX_CELLS = 160_000;

export function checkRoute(project: Project, request: RouteRequest): RouteResult | null {
  const inputs = checkInputs(project);
  if (!inputs) return null;
  const needM = request.widthM + 2 * request.allowanceM;
  const base = {
    path: null,
    passage: null,
    clearanceM: null,
    needM,
    uncertainOnRoute: [] as string[],
    resolutionM: 0,
    scope: SCOPE,
    tested: [`an item ${m(request.widthM)} wide with ${m(request.allowanceM)} kept clear on each side: a ${m(needM)} corridor`],
  };
  const fail = (outcome: RouteResult["outcome"], summary: string, blockers: string[] = []): RouteResult => ({ ...base, outcome, summary, blockers });
  if (!(request.widthM > 0) || !(request.allowanceM >= 0)) return fail("cannot_determine", "Enter the width of the item that has to pass (above 0 m).", ["no width"]);
  if (inputs.blockers.length > 0) return fail("cannot_determine", `Cannot determine yet: ${inputs.blockers.join("; ")}.`, inputs.blockers);
  if (!inputs.floor) {
    const why = "the floor is only for display, so its edge is unknown: choose the drawing's floor outline in the review";
    return fail("cannot_determine", `Cannot determine yet: ${why}.`, [why]);
  }
  const floor = inputs.floor.poly;
  for (const [point, which] of [
    [request.start, "start"],
    [request.end, "destination"],
  ] as const) {
    if (!inside(point, floor)) return fail("conflict", `The ${which} point is outside the floor.`);
  }

  const { certain, uncertain } = solids(inputs);
  const grid = makeGrid(floor, certain, uncertain);
  base.resolutionM = grid.r;
  base.tested.push(`positions on a ${m(grid.r)} grid; every route found is then checked exactly`, `kept clear of: equipment, structures, keep-clear zones and ${inputs.floor.words}`);
  const half = needM / 2;

  for (const [point, which] of [
    [request.start, "start"],
    [request.end, "destination"],
  ] as const) {
    const near = nearest(point, certain, floor);
    if (near.distance < half) {
      const where = near.distance === 0 ? `inside ${near.name}` : `${m(near.distance)} from ${near.name}`;
      return {
        ...fail("conflict", `Blocked at the ${which}: the ${which} point is ${where}, and the item needs ${m(half)} on each side.`),
        passage: { at: point, widthM: 2 * near.distance, between: [near.name], objectIds: near.id ? [near.id] : [] },
      };
    }
  }

  const everything = [...certain, ...uncertain];
  const clear = route(grid, grid.all, request, half, everything, floor);
  if (clear) {
    const passage = narrowest(clear.path, everything, floor);
    const unplaced = inputs.unplaced;
    if (unplaced.length > 0) {
      return {
        ...base,
        outcome: "cannot_determine",
        summary: `A route was found, but it cannot be confirmed clear: ${unplaced.join("; ")} could be anywhere.`,
        path: clear.path,
        passage,
        clearanceM: clear.clearance,
        blockers: unplaced,
      };
    }
    return {
      ...base,
      outcome: "fits",
      summary: `Fits in the reviewed design: a ${m(needM)} corridor runs from start to destination; its narrowest passage is ${m(passage.widthM)}${passage.between.length ? ` (${passage.between.join(" and ")})` : ""}.`,
      path: clear.path,
      passage,
      clearanceM: clear.clearance,
      blockers: [],
    };
  }

  const throughUncertain = route(grid, grid.certain, request, half, certain, floor);
  if (throughUncertain) {
    const crossed = uncertain.filter((u) => throughUncertain.path.some((p, i) => i > 0 && distanceToSolid(p, u, throughUncertain.path[i - 1]) < half)).map((u) => u.name);
    const list = crossed.length > 0 ? crossed : uncertain.map((u) => u.name).slice(0, 3);
    return {
      ...base,
      outcome: "cannot_determine",
      summary: `Cannot determine yet: the only routes found pass ${list.join("; ")}. Correct ${list.length === 1 ? "it" : "them"} in the review or the drawing, or check on site.`,
      path: throughUncertain.path,
      passage: narrowest(throughUncertain.path, certain, floor),
      clearanceM: throughUncertain.clearance,
      uncertainOnRoute: list,
      blockers: [],
    };
  }

  // Blocked even past every uncertain shape: where is the best possible way narrowest?
  const passage = widestPassage(grid, grid.certain, request, certain, floor) ?? passageAt(request.start, null, certain, floor);
  const close = passage.widthM >= needM - 2 * grid.r;
  if (close) {
    return {
      ...fail("cannot_determine", `Cannot determine yet: the narrowest point of the best way is about ${m(passage.widthM)}, within this check's ${m(grid.r)} resolution of the ${m(needM)} needed${passage.between.length ? ` (${passage.between.join(" and ")})` : ""}.`),
      passage,
    };
  }
  return {
    ...fail("conflict", `Blocked: the best way through narrows to ${m(passage.widthM)}${passage.between.length ? ` between ${passage.between.join(" and ")}` : ""}, and the item needs ${m(needM)}.`),
    passage,
  };
}

/** Equipment, structures and zones known exactly; everything else is uncertain. */
function solids(inputs: CheckInputs): { certain: Solid[]; uncertain: Solid[] } {
  const certain: Solid[] = [];
  const uncertain: Solid[] = [];
  for (const shape of [...inputs.obstacles, ...inputs.zones]) {
    const solid = { name: shape.name, points: shape.poly, closed: true, id: shape.id };
    if (shape.evidence.exact) certain.push(solid);
    else uncertain.push({ ...solid, name: `${shape.name} (${shape.evidence.problem ?? "approximate"})` });
  }
  for (const u of inputs.uncertain) uncertain.push({ name: u.label, points: u.points, closed: u.closed });
  return { certain, uncertain };
}

function distanceToSolid(p: Vec, solid: Solid, previous?: Vec): number {
  const d = solid.closed ? pointDistance(p, solid.points) : edgeDistance(p, solid.points, false);
  if (!previous) return d;
  // Also catch a thin shape crossed between two samples.
  let best = d;
  for (let i = 0; i < solid.points.length - (solid.closed ? 0 : 1); i++) {
    const a = solid.points[i]!;
    const b = solid.points[(i + 1) % solid.points.length]!;
    best = Math.min(best, segmentToSegment(previous, p, a, b));
  }
  return best;
}

function segmentToSegment(a: Vec, b: Vec, c: Vec, d: Vec): number {
  const cross = (u: Vec, v: Vec) => u.x * v.z - u.z * v.x;
  const d1 = cross(sub(b, a), sub(c, a));
  const d2 = cross(sub(b, a), sub(d, a));
  const d3 = cross(sub(d, c), sub(a, c));
  const d4 = cross(sub(d, c), sub(b, c));
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
  return Math.min(segmentDistance(a, c, d), segmentDistance(b, c, d), segmentDistance(c, a, b), segmentDistance(d, a, b));
}

/** The nearest solid (or the floor's edge) to a point, and how far. */
function nearest(p: Vec, solids: readonly Solid[], floor: readonly Vec[]): { name: string; distance: number; id?: string | undefined } {
  let best: { name: string; distance: number; id?: string | undefined } = { name: "the floor's edge", distance: inside(p, floor) ? edgeDistance(p, floor) : 0 };
  for (const s of solids) {
    const d = distanceToSolid(p, s);
    if (d < best.distance) best = { name: s.name, distance: d, id: s.id };
  }
  return best;
}

// --- The grid -------------------------------------------------------------------------------

interface Grid {
  r: number;
  nx: number;
  nz: number;
  minX: number;
  minZ: number;
  /** Clearance (metres) from each cell centre to the nearest occupied cell, per set. */
  all: Float64Array;
  certain: Float64Array;
}

function makeGrid(floor: readonly Vec[], certain: readonly Solid[], uncertain: readonly Solid[]): Grid {
  const b = bounds(floor);
  const w = b.maxX - b.minX;
  const d = b.maxZ - b.minZ;
  const r = Math.max(0.02, Math.ceil(Math.sqrt((w * d) / MAX_CELLS) * 1000) / 1000);
  const nx = Math.ceil(w / r);
  const nz = Math.ceil(d / r);
  const occCertain = new Uint8Array(nx * nz);
  const centre = (i: number, j: number): Vec => ({ x: b.minX + (i + 0.5) * r, z: b.minZ + (j + 0.5) * r });
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) if (!inside(centre(i, j), floor)) occCertain[j * nx + i] = 1;
  const mark = (occ: Uint8Array, s: Solid) => {
    const sb = bounds(s.points);
    const i0 = Math.max(0, Math.floor((sb.minX - b.minX) / r) - 1);
    const i1 = Math.min(nx - 1, Math.ceil((sb.maxX - b.minX) / r) + 1);
    const j0 = Math.max(0, Math.floor((sb.minZ - b.minZ) / r) - 1);
    const j1 = Math.min(nz - 1, Math.ceil((sb.maxZ - b.minZ) / r) + 1);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const c = centre(i, j);
        const hit = s.closed ? inside(c, s.points) || edgeDistance(c, s.points) <= r / 2 : edgeDistance(c, s.points, false) <= r / 2;
        if (hit) occ[j * nx + i] = 1;
      }
    }
  };
  for (const s of certain) mark(occCertain, s);
  const occAll = occCertain.slice();
  for (const s of uncertain) mark(occAll, s);
  return { r, nx, nz, minX: b.minX, minZ: b.minZ, all: clearance(occAll, nx, nz, r), certain: clearance(occCertain, nx, nz, r) };
}

/** Euclidean distance transform (Felzenszwalb and Huttenlocher), in metres. */
function clearance(occ: Uint8Array, nx: number, nz: number, r: number): Float64Array {
  const INF = 1e20;
  const f = new Float64Array(nx * nz);
  for (let k = 0; k < f.length; k++) f[k] = occ[k] ? 0 : INF;
  const pass = (get: (k: number) => number, set: (k: number, v: number) => void, n: number) => {
    const v = new Int32Array(n);
    const z = new Float64Array(n + 1);
    const g = new Float64Array(n);
    for (let q = 0; q < n; q++) g[q] = get(q);
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = (g[q]! + q * q - (g[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
      while (s <= z[k]!) {
        k--;
        s = (g[q]! + q * q - (g[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1]! < q) k++;
      set(q, (q - v[k]!) * (q - v[k]!) + g[v[k]!]!);
    }
  };
  for (let i = 0; i < nx; i++) pass((q) => f[q * nx + i]!, (q, val) => (f[q * nx + i] = val), nz);
  for (let j = 0; j < nz; j++) pass((q) => f[j * nx + q]!, (q, val) => (f[j * nx + q] = val), nx);
  const out = new Float64Array(f.length);
  for (let k = 0; k < f.length; k++) out[k] = Math.sqrt(f[k]!) * r;
  return out;
}

const cellOf = (g: Grid, p: Vec) => {
  const i = Math.min(g.nx - 1, Math.max(0, Math.floor((p.x - g.minX) / g.r)));
  const j = Math.min(g.nz - 1, Math.max(0, Math.floor((p.z - g.minZ) / g.r)));
  return j * g.nx + i;
};
const centreOf = (g: Grid, k: number): Vec => ({ x: g.minX + ((k % g.nx) + 0.5) * g.r, z: g.minZ + (Math.floor(k / g.nx) + 0.5) * g.r });

class Heap {
  private keys: number[] = [];
  private items: number[] = [];
  constructor(private readonly max: boolean) {}
  get size() {
    return this.items.length;
  }
  private better(a: number, b: number) {
    return this.max ? this.keys[a]! > this.keys[b]! : this.keys[a]! < this.keys[b]!;
  }
  private swap(a: number, b: number) {
    [this.keys[a], this.keys[b]] = [this.keys[b]!, this.keys[a]!];
    [this.items[a], this.items[b]] = [this.items[b]!, this.items[a]!];
  }
  push(item: number, key: number) {
    this.items.push(item);
    this.keys.push(key);
    let c = this.items.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (!this.better(c, p)) break;
      this.swap(c, p);
      c = p;
    }
  }
  pop(): number {
    const top = this.items[0]!;
    const lastItem = this.items.pop()!;
    const lastKey = this.keys.pop()!;
    if (this.items.length > 0) {
      this.items[0] = lastItem;
      this.keys[0] = lastKey;
      let p = 0;
      for (;;) {
        const l = 2 * p + 1;
        const rr = l + 1;
        let best = p;
        if (l < this.items.length && this.better(l, best)) best = l;
        if (rr < this.items.length && this.better(rr, best)) best = rr;
        if (best === p) break;
        this.swap(p, best);
        p = best;
      }
    }
    return top;
  }
}

const STEPS = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
] as const;

/** The shortest grid path between two cells through the open ones (A*), as cell indices. */
function gridPath(g: Grid, open: (k: number) => boolean, start: number, goal: number): number[] | null {
  const cost = new Float64Array(g.nx * g.nz).fill(Infinity);
  const parent = new Int32Array(g.nx * g.nz).fill(-1);
  const heap = new Heap(false);
  const target = centreOf(g, goal);
  const h = (k: number) => length(sub(centreOf(g, k), target)) / g.r;
  cost[start] = 0;
  heap.push(start, h(start));
  while (heap.size > 0) {
    const k = heap.pop();
    if (k === goal) break;
    const i = k % g.nx;
    const j = Math.floor(k / g.nx);
    for (const [di, dj, step] of STEPS) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= g.nx || nj >= g.nz) continue;
      const n = nj * g.nx + ni;
      if (!open(n)) continue;
      const c = cost[k]! + step;
      if (c < cost[n]!) {
        cost[n] = c;
        parent[n] = k;
        heap.push(n, c + h(n));
      }
    }
  }
  if (cost[goal] === Infinity) return null;
  const cells: number[] = [];
  for (let k = goal; k !== -1; k = parent[k]!) cells.push(k);
  return cells.reverse();
}

/** The shortest grid route keeping `half` (plus one cell) clear, smoothed and checked exactly. */
function route(g: Grid, field: Float64Array, request: RouteRequest, half: number, solids: readonly Solid[], floor: readonly Vec[]): { path: Vec[]; clearance: number } | null {
  const threshold = half + g.r;
  const start = cellOf(g, request.start);
  const goal = cellOf(g, request.end);
  const open = (k: number) => k === start || k === goal || field[k]! >= threshold;
  const cells = gridPath(g, open, start, goal);
  if (!cells) return null;
  // String pulling: keep only the turns needed to stay in cells that keep the clearance.
  const free = (a: Vec, b: Vec) => {
    const n = Math.ceil(length(sub(b, a)) / (g.r / 2));
    for (let s = 0; s <= n; s++) {
      const k = cellOf(g, { x: a.x + ((b.x - a.x) * s) / n, z: a.z + ((b.z - a.z) * s) / n });
      if (!open(k)) return false;
    }
    return true;
  };
  const points = cells.map((k) => centreOf(g, k));
  points[0] = request.start;
  points[points.length - 1] = request.end;
  const path: Vec[] = [points[0]!];
  let i = 0;
  while (i < points.length - 1) {
    let j = points.length - 1;
    while (j > i + 1 && !free(points[i]!, points[j]!)) j--;
    path.push(points[j]!);
    i = j;
  }
  // The exact check: sample the route and measure the true distance to everything it avoids.
  let least = Infinity;
  for (let s = 1; s < path.length; s++) {
    const a = path[s - 1]!;
    const b = path[s]!;
    const n = Math.max(1, Math.ceil(length(sub(b, a)) / (g.r / 4)));
    for (let q = 0; q <= n; q++) {
      const p = { x: a.x + ((b.x - a.x) * q) / n, z: a.z + ((b.z - a.z) * q) / n };
      least = Math.min(least, nearest(p, solids, floor).distance);
    }
  }
  return least >= half - 1e-9 ? { path, clearance: least } : null;
}

/** Where the widest possible route from start to destination is narrowest. The widest route's
 * bottleneck comes from a max-min search on the grid; the shortest route that keeps it is then
 * walked, and of its cells within one grid step of the bottleneck, the one with the narrowest
 * exactly measured passage is the place reported. */
function widestPassage(g: Grid, field: Float64Array, request: RouteRequest, solids: readonly Solid[], floor: readonly Vec[]): Passage | null {
  const start = cellOf(g, request.start);
  const goal = cellOf(g, request.end);
  const best = new Float64Array(field.length).fill(-1);
  const heap = new Heap(true);
  best[start] = field[start]!;
  heap.push(start, best[start]!);
  while (heap.size > 0) {
    const k = heap.pop();
    if (k === goal) break;
    const i = k % g.nx;
    const j = Math.floor(k / g.nx);
    for (const [di, dj] of STEPS) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= g.nx || nj >= g.nz) continue;
      const n = nj * g.nx + ni;
      const v = Math.min(best[k]!, field[n]!);
      if (v > best[n]!) {
        best[n] = v;
        heap.push(n, v);
      }
    }
  }
  const bottleneck = best[goal]!;
  if (bottleneck <= 0) return null;
  const cells = gridPath(g, (k) => field[k]! >= bottleneck, start, goal);
  if (!cells) return null;
  let narrowestHere: Passage | null = null;
  for (let s = 0; s < cells.length; s++) {
    if (field[cells[s]!]! > bottleneck + g.r) continue;
    const at = centreOf(g, cells[s]!);
    const passage = passageAt(at, s > 0 ? centreOf(g, cells[s - 1]!) : null, solids, floor);
    if (!narrowestHere || passage.widthM < narrowestHere.widthM - 1e-9) narrowestHere = passage;
  }
  return narrowestHere;
}

/** The width of the passage at a point: the free distance to each side along the narrowest of
 * twelve directions (every 15 degrees, plus the one across the travel direction if known). For
 * a corridor or doorway this is its cross-section. */
function passageAt(at: Vec, previous: Vec | null, solids: readonly Solid[], floor: readonly Vec[]): Passage {
  const shapes: { points: readonly Vec[]; closed: boolean; name: string; id?: string | undefined }[] = [
    ...solids.map((s) => ({ points: s.points, closed: s.closed, name: s.name, id: s.id })),
    { points: [...floor], closed: true, name: "the floor's edge" },
  ];
  const directions = Array.from({ length: 12 }, (_, i) => ({ x: Math.cos((i * Math.PI) / 12), z: Math.sin((i * Math.PI) / 12) }));
  if (previous) {
    const d = sub(at, previous);
    const len = length(d);
    if (len > 0) directions.push({ x: -d.z / len, z: d.x / len });
  }
  let best: Passage | null = null;
  for (const n of directions) {
    const hit = (dir: Vec) => {
      let dist = Infinity;
      let shape: (typeof shapes)[number] | null = null;
      for (const s of shapes) {
        const t = rayDistance(at, dir, [s], Infinity);
        if (t < dist) {
          dist = t;
          shape = s;
        }
      }
      return { dist, shape };
    };
    const left = hit(n);
    const right = hit({ x: -n.x, z: -n.z });
    const width = left.dist + right.dist;
    const sides = [right.shape, left.shape].filter((x) => x !== null);
    if (!best || width < best.widthM) best = { at, widthM: width, between: sides.map((x) => x.name), objectIds: sides.flatMap((x) => (x.id ? [x.id] : [])) };
  }
  return best!;
}

/** The narrowest passage along a route, measured across it. */
function narrowest(path: readonly Vec[], solids: readonly Solid[], floor: readonly Vec[]): Passage {
  let best: Passage | null = null;
  for (let s = 1; s < path.length; s++) {
    const a = path[s - 1]!;
    const b = path[s]!;
    const n = Math.max(1, Math.ceil(length(sub(b, a)) / 0.1));
    for (let q = 0; q <= n; q++) {
      const p = { x: a.x + ((b.x - a.x) * q) / n, z: a.z + ((b.z - a.z) * q) / n };
      const passage = passageAt(p, { x: p.x - (b.x - a.x), z: p.z - (b.z - a.z) }, solids, floor);
      if (!best || passage.widthM < best.widthM - 1e-9) best = passage;
    }
  }
  return best ?? passageAt(path[0]!, null, solids, floor);
}
