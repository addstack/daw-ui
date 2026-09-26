export type MeterBallisticsOptions = {
  /** Lowest level shown, in dBFS. Defaults to -70. */
  floor?: number | undefined;
  /** How fast the bar and the peak marker fall, in dB per second. Defaults to 24. */
  fall?: number | undefined;
  /** How long the peak marker stays before it falls, in milliseconds. Defaults to 1000. */
  hold?: number | undefined;
  /** An input above this level, in dBFS, lights the clip indicator. Defaults to 0. */
  clipAbove?: number | undefined;
};

export type MeterReading = {
  /** The bar: follows rises at once, falls at `fall` dB per second. In dBFS, at least `floor`. */
  level: number;
  /** The highest recent level, held for `hold` ms, then falling. */
  peak: number;
  /** Set when an input went above `clipAbove`; stays until `resetClip()`. */
  clipped: boolean;
};

export type MeterBallistics = {
  /** Feeds one input level (dBFS) measured at `now` (ms) and returns what to draw. */
  update(input: number, now: number): MeterReading;
  resetClip(): void;
  readonly reading: MeterReading;
};

/** The display behaviour of a peak meter, separate from rendering so it can be tested and reused. */
export function createMeterBallistics({
  floor = -70,
  fall = 24,
  hold = 1000,
  clipAbove = 0,
}: MeterBallisticsOptions = {}): MeterBallistics {
  let reading: MeterReading = { level: floor, peak: floor, clipped: false };
  let lastTime: number | null = null;
  let peakTime = -Infinity;

  return {
    get reading() {
      return reading;
    },
    update(input, now) {
      const elapsed = lastTime === null ? 0 : Math.max(0, now - lastTime) / 1000;
      lastTime = now;
      const measured = Number.isNaN(input) ? floor : Math.max(floor, input);

      const level = Math.max(measured, reading.level - fall * elapsed, floor);
      let peak = reading.peak;
      if (level >= peak) {
        peak = level;
        peakTime = now;
      } else if (now - peakTime > hold) {
        peak = Math.max(level, peak - fall * elapsed);
      }

      reading = { level, peak, clipped: reading.clipped || input > clipAbove };
      return reading;
    },
    resetClip() {
      reading = { ...reading, clipped: false };
    },
  };
}

/** Linear amplitude (as from an `AnalyserNode`) to dBFS; silence is `-Infinity`. */
export function gainToDecibels(gain: number): number {
  return 20 * Math.log10(Math.abs(gain));
}

export function decibelsToGain(decibels: number): number {
  return Math.pow(10, decibels / 20);
}
