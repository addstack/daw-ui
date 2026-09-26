// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { formats } from "../src/core/index.js";
import { Meter } from "../src/react/index.js";

// Animation frames run when a test says so, at the time it gives.
let frames: FrameRequestCallback[] = [];
beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal("cancelAnimationFrame", () => {
    frames = [];
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function frame(now: number) {
  const pending = frames;
  frames = [];
  for (const callback of pending) callback(now);
}

function TestMeter(props: Meter.Root.Props) {
  return (
    <Meter.Root min={-60} max={0} format={formats.decibel({ locale: "en" })} data-testid="root" {...props}>
      <Meter.Label>Kick</Meter.Label>
      <Meter.Track data-testid="track">
        <Meter.Bar data-testid="bar" />
        <Meter.Peak data-testid="peak" />
      </Meter.Track>
      <Meter.Clip aria-label="Reset" data-testid="clip" />
    </Meter.Root>
  );
}

const cssVariable = (name: string) => screen.getByTestId("root").style.getPropertyValue(name);

describe("Meter", () => {
  test("is a meter named by its label", () => {
    render(<TestMeter />);
    const meter = screen.getByRole("meter", { name: "Kick" });
    expect(meter.getAttribute("aria-valuemin")).toBe("-60");
    expect(meter.getAttribute("aria-valuemax")).toBe("0");
    expect(meter.getAttribute("aria-valuetext")).toBe("-60.0 dB");
  });

  test("reads the level every frame and writes it as CSS variables", () => {
    let level = -30;
    render(<TestMeter read={() => level} />);
    frame(0);
    expect(cssVariable("--meter-level")).toBe("0.5");
    expect(cssVariable("--meter-peak")).toBe("0.5");
    expect(screen.getByTestId("root").hasAttribute("data-active")).toBe(true);
    level = -60;
    frame(500);
    // Falls at 24 dB/s by default; the peak holds.
    expect(cssVariable("--meter-level")).toBe("0.3");
    expect(cssVariable("--meter-peak")).toBe("0.5");
  });

  test("the bar is clipped to the level, so its background stays in place", () => {
    render(<TestMeter />);
    const bar = screen.getByTestId("bar");
    expect(bar.style.position).toBe("absolute");
    expect(bar.style.clipPath).toBe("inset(calc((1 - var(--meter-level, 0)) * 100%) 0 0 0)");
    expect(screen.getByTestId("peak").style.bottom).toBe("calc(var(--meter-peak, 0) * 100%)");
  });

  test("the level also comes from the level prop", () => {
    const { rerender } = render(<TestMeter level={-60} />);
    frame(0);
    expect(screen.getByTestId("root").hasAttribute("data-active")).toBe(false);
    rerender(<TestMeter level={-15} />);
    frame(16);
    expect(cssVariable("--meter-level")).toBe("0.75");
  });

  test("the accessible value follows four times a second, not every frame", () => {
    let level = -20;
    render(<TestMeter read={() => level} />);
    const meter = screen.getByRole("meter");
    frame(0);
    expect(meter.getAttribute("aria-valuenow")).toBe("-20");
    expect(meter.getAttribute("aria-valuetext")).toBe("-20.0 dB");
    level = -10;
    frame(100);
    expect(meter.getAttribute("aria-valuenow")).toBe("-20");
    frame(250);
    expect(meter.getAttribute("aria-valuenow")).toBe("-10");
  });

  test("a clip lights the indicator until it is pressed", () => {
    let level = 1;
    render(<TestMeter read={() => level} />);
    frame(0);
    const clip = screen.getByTestId("clip");
    expect(clip.hasAttribute("data-clipped")).toBe(true);
    expect(screen.getByTestId("root").hasAttribute("data-clipped")).toBe(true);
    level = -20;
    frame(16);
    expect(clip.hasAttribute("data-clipped")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    frame(32);
    expect(clip.hasAttribute("data-clipped")).toBe(false);
  });

  test("the clip indicator is outside the meter, where assistive technology can reach it", () => {
    render(<TestMeter />);
    expect(screen.getByRole("meter").contains(screen.getByTestId("clip"))).toBe(false);
  });

  test("running meters render nothing in React", () => {
    let renders = 0;
    let level = -60;
    render(
      <Profiler id="meters" onRender={() => renders++}>
        {Array.from({ length: 16 }, (_, index) => (
          <TestMeter key={index} read={() => level} />
        ))}
      </Profiler>,
    );
    renders = 0;
    for (let index = 0; index < 120; index++) {
      level = -60 + (index % 60);
      frame(index * 16);
    }
    expect(renders).toBe(0);
  });

  test("all meters share one animation frame loop, which stops when the last one unmounts", () => {
    const { unmount } = render(
      <>
        <TestMeter />
        <TestMeter />
        <TestMeter />
      </>,
    );
    expect(frames).toHaveLength(1);
    frame(0);
    expect(frames).toHaveLength(1);
    act(() => unmount());
    expect(frames).toHaveLength(0);
  });
});
