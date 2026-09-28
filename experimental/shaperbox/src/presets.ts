import type { CurvePoint } from "../../../src/core/index.js";
import type { Box } from "../engine/box.js";
import { BANDS, KINDS, rateIndex, type Kind } from "../engine/params.js";
import { restingWave } from "../engine/waves.js";
import { TIME_WAVES, WAVES, double } from "./waves.js";

// A few settings to start from. Parameters not named keep their defaults; a wave given once is the wave over the
// whole signal, and each band's too until it is changed.

export type Preset = {
  name: string;
  params: Record<string, number>;
  waves: Partial<Record<Kind, CurvePoint[] | CurvePoint[][]>>;
  order?: Kind[];
};

const rate = (label: string) => rateIndex(label);

export const PRESETS: Preset[] = [
  {
    name: "Pump",
    params: { "volume.on": 1, "volume.rate": rate("1/4") },
    waves: { volume: WAVES.Pump },
  },
  {
    name: "Multiband Pump",
    params: {
      "volume.on": 1,
      "volume.rate": rate("1/4"),
      "volume.multiband": 1,
      "volume.split1": 180,
      "volume.split2": 3200,
      "volume.band2": 0,
    },
    // The lows duck under the kick, the mids stay, the highs are gated in sixteenths.
    waves: { volume: [WAVES.Pump, WAVES.Pump, WAVES.Flat, double(WAVES.Gate, "volume").map((point) => ({ ...point, value: point.value * 0.9 + 0.1 }))] },
  },
  {
    name: "Filter Sweep",
    params: { "filter.on": 1, "filter.rate": rate("2 bars"), "filter.type": 1, "filter.resonance": 0.55, "filter.low": 180, "filter.high": 9000 },
    waves: {
      filter: [
        { at: 0, value: 0.1, shape: -0.4 },
        { at: 0.5, value: 1, shape: 0.4 },
        { at: 1, value: 0.1 },
      ],
    },
  },
  {
    name: "Tape Stop",
    params: { "time.on": 1, "time.rate": rate("2 bars"), "time.smooth": 2 },
    waves: { time: TIME_WAVES["Tape stop"] },
  },
  {
    name: "Stutter",
    params: { "time.on": 1, "time.rate": rate("1 bar"), "pan.on": 1, "pan.rate": rate("1/8"), "pan.mix": 0.6 },
    waves: { time: TIME_WAVES.Stutter, pan: WAVES.Sine },
  },
  {
    name: "Autopan Wide",
    params: { "pan.on": 1, "pan.rate": rate("1/2"), "width.on": 1, "width.rate": rate("1 bar") },
    waves: {
      pan: WAVES.Sine,
      width: [
        { at: 0, value: 0.2, shape: -0.3 },
        { at: 0.5, value: 1, shape: 0.3 },
        { at: 1, value: 0.2 },
      ],
    },
  },
  {
    name: "Lo-fi Wobble",
    params: {
      "filter.on": 1,
      "filter.rate": rate("1/8"),
      "filter.type": 1,
      "filter.resonance": 0.65,
      "filter.low": 120,
      "filter.high": 3200,
      "crush.on": 1,
      "crush.rate": rate("1 bar"),
      "crush.bits": 6,
      "crush.downsample": 6,
      "drive.on": 1,
      "drive.rate": rate("1/4"),
      "drive.amount": 18,
    },
    waves: {
      filter: WAVES.Sine,
      crush: [
        { at: 0, value: 0.3, shape: "hold" },
        { at: 0.75, value: 1, shape: "hold" },
        { at: 1, value: 1 },
      ],
      drive: [
        { at: 0, value: 0.2 },
        { at: 1, value: 0.7 },
      ],
    },
  },
  {
    name: "Liquid Flange",
    params: { "liquid.on": 1, "liquid.rate": rate("4 bars"), "liquid.mode": 0, "liquid.feedback": 0.7, "liquid.stereo": 0.4 },
    waves: { liquid: WAVES.Triangle },
  },
  {
    name: "Transient Duck",
    params: { "volume.on": 1, "volume.trigger": 1, "volume.threshold": -10, "volume.rate": rate("1/8D") },
    waves: { volume: WAVES.Pump },
  },
  {
    name: "Noise Riser",
    params: {
      "noise.on": 1,
      "noise.rate": rate("2 bars"),
      "noise.level": -10,
      "noise.follow": 0.2,
      "noise.color": 0.3,
      "filter.on": 1,
      "filter.rate": rate("2 bars"),
      "filter.type": 3,
      "filter.resonance": 0.5,
      "filter.low": 30,
      "filter.high": 3000,
    },
    waves: {
      noise: [
        { at: 0, value: 0, shape: 0.5 },
        { at: 1, value: 1 },
      ],
      filter: [
        { at: 0, value: 0, shape: 0.4 },
        { at: 1, value: 1 },
      ],
    },
  },
  { name: "Init", params: {}, waves: {} },
];

/** A preset's waves, four for each shaper it names. */
export function presetWaves(preset: Preset): Partial<Record<Kind, CurvePoint[][]>> {
  const waves: Partial<Record<Kind, CurvePoint[][]>> = {};
  for (const kind of KINDS) {
    const given = preset.waves[kind];
    if (!given) continue;
    const bands = Array.isArray(given[0]) ? (given as CurvePoint[][]) : [given as CurvePoint[]];
    waves[kind] = Array.from({ length: BANDS }, (_, band) => bands[band] ?? bands[0] ?? restingWave(kind));
  }
  return waves;
}

/** Sets everything preset `index` holds on `box`. */
export function loadPreset(box: Box, index: number): void {
  const preset = PRESETS[index]!;
  box.preset = index;
  box.load(preset.params, presetWaves(preset), preset.order ?? [...KINDS]);
}
