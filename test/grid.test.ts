import { describe, expect, test } from "vitest";

import { clockGrid, gridStep, musicalGrid, type TimeGrid } from "../src/core/index.js";

const nested = (grid: TimeGrid) =>
  grid.steps.every((step, index) => {
    const ratio = index === 0 ? 1 : step / grid.steps[index - 1]!;
    return Math.abs(ratio - Math.round(ratio)) < 1e-9 && ratio >= 1;
  });

describe("musicalGrid", () => {
  const grid = musicalGrid({ bpm: 120, locale: "en" });

  test("lines are sixteenths, beats, bars, then twice as many bars at a time", () => {
    expect(grid.steps.slice(0, 5)).toEqual([0.125, 0.5, 2, 4, 8]);
    expect(nested(grid)).toBe(true);
    expect(nested(musicalGrid({ bpm: 97, beatsPerBar: 3, divisions: 3 }))).toBe(true);
  });

  test("lines read as a song position, as fine as they are apart", () => {
    expect(grid.label(0, 2)).toBe("1");
    expect(grid.label(6, 2)).toBe("4");
    expect(grid.label(2.5, 0.5)).toBe("2.2");
    expect(grid.label(2.625, 0.125)).toBe("2.2.2");
  });

  test("needs a tempo", () => {
    expect(() => musicalGrid({ bpm: 0 })).toThrow(RangeError);
  });
});

describe("clockGrid", () => {
  const grid = clockGrid({ locale: "en" });

  test("reads minutes and seconds, with the decimals the zoom needs", () => {
    expect(grid.label(65, 5)).toBe("1:05");
    expect(grid.label(65.5, 0.5)).toBe("1:05.5");
    expect(grid.label(65.25, 0.05)).toBe("1:05.25");
    expect(grid.label(3600, 60)).toBe("1:00:00");
    expect(grid.label(-1, 1)).toBe("-0:01");
    expect(nested(grid)).toBe(true);
  });

  test("follows the locale's decimal separator", () => {
    expect(clockGrid({ locale: "pl" }).label(65.5, 0.5)).toBe("1:05,5");
  });
});

describe("gridStep", () => {
  const grid = musicalGrid({ bpm: 120 });

  test("is the finest step that leaves the spacing, or the coarsest", () => {
    // 100 px per second: a sixteenth is 12.5 px, a beat 50 px, a bar 200 px.
    expect(gridStep(grid, 100, 12)).toBe(0.125);
    expect(gridStep(grid, 100, 64)).toBe(2);
    expect(gridStep(grid, 0.0001, 64)).toBe(grid.steps.at(-1));
  });
});
