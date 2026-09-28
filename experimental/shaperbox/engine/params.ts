// The shapers, their parameters and the messages between the page and the audio thread. Each shaper moves one
// thing (volume, a filter's cutoff, the time audio plays at, …) by a wave drawn over one cycle, as ShaperBox's do.

export const KINDS = ["volume", "filter", "time", "pan", "width", "noise", "crush", "drive", "liquid"] as const;
export type Kind = (typeof KINDS)[number];

export type ParamSpec = {
  min: number;
  max: number;
  default: number;
  curve?: "log";
  step?: number;
};

/** A cycle's length, as note values: triplets are two thirds, dotted ones half as long again. */
export const RATES = [
  { label: "1/32", beats: 1 / 8 },
  { label: "1/16T", beats: 1 / 6 },
  { label: "1/16", beats: 1 / 4 },
  { label: "1/8T", beats: 1 / 3 },
  { label: "1/16D", beats: 3 / 8 },
  { label: "1/8", beats: 1 / 2 },
  { label: "1/4T", beats: 2 / 3 },
  { label: "1/8D", beats: 3 / 4 },
  { label: "1/4", beats: 1 },
  { label: "1/2T", beats: 4 / 3 },
  { label: "1/4D", beats: 3 / 2 },
  { label: "1/2", beats: 2 },
  { label: "1/2D", beats: 3 },
  { label: "1 bar", beats: 4 },
  { label: "2 bars", beats: 8 },
  { label: "4 bars", beats: 16 },
  { label: "8 bars", beats: 32 },
] as const;

export const rateIndex = (label: string) => RATES.findIndex((rate) => rate.label === label);

/** What every shaper has: on, mix, its rate and trigger, and three bands it can split into. */
const common = (kind: Kind, rate: string) =>
  ({
    [`${kind}.on`]: { min: 0, max: 1, default: 0, step: 1 },
    [`${kind}.mix`]: { min: 0, max: 1, default: 1 },
    [`${kind}.rate`]: { min: 0, max: RATES.length - 1, default: rateIndex(rate), step: 1 },
    // 0: the wave follows the tempo; 1: a transient in the audio starts it, and it runs once.
    [`${kind}.trigger`]: { min: 0, max: 1, default: 0, step: 1 },
    [`${kind}.threshold`]: { min: -60, max: 0, default: -12 },
    [`${kind}.multiband`]: { min: 0, max: 1, default: 0, step: 1 },
    [`${kind}.split1`]: { min: 20, max: 20_000, default: 200, curve: "log" },
    [`${kind}.split2`]: { min: 20, max: 20_000, default: 2500, curve: "log" },
    [`${kind}.band1`]: { min: 0, max: 1, default: 1, step: 1 },
    [`${kind}.band2`]: { min: 0, max: 1, default: 1, step: 1 },
    [`${kind}.band3`]: { min: 0, max: 1, default: 1, step: 1 },
  }) as Record<string, ParamSpec>;

export const PARAMS: Record<string, ParamSpec> = {
  ...common("volume", "1/4"),
  ...common("filter", "1 bar"),
  "filter.type": { min: 0, max: 5, default: 1, step: 1 },
  "filter.resonance": { min: 0, max: 1, default: 0.3 },
  "filter.low": { min: 20, max: 20_000, default: 150, curve: "log" },
  "filter.high": { min: 20, max: 20_000, default: 12_000, curve: "log" },
  ...common("time", "1 bar"),
  "time.smooth": { min: 0.5, max: 50, default: 4, curve: "log" },
  ...common("pan", "1/2"),
  ...common("width", "1 bar"),
  ...common("noise", "1/4"),
  "noise.level": { min: -48, max: 0, default: -18 },
  "noise.color": { min: -1, max: 1, default: 0 },
  "noise.follow": { min: 0, max: 1, default: 0.8 },
  ...common("crush", "1/8"),
  "crush.bits": { min: 1, max: 16, default: 4 },
  "crush.downsample": { min: 1, max: 64, default: 12, curve: "log" },
  ...common("drive", "1/4"),
  "drive.amount": { min: 0, max: 48, default: 24 },
  "drive.type": { min: 0, max: 2, default: 0, step: 1 },
  ...common("liquid", "2 bars"),
  "liquid.mode": { min: 0, max: 2, default: 0, step: 1 },
  "liquid.feedback": { min: -0.95, max: 0.95, default: 0.6 },
  "liquid.stereo": { min: 0, max: 1, default: 0.3 },
  "global.mix": { min: 0, max: 1, default: 1 },
  "global.output": { min: -24, max: 12, default: 0 },
  "global.bypass": { min: 0, max: 1, default: 0, step: 1 },
};

export const FILTER_TYPES = ["LP 12", "LP 24", "HP 12", "HP 24", "BP", "Notch"] as const;
export const DRIVE_TYPES = ["Soft", "Hard", "Fold"] as const;
export const LIQUID_MODES = ["Flanger", "Phaser", "Chorus"] as const;

export const defaults = (): Record<string, number> => Object.fromEntries(Object.entries(PARAMS).map(([id, spec]) => [id, spec.default]));

/** Where a wave starts when nothing is drawn: where it changes nothing. */
export const REST: Record<Kind, number> = {
  volume: 1,
  filter: 1,
  time: 0,
  pan: 0.5,
  width: 0.5,
  noise: 0,
  crush: 0,
  drive: 0,
  liquid: 0.5,
};

/** Points of a wave, sampled from its curve, and one more for the end of the cycle. */
export const WAVE_SIZE = 1024;
/** Slices of a cycle the audio behind a wave is drawn in. */
export const SLICES = 256;
/** A wave over the whole signal, and one for each band: low, mid and high. */
export const BANDS = 4;

/** Messages from the page to the audio thread. */
export type ToProcessor =
  | { type: "params"; values: Record<string, number> }
  | { type: "wave"; kind: Kind; band: number; wave: Float32Array }
  | { type: "order"; order: Kind[] }
  | { type: "source"; left: Float32Array; right: Float32Array; beats: number | null }
  | { type: "transport"; playing: boolean; bpm: number }
  /** As an effect in a host: from the audio context's second `at`, the host's song is at beat `beats`. */
  | { type: "clock"; at: number; beats: number; bpm: number }
  | { type: "watch"; kind: Kind; band: number };

/**
 * The audio thread's report, about sixty times a second: where each shaper's wave is, the value of the watched
 * one, and the audio in and out of it over its last cycle, as the peak of each slice.
 */
export type Report = {
  type: "report";
  phases: number[];
  value: number;
  input: Float32Array;
  output: Float32Array;
  beats: number;
};
