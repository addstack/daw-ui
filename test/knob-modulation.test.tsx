// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { arcPath, knobAngle } from "../src/core/index.js";
import { Knob } from "../src/react/index.js";
import { drag } from "./helpers.js";

afterEach(cleanup);

/** The arc a range draws between two travels of a 270° knob, at the default radius. */
const arc = (from: number, to: number) => arcPath(50, 50, 46, knobAngle(from), knobAngle(to));

function ModulatedKnob({ root, range, depth }: { root?: Knob.Root.Props; range?: Knob.ModulationRange.Props; depth?: Knob.ModulationDepth.Props }) {
  return (
    <Knob.Root defaultValue={0.5} {...root}>
      <Knob.Control aria-label="Cutoff">
        <svg viewBox="0 0 100 100">
          <Knob.ModulationRange data-testid="range" {...range} />
        </svg>
      </Knob.Control>
      <Knob.ModulationDepth aria-label="LFO depth" defaultValue={0.25} {...depth} />
    </Knob.Root>
  );
}

const depthHandle = (name = "LFO depth") => screen.getByRole("slider", { name });

describe("Knob.ModulationDepth", () => {
  test("is a slider of its own, from −1 to 1 of the knob's travel, announced as a percentage", () => {
    render(<ModulatedKnob />);
    const handle = depthHandle();
    expect(handle.tabIndex).toBe(0);
    expect([handle.getAttribute("aria-valuemin"), handle.getAttribute("aria-valuemax")]).toEqual(["-1", "1"]);
    expect(handle.getAttribute("aria-valuenow")).toBe("0.25");
    expect(handle.getAttribute("aria-valuetext")).toBe("25%");
    expect(handle.style.getPropertyValue("--knob-depth")).toBe("0.25");
  });

  test("drags, steps and resets as a knob does, one gesture each; a reset goes to 0", () => {
    const changes: number[] = [];
    const gestures: string[] = [];
    render(
      <ModulatedKnob
        depth={{
          onValueChange: (value) => changes.push(value),
          onGestureStart: () => gestures.push("start"),
          onGestureEnd: () => gestures.push("end"),
        }}
      />,
    );
    // 200 px is the full travel, −1 to 1: 20 px up is 0.2 more.
    drag(depthHandle(), [{ y: 100 }, { y: 80 }]);
    expect(changes.at(-1)).toBe(0.45);
    // In whole percents.
    fireEvent.keyDown(depthHandle(), { key: "ArrowDown" });
    expect(changes.at(-1)).toBe(0.44);
    fireEvent.doubleClick(depthHandle());
    expect(changes.at(-1)).toBe(0);
    expect(gestures).toEqual(["start", "end", "start", "end", "start", "end"]);
  });

  test("is disabled with its knob", () => {
    render(<ModulatedKnob root={{ disabled: true }} />);
    expect(depthHandle().tabIndex).toBe(-1);
    expect(depthHandle().getAttribute("aria-disabled")).toBe("true");
  });
});

describe("Knob.ModulationRange", () => {
  test("is the arc from the value to the value plus the depth, and follows both without rendering", () => {
    let renders = 0;
    render(
      <Profiler id="knob" onRender={() => renders++}>
        <ModulatedKnob />
      </Profiler>,
    );
    renders = 0;
    const range = screen.getByTestId("range");
    expect(range.getAttribute("d")).toBe(arc(0.5, 0.75));
    drag(depthHandle(), [{ y: 100 }, { y: 80 }]);
    expect(range.getAttribute("d")).toBe(arc(0.5, 0.95));
    fireEvent.keyDown(screen.getByRole("slider", { name: "Cutoff" }), { key: "PageDown" });
    expect(range.getAttribute("d")).toBe(arc(0.4, 0.85));
    expect(renders).toBe(0);
  });

  test("goes the other way for a negative depth, to either side when bipolar, and stops at the ends of the sweep", () => {
    render(<ModulatedKnob depth={{ defaultValue: -0.25 }} />);
    expect(screen.getByTestId("range").getAttribute("d")).toBe(arc(0.25, 0.5));
    cleanup();
    render(<ModulatedKnob range={{ bipolar: true }} />);
    expect(screen.getByTestId("range").getAttribute("d")).toBe(arc(0.25, 0.75));
    cleanup();
    render(<ModulatedKnob depth={{ defaultValue: 0.8 }} />);
    expect(screen.getByTestId("range").getAttribute("d")).toBe(arc(0.5, 1));
  });

  test("draws nothing at depth 0; without a handle, it shows `depth`", () => {
    render(<ModulatedKnob depth={{ defaultValue: 0 }} />);
    expect(screen.getByTestId("range").hasAttribute("d")).toBe(false);
    cleanup();
    render(
      <Knob.Root defaultValue={0.5}>
        <Knob.Control>
          <svg viewBox="0 0 100 100">
            <Knob.ModulationRange data-testid="range" depth={0.5} />
          </svg>
        </Knob.Control>
      </Knob.Root>,
    );
    expect(screen.getByTestId("range").getAttribute("d")).toBe(arc(0.5, 1));
  });

  test("a knob has as many modulations as sources, each with its own depth", () => {
    render(
      <Knob.Root defaultValue={0.5}>
        <Knob.Control aria-label="Cutoff">
          <svg viewBox="0 0 100 100">
            <Knob.ModulationRange source="lfo" data-testid="lfo" />
            <Knob.ModulationRange source="envelope" data-testid="envelope" bipolar />
          </svg>
        </Knob.Control>
        <Knob.ModulationDepth source="lfo" aria-label="LFO depth" defaultValue={0.25} />
        <Knob.ModulationDepth source="envelope" aria-label="Envelope depth" defaultValue={0.1} />
      </Knob.Root>,
    );
    expect(screen.getByTestId("lfo").getAttribute("d")).toBe(arc(0.5, 0.75));
    expect(screen.getByTestId("envelope").getAttribute("d")).toBe(arc(0.4, 0.6));
    fireEvent.keyDown(depthHandle("Envelope depth"), { key: "ArrowUp" });
    expect(screen.getByTestId("envelope").getAttribute("d")).toBe(arc(0.39, 0.61));
    expect(screen.getByTestId("lfo").getAttribute("d")).toBe(arc(0.5, 0.75));
  });

  test("parts outside a knob say where they belong", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Knob.ModulationDepth />)).toThrow(/Knob.Root/);
  });
});
