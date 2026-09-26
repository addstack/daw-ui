// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { formats, scales, zoneOf } from "../src/core/index.js";
import { Fader, Knob, Meter, NumberBox } from "../src/react/index.js";

// docs/principles.md, sections 1 and 7: thresholds are declared once, and
// parts expose the zone as an attribute instead of the app comparing values
// in code on every render.

afterEach(cleanup);

describe("zoneOf", () => {
  const zones = { warm: -18, hot: -6, clip: 0 };

  test("a value is in the zone with the highest bound it is above", () => {
    expect(zoneOf(-30, zones)).toBeUndefined();
    expect(zoneOf(-12, zones)).toBe("warm");
    expect(zoneOf(-3, zones)).toBe("hot");
    expect(zoneOf(2, zones)).toBe("clip");
  });

  test("a bound belongs to the zone below it: 0 dB is not yet clipping", () => {
    expect(zoneOf(0, zones)).toBe("hot");
    expect(zoneOf(0.1, zones)).toBe("clip");
  });

  test("the order of the zones does not matter", () => {
    expect(zoneOf(-3, { clip: 0, warm: -18, hot: -6 })).toBe("hot");
  });

  test("no zones, no zone", () => {
    expect(zoneOf(5, undefined)).toBeUndefined();
    expect(zoneOf(-Infinity, { quiet: -Infinity })).toBeUndefined();
  });
});

function Volume() {
  return (
    <Fader.Root
      min={-Infinity}
      max={6}
      defaultValue={0}
      step={0.5}
      scale={scales.decibel}
      format={formats.decibel({ locale: "en" })}
      zones={{ hot: 0 }}
      data-testid="root"
    >
      <Fader.Label data-testid="label">Volume</Fader.Label>
      <Fader.Control>
        <Fader.Track data-testid="track">
          <Fader.Range data-testid="range" />
          <Fader.Thumb data-testid="thumb" />
          {[6, 0, -6].map((db) => (
            <Fader.Tick key={db} value={db} data-testid={`tick ${db}`} />
          ))}
        </Fader.Track>
      </Fader.Control>
      <Fader.Value data-testid="value" />
    </Fader.Root>
  );
}

const parts = ["root", "label", "track", "range", "thumb", "value"];

describe("value controls", () => {
  test("every part of a fader carries the zone of the value", () => {
    render(<Volume />);
    for (const part of parts) expect(screen.getByTestId(part).hasAttribute("data-zone")).toBe(false);
    expect(screen.getByRole("slider").hasAttribute("data-zone")).toBe(false);

    fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowUp" });
    for (const part of parts) expect(screen.getByTestId(part).getAttribute("data-zone")).toBe("hot");
    expect(screen.getByRole("slider").getAttribute("data-zone")).toBe("hot");
  });

  test("a tick carries the zone of its own value", () => {
    render(<Volume />);
    expect(screen.getByTestId("tick 6").getAttribute("data-zone")).toBe("hot");
    expect(screen.getByTestId("tick 0").hasAttribute("data-zone")).toBe(false);
    expect(screen.getByTestId("tick -6").hasAttribute("data-zone")).toBe(false);
  });

  test("knob and number box parts carry it too", () => {
    render(
      <>
        <Knob.Root defaultValue={0.9} zones={{ high: 0.75 }}>
          <Knob.Control>
            <svg viewBox="0 0 100 100">
              <Knob.Range data-testid="arc" />
            </svg>
          </Knob.Control>
          <Knob.Value data-testid="knob value" />
        </Knob.Root>
        <NumberBox.Root min={20} max={300} defaultValue={180} zones={{ fast: 160 }}>
          <NumberBox.Field />
        </NumberBox.Root>
      </>,
    );
    expect(screen.getByRole("slider").getAttribute("data-zone")).toBe("high");
    expect(screen.getByTestId("arc").getAttribute("data-zone")).toBe("high");
    expect(screen.getByTestId("knob value").getAttribute("data-zone")).toBe("high");
    expect(screen.getByRole("spinbutton").getAttribute("data-zone")).toBe("fast");
  });
});

describe("meter", () => {
  let frames: FrameRequestCallback[] = [];
  beforeEach(() => {
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
    vi.stubGlobal("cancelAnimationFrame", () => {
      frames = [];
    });
  });
  afterEach(() => vi.unstubAllGlobals());
  const frame = (now: number) => {
    const pending = frames;
    frames = [];
    for (const callback of pending) callback(now);
  };

  test("the root carries the zone of the level, written without rendering", () => {
    let level = -30;
    let renders = 0;
    render(
      <Profiler id="meter" onRender={() => renders++}>
        <Meter.Root read={() => level} zones={{ warm: -18, hot: -6, clip: 0 }} data-testid="meter">
          <Meter.Track aria-label="Level" />
        </Meter.Root>
      </Profiler>,
    );
    renders = 0;
    const meter = screen.getByTestId("meter");
    frame(0);
    expect(meter.hasAttribute("data-zone")).toBe(false);
    level = -10;
    frame(16);
    expect(meter.getAttribute("data-zone")).toBe("warm");
    level = 1;
    frame(32);
    expect(meter.getAttribute("data-zone")).toBe("clip");
    expect(renders).toBe(0);
  });
});
