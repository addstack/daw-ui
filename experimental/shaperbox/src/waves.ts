import type { CurvePoint } from "../../../src/core/index.js";
import type { Kind } from "../engine/params.js";

// Waves to start from, and what the toolbar does to a wave. A wave is a curve over one cycle: `at` from 0 to 1,
// `value` from 0 (the bottom) to 1 (the top).

const flat = (value: number): CurvePoint[] => [
  { at: 0, value },
  { at: 1, value },
];

/** `count` steps across the cycle, each on for `on` of its length and then off, held. */
function gate(count: number, on: number, high = 1, low = 0): CurvePoint[] {
  const points: CurvePoint[] = [];
  for (let i = 0; i < count; i++) points.push({ at: i / count, value: high, shape: "hold" }, { at: (i + on) / count, value: low, shape: "hold" });
  points.push({ at: 1, value: low });
  return points;
}

/** Points along `f` from `from` to `to`, `count` straight segments. */
function along(f: (x: number) => number, from: number, to: number, count: number): CurvePoint[] {
  return Array.from({ length: count + 1 }, (_, i) => {
    const at = from + ((to - from) * i) / count;
    return { at, value: f(at) };
  });
}

export const WAVES = {
  Sine: [
    // Each quarter bends as a sine does: fast away from the middle, slow into a peak, and back.
    { at: 0, value: 0.5, shape: -0.3 },
    { at: 0.25, value: 1, shape: 0.3 },
    { at: 0.5, value: 0.5, shape: -0.3 },
    { at: 0.75, value: 0, shape: 0.3 },
    { at: 1, value: 0.5 },
  ],
  Triangle: [
    { at: 0, value: 0 },
    { at: 0.5, value: 1 },
    { at: 1, value: 0 },
  ],
  "Saw ↓": [
    { at: 0, value: 1 },
    { at: 1, value: 0 },
  ],
  "Saw ↑": [
    { at: 0, value: 0 },
    { at: 1, value: 1 },
  ],
  Square: [
    { at: 0, value: 1, shape: "hold" },
    { at: 0.5, value: 0, shape: "hold" },
    { at: 1, value: 0 },
  ],
  // A sidechain's duck: down at once, back up fast and then slowly.
  Pump: [
    { at: 0, value: 0, shape: -0.55 },
    { at: 0.5, value: 1 },
    { at: 1, value: 1 },
  ],
  Gate: gate(8, 0.6),
  Flat: flat(1),
} satisfies Record<string, CurvePoint[]>;

// Time's wave is where in the cycle the audio plays from: the diagonal plays it as it is.
const normal = (x: number) => x;

export const TIME_WAVES = {
  Normal: [
    { at: 0, value: 0 },
    { at: 1, value: 1 },
  ],
  "Half speed": [
    { at: 0, value: 0 },
    { at: 1, value: 0.5 },
  ],
  // Normal for three quarters, then slowing to a stop: the position's slope falls from 1 to 0.
  "Tape stop": [...along(normal, 0, 0.75, 1), ...along((x) => 0.75 + 0.125 * (1 - (1 - (x - 0.75) / 0.25) ** 2), 0.75, 1, 8).slice(1)],
  // Normal for half, then the half's last sixteenth over and over.
  Stutter: [
    { at: 0, value: 0 },
    { at: 0.5, value: 0.5 },
    ...Array.from({ length: 8 }, (_, i) => [
      { at: 0.5 + i / 16, value: 7 / 16 },
      { at: 0.5 + (i + 1) / 16, value: 8 / 16 },
    ]).flat(),
  ],
  // Normal for half, then that half backwards.
  Reverse: [
    { at: 0, value: 0 },
    { at: 0.5, value: 0.5 },
    { at: 1, value: 0 },
  ],
  // Back and forth under the hand, as a record scratched.
  Scratch: [
    { at: 0, value: 0 },
    { at: 0.5, value: 0.5, shape: 0.4 },
    { at: 0.625, value: 0.35, shape: -0.4 },
    { at: 0.75, value: 0.5, shape: 0.4 },
    { at: 0.875, value: 0.35, shape: -0.4 },
    { at: 1, value: 0.5 },
  ],
} satisfies Record<string, CurvePoint[]>;

export const wavesFor = (kind: Kind): Record<string, CurvePoint[]> => (kind === "time" ? TIME_WAVES : WAVES);

/** Upside down. */
export const invert = (points: readonly CurvePoint[]): CurvePoint[] => points.map((point) => ({ ...point, value: 1 - point.value }));

/** Back to front: a bend turns the other way, and a held segment jumps at its start instead of its end. */
export function reverse(points: readonly CurvePoint[]): CurvePoint[] {
  const reversed: CurvePoint[] = [];
  for (let i = points.length - 1; i >= 0; i--) {
    const point = points[i]!;
    const before = points[i - 1];
    const shape = before?.shape;
    const at = 1 - point.at;
    if (shape === "hold") reversed.push({ at, value: point.value }, { at, value: before!.value });
    else reversed.push({ at, value: point.value, shape: typeof shape === "number" ? -shape : shape });
  }
  return reversed;
}

/** Twice in a cycle. Time's wave also halves its height, so that each half plays its own half of the cycle. */
export function double(points: readonly CurvePoint[], kind: Kind): CurvePoint[] {
  const half = (offset: number) =>
    points.map((point) => ({ ...point, at: offset + point.at / 2, value: kind === "time" ? offset + point.value / 2 : point.value }));
  return [...half(0), ...half(0.5)];
}
