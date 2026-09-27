import type { Range } from "./range.js";

// The drawing of a spectrum: from the bins of an FFT, evenly spaced in hertz, to one level per column of pixels
// on a frequency axis, usually logarithmic. Not part of the public API: `Spectrum` draws with it.

/** Which bins each column of a drawing covers, as fractional bin numbers, and its middle frequency. */
export type SpectrumColumns = { readonly from: Float64Array; readonly to: Float64Array; readonly frequency: Float64Array };

/**
 * The bins under each of `width` columns across `axis` (in hertz), for
 * `count` bins from 0 Hz to half the sample rate, as an `AnalyserNode` gives
 * them: bin k is at `k · sampleRate / (2 · count)`.
 */
export function spectrumColumns(width: number, count: number, sampleRate: number, axis: Range): SpectrumColumns {
  const perBin = sampleRate / 2 / count;
  const from = new Float64Array(width);
  const to = new Float64Array(width);
  const frequency = new Float64Array(width);
  for (let column = 0; column < width; column++) {
    const low = axis.denormalize(column / width);
    const high = axis.denormalize((column + 1) / width);
    from[column] = low / perBin;
    to[column] = high / perBin;
    frequency[column] = Math.sqrt(low * high);
  }
  return { from, to, frequency };
}

// Silence, as −∞ dB from an analyser, counts as very quiet, so that the curve through it stays a number.
const SILENCE = -200;
const level = (bins: ArrayLike<number>, index: number) => {
  const value = bins[Math.min(bins.length - 1, Math.max(0, index))]!;
  return Number.isFinite(value) ? value : SILENCE;
};

/**
 * The level of each column in dB, into `out`: the loudest bin of a column
 * that covers one or more, so that narrow peaks at high frequencies show;
 * between bins, where a column is narrower than a bin, a Catmull–Rom curve
 * through the bins around it, so that the low end is smooth. `tilt` adds
 * that many dB per octave above 1 kHz, and takes as many below it.
 */
export function spectrumLevels(bins: ArrayLike<number>, columns: SpectrumColumns, tilt: number, out: Float32Array): Float32Array {
  const { from, to, frequency } = columns;
  for (let column = 0; column < out.length; column++) {
    const first = Math.ceil(from[column]!);
    const last = Math.floor(to[column]!);
    let value: number;
    if (last >= first) {
      value = -Infinity;
      for (let index = first; index <= last && index < bins.length; index++) value = Math.max(value, level(bins, index));
      if (value === -Infinity) value = level(bins, bins.length - 1);
    } else {
      const at = (from[column]! + to[column]!) / 2;
      const index = Math.floor(at);
      const t = at - index;
      const [p0, p1, p2, p3] = [level(bins, index - 1), level(bins, index), level(bins, index + 1), level(bins, index + 2)];
      value = p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
    }
    out[column] = tilt === 0 ? value : value + tilt * Math.log2(frequency[column]! / 1000);
  }
  return out;
}
