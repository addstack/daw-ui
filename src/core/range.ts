/**
 * How a parameter's travel (0 at the start of a knob or fader, 1 at the end)
 * maps to its value. Values passed in are already within [min, max].
 */
export type Scale = {
  toNormalized(value: number, min: number, max: number): number;
  fromNormalized(normalized: number, min: number, max: number): number;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const linear: Scale = {
  toNormalized: (value, min, max) => (max === min ? 0 : (value - min) / (max - min)),
  fromNormalized: (normalized, min, max) => min + normalized * (max - min),
};

/**
 * Equal travel for equal ratios, as for frequencies and times: on a
 * 20 Hz – 20 kHz knob, 200 Hz and 2 kHz are a third and two thirds of the way.
 * Needs `min > 0`.
 */
const log: Scale = {
  toNormalized: (value, min, max) => Math.log(value / min) / Math.log(max / min),
  fromNormalized: (normalized, min, max) => min * Math.pow(max / min, normalized),
};

/**
 * Stretches one end of the travel. `exponent > 1` gives the low values more
 * room, `exponent < 1` the high ones. The same as JUCE's skew factor, inverted.
 */
function power(exponent: number): Scale {
  return {
    toNormalized: (value, min, max) => Math.pow(linear.toNormalized(value, min, max), 1 / exponent),
    fromNormalized: (normalized, min, max) => linear.fromNormalized(Math.pow(normalized, exponent), min, max),
  };
}

const amplitude = (decibels: number) => Math.pow(10, decibels / 20);

/**
 * A mixing-console fader law for values in dB: travel follows amplitude to the
 * power of 1/4. On a -70 … +6 dB fader, 0 dB sits at about 80% of the travel
 * and -12 dB near the middle, and the bottom quarter covers the quiet end.
 */
const decibel: Scale = {
  toNormalized(value, min, max) {
    const low = Math.pow(amplitude(min), 0.25);
    const high = Math.pow(amplitude(max), 0.25);
    return (Math.pow(amplitude(value), 0.25) - low) / (high - low);
  },
  fromNormalized(normalized, min, max) {
    const low = Math.pow(amplitude(min), 0.25);
    const high = Math.pow(amplitude(max), 0.25);
    const root = low + normalized * (high - low);
    return 20 * Math.log10(Math.pow(root, 4));
  },
};

export const scales = { linear, log, power, decibel };

export type RangeOptions = {
  min: number;
  max: number;
  /** Values snap to `min + k * step`. Leave it out for a continuous parameter. */
  step?: number | undefined;
  /**
   * How travel maps to value.
   * @default scales.linear
   */
  scale?: Scale | undefined;
};

export type Range = {
  readonly min: number;
  readonly max: number;
  readonly step: number | undefined;
  readonly scale: Scale;
  clamp(value: number): number;
  /** Clamps, then snaps to the step. */
  constrain(value: number): number;
  /** Travel position in [0, 1] of a value. */
  normalize(value: number): number;
  /** Value at a travel position, constrained. */
  denormalize(normalized: number): number;
};

/** The value model shared by knobs, faders and number boxes. */
export function createRange({ min, max, step, scale = linear }: RangeOptions): Range {
  if (!(max > min)) throw new RangeError(`max (${max}) must be greater than min (${min}).`);
  if (step !== undefined && !(step > 0)) throw new RangeError(`step (${step}) must be greater than 0.`);

  const clamp = (value: number) => Math.min(max, Math.max(min, value));
  const constrain = (value: number) => {
    const clamped = clamp(value);
    // 12 significant digits drop noise such as 0.30000000000000004 and keep far more precision than any control shows.
    if (step === undefined) return Number(clamped.toPrecision(12));
    const snapped = min + Math.round((clamped - min) / step) * step;
    // Remove floating-point noise such as 0.30000000000000004, and stay in range when max - min is no multiple of step.
    return clamp(Number(snapped.toFixed(decimalsOf(step) + decimalsOf(min))));
  };

  return {
    min,
    max,
    step,
    scale,
    clamp,
    constrain,
    normalize: (value) => clamp01(scale.toNormalized(clamp(value), min, max)),
    denormalize: (normalized) => constrain(scale.fromNormalized(clamp01(normalized), min, max)),
  };
}

function decimalsOf(value: number): number {
  const text = String(value);
  if (text.includes("e-")) return Number(text.split("e-")[1]);
  return text.split(".")[1]?.length ?? 0;
}
