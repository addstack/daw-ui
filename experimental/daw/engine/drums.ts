import { decibelsToGain } from "../../../src/core/index.js";
import { CLAP, CLOSED_HAT, CRASH, KICK, OPEN_HAT, RIM, SNARE, TOM } from "./project.js";

// A drum machine: eight sounds made here from textbook parts (a falling sine for the kick and the tom, filtered
// noise for the snare, the clap, the hats and the crash), each on a General MIDI note, played by the Web Audio
// API's own buffer sources, which start on the sample they are given. A closed hat chokes an open one.

export type Pad = { note: number; name: string };

export const PADS: Pad[] = [
  { note: KICK, name: "Kick" },
  { note: SNARE, name: "Snare" },
  { note: CLAP, name: "Clap" },
  { note: RIM, name: "Rim" },
  { note: CLOSED_HAT, name: "Closed Hat" },
  { note: OPEN_HAT, name: "Open Hat" },
  { note: TOM, name: "Tom" },
  { note: CRASH, name: "Crash" },
];

function random(seed: number) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 2_147_483_648 - 1;
  };
}

/** A one-pole low-pass, one sample at a time. */
function onePole(cutoff: number, sampleRate: number) {
  const a = 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate);
  let y = 0;
  return (x: number) => (y += (x - y) * a);
}

/** Noise between `low` and `high` Hz. */
function bandNoise(seed: number, low: number, high: number, sampleRate: number) {
  const noise = random(seed);
  const under = onePole(low, sampleRate);
  const over = onePole(high, sampleRate);
  return () => {
    const x = over(noise());
    return x - under(x);
  };
}

/** The sound of `note`, left and right, `seconds` long, from `sample` at each second `t`. */
function make(seconds: number, sampleRate: number, sample: (t: number, channel: number) => number): Float32Array[] {
  const length = Math.round(seconds * sampleRate);
  return [0, 1].map((channel) => {
    const data = new Float32Array(length);
    for (let i = 0; i < length; i++) data[i] = sample(i / sampleRate, channel);
    // Fades out over the last 5 ms, so that no sound stops with a click.
    const fade = Math.min(length, Math.round(0.005 * sampleRate));
    for (let i = 0; i < fade; i++) data[length - 1 - i]! *= i / fade;
    return data;
  });
}

function render(note: number, sampleRate: number): Float32Array[] {
  switch (note) {
    case KICK: {
      const phase = [0, 0];
      return make(0.5, sampleRate, (t, channel) => {
        phase[channel]! += (2 * Math.PI * (45 + 110 * Math.exp(-t / 0.03))) / sampleRate;
        return Math.sin(phase[channel]!) * Math.exp(-t / 0.28) * Math.min(1, t * 4000) * 0.95;
      });
    }
    case SNARE: {
      const noises = [bandNoise(3, 900, 7000, sampleRate), bandNoise(4, 900, 7000, sampleRate)];
      return make(0.35, sampleRate, (t, channel) => Math.sin(2 * Math.PI * 185 * t) * Math.exp(-t / 0.07) * 0.5 + noises[channel]!() * Math.exp(-t / 0.12) * 1.4);
    }
    case CLAP: {
      const noises = [bandNoise(5, 700, 2600, sampleRate), bandNoise(6, 700, 2600, sampleRate)];
      return make(0.4, sampleRate, (t, channel) => {
        const burst = t < 0.03 ? Math.exp(-((t % 0.01) / 0.003)) : Math.exp(-(t - 0.03) / 0.1);
        return noises[channel]!() * burst * 2.2;
      });
    }
    case RIM: {
      const noise = random(7);
      return make(0.1, sampleRate, (t) => Math.sin(2 * Math.PI * 1700 * t) * Math.exp(-t / 0.012) * 0.6 + noise() * Math.exp(-t / 0.003) * 0.4);
    }
    case CLOSED_HAT:
    case OPEN_HAT: {
      const decay = note === OPEN_HAT ? 0.22 : 0.035;
      const noises = [bandNoise(8, 7000, 16_000, sampleRate), bandNoise(9, 7000, 16_000, sampleRate)];
      return make(note === OPEN_HAT ? 0.8 : 0.15, sampleRate, (t, channel) => noises[channel]!() * Math.exp(-t / decay) * 1.6);
    }
    case TOM: {
      let phase = 0;
      return make(0.6, sampleRate, (t) => {
        phase += (2 * Math.PI * (95 + 30 * Math.exp(-t / 0.08))) / sampleRate;
        return Math.sin(phase) * Math.exp(-t / 0.22) * Math.min(1, t * 3000) * 0.8;
      });
    }
    case CRASH: {
      const noises = [bandNoise(10, 4000, 15_000, sampleRate), bandNoise(11, 4000, 15_000, sampleRate)];
      return make(2, sampleRate, (t, channel) => noises[channel]!() * Math.exp(-t / 0.55) * Math.min(1, t * 2000) * 1.1);
    }
    default:
      return [];
  }
}

// Made once for each sample rate.
const made = new Map<number, Map<number, Float32Array[]>>();

function sounds(sampleRate: number): Map<number, Float32Array[]> {
  let byNote = made.get(sampleRate);
  if (!byNote) made.set(sampleRate, (byNote = new Map(PADS.map((pad) => [pad.note, render(pad.note, sampleRate)]))));
  return byNote;
}

type Voice = { note: number; source: AudioBufferSourceNode; gain: GainNode; start: number };

export class DrumMachine {
  /** Each pad's level in decibels and tuning in semitones. */
  readonly settings: Record<number, { level: number; tune: number }> = Object.fromEntries(PADS.map((pad) => [pad.note, { level: 0, tune: 0 }]));
  private context: BaseAudioContext | null = null;
  private output: GainNode | null = null;
  private readonly buffers = new Map<number, AudioBuffer>();
  private voices: Voice[] = [];

  /** Plays into `destination`, in `context`. */
  connect(context: BaseAudioContext, destination: AudioNode): void {
    this.context = context;
    this.output = new GainNode(context);
    this.output.connect(destination);
    for (const [note, channels] of sounds(context.sampleRate)) {
      const buffer = new AudioBuffer({ numberOfChannels: 2, length: channels[0]!.length, sampleRate: context.sampleRate });
      channels.forEach((data, channel) => buffer.copyToChannel(data as Float32Array<ArrayBuffer>, channel));
      this.buffers.set(note, buffer);
    }
  }

  disconnect(): void {
    this.allNotesOff();
    this.output?.disconnect();
    this.output = null;
  }

  /** Plays `note` at `time` in the audio context's seconds, or at once. */
  noteOn(note: number, velocity: number, time?: number): void {
    const { context, output } = this;
    const buffer = this.buffers.get(note);
    if (!context || !output || !buffer) return;
    const start = Math.max(time ?? 0, context.currentTime);
    const { level, tune } = this.settings[note]!;
    const source = new AudioBufferSourceNode(context, { buffer, playbackRate: 2 ** (tune / 12) });
    const gain = new GainNode(context, { gain: decibelsToGain(level) * (0.2 + 0.8 * velocity * velocity) });
    source.connect(gain).connect(output);
    source.start(start);
    if (note === CLOSED_HAT) {
      for (const voice of this.voices) if (voice.note === OPEN_HAT && voice.start < start) voice.gain.gain.setTargetAtTime(0, start, 0.008);
    }
    const voice: Voice = { note, source, gain, start };
    this.voices.push(voice);
    source.onended = () => {
      this.voices = this.voices.filter((one) => one !== voice);
      gain.disconnect();
    };
  }

  /** The sounds play to their end: a note's end changes nothing. */
  noteOff(_note: number, _time?: number): void {}

  /** Drops the sounds scheduled after `time`, or all of them; those playing ring on. */
  allNotesOff(time?: number): void {
    const from = time ?? 0;
    for (const voice of this.voices) if (voice.start > from || time === undefined) voice.source.stop();
  }

  /** The notes that sounded in the last tenth of a second, to light their keys. */
  get notes(): number[] {
    const now = this.context?.currentTime ?? 0;
    return this.voices.filter((voice) => voice.start <= now && now < voice.start + 0.1).map((voice) => voice.note);
  }
}
