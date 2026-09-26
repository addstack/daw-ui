import { describe, expect, test } from "vitest";

import { createMeterBallistics, decibelsToGain, gainToDecibels } from "../src/core/index.js";

describe("createMeterBallistics", () => {
  test("rises at once and falls at the given rate", () => {
    const meter = createMeterBallistics({ floor: -60, fall: 20 });
    expect(meter.update(-6, 0).level).toBe(-6);
    expect(meter.update(-60, 500).level).toBe(-16);
    expect(meter.update(-60, 1000).level).toBe(-26);
  });

  test("holds the peak, then lets it fall", () => {
    const meter = createMeterBallistics({ floor: -60, fall: 20, hold: 1000 });
    meter.update(-3, 0);
    expect(meter.update(-60, 900).peak).toBe(-3);
    expect(meter.update(-60, 1000).peak).toBe(-3);
    expect(meter.update(-60, 1500).peak).toBe(-13);
  });

  test("never goes below the floor, also for silence and NaN", () => {
    const meter = createMeterBallistics({ floor: -60 });
    expect(meter.update(-Infinity, 0).level).toBe(-60);
    expect(meter.update(Number.NaN, 16).level).toBe(-60);
  });

  test("keeps the clip indicator until it is reset", () => {
    const meter = createMeterBallistics({ clipAbove: 0 });
    expect(meter.update(-1, 0).clipped).toBe(false);
    expect(meter.update(0.5, 16).clipped).toBe(true);
    expect(meter.update(-30, 5000).clipped).toBe(true);
    meter.resetClip();
    expect(meter.reading.clipped).toBe(false);
    expect(meter.update(-30, 5016).clipped).toBe(false);
  });
});

test("gain and decibels convert both ways", () => {
  expect(gainToDecibels(1)).toBe(0);
  expect(gainToDecibels(0.5)).toBeCloseTo(-6.02, 2);
  expect(gainToDecibels(0)).toBe(-Infinity);
  expect(decibelsToGain(-6.0206)).toBeCloseTo(0.5, 4);
});
