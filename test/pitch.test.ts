import { describe, expect, test } from "vitest";

import { readPitch } from "../src/core/index.js";

/** The frequency of a MIDI note with a fraction, at A4 = 440 Hz. */
const hertz = (note: number) => 440 * 2 ** ((note - 69) / 12);

describe("readPitch", () => {
  test("reads a frequency as a note with a fraction, the nearest note and the cents off", () => {
    expect(readPitch(440)).toEqual({ note: 69, target: 69, cents: 0 });
    const sharp = readPitch(446)!;
    expect([sharp.target, Math.round(sharp.cents)]).toEqual([69, 23]);
    const flat = readPitch(hertz(59.7))!;
    expect([flat.target, Math.round(flat.cents)]).toEqual([60, -30]);
    // At A4 = 432 Hz, 432 Hz is A4.
    expect(readPitch(432, { reference: 432 })!.target).toBe(69);
  });

  test("silence is null", () => {
    expect([readPitch(null), readPitch(0), readPitch(-1), readPitch(Number.NaN), readPitch(Infinity)]).toEqual([null, null, null, null, null]);
  });

  test("the note stays on the previous one until the pitch is nearer another by the hysteresis", () => {
    expect(readPitch(hertz(60.4))!.target).toBe(60);
    // Past the middle, but not by 10 cents: still C4.
    expect(readPitch(hertz(60.54), { previous: 60 })!.target).toBe(60);
    expect(readPitch(hertz(60.56), { previous: 60 })!.target).toBe(61);
    // Without a previous reading, the nearest.
    expect(readPitch(hertz(60.54))!.target).toBe(61);
  });

  test("targets are the notes a pitch is tuned to, such as strings; a target locks one", () => {
    const strings = [40, 45, 50, 55, 59, 64];
    const low = readPitch(hertz(41.3), { targets: strings })!;
    expect([low.target, Math.round(low.cents)]).toEqual([40, 130]);
    expect(readPitch(hertz(42.54), { targets: strings, previous: 40 })!.target).toBe(40);
    expect(readPitch(hertz(42.56), { targets: strings, previous: 40 })!.target).toBe(45);
    // A previous target that is no longer one of the targets gives way at once.
    expect(readPitch(hertz(41), { targets: strings, previous: 41 })!.target).toBe(40);
    expect(readPitch(hertz(41.3), { targets: strings, target: 45 })!.target).toBe(45);
  });
});
