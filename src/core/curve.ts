import type { Range } from "./range.js";

/**
 * How a curve goes from a point to the next: `"linear"` in a straight line,
 * `"hold"` at the point's value until the next point jumps, or a tension
 * from −1 to 1 that bends it: above 0 it stays near the point's value and
 * moves late, below 0 it moves early; 0 is a straight line.
 */
export type CurveShape = "linear" | "hold" | number;

/** A point of a curve: of automation, a fade, a tempo change. */
export type CurvePoint = {
  /** Seconds. */
  at: number;
  value: number;
  /**
   * How the curve goes from this point to the next.
   * @default "linear"
   */
  shape?: CurveShape | undefined;
};

/**
 * How far a segment has gone, 0 … 1, at `fraction` 0 … 1 of its time: a
 * straight line, or bent by a tension, as `fraction ** 2 ** (3 · tension)`.
 * A held segment stays at 0 until its end.
 */
export function curveEase(shape: CurveShape | undefined, fraction: number): number {
  if (shape === "hold") return fraction < 1 ? 0 : 1;
  if (typeof shape !== "number" || shape === 0) return fraction;
  return fraction ** 2 ** (3 * Math.max(-1, Math.min(1, shape)));
}

/** The index of the first of `points`, sorted by `at`, that is after `time`. */
export function pointAfter(points: readonly CurvePoint[], time: number): number {
  let low = 0;
  let high = points.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (points[middle]!.at <= time) low = middle + 1;
    else high = middle;
  }
  return low;
}

const identity = { normalize: (value: number) => value, denormalize: (value: number) => value };

/**
 * The travel position of a curve at `time` between `previous` and `next`
 * (either may be missing, before the first point or after the last): what
 * `curveValue` gives before `range.denormalize`. At `next.at` itself, a
 * held segment has not jumped yet: the jump is the next point's.
 */
export function curvePosition(
  previous: CurvePoint | undefined,
  next: CurvePoint | undefined,
  time: number,
  range: Pick<Range, "normalize"> = identity,
): number {
  if (!previous) return next ? range.normalize(next.value) : Number.NaN;
  const from = range.normalize(previous.value);
  if (!next || previous.shape === "hold") return from;
  const to = range.normalize(next.value);
  if (!(next.at > previous.at)) return to;
  return from + (to - from) * curveEase(previous.shape, Math.min(1, Math.max(0, (time - previous.at) / (next.at - previous.at))));
}

/**
 * The value of a curve at `time`, from `points` sorted by `at`: the first
 * point's value before it, the last one's after it, `NaN` without points.
 * Two points at the same time make a jump, to the later one's value.
 *
 * With a `range`, segments go straight in its travel positions, as a fader
 * moved at a steady pace would: a fade on a decibel range goes as it would
 * on a volume fader. Without, they go straight in value.
 */
export function curveValue(points: readonly CurvePoint[], time: number, range?: Range): number {
  const index = pointAfter(points, time);
  const position = curvePosition(points[index - 1], points[index], time, range);
  return range ? range.denormalize(position) : position;
}
