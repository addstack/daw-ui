import { curveValue, type CurvePoint } from "../../../src/core/index.js";
import { REST, WAVE_SIZE, type Kind } from "./params.js";

/** A wave, sampled from its curve over one cycle (0 … 1) and at its end, for the audio thread to read. */
export function sampleWave(points: readonly CurvePoint[]): Float32Array {
  const wave = new Float32Array(WAVE_SIZE + 1);
  for (let i = 0; i <= WAVE_SIZE; i++) wave[i] = Math.min(1, Math.max(0, curveValue(points, i / WAVE_SIZE) || 0));
  return wave;
}

/** A wave where it changes nothing: the diagonal for Time, a flat line elsewhere. */
export function restingWave(kind: Kind): CurvePoint[] {
  const [start, end] = kind === "time" ? [0, 1] : [REST[kind], REST[kind]];
  return [
    { at: 0, value: start },
    { at: 1, value: end },
  ];
}
