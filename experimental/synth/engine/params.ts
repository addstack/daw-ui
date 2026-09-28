// The synth's parameters and modulation, shared by the page and the audio thread. Each parameter has a range, as
// the knobs that set it do; modulation moves a parameter along that range's travel, from 0 to 1, as Serum's does.

export type Curve = "linear" | "log";

export type ParamSpec = {
  min: number;
  max: number;
  default: number;
  curve?: Curve;
  step?: number;
};

const osc = (prefix: "a" | "b", on: number, table: number) =>
  ({
    [`${prefix}.on`]: { min: 0, max: 1, default: on, step: 1 },
    [`${prefix}.table`]: { min: 0, max: 3, default: table, step: 1 },
    [`${prefix}.position`]: { min: 0, max: 1, default: 0 },
    [`${prefix}.level`]: { min: 0, max: 1, default: 0.75 },
    [`${prefix}.pan`]: { min: -1, max: 1, default: 0 },
    [`${prefix}.octave`]: { min: -3, max: 3, default: 0, step: 1 },
    [`${prefix}.semi`]: { min: -12, max: 12, default: 0, step: 1 },
    [`${prefix}.fine`]: { min: -100, max: 100, default: 0 },
    [`${prefix}.unison`]: { min: 1, max: 7, default: 1, step: 1 },
    [`${prefix}.detune`]: { min: 0, max: 1, default: 0.25 },
    [`${prefix}.blend`]: { min: 0, max: 1, default: 0.5 },
  }) as Record<string, ParamSpec>;

const envelope = (prefix: string, attack: number, decay: number, sustain: number, release: number) =>
  ({
    [`${prefix}.attack`]: { min: 1, max: 8000, default: attack, curve: "log" },
    [`${prefix}.decay`]: { min: 1, max: 8000, default: decay, curve: "log" },
    [`${prefix}.sustain`]: { min: 0, max: 1, default: sustain },
    [`${prefix}.release`]: { min: 1, max: 8000, default: release, curve: "log" },
  }) as Record<string, ParamSpec>;

export const PARAMS: Record<string, ParamSpec> = {
  ...osc("a", 1, 0),
  ...osc("b", 0, 1),
  "sub.on": { min: 0, max: 1, default: 0, step: 1 },
  "sub.level": { min: 0, max: 1, default: 0.5 },
  "sub.octave": { min: -2, max: 0, default: -1, step: 1 },
  "sub.shape": { min: 0, max: 1, default: 0, step: 1 },
  "noise.on": { min: 0, max: 1, default: 0, step: 1 },
  "noise.level": { min: 0, max: 1, default: 0.2 },
  "filter.on": { min: 0, max: 1, default: 1, step: 1 },
  "filter.type": { min: 0, max: 4, default: 0, step: 1 },
  "filter.cutoff": { min: 20, max: 20_000, default: 4000, curve: "log" },
  "filter.resonance": { min: 0, max: 1, default: 0.15 },
  "filter.drive": { min: 0, max: 1, default: 0 },
  "filter.mix": { min: 0, max: 1, default: 1 },
  ...envelope("env1", 4, 400, 0.8, 300),
  ...envelope("env2", 4, 600, 0, 400),
  ...envelope("env3", 300, 900, 0.5, 900),
  "lfo1.rate": { min: 0.02, max: 20, default: 1, curve: "log" },
  "lfo1.retrigger": { min: 0, max: 1, default: 0, step: 1 },
  "lfo2.rate": { min: 0.02, max: 20, default: 0.25, curve: "log" },
  "lfo2.retrigger": { min: 0, max: 1, default: 0, step: 1 },
  "macro1": { min: 0, max: 1, default: 0 },
  "macro2": { min: 0, max: 1, default: 0 },
  "chorus.mix": { min: 0, max: 1, default: 0 },
  "chorus.rate": { min: 0.05, max: 5, default: 0.6, curve: "log" },
  "chorus.depth": { min: 0, max: 1, default: 0.5 },
  "delay.mix": { min: 0, max: 1, default: 0 },
  "delay.time": { min: 20, max: 1500, default: 375, curve: "log" },
  "delay.feedback": { min: 0, max: 0.9, default: 0.4 },
  "reverb.mix": { min: 0, max: 1, default: 0.15 },
  "reverb.size": { min: 0.3, max: 8, default: 2.5, curve: "log" },
  "master.volume": { min: -60, max: 6, default: -8 },
};

export type ParamId = keyof typeof PARAMS & string;

export const FILTER_TYPES = ["LP 12", "LP 24", "HP 12", "BP 12", "Notch"] as const;

/** What moves parameters: two modulation envelopes, two LFOs, the note's velocity and pitch, and two macros. */
export const SOURCES = ["env2", "env3", "lfo1", "lfo2", "velocity", "note", "macro1", "macro2"] as const;
export type Source = (typeof SOURCES)[number];

/** What they can move. */
export const DESTINATIONS = [
  "a.position",
  "a.level",
  "a.pan",
  "a.fine",
  "a.detune",
  "b.position",
  "b.level",
  "b.pan",
  "b.fine",
  "b.detune",
  "sub.level",
  "noise.level",
  "filter.cutoff",
  "filter.resonance",
  "filter.drive",
  "filter.mix",
] as const;
export type Destination = (typeof DESTINATIONS)[number];

/** A source moving a destination by `amount` of its travel, −1 to 1. */
export type Routing = { source: Source; destination: Destination; amount: number };

export function normalize(spec: ParamSpec, value: number): number {
  if (spec.curve === "log") return Math.log(value / spec.min) / Math.log(spec.max / spec.min);
  return (value - spec.min) / (spec.max - spec.min);
}

export function denormalize(spec: ParamSpec, travel: number): number {
  const t = Math.min(1, Math.max(0, travel));
  if (spec.curve === "log") return spec.min * (spec.max / spec.min) ** t;
  return spec.min + t * (spec.max - spec.min);
}

export const defaults = (): Record<string, number> => Object.fromEntries(Object.entries(PARAMS).map(([id, spec]) => [id, spec.default]));

/** A note's messages: at `time`, in the audio context's seconds, or at once without it. */
export type NoteMessage =
  | { type: "noteOn"; note: number; velocity: number; time?: number | undefined }
  | { type: "noteOff"; note: number; time?: number | undefined }
  | { type: "allNotesOff"; time?: number | undefined };

/** Messages from the page to the audio thread. */
export type ToProcessor =
  | { type: "tables"; tables: Float32Array[] }
  | { type: "params"; values: Record<string, number> }
  | { type: "routings"; routings: Routing[] }
  | { type: "lfo"; index: 0 | 1; shape: Float32Array }
  | NoteMessage;

/** Messages from the audio thread: where modulation has moved each destination now, as travel, and what plays. */
export type FromProcessor = { type: "state"; travel: Record<string, number>; lfo: [number, number]; notes: number[] };

/** The wavetables: their names, and how they are laid out. */
export const TABLES = ["Basic", "Harmonics", "Pulse", "Formant"] as const;
export const TABLE_SIZE = 2048;
export const FRAMES = 32;
/** Band-limited copies per frame: copy l keeps harmonics up to 1024 / 2^l. */
export const LEVELS = 11;
/** Points of an LFO shape, sampled from its curve. */
export const LFO_SIZE = 512;
