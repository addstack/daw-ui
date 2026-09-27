import { curveValue, type CurvePoint } from "../../../src/core/index.js";
import { LFO_SIZE } from "./params.js";

/** An LFO's shape, sampled from its curve over one cycle (0 … 1), for the audio thread to read. */
export function sampleShape(points: readonly CurvePoint[]): Float32Array {
  const shape = new Float32Array(LFO_SIZE);
  for (let i = 0; i < LFO_SIZE; i++) shape[i] = Math.min(1, Math.max(0, curveValue(points, i / LFO_SIZE) || 0));
  return shape;
}
