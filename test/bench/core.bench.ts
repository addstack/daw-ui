import { mkdirSync, writeFileSync } from "node:fs";

import { afterAll, test } from "vitest";

import { boxesAlongSegment, createMeterBallistics, createRange, formats, scales, type Box } from "../../src/core/index.js";

// Work that runs per pointer event or per animation frame, at the sizes of a
// large session. Results go to perf-results/bench.md for the CI job summary.

type Row = { name: string; mean: number; p99: number };
const rows: Row[] = [];

afterAll(() => {
  const µs = (ms: number) => (ms * 1000).toFixed(2);
  mkdirSync("perf-results", { recursive: true });
  writeFileSync(
    "perf-results/bench.md",
    [
      "### Core (Node, `vitest bench`)",
      "",
      "| Work | Mean (µs) | p99 (µs) | Share of a 16.7 ms frame |",
      "| --- | --: | --: | --: |",
      ...rows.map((row) => `| ${row.name} | ${µs(row.mean)} | ${µs(row.p99)} | ${((row.mean / 16.7) * 100).toFixed(3)} % |`),
      "",
    ].join("\n"),
  );
});

test("per pointer event", async ({ bench }) => {
  // A 16 × 64 step sequencer: 1024 boxes tested against one pointer move.
  const boxes: Box[] = [];
  for (let row = 0; row < 16; row++) {
    for (let step = 0; step < 64; step++) {
      boxes.push({ left: step * 16, top: row * 16, right: step * 16 + 14, bottom: row * 16 + 14 });
    }
  }
  const decibel = createRange({ min: -70, max: 6, scale: scales.decibel });

  const segment = "boxesAlongSegment, 1024 steps";
  const scale = "decibel scale, value to travel and back";
  const results = await bench.compare(
    bench(segment, () => {
      boxesAlongSegment({ x: 3, y: 3 }, { x: 900, y: 40 }, boxes);
    }),
    bench(scale, () => {
      decibel.normalize(decibel.denormalize(0.73));
    }),
  );
  for (const name of [segment, scale] as const) {
    const { latency } = results.get(name);
    rows.push({ name, mean: latency.mean, p99: latency.p99 });
  }
});

test("per animation frame, 64 channels", async ({ bench }) => {
  const meters = Array.from({ length: 64 }, () => createMeterBallistics());
  const range = createRange({ min: -60, max: 6 });
  const format = formats.decibel({ locale: "en" });
  let now = 0;

  const ballistics = "meter ballistics and travel, 64 channels";
  const text = "decibel text, 64 channels";
  const results = await bench.compare(
    bench(ballistics, () => {
      now += 16;
      for (const meter of meters) range.normalize(meter.update(-12 - (now % 40), now).level);
    }),
    bench(text, () => {
      for (let channel = 0; channel < 64; channel++) format.format(-channel / 3);
    }),
  );
  for (const name of [ballistics, text] as const) {
    const { latency } = results.get(name);
    rows.push({ name, mean: latency.mean, p99: latency.p99 });
  }
});
