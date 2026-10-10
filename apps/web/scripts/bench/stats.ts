// Pure statistics for benchmark windows. Percentiles use the nearest-rank method.

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank]!;
}

export const median = (values: readonly number[]): number => percentile(values, 50);

export interface FrameStats {
  frames: number;
  medianMs: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  /** Frames longer than 33.4 ms: below 30 frames per second for that frame. */
  over33: number;
  /** Frames longer than 50 ms: a visible hitch. */
  over50: number;
}

export function frameStats(frames: readonly number[]): FrameStats {
  return {
    frames: frames.length,
    medianMs: round(median(frames)),
    p95Ms: round(percentile(frames, 95)),
    p99Ms: round(percentile(frames, 99)),
    maxMs: round(Math.max(...frames)),
    over33: frames.filter((f) => f > 33.4).length,
    over50: frames.filter((f) => f > 50).length,
  };
}

export const round = (value: number, digits = 2): number => Math.round(value * 10 ** digits) / 10 ** digits;

/** "8.33 (8.30–8.40)": the median of per-run values with their range. */
export function spread(values: readonly number[], digits = 1): string {
  if (values.length === 0) return "-";
  const fmt = (v: number) => v.toFixed(digits);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return lo === hi ? fmt(lo) : `${fmt(median(values))} (${fmt(lo)}–${fmt(hi)})`;
}
