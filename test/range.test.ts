import { describe, expect, test } from "vitest";

import { createRange, scales } from "../src/core/index.js";

describe("createRange", () => {
  test("maps a linear range to travel and back", () => {
    const range = createRange({ min: -1, max: 1 });
    expect(range.normalize(0)).toBe(0.5);
    expect(range.denormalize(0.25)).toBe(-0.5);
  });

  test("clamps values and travel", () => {
    const range = createRange({ min: 0, max: 10 });
    expect(range.normalize(20)).toBe(1);
    expect(range.normalize(-5)).toBe(0);
    expect(range.denormalize(1.5)).toBe(10);
  });

  test("snaps to the step, without floating-point noise", () => {
    const range = createRange({ min: 0, max: 1, step: 0.1 });
    expect(range.constrain(0.34)).toBe(0.3);
    expect(range.denormalize(0.3)).toBe(0.3);
    expect(range.constrain(0.1 + 0.2)).toBe(0.3);
  });

  test("snaps relative to min, and stays in range when the span is no multiple of the step", () => {
    const range = createRange({ min: 1, max: 10, step: 2 });
    expect(range.constrain(4.2)).toBe(5);
    expect(range.constrain(10)).toBe(10);
  });

  test("steps count from 0 when min is -Infinity, and silence stays silence", () => {
    const range = createRange({ min: -Infinity, max: 6, step: 0.5, scale: scales.decibel });
    expect(range.constrain(-6.3)).toBe(-6.5);
    expect(range.constrain(0.2)).toBe(0);
    expect(range.constrain(-Infinity)).toBe(-Infinity);
  });

  test("rejects an empty range and a non-positive step", () => {
    expect(() => createRange({ min: 1, max: 1 })).toThrow(RangeError);
    expect(() => createRange({ min: 0, max: 1, step: 0 })).toThrow(RangeError);
  });
});

describe("scales", () => {
  test("log gives equal travel to equal ratios", () => {
    const range = createRange({ min: 20, max: 20_000, scale: scales.log });
    expect(range.normalize(200)).toBeCloseTo(1 / 3);
    expect(range.normalize(2000)).toBeCloseTo(2 / 3);
    expect(range.denormalize(0.5)).toBeCloseTo(632.46, 1);
  });

  test("power stretches the low end when the exponent is above 1", () => {
    const range = createRange({ min: 0, max: 100, scale: scales.power(2) });
    expect(range.normalize(25)).toBeCloseTo(0.5);
    expect(range.denormalize(0.5)).toBeCloseTo(25);
  });

  test("decibel puts 0 dB near 80% of a -70 … +6 dB fader, like a console", () => {
    const range = createRange({ min: -70, max: 6, scale: scales.decibel });
    expect(range.normalize(0)).toBeCloseTo(0.82, 2);
    expect(range.normalize(-12)).toBeCloseTo(0.545, 3);
    expect(range.denormalize(range.normalize(-6))).toBeCloseTo(-6);
  });

  test("decibel reaches -Infinity at the bottom of a fader that goes to silence", () => {
    const range = createRange({ min: -Infinity, max: 6, scale: scales.decibel });
    expect(range.denormalize(0)).toBe(-Infinity);
    expect(range.normalize(-Infinity)).toBe(0);
    expect(range.normalize(6)).toBe(1);
  });

  test("every scale round-trips across the travel", () => {
    const cases = [
      createRange({ min: -1, max: 1 }),
      createRange({ min: 20, max: 20_000, scale: scales.log }),
      createRange({ min: 0, max: 5000, scale: scales.power(3) }),
      createRange({ min: -60, max: 12, scale: scales.decibel }),
    ];
    for (const range of cases) {
      for (let travel = 0; travel <= 1; travel += 0.125) {
        expect(range.normalize(range.denormalize(travel))).toBeCloseTo(travel, 9);
      }
    }
  });
});
