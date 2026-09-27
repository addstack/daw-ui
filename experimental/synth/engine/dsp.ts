import { DESTINATIONS, FRAMES, LEVELS, LFO_SIZE, PARAMS, TABLE_SIZE, denormalize, normalize, type Destination, type Routing, type Source } from "./params.js";

// The sound, from textbook parts: wavetable oscillators with unison, a state-variable filter (Andrew Simper's
// trapezoidal SVF), ADSR envelopes, and a matrix that moves parameters along their travel. No audio-thread globals
// here, so that it runs anywhere: the processor wraps it.

/** A block of this many samples shares one reading of the modulation. */
export const BLOCK = 128;

const noteHertz = (note: number) => 440 * 2 ** ((note - 69) / 12);

/** An ADSR envelope: linear attack, exponential decay and release. Times in milliseconds. */
export class Envelope {
  level = 0;
  stage: "idle" | "attack" | "decay" | "release" = "idle";

  constructor(private readonly sampleRate: number) {}

  gate(on: boolean): void {
    this.stage = on ? "attack" : this.stage === "idle" ? "idle" : "release";
  }

  /** Moves on by `samples` and returns the level. */
  advance(samples: number, attack: number, decay: number, sustain: number, release: number): number {
    const perMs = this.sampleRate / 1000;
    switch (this.stage) {
      case "attack":
        this.level += samples / Math.max(1, attack * perMs);
        if (this.level >= 1) [this.level, this.stage] = [1, "decay"];
        break;
      case "decay":
        // A time constant of a quarter of the time: the level is within 2% of the sustain after it.
        this.level = sustain + (this.level - sustain) * Math.exp(-samples / Math.max(1, (decay * perMs) / 4));
        break;
      case "release":
        this.level *= Math.exp(-samples / Math.max(1, (release * perMs) / 4));
        if (this.level < 1e-4) [this.level, this.stage] = [0, "idle"];
        break;
    }
    return this.level;
  }
}

/** A state-variable filter, per Andrew Simper (Cytomic): stable under fast modulation. */
class Filter {
  private ic1 = 0;
  private ic2 = 0;
  private a1 = 0;
  private a2 = 0;
  private a3 = 0;
  private k = 2;

  set(cutoff: number, resonance: number, sampleRate: number): void {
    const g = Math.tan((Math.PI * Math.min(cutoff, sampleRate * 0.45)) / sampleRate);
    this.k = 2 - 1.96 * resonance;
    this.a1 = 1 / (1 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }

  /** Returns [low, band, high] for one sample. */
  run(input: number): [number, number, number] {
    const v3 = input - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    return [v2, v1, input - this.k * v1 - v2];
  }

  reset(): void {
    this.ic1 = this.ic2 = 0;
  }
}

/** A filter of one of the five types, with drive before it; two stages for LP 24. */
class VoiceFilter {
  private readonly first = new Filter();
  private readonly second = new Filter();
  type = 0;
  drive = 0;

  set(cutoff: number, resonance: number, sampleRate: number): void {
    this.first.set(cutoff, resonance, sampleRate);
    // The second stage of a 24 dB filter resonates less, so that the pair does not scream.
    this.second.set(cutoff, resonance * 0.5, sampleRate);
  }

  run(input: number): number {
    const driven = this.drive > 0 ? Math.tanh(input * (1 + this.drive * 6)) / (1 + this.drive * 1.5) : input;
    const [low, band, high] = this.first.run(driven);
    switch (this.type) {
      case 1:
        return this.second.run(low)[0];
      case 2:
        return high;
      case 3:
        return band;
      case 4:
        return low + high;
      default:
        return low;
    }
  }

  reset(): void {
    this.first.reset();
    this.second.reset();
  }
}

/** One oscillator's unison voices: their phases, and the gains and pans of each. */
class Oscillator {
  readonly phases = new Float64Array(7);

  /** New random phases, as Serum's unison starts. */
  scatter(): void {
    for (let i = 0; i < this.phases.length; i++) this.phases[i] = Math.random();
  }

  /**
   * Adds `length` samples of the oscillator to `left` and `right`: `count` unison voices spread over ±`detune`
   * × 50 cents, the side ones at `blend`, panned apart.
   */
  render(
    table: Float32Array,
    hertz: number,
    position: number,
    count: number,
    detune: number,
    blend: number,
    level: number,
    pan: number,
    sampleRate: number,
    left: Float32Array,
    right: Float32Array,
    length: number,
  ): void {
    const at = Math.min(1, Math.max(0, position)) * (FRAMES - 1);
    const frame = Math.min(FRAMES - 2, Math.floor(at));
    const between = at - frame;
    // The strongest harmonic that stays under half the sample rate picks the band-limited copy.
    const harmonics = sampleRate / 2 / Math.max(1, hertz * (1 + detune * 0.03));
    const level2 = Math.min(LEVELS - 1, Math.max(0, Math.ceil(10 - Math.log2(Math.max(1, harmonics)))));
    const offsetA = (frame * LEVELS + level2) * TABLE_SIZE;
    const offsetB = ((frame + 1) * LEVELS + level2) * TABLE_SIZE;
    // Voices spread evenly from −1 to 1; the one or two nearest the middle are the centre, at full level, and
    // the others, the sides, at `blend`.
    const steps = Math.max(1, count - 1);
    const spreadOf = (voice: number) => (count === 1 ? 0 : (voice / steps) * 2 - 1);
    const central = (spread: number) => Math.abs(spread) <= 1 / steps + 1e-9;
    let centres = 0;
    for (let voice = 0; voice < count; voice++) if (central(spreadOf(voice))) centres++;
    const norm = 1 / Math.sqrt(centres + (count - centres) * blend * blend);
    for (let voice = 0; voice < count; voice++) {
      const spread = spreadOf(voice);
      const gain = level * norm * (central(spread) ? 1 : blend);
      if (gain === 0) continue;
      const cents = spread * detune * 50;
      const increment = (hertz * 2 ** (cents / 1200)) / sampleRate;
      // Constant-power pan: the oscillator's own, plus the unison spread across the stereo field.
      const place = Math.min(1, Math.max(-1, pan + spread * 0.7));
      const leftGain = gain * Math.cos(((place + 1) * Math.PI) / 4);
      const rightGain = gain * Math.sin(((place + 1) * Math.PI) / 4);
      let phase = this.phases[voice]!;
      for (let i = 0; i < length; i++) {
        const index = phase * TABLE_SIZE;
        const whole = index | 0;
        const fraction = index - whole;
        const next = (whole + 1) & (TABLE_SIZE - 1);
        const a = table[offsetA + whole]! + (table[offsetA + next]! - table[offsetA + whole]!) * fraction;
        const b = table[offsetB + whole]! + (table[offsetB + next]! - table[offsetB + whole]!) * fraction;
        const sample = a + (b - a) * between;
        left[i] = left[i]! + sample * leftGain;
        right[i] = right[i]! + sample * rightGain;
        phase += increment;
        if (phase >= 1) phase -= 1;
      }
      this.phases[voice] = phase;
    }
  }
}

export type SynthState = {
  params: Record<string, number>;
  routings: Routing[];
  tables: Float32Array[];
  lfos: [Float32Array, Float32Array];
  /** The LFOs' phases when they run free: shared by every voice. */
  lfoPhases: [number, number];
};

/** One note: its oscillators, filter and envelopes. */
export class Voice {
  note = -1;
  velocity = 0;
  age = 0;
  held = false;
  readonly amp: Envelope;
  readonly env2: Envelope;
  readonly env3: Envelope;
  private readonly a = new Oscillator();
  private readonly b = new Oscillator();
  private subPhase = 0;
  private readonly filters = [new VoiceFilter(), new VoiceFilter()] as const;
  private readonly lfoPhases: [number, number] = [0, 0];
  private readonly left = new Float32Array(BLOCK);
  private readonly right = new Float32Array(BLOCK);
  /** The travel of every destination after modulation, as of the last block. */
  readonly travel = new Map<Destination, number>();

  constructor(private readonly sampleRate: number) {
    this.amp = new Envelope(sampleRate);
    this.env2 = new Envelope(sampleRate);
    this.env3 = new Envelope(sampleRate);
  }

  get active(): boolean {
    return this.amp.stage !== "idle";
  }

  start(note: number, velocity: number, state: SynthState, age: number): void {
    const fresh = !this.active;
    this.note = note;
    this.velocity = velocity;
    this.age = age;
    this.held = true;
    if (fresh) {
      this.a.scatter();
      this.b.scatter();
      this.subPhase = 0;
      this.filters.forEach((filter) => filter.reset());
    }
    for (const envelope of [this.amp, this.env2, this.env3]) envelope.gate(true);
    // A retriggered LFO starts over with each note; a free one runs on from where every voice's LFO is.
    this.lfoPhases[0] = state.params["lfo1.retrigger"] ? 0 : state.lfoPhases[0];
    this.lfoPhases[1] = state.params["lfo2.retrigger"] ? 0 : state.lfoPhases[1];
  }

  stop(): void {
    this.held = false;
    for (const envelope of [this.amp, this.env2, this.env3]) envelope.gate(false);
  }

  /** The sources' values for this block, 0 … 1. */
  private sources(state: SynthState, length: number): Record<Source, number> {
    const { params } = state;
    const envelope = (envelope: Envelope, name: string) =>
      envelope.advance(length, params[`${name}.attack`]!, params[`${name}.decay`]!, params[`${name}.sustain`]!, params[`${name}.release`]!);
    const lfo = (index: 0 | 1) => {
      const shape = state.lfos[index];
      const value = shape[Math.floor(this.lfoPhases[index] * LFO_SIZE) % LFO_SIZE]!;
      this.lfoPhases[index] = (this.lfoPhases[index] + (params[`lfo${index + 1}.rate`]! * length) / this.sampleRate) % 1;
      return value;
    };
    return {
      env2: envelope(this.env2, "env2"),
      env3: envelope(this.env3, "env3"),
      lfo1: lfo(0),
      lfo2: lfo(1),
      velocity: this.velocity,
      note: Math.min(1, Math.max(0, (this.note - 24) / 96)),
      macro1: params["macro1"]!,
      macro2: params["macro2"]!,
    };
  }

  /** Adds `length` samples of this voice to `left` and `right`. */
  render(state: SynthState, left: Float32Array, right: Float32Array, length: number): void {
    const { params } = state;
    const values = this.sources(state, length);
    const value = (id: Destination) => {
      let travel = normalize(PARAMS[id]!, params[id]!);
      for (const routing of state.routings) if (routing.destination === id) travel += routing.amount * values[routing.source];
      travel = Math.min(1, Math.max(0, travel));
      this.travel.set(id, travel);
      return denormalize(PARAMS[id]!, travel);
    };
    for (const id of DESTINATIONS) value(id);
    const moved = (id: Destination) => denormalize(PARAMS[id]!, this.travel.get(id)!);

    this.left.fill(0, 0, length);
    this.right.fill(0, 0, length);
    for (const [name, oscillator] of [["a", this.a], ["b", this.b]] as const) {
      if (!params[`${name}.on`]) continue;
      const table = state.tables[params[`${name}.table`]!];
      if (!table) continue;
      const pitch = this.note + 12 * params[`${name}.octave`]! + params[`${name}.semi`]! + moved(`${name}.fine`) / 100;
      oscillator.render(
        table,
        noteHertz(pitch),
        moved(`${name}.position`),
        params[`${name}.unison`]!,
        moved(`${name}.detune`),
        params[`${name}.blend`]!,
        moved(`${name}.level`),
        moved(`${name}.pan`),
        this.sampleRate,
        this.left,
        this.right,
        length,
      );
    }
    if (params["sub.on"]) {
      const increment = noteHertz(this.note + 12 * params["sub.octave"]!) / this.sampleRate;
      const level = moved("sub.level") * 0.7;
      for (let i = 0; i < length; i++) {
        const sample = (params["sub.shape"] ? (this.subPhase < 0.5 ? 0.6 : -0.6) : Math.sin(2 * Math.PI * this.subPhase)) * level;
        this.left[i] = this.left[i]! + sample;
        this.right[i] = this.right[i]! + sample;
        this.subPhase = (this.subPhase + increment) % 1;
      }
    }
    if (params["noise.on"]) {
      const level = moved("noise.level") * 0.5;
      for (let i = 0; i < length; i++) {
        this.left[i] = this.left[i]! + (Math.random() * 2 - 1) * level;
        this.right[i] = this.right[i]! + (Math.random() * 2 - 1) * level;
      }
    }

    const filtering = params["filter.on"] === 1;
    const mix = moved("filter.mix");
    if (filtering) {
      for (const filter of this.filters) {
        filter.type = params["filter.type"]!;
        filter.drive = moved("filter.drive");
        filter.set(moved("filter.cutoff"), moved("filter.resonance"), this.sampleRate);
      }
    }
    const { amp } = this;
    const [attack, decay, sustain, release] = [params["env1.attack"]!, params["env1.decay"]!, params["env1.sustain"]!, params["env1.release"]!];
    // Softer notes are quieter, though not silent.
    const loudness = 0.35 + 0.65 * this.velocity;
    for (let i = 0; i < length; i++) {
      let l = this.left[i]!;
      let r = this.right[i]!;
      if (filtering) {
        l += (this.filters[0].run(l) - l) * mix;
        r += (this.filters[1].run(r) - r) * mix;
      }
      const gain = amp.advance(1, attack, decay, sustain, release) * loudness;
      left[i] = left[i]! + l * gain;
      right[i] = right[i]! + r * gain;
    }
  }
}

/** The instrument: eight voices, the newest note stealing the oldest voice when all are busy. */
export class Engine {
  readonly voices: Voice[];
  private count = 0;

  constructor(
    readonly state: SynthState,
    private readonly sampleRate: number,
  ) {
    this.voices = Array.from({ length: 8 }, () => new Voice(sampleRate));
  }

  noteOn(note: number, velocity: number): void {
    const voice =
      this.voices.find((one) => one.active && one.note === note) ??
      this.voices.find((one) => !one.active) ??
      this.voices.reduce((oldest, one) => (one.age < oldest.age ? one : oldest));
    voice.start(note, velocity, this.state, ++this.count);
  }

  noteOff(note: number): void {
    for (const voice of this.voices) if (voice.note === note && voice.held) voice.stop();
  }

  allNotesOff(): void {
    for (const voice of this.voices) voice.stop();
  }

  /** Renders `length` samples into `left` and `right`. */
  render(left: Float32Array, right: Float32Array, length: number): void {
    left.fill(0, 0, length);
    right.fill(0, 0, length);
    for (const voice of this.voices) if (voice.active) voice.render(this.state, left, right, length);
    const { lfoPhases, params } = this.state;
    lfoPhases[0] = (lfoPhases[0] + (params["lfo1.rate"]! * length) / this.sampleRate) % 1;
    lfoPhases[1] = (lfoPhases[1] + (params["lfo2.rate"]! * length) / this.sampleRate) % 1;
    // A soft limit, so that eight voices of unison never clip hard.
    for (let i = 0; i < length; i++) {
      left[i] = Math.tanh(left[i]! * 0.5);
      right[i] = Math.tanh(right[i]! * 0.5);
    }
  }

  /** The voice started last that still sounds, for showing where modulation is. */
  newest(): Voice | undefined {
    return this.voices.filter((voice) => voice.active).sort((a, b) => b.age - a.age)[0];
  }
}
