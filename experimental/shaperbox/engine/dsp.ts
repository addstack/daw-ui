import { BANDS, KINDS, RATES, REST, SLICES, WAVE_SIZE, defaults, type Kind } from "./params.js";
import { restingWave, sampleWave } from "./waves.js";

// The sound, from textbook parts: a chain of shapers, each moving one thing by a wave drawn over a cycle that
// follows the tempo, or starts on a transient; each can split the audio into three bands with Linkwitz–Riley
// crossovers and shape each band by its own wave. No audio-thread globals here, so that it runs anywhere: the
// processor wraps it.

/** The most samples processed at once: a render quantum of the Web Audio API. */
export const BLOCK = 128;

const decibelsToGain = (decibels: number) => 10 ** (decibels / 20);

/** A wave's value, 0 … 1, at `phase` 0 … 1, between its sampled points. */
export function waveAt(wave: Float32Array, phase: number): number {
  const x = Math.min(1, Math.max(0, phase)) * WAVE_SIZE;
  const index = Math.min(WAVE_SIZE - 1, Math.floor(x));
  const a = wave[index]!;
  return a + (wave[index + 1]! - a) * (x - index);
}

/** A flat wave at `value`. */
export const flatWave = (value: number) => new Float32Array(WAVE_SIZE + 1).fill(value);

/** A second-order filter, as Robert Bristow-Johnson's cookbook has them, with a Butterworth Q. */
class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private z1 = 0;
  private z2 = 0;

  set(type: "lowpass" | "highpass" | "allpass", frequency: number, sampleRate: number): void {
    const w = (2 * Math.PI * Math.min(frequency, sampleRate * 0.49)) / sampleRate;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * Math.SQRT1_2);
    const a0 = 1 + alpha;
    if (type === "lowpass") [this.b0, this.b1, this.b2] = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2];
    else if (type === "highpass") [this.b0, this.b1, this.b2] = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
    else [this.b0, this.b1, this.b2] = [1 - alpha, -2 * cos, 1 + alpha];
    this.b0 /= a0;
    this.b1 /= a0;
    this.b2 /= a0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  run(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

/**
 * Three bands of one channel, split at two frequencies by Linkwitz–Riley crossovers (two Butterworth filters in a
 * row, 24 dB per octave). The low band goes through the all-pass the upper split makes of the others, so that the
 * three sum back to the signal with its level unchanged.
 */
class Crossover {
  private readonly low = [new Biquad(), new Biquad()];
  private readonly rest = [new Biquad(), new Biquad()];
  private readonly align = new Biquad();
  private readonly mid = [new Biquad(), new Biquad()];
  private readonly high = [new Biquad(), new Biquad()];
  private splits = [0, 0];

  set(first: number, second: number, sampleRate: number): void {
    const upper = Math.max(second, first * 1.01);
    if (first === this.splits[0] && upper === this.splits[1]) return;
    this.splits = [first, upper];
    for (const filter of this.low) filter.set("lowpass", first, sampleRate);
    for (const filter of this.rest) filter.set("highpass", first, sampleRate);
    this.align.set("allpass", upper, sampleRate);
    for (const filter of this.mid) filter.set("lowpass", upper, sampleRate);
    for (const filter of this.high) filter.set("highpass", upper, sampleRate);
  }

  /** Splits sample `i` of `input` into `low`, `mid` and `high`. */
  split(input: Float32Array, i: number, low: Float32Array, mid: Float32Array, high: Float32Array): void {
    const x = input[i]!;
    low[i] = this.align.run(this.low[1]!.run(this.low[0]!.run(x)));
    const rest = this.rest[1]!.run(this.rest[0]!.run(x));
    mid[i] = this.mid[1]!.run(this.mid[0]!.run(rest));
    high[i] = this.high[1]!.run(this.high[0]!.run(rest));
  }
}

/** A state-variable filter, per Andrew Simper (Cytomic): stable under fast modulation. Its outputs stay on it. */
class Svf {
  private ic1 = 0;
  private ic2 = 0;
  low = 0;
  band = 0;
  high = 0;

  run(x: number, a1: number, a2: number, a3: number, k: number): void {
    const v3 = x - this.ic2;
    const v1 = a1 * this.ic1 + a2 * v3;
    const v2 = this.ic2 + a2 * this.ic1 + a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.low = v2;
    this.band = v1;
    this.high = x - k * v1 - v2;
  }
}

/** A delay line a power of two long, read between samples. */
class DelayLine {
  private readonly buffer: Float32Array;
  private readonly mask: number;
  private at = 0;

  constructor(length: number) {
    const size = 2 ** Math.ceil(Math.log2(length));
    this.buffer = new Float32Array(size);
    this.mask = size - 1;
  }

  get size(): number {
    return this.buffer.length;
  }

  write(x: number): void {
    this.at = (this.at + 1) & this.mask;
    this.buffer[this.at] = x;
  }

  /** The sample written `delay` samples ago, 0 for the newest; cubic between samples from two back. */
  read(delay: number): number {
    const { buffer, mask } = this;
    const position = this.at - delay;
    const index = Math.floor(position);
    const t = position - index;
    const x1 = buffer[index & mask]!;
    const x2 = buffer[(index + 1) & mask]!;
    if (delay < 2) return x1 + (x2 - x1) * t;
    const x0 = buffer[(index - 1) & mask]!;
    const x3 = buffer[(index + 2) & mask]!;
    // A Catmull–Rom (Hermite) curve through the four samples around the point.
    const c1 = 0.5 * (x2 - x0);
    const c2 = x0 - 2.5 * x1 + 2 * x2 - 0.5 * x3;
    const c3 = 0.5 * (x3 - x0) + 1.5 * (x1 - x2);
    return ((c3 * t + c2) * t + c1) * t + x1;
  }
}

/**
 * What a shaper does to the audio of one band (or of all of it), moved by `value`: the wave at each sample, 0 … 1.
 * `phase` is where in the cycle each sample is, and `cycle` the cycle's length in samples.
 */
abstract class Effect {
  constructor(
    protected readonly params: Record<string, number>,
    protected readonly sampleRate: number,
  ) {}

  /** Reads its parameters, once a block. */
  prepare(): void {}

  abstract process(left: Float32Array, right: Float32Array, value: Float32Array, phase: Float32Array, n: number, cycle: number): void;
}

/** Volume: the wave is the gain, from silence at the bottom to the audio as it is at the top. */
class Volume extends Effect {
  process(left: Float32Array, right: Float32Array, value: Float32Array, _phase: Float32Array, n: number) {
    for (let i = 0; i < n; i++) {
      left[i]! *= value[i]!;
      right[i]! *= value[i]!;
    }
  }
}

/** Pan: left at the top, right at the bottom, as a balance: the other side fades out, so that nothing gets louder. */
class Pan extends Effect {
  process(left: Float32Array, right: Float32Array, value: Float32Array, _phase: Float32Array, n: number) {
    for (let i = 0; i < n; i++) {
      left[i]! *= Math.min(1, 2 * value[i]!);
      right[i]! *= Math.min(1, 2 - 2 * value[i]!);
    }
  }
}

/** Width: the sides of the stereo image, from mono at the bottom to twice as wide at the top. */
class Width extends Effect {
  process(left: Float32Array, right: Float32Array, value: Float32Array, _phase: Float32Array, n: number) {
    for (let i = 0; i < n; i++) {
      const mid = (left[i]! + right[i]!) / 2;
      const side = ((left[i]! - right[i]!) / 2) * value[i]! * 2;
      left[i] = mid + side;
      right[i] = mid - side;
    }
  }
}

/** Filter: the wave is the cutoff, between the range's low and high frequencies on a logarithmic scale. */
class Filter extends Effect {
  private readonly stages = [new Svf(), new Svf(), new Svf(), new Svf()];
  private type = 0;
  private k = 2;
  private k2 = 2;
  private low = 0;
  private span = 0;

  override prepare() {
    const { params } = this;
    this.type = params["filter.type"]!;
    const resonance = params["filter.resonance"]!;
    this.k = 2 - 1.96 * resonance;
    // The second stage of a 24 dB filter resonates less, so that the pair does not scream.
    this.k2 = 2 - 0.98 * resonance;
    this.low = Math.log(params["filter.low"]!);
    this.span = Math.log(params["filter.high"]!) - this.low;
  }

  process(left: Float32Array, right: Float32Array, value: Float32Array, _phase: Float32Array, n: number) {
    const { type, k, k2, sampleRate } = this;
    const [firstLeft, firstRight, secondLeft, secondRight] = this.stages as [Svf, Svf, Svf, Svf];
    for (let i = 0; i < n; i++) {
      const cutoff = Math.min(Math.exp(this.low + value[i]! * this.span), sampleRate * 0.45);
      const g = Math.tan((Math.PI * cutoff) / sampleRate);
      const a1 = 1 / (1 + g * (g + k));
      const a2 = g * a1;
      const a3 = g * a2;
      firstLeft.run(left[i]!, a1, a2, a3, k);
      firstRight.run(right[i]!, a1, a2, a3, k);
      switch (type) {
        case 0:
          left[i] = firstLeft.low;
          right[i] = firstRight.low;
          break;
        case 2:
          left[i] = firstLeft.high;
          right[i] = firstRight.high;
          break;
        case 4:
          left[i] = k * firstLeft.band;
          right[i] = k * firstRight.band;
          break;
        case 5:
          left[i] = firstLeft.low + firstLeft.high;
          right[i] = firstRight.low + firstRight.high;
          break;
        default: {
          const b1 = 1 / (1 + g * (g + k2));
          const b2 = g * b1;
          const b3 = g * b2;
          const high = type === 3;
          secondLeft.run(high ? firstLeft.high : firstLeft.low, b1, b2, b3, k2);
          secondRight.run(high ? firstRight.high : firstRight.low, b1, b2, b3, k2);
          left[i] = high ? secondLeft.high : secondLeft.low;
          right[i] = high ? secondRight.high : secondRight.low;
        }
      }
    }
  }
}

/**
 * Time: the wave is where in the cycle the audio plays from, as in Cableguys' TimeShaper. The diagonal from the
 * bottom left to the top right plays it as it is; below it the audio comes from further back: a flatter line
 * plays slower and lower, a falling one backwards, a step repeats. Above the diagonal would be the future, so the
 * audio plays as it is there. Jumps glide over `smooth` milliseconds.
 */
class Time extends Effect {
  private readonly lines: [DelayLine, DelayLine];
  private delay = 0;
  private glide = 1;

  constructor(params: Record<string, number>, sampleRate: number) {
    super(params, sampleRate);
    // Enough for a cycle of two bars at 60 BPM at 48 kHz.
    this.lines = [new DelayLine(sampleRate * 8.5), new DelayLine(sampleRate * 8.5)];
  }

  override prepare() {
    this.glide = 1 - Math.exp(-1000 / (this.params["time.smooth"]! * this.sampleRate));
  }

  process(left: Float32Array, right: Float32Array, value: Float32Array, phase: Float32Array, n: number, cycle: number) {
    const [lineLeft, lineRight] = this.lines;
    const longest = lineLeft.size - 4;
    for (let i = 0; i < n; i++) {
      const target = Math.min(longest, Math.max(0, (phase[i]! - value[i]!) * cycle));
      this.delay += (target - this.delay) * this.glide;
      lineLeft.write(left[i]!);
      lineRight.write(right[i]!);
      // The diagonal, give or take a rounding: the audio as it is.
      if (this.delay < 0.05) continue;
      left[i] = lineLeft.read(this.delay);
      right[i] = lineRight.read(this.delay);
    }
  }
}

/** Noise: white noise, coloured darker or brighter, at the wave's level, following the audio's loudness. */
class Noise extends Effect {
  private seed = 0x9e3779b9;
  private readonly smooth = [0, 0];
  private envelope = 0;
  private gain = 0;
  private color = 0;
  private coefficient = 0;
  private follow = 0;
  private readonly release: number;

  constructor(params: Record<string, number>, sampleRate: number) {
    super(params, sampleRate);
    this.release = Math.exp(-1 / (0.06 * sampleRate));
  }

  override prepare() {
    const { params, sampleRate } = this;
    this.gain = decibelsToGain(params["noise.level"]!);
    this.color = params["noise.color"]!;
    this.follow = params["noise.follow"]!;
    // Darker: a low-pass down to 500 Hz; brighter: the rest of a low-pass from 100 Hz up to 6.4 kHz.
    const cutoff = this.color < 0 ? 16_000 * 2 ** (5 * this.color) : 100 * 2 ** (6 * this.color);
    this.coefficient = 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate);
  }

  private white(): number {
    let x = this.seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x >>> 0;
    return this.seed / 2_147_483_648 - 1;
  }

  private colored(channel: 0 | 1): number {
    const white = this.white();
    this.smooth[channel]! += (white - this.smooth[channel]!) * this.coefficient;
    return this.color < 0 ? this.smooth[channel]! : this.color > 0 ? white - this.smooth[channel]! : white;
  }

  process(left: Float32Array, right: Float32Array, value: Float32Array, _phase: Float32Array, n: number) {
    for (let i = 0; i < n; i++) {
      const level = Math.max(Math.abs(left[i]!), Math.abs(right[i]!));
      this.envelope = level > this.envelope ? level : this.envelope * this.release;
      const gain = this.gain * value[i]! * (1 - this.follow + this.follow * Math.min(1, this.envelope * 2));
      left[i]! += this.colored(0) * gain;
      right[i]! += this.colored(1) * gain;
    }
  }
}

/** Crush: fewer bits and a lower sample rate as the wave rises, down to the knobs' at the top. */
class Crush extends Effect {
  private bits = 16;
  private downsample = 1;
  private count = 0;
  private heldLeft = 0;
  private heldRight = 0;

  override prepare() {
    this.bits = this.params["crush.bits"]!;
    this.downsample = this.params["crush.downsample"]!;
  }

  process(left: Float32Array, right: Float32Array, value: Float32Array, _phase: Float32Array, n: number) {
    for (let i = 0; i < n; i++) {
      const amount = value[i]!;
      this.count += 1;
      if (this.count >= 1 + amount * (this.downsample - 1)) {
        this.count = 0;
        this.heldLeft = left[i]!;
        this.heldRight = right[i]!;
      }
      const steps = 2 ** (16 - amount * (16 - this.bits) - 1);
      left[i] = Math.round(this.heldLeft * steps) / steps;
      right[i] = Math.round(this.heldRight * steps) / steps;
    }
  }
}

const shapers = [Math.tanh, (x: number) => Math.max(-1, Math.min(1, x)), Math.sin];

/** Drive: distortion as the wave rises, up to the knob's gain at the top, a soft or hard clip or a fold. */
class Drive extends Effect {
  private amount = 0;
  private type = 0;

  override prepare() {
    this.amount = this.params["drive.amount"]!;
    this.type = this.params["drive.type"]!;
  }

  process(left: Float32Array, right: Float32Array, value: Float32Array, _phase: Float32Array, n: number) {
    const shape = shapers[this.type] ?? Math.tanh;
    for (let i = 0; i < n; i++) {
      const gain = decibelsToGain(value[i]! * this.amount);
      // About as loud driven as not: a peak of 0.3 stays 0.3; a fold, whose peaks stay at 1, drops as it folds more.
      const level = this.type === 2 ? 1 / (1 + (gain - 1) * 0.05) : 0.3 / shape(0.3 * gain);
      left[i] = shape(left[i]! * gain) * level;
      right[i] = shape(right[i]! * gain) * level;
    }
  }
}

/**
 * Liquid: a flanger, a phaser or a chorus, swept by the wave; the right channel's sweep turns the other way by
 * `stereo`.
 */
class Liquid extends Effect {
  private readonly lines: [DelayLine, DelayLine];
  private readonly allpasses = [new Float64Array(6), new Float64Array(6)];
  private readonly last = [0, 0];
  private mode = 0;
  private feedback = 0;
  private stereo = 0;
  private level = 0.5;

  constructor(params: Record<string, number>, sampleRate: number) {
    super(params, sampleRate);
    this.lines = [new DelayLine(sampleRate * 0.05), new DelayLine(sampleRate * 0.05)];
  }

  override prepare() {
    this.mode = this.params["liquid.mode"]!;
    this.feedback = this.params["liquid.feedback"]!;
    this.stereo = this.params["liquid.stereo"]!;
    // The dry and the swept audio together, about as loud as the dry alone; feedback makes it louder still.
    this.level = this.mode === 2 ? 0.6 : 0.55 * (1 - 0.4 * Math.abs(this.feedback));
  }

  private run(channel: 0 | 1, x: number, sweep: number): number {
    const { sampleRate } = this;
    if (this.mode === 1) {
      // Six first-order all-passes from 150 Hz to 7.5 kHz, fed back.
      const t = Math.tan((Math.PI * 150 * 50 ** sweep) / sampleRate);
      const a = (t - 1) / (t + 1);
      const states = this.allpasses[channel]!;
      let u = x + this.feedback * 0.8 * this.last[channel]!;
      for (let stage = 0; stage < 6; stage++) {
        const y = a * u + states[stage]!;
        states[stage] = u - a * y;
        u = y;
      }
      this.last[channel] = u;
      return (x + u) * this.level;
    }
    const line = this.lines[channel];
    const milliseconds = this.mode === 0 ? 0.25 * 36 ** sweep : 6 + 14 * sweep;
    const wet = line.read((milliseconds / 1000) * sampleRate);
    line.write(x + (this.mode === 0 ? this.feedback * wet : 0));
    return (x + wet) * this.level;
  }

  process(left: Float32Array, right: Float32Array, value: Float32Array, _phase: Float32Array, n: number) {
    for (let i = 0; i < n; i++) {
      const sweep = value[i]!;
      left[i] = this.run(0, left[i]!, sweep);
      right[i] = this.run(1, right[i]!, sweep + (1 - 2 * sweep) * this.stereo);
    }
  }
}

const EFFECTS: Record<Kind, new (params: Record<string, number>, sampleRate: number) => Effect> = {
  volume: Volume,
  filter: Filter,
  time: Time,
  pan: Pan,
  width: Width,
  noise: Noise,
  crush: Crush,
  drive: Drive,
  liquid: Liquid,
};

/** Where the audio plays, for a block: the beat at its start, and how far a sample moves it. */
type Clock = { beats: number; beatsPerSample: number; bpm: number; playing: boolean };

/** How loud the audio is, quickly and slowly, for each sample of a block: a transient is twice as loud quickly as slowly. */
type Envelopes = { fast: Float32Array; slow: Float32Array };

/** The audio into and out of the watched wave, as the peak of each slice of its cycle. */
export class Watch {
  kind: Kind = "volume";
  band = 0;
  readonly input = new Float32Array(SLICES);
  readonly output = new Float32Array(SLICES);
  value = 0;
  private slice = -1;

  set(kind: Kind, band: number): void {
    [this.kind, this.band, this.slice] = [kind, band, -1];
    this.input.fill(0);
    this.output.fill(0);
  }

  /** Takes the peaks of a block: `before` is each sample's peak before the shaper, `left` and `right` after it. */
  record(phase: Float32Array, before: Float32Array, left: Float32Array, right: Float32Array, n: number): void {
    for (let i = 0; i < n; i++) {
      const slice = Math.floor(phase[i]! * SLICES);
      if (slice >= SLICES) continue;
      if (slice !== this.slice) {
        this.slice = slice;
        this.input[slice] = 0;
        this.output[slice] = 0;
      }
      this.input[slice] = Math.max(this.input[slice]!, before[i]!);
      this.output[slice] = Math.max(this.output[slice]!, Math.abs(left[i]!), Math.abs(right[i]!));
    }
  }
}

type Pair = readonly [Float32Array, Float32Array];

/** One shaper: its waves, where it is in its cycle, and its effect on the whole signal or on each band. */
export class Shaper {
  /** The wave over the whole signal, then the low, mid and high bands'. */
  readonly waves: Float32Array[];
  /** Where it is in its cycle, at the end of the last block. */
  phase = 0;
  private since = Infinity;
  private armed = true;
  private holdoff = 0;
  private readonly effects: (Effect | null)[] = [null, null, null, null];
  private readonly smoothed = new Float64Array(BANDS);
  private readonly crossovers = [new Crossover(), new Crossover()];
  private readonly bands = Array.from({ length: 3 }, () => [new Float32Array(BLOCK), new Float32Array(BLOCK)] as const);
  private readonly dry = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
  private readonly phases = new Float32Array(BLOCK);
  private readonly values = new Float32Array(BLOCK);
  private readonly before = new Float32Array(BLOCK);
  private readonly glide: number;

  constructor(
    readonly kind: Kind,
    private readonly params: Record<string, number>,
    private readonly sampleRate: number,
    private readonly watch: Watch,
  ) {
    this.waves = Array.from({ length: BANDS }, () => sampleWave(restingWave(kind)));
    this.smoothed.fill(REST[kind]);
    // Waves glide over about a millisecond, so that a step does not click; Time glides its own way.
    this.glide = kind === "time" ? 1 : 1 - Math.exp(-1 / (0.0007 * sampleRate));
  }

  private param(name: string): number {
    return this.params[`${this.kind}.${name}`]!;
  }

  /** Where in the cycle each sample is: by the beat, or since the last transient, once through. */
  private advance(n: number, clock: Clock, envelopes: Envelopes, cycle: number, beats: number): void {
    const { phases } = this;
    if (this.param("trigger") === 0) {
      for (let i = 0; i < n; i++) {
        const position = (clock.beats + i * clock.beatsPerSample) / beats;
        phases[i] = position - Math.floor(position);
      }
    } else {
      const threshold = decibelsToGain(this.param("threshold"));
      const holdoff = Math.round(0.05 * this.sampleRate);
      for (let i = 0; i < n; i++) {
        const fast = envelopes.fast[i]!;
        const slow = envelopes.slow[i]!;
        if (this.holdoff > 0) this.holdoff--;
        if (this.armed && this.holdoff === 0 && fast > threshold && fast > slow * 1.6) {
          [this.since, this.armed, this.holdoff] = [0, false, holdoff];
        } else if (!this.armed && fast < slow * 1.25) this.armed = true;
        phases[i] = Math.min(1, this.since / cycle);
        if (clock.playing) this.since++;
      }
    }
    this.phase = phases[n - 1]!;
  }

  /** The wave `band` at each sample, gliding. */
  private sample(band: number, n: number): void {
    const wave = this.waves[band]!;
    let value = this.smoothed[band]!;
    for (let i = 0; i < n; i++) {
      value += (waveAt(wave, this.phases[i]!) - value) * this.glide;
      this.values[i] = value;
    }
    this.smoothed[band] = value;
  }

  /** Shapes `left` and `right` by the wave `band`, as much as the mix says; `watched` records it. */
  private shape(band: number, left: Float32Array, right: Float32Array, n: number, cycle: number): void {
    this.sample(band, n);
    const watched = this.watch.kind === this.kind && this.watch.band === band;
    if (watched) {
      for (let i = 0; i < n; i++) this.before[i] = Math.max(Math.abs(left[i]!), Math.abs(right[i]!));
      this.watch.value = this.values[n - 1]!;
    }
    const effect = (this.effects[band] ??= new EFFECTS[this.kind](this.params, this.sampleRate));
    effect.prepare();
    const mix = this.param("mix");
    const [dryLeft, dryRight] = this.dry as [Float32Array, Float32Array];
    if (mix < 1) {
      dryLeft.set(left.subarray(0, n));
      dryRight.set(right.subarray(0, n));
    }
    effect.process(left, right, this.values, this.phases, n, cycle);
    if (mix < 1) {
      for (let i = 0; i < n; i++) {
        left[i] = dryLeft[i]! + (left[i]! - dryLeft[i]!) * mix;
        right[i] = dryRight[i]! + (right[i]! - dryRight[i]!) * mix;
      }
    }
    if (watched) this.watch.record(this.phases, this.before, left, right, n);
  }

  process(left: Float32Array, right: Float32Array, n: number, clock: Clock, envelopes: Envelopes): void {
    const beats = RATES[this.param("rate")]?.beats ?? 1;
    const cycle = Math.max(1, ((beats * 60) / clock.bpm) * this.sampleRate);
    this.advance(n, clock, envelopes, cycle, beats);
    if (this.param("multiband") === 0) {
      this.shape(0, left, right, n, cycle);
      return;
    }
    const [[lowLeft, lowRight], [midLeft, midRight], [highLeft, highRight]] = this.bands as [Pair, Pair, Pair];
    const [crossLeft, crossRight] = this.crossovers as [Crossover, Crossover];
    crossLeft.set(this.param("split1"), this.param("split2"), this.sampleRate);
    crossRight.set(this.param("split1"), this.param("split2"), this.sampleRate);
    for (let i = 0; i < n; i++) {
      crossLeft.split(left, i, lowLeft, midLeft, highLeft);
      crossRight.split(right, i, lowRight, midRight, highRight);
    }
    for (let band = 1; band <= 3; band++) {
      const [bandLeft, bandRight] = this.bands[band - 1]!;
      if (this.param(`band${band}`) === 1) this.shape(band, bandLeft, bandRight, n, cycle);
      else if (this.watch.kind === this.kind && this.watch.band === band) {
        // A band left as it is still shows its audio.
        for (let i = 0; i < n; i++) this.before[i] = Math.max(Math.abs(bandLeft[i]!), Math.abs(bandRight[i]!));
        this.watch.record(this.phases, this.before, bandLeft, bandRight, n);
      }
    }
    for (let i = 0; i < n; i++) {
      left[i] = lowLeft[i]! + midLeft[i]! + highLeft[i]!;
      right[i] = lowRight[i]! + midRight[i]! + highRight[i]!;
    }
  }
}

/** Audio to play in a loop, and how many beats it lasts when it is known. */
export type Source = { left: Float32Array; right: Float32Array; beats: number | null };

/** The transport, the audio it plays, the chain of shapers and the output. */
export class Engine {
  readonly params = defaults();
  readonly watch = new Watch();
  readonly shapers: Record<Kind, Shaper>;
  order: Kind[] = [...KINDS];
  bpm = 120;
  playing = false;
  beats = 0;
  private sample = 0;
  private source: Source | null = null;
  private bypass = 0;
  private fast = 0;
  private slow = 0;
  private readonly envelopes: Envelopes = { fast: new Float32Array(BLOCK), slow: new Float32Array(BLOCK) };
  private readonly dry = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
  private readonly coefficients: { fast: number; slow: number; bypass: number };

  constructor(readonly sampleRate: number) {
    this.shapers = Object.fromEntries(KINDS.map((kind) => [kind, new Shaper(kind, this.params, sampleRate, this.watch)])) as Record<Kind, Shaper>;
    const coefficient = (seconds: number) => 1 - Math.exp(-1 / (seconds * sampleRate));
    this.coefficients = {
      fast: coefficient(0.004),
      slow: coefficient(0.12),
      bypass: coefficient(0.01),
    };
  }

  setSource(source: Source | null): void {
    this.source = source;
    // Audio of a known number of beats keeps its place in the bar; other audio starts over.
    if (!source) return;
    const length = source.left.length;
    this.sample = source.beats ? Math.round(((this.beats % source.beats) * 60 * this.sampleRate) / this.bpm) % length : this.sample % length;
  }

  setTransport(playing: boolean, bpm: number): void {
    if (playing && !this.playing) this.sample = this.beats = 0;
    this.playing = playing;
    this.bpm = bpm;
  }

  /** Renders `n` samples; `dryLeft` and `dryRight` take the audio before the shapers. */
  render(left: Float32Array, right: Float32Array, n: number, dryLeft?: Float32Array, dryRight?: Float32Array): void {
    for (let at = 0; at < n; at += BLOCK) {
      const count = Math.min(BLOCK, n - at);
      const part = (buffer: Float32Array | undefined) => (buffer && (at === 0 && count === buffer.length ? buffer : buffer.subarray(at, at + count)));
      this.block(part(left)!, part(right)!, count, part(dryLeft), part(dryRight));
    }
  }

  private block(left: Float32Array, right: Float32Array, n: number, dryLeft?: Float32Array, dryRight?: Float32Array): void {
    const { source, params, coefficients, envelopes } = this;
    if (this.playing && source) {
      const length = source.left.length;
      for (let i = 0; i < n; i++) {
        const index = (this.sample + i) % length;
        left[i] = source.left[index]!;
        right[i] = source.right[index]!;
      }
    } else {
      left.fill(0, 0, n);
      right.fill(0, 0, n);
    }
    const [inLeft, inRight] = this.dry as [Float32Array, Float32Array];
    inLeft.set(left.subarray(0, n));
    inRight.set(right.subarray(0, n));
    dryLeft?.set(inLeft.subarray(0, n));
    dryRight?.set(inRight.subarray(0, n));

    // How loud the input is, over a few milliseconds and over a tenth of a second (RMS, which a chord's beating
    // moves less than its peaks), for the shapers that start on a transient.
    for (let i = 0; i < n; i++) {
      const energy = (left[i]! * left[i]! + right[i]! * right[i]!) / 2;
      this.fast += (energy - this.fast) * coefficients.fast;
      this.slow += (energy - this.slow) * coefficients.slow;
      envelopes.fast[i] = Math.sqrt(this.fast);
      envelopes.slow[i] = Math.sqrt(this.slow);
    }

    const clock: Clock = { beats: this.beats, beatsPerSample: this.playing ? this.bpm / 60 / this.sampleRate : 0, bpm: this.bpm, playing: this.playing };
    for (const kind of this.order) if (params[`${kind}.on`] === 1) this.shapers[kind].process(left, right, n, clock, envelopes);

    const mix = params["global.mix"]!;
    const output = decibelsToGain(params["global.output"]!);
    const bypass = params["global.bypass"]!;
    for (let i = 0; i < n; i++) {
      this.bypass += (bypass - this.bypass) * coefficients.bypass;
      const wetLeft = (inLeft[i]! + (left[i]! - inLeft[i]!) * mix) * output;
      const wetRight = (inRight[i]! + (right[i]! - inRight[i]!) * mix) * output;
      left[i] = wetLeft + (inLeft[i]! - wetLeft) * this.bypass;
      right[i] = wetRight + (inRight[i]! - wetRight) * this.bypass;
    }

    if (this.playing) {
      this.sample += n;
      this.beats += (n * this.bpm) / 60 / this.sampleRate;
    }
  }
}
