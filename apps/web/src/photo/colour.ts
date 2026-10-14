// Colours from the photo itself. A vision model names what an object is made of ("plastic",
// "wood") more reliably than how it looks, so each object's appearance is suggested from the
// pixels inside its outline when they show a clear colour (matched to the nearest approved
// appearance in CIELAB, with the floor and wall set aside). Only a suggestion; the user can
// change it.
import type { GeometryPart, ImageBox } from "@replay-world/contracts";

type Material = GeometryPart["material"];

/**
 * Base colours (sRGB) of the appearances a photo object may get. They mirror the generated-model
 * materials in services/api/src/replay_world_api/objects/materials.py (a test checks they agree).
 * Clear glass is left out: its colour is whatever is behind it.
 */
export const APPEARANCE_SRGB: Partial<Record<Material, string>> = {
  paint_light_grey: "#c9cdcf",
  paint_white: "#ecece7",
  paint_anthracite: "#3a4045",
  plastic_black: "#222426",
  plastic_grey: "#8a8f94",
  fabric_grey: "#6d7175",
  wood: "#a87a4f",
  pallet_wood: "#c49a62",
  cardboard: "#b98c5e",
  paint_blue: "#1f5fa8",
  paint_red: "#af2b1e",
  paint_green: "#308446",
  paint_orange: "#e75b12",
  safety_yellow: "#e5ad0c",
  aluminium: "#b9bfc5",
  stainless_steel: "#c4c8cc",
  steel_dark: "#555b62",
};

export interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

type Rgb = [number, number, number];

/** Pixels sampled on a grid of about `target` points over [x0, x1) x [y0, y1), clipped to the image. */
function* grid(pixels: Pixels, x0: number, x1: number, y0: number, y1: number, target: number): Generator<{ x: number; y: number; rgb: Rgb }> {
  const ax = Math.max(0, Math.floor(x0));
  const bx = Math.min(pixels.width, Math.ceil(x1));
  const ay = Math.max(0, Math.floor(y0));
  const by = Math.min(pixels.height, Math.ceil(y1));
  if (bx <= ax || by <= ay) return;
  const step = Math.max(1, Math.round(Math.sqrt(((bx - ax) * (by - ay)) / target)));
  for (let y = ay; y < by; y += step) {
    for (let x = ax; x < bx; x += step) {
      const i = (y * pixels.width + x) * 4;
      yield { x, y, rgb: [pixels.data[i]!, pixels.data[i + 1]!, pixels.data[i + 2]!] };
    }
  }
}

/** Share of the samples matched to each appearance. */
function shares(samples: Iterable<Rgb>): Map<Material, number> {
  const counts = new Map<Material, number>();
  let total = 0;
  for (const rgb of samples) {
    const m = nearestAppearance(rgb);
    counts.set(m, (counts.get(m) ?? 0) + 1);
    total++;
  }
  for (const [m, n] of counts) counts.set(m, n / total);
  return counts;
}

/** Share of a floor or wall strip that makes an appearance count as background. */
const BACKGROUND_SHARE = 0.12;

/** Least share of the outline a clear colour needs to be suggested. */
const MIN_COLOURED_SHARE = 0.15;

/**
 * A clear colour that belongs to the object, when the photo shows one: the pixels inside the
 * outline are matched to their nearest appearance, the floor's (a strip under the outline) and
 * the wall's (a strip above it: any appearance covering 12 % of either) are set aside, and the most common clearly coloured appearance
 * left wins if it covers enough of the outline. Null otherwise: greys, shadows and see-through
 * objects are too easily confused with what is behind them, so the model's suggestion stays.
 */
export function suggestAppearance(pixels: Pixels, box: ImageBox): Material | null {
  const x0 = box.left * pixels.width;
  const x1 = box.right * pixels.width;
  const y0 = box.top * pixels.height;
  const y1 = box.bottom * pixels.height;
  const strip = Math.max(2, 0.08 * (y1 - y0));
  const background = new Set<Material>();
  // Outside the photo, the outline's own edge stands in for the strip.
  const below: [number, number] = y1 + 1 < pixels.height ? [y1, y1 + strip] : [y1 - strip, y1];
  const above: [number, number] = y0 - 1 > 0 ? [y0 - strip, y0] : [y0, y0 + strip];
  for (const [a, b] of [below, above]) {
    for (const [m, share] of shares(Array.from(grid(pixels, x0, x1, a, b, 400), (p) => p.rgb))) {
      if (share >= BACKGROUND_SHARE) background.add(m);
    }
  }
  let best: Material | null = null;
  let bestShare = MIN_COLOURED_SHARE;
  for (const [m, share] of shares(Array.from(grid(pixels, x0, x1, y0, y1, 3000), (p) => p.rgb))) {
    if (!background.has(m) && isColoured(m) && share >= bestShare) {
      best = m;
      bestShare = share;
    }
  }
  return best;
}

function lab([r, g, b]: Rgb): Rgb {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const x = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

const hexRgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
const PALETTE = Object.entries(APPEARANCE_SRGB).map(([material, hex]) => ({ material: material as Material, lab: lab(hexRgb(hex)) }));

/** Chroma (CIELAB) above which a colour counts as clearly coloured rather than a grey. */
const CHROMATIC = 15;

const chroma = (c: Rgb) => Math.hypot(c[1], c[2]);
const hue = (c: Rgb) => (Math.atan2(c[2], c[1]) * 180) / Math.PI;

/**
 * The approved appearance closest to a colour. Clearly coloured pixels are matched on hue first
 * (then chroma and lightness) among the coloured appearances, so a dark maroon chair reads as red
 * rather than black; greys are matched by plain CIELAB distance.
 */
function isColoured(material: Material): boolean {
  const entry = PALETTE.find((p) => p.material === material);
  return entry !== undefined && chroma(entry.lab) >= CHROMATIC;
}

export function nearestAppearance(rgb: Rgb): Material {
  const target = lab(rgb);
  const coloured = chroma(target) >= CHROMATIC;
  const candidates = coloured ? PALETTE.filter((p) => chroma(p.lab) >= CHROMATIC) : PALETTE;
  let best = candidates[0]!;
  let bestDistance = Infinity;
  for (const entry of candidates) {
    let d: number;
    if (coloured) {
      const dh = Math.abs(((hue(entry.lab) - hue(target) + 540) % 360) - 180);
      d = dh + 0.5 * Math.abs(chroma(entry.lab) - chroma(target)) + 0.2 * Math.abs(entry.lab[0] - target[0]);
    } else {
      d = Math.hypot(entry.lab[0] - target[0], entry.lab[1] - target[1], entry.lab[2] - target[2]);
    }
    if (d < bestDistance) {
      best = entry;
      bestDistance = d;
    }
  }
  return best.material;
}
