import { describe, expect, test } from "vitest";

import { createRange, curveEase, curveValue, scales, type CurvePoint } from "../src/core/index.js";

// A second up from 0 to 1, a held second at 0.5, then a jump down to 0.
const points: CurvePoint[] = [
  { at: 0, value: 0 },
  { at: 1, value: 1 },
  { at: 2, value: 0.5, shape: "hold" },
  { at: 3, value: 0 },
];

describe("curveValue", () => {
  test("holds the first value before the first point and the last after the last", () => {
    expect(curveValue(points, -5)).toBe(0);
    expect(curveValue(points, 10)).toBe(0);
    expect(curveValue([], 1)).toBeNaN();
  });

  test("goes straight between points, and a held segment stays until the next point jumps", () => {
    expect(curveValue(points, 0.25)).toBe(0.25);
    expect(curveValue(points, 1.5)).toBe(0.75);
    expect(curveValue(points, 2.99)).toBe(0.5);
    expect(curveValue(points, 3)).toBe(0);
  });

  test("two points at the same time jump to the later one", () => {
    const jump: CurvePoint[] = [
      { at: 0, value: 0 },
      { at: 1, value: 0 },
      { at: 1, value: 1 },
      { at: 2, value: 1 },
    ];
    expect(curveValue(jump, 0.99)).toBe(0);
    expect(curveValue(jump, 1)).toBe(1);
  });

  test("a tension bends a segment: above 0 it moves late, below 0 early", () => {
    const late = curveValue([{ at: 0, value: 0, shape: 0.5 }, { at: 1, value: 1 }], 0.5);
    const early = curveValue([{ at: 0, value: 0, shape: -0.5 }, { at: 1, value: 1 }], 0.5);
    expect(late).toBeCloseTo(0.5 ** 2 ** 1.5);
    expect(late).toBeLessThan(0.5);
    expect(early).toBeGreaterThan(0.5);
    expect(curveEase(1, 1)).toBe(1);
    expect(curveEase(0, 0.3)).toBe(0.3);
  });

  test("with a range, segments go straight in its travel positions, as on a fader", () => {
    const volume = createRange({ min: -Infinity, max: 6, scale: scales.decibel });
    const fade: CurvePoint[] = [
      { at: 0, value: 0 },
      { at: 1, value: -Infinity },
    ];
    const halfway = curveValue(fade, 0.5, volume);
    // Halfway in fader travel between 0 dB and silence, not halfway in decibels (which would be -Infinity).
    expect(volume.normalize(halfway)).toBeCloseTo((volume.normalize(0) + volume.normalize(-Infinity)) / 2);
    expect(Number.isFinite(halfway)).toBe(true);
  });
});
