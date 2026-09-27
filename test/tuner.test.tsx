// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { formats } from "../src/core/index.js";
import { noteOf, targetOf } from "../src/core/tuner.js";
import { Tuner } from "../src/react/index.js";

const names = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const pitch = formats.pitch({ names, locale: "en" });
/** The frequency of a MIDI note with a fraction, at A4 = 440 Hz. */
const hertz = (note: number) => 440 * 2 ** ((note - 69) / 12);

describe("reading a frequency", () => {
  test("a frequency is a note with a fraction, from the reference A4", () => {
    expect(noteOf(440, 440)).toBe(69);
    expect(noteOf(hertz(60.25), 440)).toBeCloseTo(60.25);
    // At A4 = 432 Hz, 432 Hz is A4.
    expect(noteOf(432, 432)).toBe(69);
  });

  test("the note shown is the nearest, and stays until the pitch is nearer another by the hysteresis", () => {
    expect(targetOf(60.4, null, undefined, 10)).toBe(60);
    // Past the middle, but not by 10 cents: still C.
    expect(targetOf(60.54, 60, undefined, 10)).toBe(60);
    expect(targetOf(60.56, 60, undefined, 10)).toBe(61);
    // Among targets, the nearest string: 41.3 is nearer E2 (40) than A2 (45).
    expect(targetOf(41.3, null, [40, 45, 50], 10)).toBe(40);
    // Between E2 and A2 the middle is 42.5: past it by less than 10 cents, still E2.
    expect(targetOf(42.54, 40, [40, 45, 50], 10)).toBe(40);
    expect(targetOf(42.56, 40, [40, 45, 50], 10)).toBe(45);
  });
});

let frames: FrameRequestCallback[] = [];
beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal("cancelAnimationFrame", () => {});
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

function Classic(props: Partial<Tuner.Root.Props>) {
  return (
    <Tuner.Root format={pitch} data-testid="root" {...props}>
      <Tuner.Note data-testid="note" />
      <Tuner.Note data-testid="midi" format={formats.number({ digits: 0, locale: "en" })} />
      <Tuner.Frequency data-testid="frequency" format={formats.frequency({ locale: "en" })} />
      <Tuner.Cents data-testid="cents" />
      <Tuner.Indicator data-testid="indicator" />
      <Tuner.Strobe data-testid="strobe" />
      <Tuner.Mark note={69} data-testid="A4" />
      <Tuner.Mark pitchClass={9} data-testid="any A" />
      <Tuner.Mark cents={[-5, 5]} data-testid="centre" />
      <Tuner.Mark cents={[5, 50]} data-testid="sharp light" />
    </Tuner.Root>
  );
}

const text = (id: string) => screen.getByTestId(id).textContent;
const has = (id: string, attribute: string) => screen.getByTestId(id).hasAttribute(attribute);
const variable = (id: string, name: string) => screen.getByTestId(id).style.getPropertyValue(name);

describe("Tuner", () => {
  test("shows the note, the frequency and the cents off, as text, attributes and variables", () => {
    render(<Classic frequency={440} />);
    expect([text("note"), text("midi"), text("frequency"), text("cents")]).toEqual(["A4", "69", "440 Hz", "0"]);
    expect(["data-active", "data-in-tune", "data-flat", "data-sharp"].map((name) => has("root", name))).toEqual([true, true, false, false]);
    expect([variable("indicator", "--tuner-offset"), variable("indicator", "--tuner-class")]).toEqual(["0", "9"]);
    expect([has("A4", "data-active"), has("any A", "data-active"), has("centre", "data-active"), has("sharp light", "data-active")]).toEqual([true, true, true, false]);
    // A mark is not announced; the note is, politely, when it changes.
    expect(screen.getByTestId("A4").getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByTestId("note").getAttribute("aria-live")).toBe("polite");
  });

  test("with read, it follows the frequency once per frame without rendering; in silence it keeps the last reading", () => {
    let frequency: number | null = hertz(69.234);
    let commits = 0;
    render(
      <Profiler id="tuner" onRender={() => commits++}>
        <Classic read={() => frequency} />
      </Profiler>,
    );
    const before = commits;
    frame(0);
    expect([text("note"), text("cents")]).toEqual(["A4", "+23"]);
    expect(["data-in-tune", "data-sharp"].map((name) => has("root", name))).toEqual([false, true]);
    expect(variable("indicator", "--tuner-offset")).toBe("0.468");
    expect([has("centre", "data-active"), has("sharp light", "data-active")]).toEqual([false, true]);
    frequency = hertz(68.9);
    frame(16);
    expect([text("cents"), has("root", "data-flat")]).toEqual(["-10", true]);
    frequency = null;
    frame(32);
    expect([has("root", "data-active"), has("root", "data-flat"), has("A4", "data-active")]).toEqual([false, false, false]);
    expect(text("note")).toBe("A4");
    expect(commits).toBe(before);
  });

  test("targets are the notes a pitch is tuned to; a target locks one", () => {
    const strings = [40, 45, 50, 55, 59, 64];
    render(<Classic frequency={hertz(41.3)} targets={strings} />);
    // 1.3 semitones above E2 is still tuned to E2: +130 cents, the needle at the end of its travel.
    expect([text("note"), text("cents"), variable("indicator", "--tuner-offset")]).toEqual(["E2", "+130", "1"]);
    cleanup();
    render(<Classic frequency={hertz(41.3)} targets={strings} target={45} />);
    expect([text("note"), text("cents")]).toEqual(["A2", "-370"]);
  });

  test("smoothing follows the pitch over time; the strobe's phase adds up the cents off", () => {
    let frequency = hertz(69.2);
    render(<Classic read={() => frequency} smoothing={100} />);
    frame(0);
    frame(500);
    // +20 cents for half a second: the strobe has moved 10.
    expect(variable("strobe", "--tuner-phase")).toBe("10");
    frequency = hertz(69);
    frame(600);
    // A time constant of 100 ms after 100 ms: 63% of the way from +20 to 0 cents.
    expect(text("cents")).toBe("+7");
  });

  test("without a format, a note is its MIDI number; parts outside a root say where they belong", () => {
    render(
      <Tuner.Root frequency={hertz(60)}>
        <Tuner.Note data-testid="note" />
      </Tuner.Root>,
    );
    expect(text("note")).toBe("60");
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Tuner.Note />)).toThrow(/Tuner.Root/);
  });
});
