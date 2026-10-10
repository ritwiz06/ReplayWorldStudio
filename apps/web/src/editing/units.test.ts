import { describe, expect, it } from "vitest";
import { degToRad, formatFixed, parseDecimal, quantizeDegrees, quantizeMetres, radToDeg, wrapDegrees } from "./units";

describe("units shared by numeric fields and handles", () => {
  it("snaps to exactly the number that typing the same decimal gives", () => {
    for (const text of ["2.35", "-7.2", "0.83", "-5.195", "12.345", "0.001", "999.999"]) {
      const typed = parseDecimal(text, 3, "m");
      expect(typed.ok).toBe(true);
      if (!typed.ok) continue;
      // A handle drag ends at some raw float near the value and snaps to 1 mm.
      for (const noise of [0, 1e-12, -1e-12, 3e-4, -3e-4]) expect(quantizeMetres(typed.value + noise, 1)).toBe(typed.value);
    }
    expect(quantizeMetres(2.3456, 10)).toBe(Number("2.35"));
    expect(quantizeMetres(-5.195, 10)).toBe(-5.19);
  });

  it("never produces negative zero, which JSON would save as 0", () => {
    expect(Object.is(quantizeMetres(-0.0004, 1), 0)).toBe(true);
    expect(Object.is(quantizeDegrees(-0.4, 1), 0)).toBe(true);
    expect(Object.is(degToRad(-0), 0)).toBe(true);
    const parsed = parseDecimal("-0.000", 3, "m");
    expect(parsed.ok && Object.is(parsed.value, 0)).toBe(true);
  });

  it("converts degrees in the UI to radians in the contract with one formula", () => {
    expect(degToRad(90)).toBe(Math.PI / 2);
    expect(degToRad(180)).toBe(Math.PI);
    expect(radToDeg(degToRad(33.3))).toBeCloseTo(33.3, 12);
    expect(formatFixed(radToDeg(1.570796326795), 1)).toBe("90.0");
  });

  it("wraps angles into (-180, 180]", () => {
    expect([wrapDegrees(180), wrapDegrees(-180), wrapDegrees(270), wrapDegrees(-450), wrapDegrees(360)]).toEqual([180, 180, -90, -90, 0]);
  });

  it("refuses non-numbers and more precision than the field resolution", () => {
    expect(parseDecimal("abc", 3, "m")).toEqual({ ok: false, message: "Enter a number in m." });
    expect(parseDecimal("1e3", 3, "m").ok).toBe(false);
    expect(parseDecimal("", 3, "m").ok).toBe(false);
    expect(parseDecimal("1.2345", 3, "m")).toEqual({ ok: false, message: "Use at most 3 decimal places (m)." });
    expect(parseDecimal("12.34", 1, "°")).toEqual({ ok: false, message: "Use at most 1 decimal place (°)." });
    expect(parseDecimal(" −3.5 ", 1, "°")).toEqual({ ok: true, value: -3.5 });
    expect(parseDecimal(".5", 3, "m")).toEqual({ ok: true, value: 0.5 });
  });

  it("formats fields without a negative zero", () => {
    expect(formatFixed(-0.0001, 3)).toBe("0.000");
    expect(formatFixed(-7.7, 3)).toBe("-7.700");
  });
});
