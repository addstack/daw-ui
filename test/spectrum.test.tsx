// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { createRange, scales } from "../src/core/index.js";
import { spectrumColumns, spectrumLevels } from "../src/core/spectrum.js";
import { Spectrum } from "../src/react/index.js";

// 1024 bins at 48 kHz, as an AnalyserNode with an fftSize of 2048 gives them: 23.4375 Hz apart.
const RATE = 48_000;
const COUNT = 1024;
const PER_BIN = RATE / 2 / COUNT;
const bins = (level: (index: number) => number) => Float32Array.from({ length: COUNT }, (_, index) => level(index));

describe("spectrum levels", () => {
  test("a column over many bins shows the loudest, so that a narrow peak shows", () => {
    // Three columns across 0 … 24 kHz, 341 bins each.
    const columns = spectrumColumns(3, COUNT, RATE, createRange({ min: 0, max: 24_000 }));
    expect(columns.from[1]).toBeCloseTo(8000 / PER_BIN);
    const levels = spectrumLevels(bins((index) => (index === 500 ? -10 : -80)), columns, 0, new Float32Array(3));
    expect([...levels]).toEqual([-80, -10, -80]);
  });

  test("a column narrower than a bin lies on a smooth curve through the bins around it", () => {
    // 20 Hz … 20 kHz across 1000 columns: at the low end, a bin spans many columns.
    const columns = spectrumColumns(1000, COUNT, RATE, createRange({ min: 20, max: 20_000, scale: scales.log }));
    expect(columns.to[0]! - columns.from[0]!).toBeLessThan(1);
    // On a straight slope of bins the curve is the slope itself, away from the first bin (column 100 is at 40 Hz).
    const levels = spectrumLevels(bins((index) => -index), columns, 0, new Float32Array(1000));
    expect(columns.to[100]! - columns.from[100]!).toBeLessThan(1);
    expect(levels[100]).toBeCloseTo(-(columns.from[100]! + columns.to[100]!) / 2, 3);
  });

  test("silence is very quiet, not missing; tilt raises the highs and lowers the lows by octaves from 1 kHz", () => {
    const axis = createRange({ min: 20, max: 20_000, scale: scales.log });
    const columns = spectrumColumns(1000, COUNT, RATE, axis);
    const silent = spectrumLevels(bins(() => -Infinity), columns, 0, new Float32Array(1000));
    expect(silent.every((level) => level === -200)).toBe(true);
    const flat = spectrumLevels(bins(() => -40), columns, 0, new Float32Array(1000));
    const tilted = spectrumLevels(bins(() => -40), columns, 4.5, new Float32Array(1000));
    const at = (hertz: number) => Math.floor(axis.normalize(hertz) * 1000);
    expect(tilted[at(4000)]! - flat[at(4000)]!).toBeCloseTo(9, 0);
    expect(tilted[at(250)]! - flat[at(250)]!).toBeCloseTo(-9, 0);
  });
});

// jsdom has no layout, frames or canvas: the tests give the spectrum a size, run frames, and record the paths drawn.
let frames: FrameRequestCallback[] = [];
const size = { width: 100, height: 90 };
const drawn = { paths: [] as [string, number, number][][], ends: [] as string[] };

beforeEach(() => {
  frames = [];
  drawn.paths = [];
  drawn.ends = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: () => void) {}
      observe() {
        this.callback();
      }
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => size.width);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => size.height);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () =>
      ({
        clearRect: () => {},
        beginPath: () => drawn.paths.push([]),
        moveTo: (x: number, y: number) => drawn.paths.at(-1)!.push(["M", Math.round(x), Math.round(y)]),
        lineTo: (x: number, y: number) => drawn.paths.at(-1)!.push(["L", Math.round(x), Math.round(y)]),
        closePath: () => drawn.ends.push("close"),
        stroke: () => drawn.ends.push("stroke"),
        fill: () => drawn.ends.push("fill"),
      }) as unknown as CanvasRenderingContext2D,
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function frame(now: number) {
  const pending = frames;
  frames = [];
  for (const callback of pending) callback(now);
}

/** The heights of the last line drawn, from the top, one per column. */
const heights = () => drawn.paths.at(-1)!.map(([, , y]) => y);

describe("Spectrum", () => {
  test("is an image named by the application; a line and a fill through one level per column", () => {
    render(
      <Spectrum.Root bins={bins(() => -45)} sampleRate={RATE} aria-label="Analyser">
        <Spectrum.Fill />
        <Spectrum.Line />
      </Spectrum.Root>,
    );
    expect(screen.getByRole("img", { name: "Analyser" })).toBeTruthy();
    // The fill: one shape from the bottom left, along the levels, to the bottom right, closed along the bottom.
    const [fill, line] = drawn.paths.slice(-2);
    expect(fill![0]).toEqual(["M", 0, 90]);
    expect(fill!.filter(([command]) => command === "M")).toHaveLength(1);
    expect(fill![1]).toEqual(["L", 1, 45]);
    expect(fill!.at(-1)).toEqual(["L", 100, 90]);
    expect(drawn.ends).toEqual(["close", "fill", "stroke"]);
    // −45 dB is halfway from −90 to 0 dB: 45 px down a 90 px spectrum, in every one of 100 columns.
    expect(line).toHaveLength(100);
    expect(new Set(line!.map(([, , y]) => y))).toEqual(new Set([45]));
  });

  test("with read, it follows the bins once per frame and renders nothing; fall lets the levels down slowly", () => {
    let level = -10;
    let commits = 0;
    render(
      <Profiler id="spectrum" onRender={() => commits++}>
        <Spectrum.Root read={() => bins(() => level)} sampleRate={RATE} fall={24}>
          <Spectrum.Line />
        </Spectrum.Root>
      </Profiler>,
    );
    const before = commits;
    frame(0);
    expect(new Set(heights())).toEqual(new Set([10]));
    // Half a second later, silence: the level falls 12 dB, to −22 dB.
    level = -90;
    frame(500);
    expect(new Set(heights())).toEqual(new Set([22]));
    // Rising is at once.
    level = 0;
    frame(600);
    expect(new Set(heights())).toEqual(new Set([0]));
    expect(commits).toBe(before);
  });

  test("peaks hold, then fall", () => {
    let level = -10;
    render(
      <Spectrum.Root read={() => bins(() => level)} sampleRate={RATE}>
        <Spectrum.Peak hold={1000} fall={24} />
      </Spectrum.Root>,
    );
    frame(0);
    level = -90;
    frame(500);
    expect(new Set(heights())).toEqual(new Set([10]));
    frame(1000);
    frame(1500);
    // Held until 1 s, then 12 dB lower half a second on.
    expect(new Set(heights())).toEqual(new Set([22]));
  });

  test("parts outside a root say where they belong", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Spectrum.Line />)).toThrow(/Spectrum.Root/);
  });
});
