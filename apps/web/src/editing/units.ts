// Display units for editing: metres and degrees in the UI, metres and radians in the contract.
// Numeric fields and handles both go through these functions, so the same decimal value typed
// or dragged becomes the same stored number.

/** Resolution of length fields and handles: 1 mm. */
export const LENGTH_DECIMALS = 3;
/** Resolution of angle fields: 0.1°. */
export const ANGLE_DECIMALS = 1;

/** Turn -0 into 0 so JSON (which writes -0 as 0) and the scene hold the same number. */
const plain = (value: number): number => value + 0;

/**
 * Nearest multiple of `stepMm` millimetres, in metres. The result is an integer number of
 * millimetres divided by 1000, which is exactly the double that parsing the decimal text gives,
 * so a handle that snaps to 2.35 m stores the same number as typing "2.35".
 */
export function quantizeMetres(valueM: number, stepMm: number): number {
  return plain((Math.round((valueM * 1000) / stepMm) * stepMm) / 1000);
}

/** Nearest multiple of `stepDeg` degrees. */
export function quantizeDegrees(deg: number, stepDeg: number): number {
  return plain(Math.round(deg / stepDeg) * stepDeg);
}

export function degToRad(deg: number): number {
  return plain((deg * Math.PI) / 180);
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** Wrap an angle in degrees into (-180, 180]. */
export function wrapDegrees(deg: number): number {
  const wrapped = ((((deg + 180) % 360) + 360) % 360) - 180;
  return plain(wrapped === -180 ? 180 : wrapped);
}

/** Fixed-point text for an editable field ("-7.700", "90.0"). Never shows "-0.000". */
export function formatFixed(value: number, decimals: number): string {
  const text = value.toFixed(decimals);
  return Number(text) === 0 ? (0).toFixed(decimals) : text;
}

export type Parsed = { ok: true; value: number } | { ok: false; message: string };

const DECIMAL = /^[-+]?(\d+\.?\d*|\.\d+)$/;

/**
 * Parse a plain decimal ("2.35", "-7", ".5") with at most `maxDecimals` decimal places.
 * More precision than the field resolution is refused rather than silently rounded.
 */
export function parseDecimal(text: string, maxDecimals: number, unit: string): Parsed {
  const trimmed = text.trim().replace(/^−/, "-");
  if (!DECIMAL.test(trimmed)) return { ok: false, message: `Enter a number in ${unit}.` };
  const decimals = trimmed.includes(".") ? trimmed.length - trimmed.indexOf(".") - 1 : 0;
  if (decimals > maxDecimals) {
    return { ok: false, message: `Use at most ${maxDecimals} decimal place${maxDecimals === 1 ? "" : "s"} (${unit}).` };
  }
  return { ok: true, value: plain(Number(trimmed)) };
}
