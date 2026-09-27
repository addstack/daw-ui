import { positionFormat, type LocaleOptions, type ValueField } from "./format.js";
import { createPadder, symbol } from "./numbers.js";

/**
 * Where the lines of a timeline's grid and ruler fall, and what they read:
 * the distances between lines, from fine to coarse, and the text of a line.
 * A ruler or grid uses the finest distance that leaves enough room at the
 * zoom, so zooming out shows bars instead of beats.
 */
export type TimeGrid = {
  /** Seconds between lines, from fine to coarse, each a whole multiple of the one before, so that coarser lines fall on finer ones. */
  readonly steps: readonly number[];
  /** The text of the line at `time` seconds, when lines are `step` seconds apart. */
  label(time: number, step: number): string;
};

export type MusicalGridOptions = LocaleOptions & {
  /** Beats per minute. */
  bpm: number;
  /**
   * Beats in a bar: 4 in 4/4, 3 in 3/4.
   * @default 4
   */
  beatsPerBar?: number | undefined;
  /**
   * Parts of a beat for the finest lines: 4 makes them sixteenths when the beat is a quarter note.
   * @default 4
   */
  divisions?: number | undefined;
};

/**
 * Bars, beats and their divisions at a constant tempo, from time 0 at bar 1.
 * Lines are divisions, beats, bars, then 2, 4, 8 … bars; they read as a
 * song position, as fine as they are apart: "12", "12.3", "12.3.2".
 */
export function musicalGrid({ bpm, beatsPerBar = 4, divisions = 4, locale }: MusicalGridOptions): TimeGrid {
  if (!(bpm > 0)) throw new RangeError(`bpm (${bpm}) must be greater than 0.`);
  const beat = 60 / bpm;
  const bar = beat * beatsPerBar;
  const steps = divisions > 1 ? [beat / divisions, beat] : [beat];
  for (let bars = 1; bars <= 1024; bars *= 2) steps.push(bar * bars);
  const fields = positionFormat({ beatsPerBar, divisions, locale })
    .segments!.filter((segment): segment is ValueField => segment.type === "field");
  // A step a hair under a beat, from floating-point noise, is still a beat.
  const atLeast = (step: number, unit: number) => step >= unit * (1 - 1e-9);
  return {
    steps,
    label(time, step) {
      const beats = time / beat;
      const count = atLeast(step, bar) ? 1 : atLeast(step, beat) ? 2 : 3;
      return fields
        .slice(0, count)
        .map((field) => field.format(beats))
        .join(".");
    },
  };
}

const CLOCK_STEPS = [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10, 30, 60, 300, 600, 1800, 3600, 7200, 14_400, 28_800, 57_600];

/**
 * Minutes and seconds: "1:05", with the decimals the zoom needs ("1:05.5",
 * "1:05.250"), and hours from an hour on ("1:00:00"). Digits and the
 * decimal separator follow the locale.
 */
export function clockGrid({ locale }: LocaleOptions = {}): TimeGrid {
  const pad = createPadder(locale);
  const decimal = symbol(locale, "decimal", ".");
  const minus = symbol(locale, "minusSign", "-");
  return {
    steps: CLOCK_STEPS,
    label(time, step) {
      const digits = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
      const unit = 10 ** digits;
      const total = Math.round(Math.abs(time) * unit);
      const whole = Math.floor(total / unit);
      const hours = Math.floor(whole / 3600);
      const minutes = Math.floor(whole / 60) % 60;
      const seconds = whole % 60;
      let text = hours > 0 ? `${pad(hours)}:${pad(minutes, 2)}:${pad(seconds, 2)}` : `${pad(minutes)}:${pad(seconds, 2)}`;
      if (digits > 0) text += decimal + pad(total % unit, digits);
      return (time < 0 && total > 0 ? minus : "") + text;
    },
  };
}

/** The finest step of `grid` at least `spacing` CSS pixels apart at `scale` pixels per second; the coarsest when none is. */
export function gridStep(grid: TimeGrid, scale: number, spacing: number): number {
  for (const step of grid.steps) if (step * scale >= spacing) return step;
  return grid.steps[grid.steps.length - 1]!;
}
