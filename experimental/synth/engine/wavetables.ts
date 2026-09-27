import { FRAMES, LEVELS, TABLE_SIZE } from "./params.js";

// Wavetables: each is FRAMES single cycles of TABLE_SIZE samples, which the position knob morphs through. Every frame
// is stored LEVELS times, band-limited for higher and higher notes, so that a note never has harmonics above half the
// sample rate: the textbook way to play wavetables without aliasing (mipmaps). Layout: [frame][level][sample].

/** An in-place radix-2 FFT of `real` and `imaginary`; `inverse` for the inverse, unscaled. */
function fft(real: Float64Array, imaginary: Float64Array, inverse = false): void {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j]!, real[i]!];
      [imaginary[i], imaginary[j]] = [imaginary[j]!, imaginary[i]!];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = ((inverse ? 2 : -2) * Math.PI) / size;
    const [stepReal, stepImaginary] = [Math.cos(angle), Math.sin(angle)];
    for (let start = 0; start < n; start += size) {
      let [wReal, wImaginary] = [1, 0];
      for (let k = 0; k < size / 2; k++) {
        const a = start + k;
        const b = a + size / 2;
        const tReal = real[b]! * wReal - imaginary[b]! * wImaginary;
        const tImaginary = real[b]! * wImaginary + imaginary[b]! * wReal;
        real[b] = real[a]! - tReal;
        imaginary[b] = imaginary[a]! - tImaginary;
        real[a] = real[a]! + tReal;
        imaginary[a] = imaginary[a]! + tImaginary;
        [wReal, wImaginary] = [wReal * stepReal - wImaginary * stepImaginary, wReal * stepImaginary + wImaginary * stepReal];
      }
    }
  }
}

/** A wavetable from its frames, each a function of the phase 0 … 1 for frame `f` of FRAMES (0 … 1). */
function build(frame: (phase: number, f: number) => number): Float32Array {
  const table = new Float32Array(FRAMES * LEVELS * TABLE_SIZE);
  const real = new Float64Array(TABLE_SIZE);
  const imaginary = new Float64Array(TABLE_SIZE);
  const spectrumReal = new Float64Array(TABLE_SIZE);
  const spectrumImaginary = new Float64Array(TABLE_SIZE);
  for (let f = 0; f < FRAMES; f++) {
    for (let i = 0; i < TABLE_SIZE; i++) {
      real[i] = frame(i / TABLE_SIZE, f / (FRAMES - 1));
      imaginary[i] = 0;
    }
    fft(real, imaginary);
    // No DC: an offset would click when a note starts and stops.
    real[0] = 0;
    imaginary[0] = 0;
    spectrumReal.set(real);
    spectrumImaginary.set(imaginary);
    let peak = 0;
    for (let level = 0; level < LEVELS; level++) {
      const harmonics = (TABLE_SIZE / 2) >> level;
      for (let bin = 0; bin < TABLE_SIZE; bin++) {
        const harmonic = Math.min(bin, TABLE_SIZE - bin);
        const keep = harmonic <= harmonics && harmonic < TABLE_SIZE / 2;
        real[bin] = keep ? spectrumReal[bin]! : 0;
        imaginary[bin] = keep ? spectrumImaginary[bin]! : 0;
      }
      fft(real, imaginary, true);
      const offset = (f * LEVELS + level) * TABLE_SIZE;
      for (let i = 0; i < TABLE_SIZE; i++) table[offset + i] = real[i]! / TABLE_SIZE;
      if (level === 0) for (let i = 0; i < TABLE_SIZE; i++) peak = Math.max(peak, Math.abs(table[offset + i]!));
    }
    // Every frame as loud at its peak, so that moving the position does not change the level much.
    const gain = peak > 0 ? 0.9 / peak : 0;
    for (let i = f * LEVELS * TABLE_SIZE; i < (f + 1) * LEVELS * TABLE_SIZE; i++) table[i]! *= gain;
  }
  return table;
}

const TAU = 2 * Math.PI;
const saw = (phase: number) => 2 * phase - 1;
const square = (phase: number) => (phase < 0.5 ? 1 : -1);
const triangle = (phase: number) => 1 - 4 * Math.abs(phase - 0.5);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** The four wavetables, in the order of TABLES. */
export function createWavetables(): Float32Array[] {
  return [
    // Basic: sine, triangle, saw and square, one into the next.
    build((phase, f) => {
      const shapes = [Math.sin(TAU * phase), triangle(phase), saw(phase), square(phase)];
      const at = f * 3;
      const index = Math.min(2, Math.floor(at));
      return mix(shapes[index]!, shapes[index + 1]!, at - index);
    }),
    // Harmonics: from a sine to 32 harmonics at 1/n, as drawbars pulled one by one.
    build((phase, f) => {
      const count = 1 + f * 31;
      let sum = 0;
      for (let n = 1; n <= Math.ceil(count); n++) sum += (Math.min(1, count - n + 1) * Math.sin(TAU * n * phase)) / n;
      return sum;
    }),
    // Pulse: a square narrowing to a thin pulse.
    build((phase, f) => (phase < mix(0.5, 0.04, f) ? 1 : -1)),
    // Formant: a buzz whose resonance sweeps up through the harmonics, like a vowel changing.
    build((phase, f) => {
      const centre = 2 + f * 28;
      let sum = 0;
      for (let n = 1; n <= 64; n++) sum += (Math.exp(-(((n - centre) / 2.5) ** 2)) + 0.15 / n) * Math.sin(TAU * n * phase);
      return sum;
    }),
  ];
}

/** One frame of a table at its fullest band, for drawing it. */
export function frameOf(table: Float32Array, frame: number): Float32Array {
  const offset = Math.round(frame) * LEVELS * TABLE_SIZE;
  return table.subarray(offset, offset + TABLE_SIZE);
}
