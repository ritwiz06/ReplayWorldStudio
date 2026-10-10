import type { Dimensions, KnownParameter } from "@replay-world/contracts";

type Origin = Dimensions["width"]["origin"];

export const ORIGIN_LABEL: Record<Origin, string> = {
  measured: "Measured",
  user_supplied: "User-supplied",
  supplier: "Supplier",
  inferred: "Inferred",
  default: "Default",
};

export const REVIEW_LABEL: Record<Dimensions["width"]["review_status"], string> = {
  unreviewed: "Unreviewed",
  confirmed: "Confirmed",
};

const UNIT_LABEL: Record<KnownParameter["unit"], string> = {
  m: "m",
  s: "s",
  kg: "kg",
  rad: "rad",
  "m/s": "m/s",
  "1": "",
};

export function formatNumber(value: number, digits = 2): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatMetres(value: number): string {
  return `${formatNumber(value)} m`;
}

export function formatValue(value: number, unit: KnownParameter["unit"]): string {
  return `${formatNumber(value)} ${UNIT_LABEL[unit]}`.trim();
}

export function formatRadians(value: number): string {
  return `${formatNumber(value, 3)} rad (${formatNumber((value * 180) / Math.PI, 1)}°)`;
}

/** Plan footprint (width along X × depth along Z) followed by height, e.g. "1.20 × 1.00 m · 1.40 m high". */
export function formatFootprint(d: Dimensions): string {
  return `${formatNumber(d.width.value_m)} × ${formatNumber(d.depth.value_m)} m · ${formatNumber(d.height.value_m)} m high`;
}

/** Display name of each object kind. */
export const KIND_LABEL = {
  structure: "Structure",
  equipment: "Equipment",
  reference: "Reference",
  walkway: "Walkway",
  keep_clear: "Keep-clear zone",
} as const;
