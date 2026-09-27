import type { CurvePoint } from "../../../src/core/index.js";
import type { Routing } from "../engine/params.js";

// A few sounds to start from. Parameters not named keep their defaults.

export type Preset = {
  name: string;
  params: Record<string, number>;
  routings: Routing[];
  lfos: [CurvePoint[], CurvePoint[]];
};

/** LFO shapes over one cycle, 0 … 1: a sine made of two bends, a triangle, a falling saw, a square. */
export const SHAPES = {
  // Each quarter bends as a sine does: fast away from the middle, slow into a peak, and back.
  sine: [
    { at: 0, value: 0.5, shape: -0.3 },
    { at: 0.25, value: 1, shape: 0.3 },
    { at: 0.5, value: 0.5, shape: -0.3 },
    { at: 0.75, value: 0, shape: 0.3 },
    { at: 1, value: 0.5 },
  ],
  triangle: [
    { at: 0, value: 0 },
    { at: 0.5, value: 1 },
    { at: 1, value: 0 },
  ],
  saw: [
    { at: 0, value: 1, shape: -0.3 },
    { at: 1, value: 0 },
  ],
  square: [
    { at: 0, value: 1 },
    { at: 0.5, value: 1 },
    { at: 0.5, value: 0 },
    { at: 1, value: 0 },
  ],
} satisfies Record<string, CurvePoint[]>;

export const PRESETS: Preset[] = [
  { name: "Init", params: {}, routings: [], lfos: [SHAPES.sine, SHAPES.triangle] },
  {
    name: "Supersaw Pad",
    params: {
      "a.position": 0.667, "a.unison": 7, "a.detune": 0.35, "a.blend": 0.75,
      "b.on": 1, "b.table": 0, "b.position": 0.667, "b.octave": -1, "b.unison": 5, "b.detune": 0.25, "b.level": 0.5,
      "filter.type": 1, "filter.cutoff": 2200, "filter.resonance": 0.2,
      "env1.attack": 700, "env1.decay": 900, "env1.sustain": 0.8, "env1.release": 1600,
      "lfo1.rate": 0.15, "chorus.mix": 0.35, "reverb.mix": 0.4, "reverb.size": 4,
    },
    routings: [
      { source: "lfo1", destination: "filter.cutoff", amount: 0.15 },
      { source: "env3", destination: "a.detune", amount: 0.2 },
    ],
    lfos: [SHAPES.sine, SHAPES.triangle],
  },
  {
    name: "Wobble Bass",
    params: {
      "a.position": 0.667, "a.octave": -1, "a.unison": 3, "a.detune": 0.12,
      "sub.on": 1, "sub.level": 0.7, "sub.octave": -1,
      "filter.type": 1, "filter.cutoff": 180, "filter.resonance": 0.55, "filter.drive": 0.5,
      "env1.attack": 2, "env1.decay": 200, "env1.sustain": 1, "env1.release": 90,
      "lfo1.rate": 3, "lfo1.retrigger": 1, "reverb.mix": 0.05,
    },
    routings: [{ source: "lfo1", destination: "filter.cutoff", amount: 0.55 }],
    lfos: [SHAPES.saw, SHAPES.triangle],
  },
  {
    name: "Pluck",
    params: {
      "a.table": 2, "a.position": 0.35, "a.unison": 2, "a.detune": 0.1,
      "filter.type": 0, "filter.cutoff": 300, "filter.resonance": 0.3,
      "env1.attack": 1, "env1.decay": 420, "env1.sustain": 0, "env1.release": 320,
      "env2.attack": 1, "env2.decay": 260, "env2.sustain": 0, "env2.release": 200,
      "delay.mix": 0.28, "delay.time": 375, "delay.feedback": 0.4, "reverb.mix": 0.22,
    },
    routings: [
      { source: "env2", destination: "filter.cutoff", amount: 0.6 },
      { source: "velocity", destination: "filter.cutoff", amount: 0.15 },
    ],
    lfos: [SHAPES.sine, SHAPES.triangle],
  },
  {
    name: "Vowel Lead",
    params: {
      "a.table": 3, "a.position": 0.2, "a.unison": 3, "a.detune": 0.15,
      "b.on": 1, "b.table": 0, "b.position": 1, "b.octave": -1, "b.level": 0.3,
      "filter.cutoff": 6000, "filter.resonance": 0.1,
      "env1.attack": 12, "env1.decay": 300, "env1.sustain": 0.85, "env1.release": 220,
      "lfo2.rate": 0.3, "chorus.mix": 0.2, "delay.mix": 0.18, "reverb.mix": 0.25,
    },
    routings: [
      { source: "lfo2", destination: "a.position", amount: 0.7 },
      { source: "macro1", destination: "filter.cutoff", amount: -0.5 },
    ],
    lfos: [SHAPES.sine, SHAPES.triangle],
  },
];
