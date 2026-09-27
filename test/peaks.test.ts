import { describe, expect, test } from "vitest";

import { createPeaks, createPeaksRecorder, peaksFromAudiowaveform, readPeaks, type Peaks } from "../src/core/index.js";

/** `seconds` of a sine at `frequency`, at `sampleRate`, with the amplitude of `gain(t)`. */
function sine(seconds: number, sampleRate: number, frequency: number, gain: (t: number) => number = () => 1): Float32Array {
  const samples = new Float32Array(Math.round(seconds * sampleRate));
  for (let index = 0; index < samples.length; index++) {
    const t = index / sampleRate;
    samples[index] = gain(t) * Math.sin(2 * Math.PI * frequency * t);
  }
  return samples;
}

function columns(peaks: Peaks, count: number, time: number, secondsPerColumn: number, channel?: number, samples?: Float32Array[]): number[][] {
  const out = new Float32Array(count * 2);
  readPeaks(peaks, out, { time, secondsPerColumn, channel, samples });
  return Array.from({ length: count }, (_, column) => [out[column * 2]!, out[column * 2 + 1]!]);
}

describe("createPeaks", () => {
  test("keeps the lowest and highest sample of each bucket, in 8 bits", () => {
    const peaks = createPeaks([new Float32Array([0.5, -0.25, 1, -1, 0.1])], 4, { samplesPerPeak: 2 });
    expect(Array.from(peaks.levels[0]!.data[0]!)).toEqual([-32, 64, -127, 127, 13, 13]);
    expect(peaks).toMatchObject({ sampleRate: 4, channels: 1, length: 5, duration: 1.25 });
  });

  test("each level merges pairs of buckets, down to one", () => {
    const peaks = createPeaks([sine(1, 1000, 5)], 1000, { samplesPerPeak: 10 });
    expect(peaks.levels.map((level) => level.samplesPerPeak)).toEqual([10, 20, 40, 80, 160, 320, 640, 1280]);
    const coarsest = peaks.levels.at(-1)!.data[0]!;
    expect(Array.from(coarsest)).toEqual([-127, 127]);
  });

  test("channels stay apart, and a shorter channel is silent at its end", () => {
    const peaks = createPeaks([new Float32Array([1, 1, 1, 1]), new Float32Array([-1, -1])], 4, { samplesPerPeak: 2 });
    expect(Array.from(peaks.levels[0]!.data[1]!)).toEqual([-127, -127, 0, 0]);
  });

  test("rejects no channels and a bucket of no samples", () => {
    expect(() => createPeaks([], 48_000)).toThrow(RangeError);
    expect(() => createPeaks([new Float32Array(4)], 48_000, { samplesPerPeak: 0 })).toThrow(RangeError);
  });
});

describe("readPeaks", () => {
  // A sine that fades in over 10 s: each column's peak follows the fade.
  const sampleRate = 8000;
  const peaks = createPeaks([sine(10, sampleRate, 100, (t) => t / 10)], sampleRate);

  test("reads each column's range from the audio at any zoom", () => {
    for (const secondsPerColumn of [0.05, 0.5, 2]) {
      const read = columns(peaks, 5, 0, secondsPerColumn);
      for (const [column, [min, max]] of read.entries()) {
        const loudest = Math.min(1, ((column + 1) * secondsPerColumn) / 10);
        expect(max).toBeCloseTo(loudest, 1);
        expect(min).toBeCloseTo(-loudest, 1);
      }
    }
  });

  test("columns before or after the audio are silent", () => {
    expect(columns(peaks, 2, -5, 1)).toEqual([
      [0, 0],
      [0, 0],
    ]);
    expect(columns(peaks, 1, 12, 1)).toEqual([[0, 0]]);
  });

  test("columns narrower than a bucket show the bucket they are in", () => {
    const [first, second] = columns(peaks, 2, 5, 1 / sampleRate);
    expect(first).toEqual(second);
    expect(first![1]).toBeGreaterThan(0);
  });

  test("merges channels, or reads one", () => {
    const stereo = createPeaks([new Float32Array([0.5, 0.5]), new Float32Array([-1, -1])], 2, { samplesPerPeak: 2 });
    expect(columns(stereo, 1, 0, 1)[0]!.map((value) => Math.round(value * 100) / 100)).toEqual([-1, 0.5]);
    expect(columns(stereo, 1, 0, 1, 0)[0]!.map((value) => Math.round(value * 100) / 100)).toEqual([0.5, 0.5]);
  });
});

describe("peaksFromAudiowaveform", () => {
  test("reads 8-bit data", () => {
    const peaks = peaksFromAudiowaveform({ sample_rate: 48_000, samples_per_pixel: 512, bits: 8, data: [-10, 20, -127, 127] });
    expect(Array.from(peaks.levels[0]!.data[0]!)).toEqual([-10, 20, -127, 127]);
    expect(peaks).toMatchObject({ length: 1024, channels: 1, levels: [{ samplesPerPeak: 512 }, { samplesPerPeak: 1024 }] });
  });

  test("reduces 16-bit data, and splits channels", () => {
    const peaks = peaksFromAudiowaveform({
      sample_rate: 44_100,
      samples_per_pixel: 256,
      bits: 16,
      channels: 2,
      data: [-32768, 32767, -256, 512],
    });
    expect(Array.from(peaks.levels[0]!.data[0]!)).toEqual([-127, 127]);
    expect(Array.from(peaks.levels[0]!.data[1]!)).toEqual([-1, 2]);
  });
});

describe("createPeaksRecorder", () => {
  test("peaks appended block by block are the peaks of the whole", () => {
    const samples = sine(3, 8000, 50, (t) => t / 3);
    const whole = createPeaks([samples], 8000);
    const recorder = createPeaksRecorder({ sampleRate: 8000, channels: 1 });
    // Blocks of 128 samples, as an AudioWorklet delivers them.
    for (let at = 0; at < samples.length; at += 128) recorder.append([samples.subarray(at, at + 128)]);
    expect(recorder).toMatchObject({ length: whole.length, duration: whole.duration });
    expect(recorder.levels.map((level) => level.samplesPerPeak)).toEqual(whole.levels.map((level) => level.samplesPerPeak));
    for (const secondsPerColumn of [0.01, 0.2, 1]) {
      expect(columns(recorder, 3, 0, secondsPerColumn)).toEqual(columns(whole, 3, 0, secondsPerColumn));
    }
  });

  test("tells its listeners from where the audio changed", () => {
    const recorder = createPeaksRecorder({ sampleRate: 1000, channels: 1, samplesPerPeak: 100 });
    const changes: number[] = [];
    recorder.subscribe((from) => changes.push(from));
    recorder.append([new Float32Array(150)]);
    recorder.append([new Float32Array(100)]);
    // The second block finishes the bucket that started at 0.1 s.
    expect(changes).toEqual([0, 0.1]);
  });

  test("the last bucket shows what has come so far", () => {
    const recorder = createPeaksRecorder({ sampleRate: 1000, channels: 1, samplesPerPeak: 100 });
    recorder.append([new Float32Array(10).fill(0.5)]);
    expect(columns(recorder, 1, 0, 0.1)).toEqual([[0.5039370059967041, 0.5039370059967041]]);
  });
});

describe("readPeaks with the samples", () => {
  const sampleRate = 1000;
  const ramp = new Float32Array(1000).map((_, index) => index / 1000);
  const peaks = createPeaks([ramp], sampleRate);

  test("columns narrower than a bucket read the samples, and join into a line", () => {
    // Four columns per sample: each covers a quarter of the step to the next sample.
    const read = columns(peaks, 4, 0.1, 0.00025, undefined, [ramp]);
    const round = (value: number) => Math.round(value * 1e6) / 1e6;
    expect(read.map(([min, max]) => [round(min!), round(max!)])).toEqual([
      [0.1, 0.10025],
      [0.10025, 0.1005],
      [0.1005, 0.10075],
      [0.10075, 0.101],
    ]);
  });

  test("columns as wide as buckets still read the peaks", () => {
    const out = new Float32Array(2);
    readPeaks(peaks, out, { time: 0, secondsPerColumn: 0.5, samples: [new Float32Array(1000)] });
    expect(out[1]).toBeGreaterThan(0.4);
  });
});
