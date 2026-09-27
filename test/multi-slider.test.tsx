// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { MultiSlider, type MultiSliderChangeDetails } from "../src/react/index.js";
import { pointerDown, pointerMove, pointerUp, setBox } from "./helpers.js";

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

function frame() {
  const pending = frames;
  frames = [];
  for (const callback of pending) callback(0);
}

type Log = { values: number[][]; details: MultiSliderChangeDetails[]; gestures: string[] };

/** Four values on 0 … 1, on a control 200 × 100 px: items 50 px wide, side by side. */
function setup(props: Partial<MultiSlider.Root.Props> = {}, boxes = [0, 50, 100, 150]) {
  const log: Log = { values: [], details: [], gestures: [] };
  let commits = 0;
  const count = props.value?.length ?? props.defaultValue?.length ?? 4;
  render(
    <Profiler id="multi-slider" onRender={() => commits++}>
      <MultiSlider.Root
        defaultValue={[0, 0, 0, 0]}
        onValueChange={(values, details) => {
          log.values.push(values);
          log.details.push(details);
        }}
        onGestureStart={() => log.gestures.push("start")}
        onGestureEnd={() => log.gestures.push("end")}
        {...props}
      >
        <MultiSlider.Label>Velocity</MultiSlider.Label>
        <MultiSlider.Control data-testid="control">
          {Array.from({ length: count }, (_, index) => (
            <MultiSlider.Item key={index} index={index}>
              <MultiSlider.Range data-testid={`range ${index}`} />
            </MultiSlider.Item>
          ))}
        </MultiSlider.Control>
        <MultiSlider.Value data-testid="value" />
      </MultiSlider.Root>
    </Profiler>,
  );
  const control = screen.getByTestId("control");
  setBox(control, { x: 0, y: 0, width: 200, height: 100 });
  screen.getAllByRole("slider").forEach((item, index) => setBox(item, { x: boxes[index]!, y: 0, width: 50, height: 100 }));
  return { log, control, commits: () => commits };
}

const item = (index: number) => screen.getAllByRole("slider")[index]!;
const last = (log: Log) => log.values.at(-1)!;

describe("MultiSlider", () => {
  test("is a group named by its label; each value is a slider in one tab stop, placed side by side", () => {
    setup({ defaultValue: [0.5, 0.25, 1, 0] });
    expect(screen.getByRole("group", { name: "Velocity" })).toBeTruthy();
    expect(screen.getAllByRole("slider").map((one) => one.getAttribute("aria-label"))).toEqual(["1", "2", "3", "4"]);
    expect(item(0).getAttribute("aria-valuetext")).toBe("0.50");
    expect(item(0).getAttribute("aria-orientation")).toBe("vertical");
    expect(screen.getAllByRole("slider").map((one) => one.tabIndex)).toEqual([0, -1, -1, -1]);
    expect([item(1).style.insetInlineStart, item(1).style.width]).toEqual(["25%", "25%"]);
    expect([screen.getByTestId("range 1").style.bottom, screen.getByTestId("range 1").style.height]).toEqual(["0%", "25%"]);
    expect(item(1).style.getPropertyValue("--multi-slider-value")).toBe("0.25");
  });

  test("a stroke sets every value it crosses to where it crosses, even in one fast move, as one gesture, without rendering", () => {
    const { log, control, commits } = setup();
    const before = commits();
    pointerDown(control, { x: 25, y: 75 });
    expect(last(log)).toEqual([0.25, 0, 0, 0]);
    // Across all four items in one pointer event: each takes the height of the path at its middle.
    pointerMove(control, { x: 175, y: 25 });
    const values = last(log);
    [0.25, 0.4167, 0.5833, 0.75].forEach((expected, index) => expect(values[index]).toBeCloseTo(expected, 3));
    expect(log.details.at(-1)).toMatchObject({ reason: "paint", indexes: [1, 2, 3] });
    expect(screen.getByTestId("range 3").style.height).toBe("75%");
    expect(control.hasAttribute("data-painting")).toBe(true);
    pointerUp(control, { x: 175, y: 25 });
    expect(control.hasAttribute("data-painting")).toBe(false);
    expect(log.gestures).toEqual(["start", "end"]);
    expect(commits()).toBe(before);
    // The value shown is the last one changed.
    expect(screen.getByTestId("value").textContent).toBe("0.75");
  });

  test("with Shift, the pressed item alone moves, a tenth as far", () => {
    const { log, control } = setup({ defaultValue: [0, 0.5, 0, 0] });
    pointerDown(control, { x: 75, y: 50, shiftKey: true });
    expect(log.values).toEqual([]);
    expect(document.activeElement).toBe(item(1));
    pointerMove(control, { x: 175, y: 0, shiftKey: true });
    expect(last(log)).toEqual([0, 0.55, 0, 0]);
    expect(log.details.at(-1)!.reason).toBe("drag");
  });

  test("items at the same place, the notes of a chord, all take the stroke's value", () => {
    const { log, control } = setup({ defaultValue: [0, 0, 0] }, [0, 0, 100]);
    pointerDown(control, { x: 25, y: 20 });
    expect(last(log)).toEqual([0.8, 0.8, 0]);
    expect(log.details.at(-1)!.indexes).toEqual([0, 1]);
  });

  test("keys: Up and Down change a value, Left and Right move along, Shift+Right copies the value along; Delete resets", () => {
    const { log } = setup({ step: 0.1, defaultValue: [0.5, 0, 0, 0] });
    item(0).focus();
    fireEvent.keyDown(item(0), { key: "ArrowUp" });
    expect(last(log)).toEqual([0.6, 0, 0, 0]);
    fireEvent.keyDown(item(0), { key: "ArrowRight", shiftKey: true });
    expect(last(log)).toEqual([0.6, 0.6, 0, 0]);
    expect(log.details.at(-1)).toMatchObject({ reason: "paint", indexes: [1] });
    expect(document.activeElement).toBe(item(1));
    expect([item(0).tabIndex, item(1).tabIndex]).toEqual([-1, 0]);
    fireEvent.keyDown(item(1), { key: "End" });
    expect(last(log)).toEqual([0.6, 1, 0, 0]);
    fireEvent.keyDown(item(1), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(item(0));
    fireEvent.keyDown(item(0), { key: "Delete" });
    expect(last(log)).toEqual([0.5, 1, 0, 0]);
    fireEvent.doubleClick(item(1));
    expect(last(log)).toEqual([0.5, 0, 0, 0]);
    // Each key and each reset is one gesture.
    expect(log.gestures.filter((gesture) => gesture === "start")).toHaveLength(5);
  });

  test("bars are drawn from origin: up or down from the middle of −1 … 1", () => {
    setup({ min: -1, max: 1, origin: 0, defaultValue: [-0.5, 0.5, 0, 1] });
    expect([screen.getByTestId("range 0").style.bottom, screen.getByTestId("range 0").style.height]).toEqual(["25%", "25%"]);
    expect([screen.getByTestId("range 1").style.bottom, screen.getByTestId("range 1").style.height]).toEqual(["50%", "25%"]);
  });

  test("controlled, it shows the values the parent passes; read changes them once per frame", () => {
    let values = [0.1, 0.2];
    const { rerender } = render(
      <MultiSlider.Root value={[0.3, 0.4]}>
        <MultiSlider.Control>
          <MultiSlider.Item index={0} aria-label="First" />
          <MultiSlider.Item index={1} aria-label="Second" />
        </MultiSlider.Control>
      </MultiSlider.Root>,
    );
    expect(screen.getByRole("slider", { name: "Second" }).getAttribute("aria-valuenow")).toBe("0.4");
    rerender(
      <MultiSlider.Root read={() => values}>
        <MultiSlider.Control>
          <MultiSlider.Item index={0} aria-label="First" />
          <MultiSlider.Item index={1} aria-label="Second" />
        </MultiSlider.Control>
      </MultiSlider.Root>,
    );
    frame();
    expect(screen.getByRole("slider", { name: "Second" }).getAttribute("aria-valuenow")).toBe("0.2");
    values = [0.9, 0.8];
    frame();
    expect(screen.getByRole("slider", { name: "First" }).getAttribute("aria-valuetext")).toBe("0.90");
  });

  test("disabled, it ignores input and leaves the tab order", () => {
    const { log, control } = setup({ disabled: true });
    pointerDown(control, { x: 25, y: 20 });
    fireEvent.keyDown(item(0), { key: "ArrowUp" });
    expect(log.values).toEqual([]);
    expect(item(0).tabIndex).toBe(-1);
  });

  test("parts outside a root say where they belong", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<MultiSlider.Item index={0} />)).toThrow(/MultiSlider.Root/);
    expect(() =>
      render(
        <MultiSlider.Root defaultValue={[0]}>
          <MultiSlider.Range />
        </MultiSlider.Root>,
      ),
    ).toThrow(/MultiSlider.Item/);
  });
});
