// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { formats, scales } from "../src/core/index.js";
import { XYPad, type XYPadChangeDetails, type XYValue } from "../src/react/index.js";
import { pointerDown, pointerMove, pointerUp, setBox } from "./helpers.js";

// A pad 200 × 100 px, both axes 0 … 1 unless a test says otherwise.

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

type Log = { values: XYValue[][]; details: XYPadChangeDetails[]; gestures: string[] };

function setup(props: Partial<XYPad.Root.Props> = {}, thumbs = 1) {
  const log: Log = { values: [], details: [], gestures: [] };
  let commits = 0;
  render(
    <Profiler id="pad" onRender={() => commits++}>
      <XYPad.Root
        defaultValue={[[0.5, 0.5]]}
        onValueChange={(values, details) => {
          log.values.push(values);
          log.details.push(details);
        }}
        onGestureStart={() => log.gestures.push("start")}
        onGestureEnd={() => log.gestures.push("end")}
        {...props}
      >
        <XYPad.Label>Filter</XYPad.Label>
        <XYPad.Control data-testid="control">
          {Array.from({ length: thumbs }, (_, index) => (
            <XYPad.Thumb key={index} index={index} aria-label={`Thumb ${index + 1}`} />
          ))}
        </XYPad.Control>
        <XYPad.Value data-testid="value" />
        <XYPad.Value data-testid="value-y" axis="y" />
      </XYPad.Root>
    </Profiler>,
  );
  const control = screen.getByTestId("control");
  setBox(control, { x: 0, y: 0, width: 200, height: 100 });
  return { log, control, commits: () => commits };
}

const thumb = (index = 0) => screen.getByRole("slider", { name: `Thumb ${index + 1}` });

describe("XYPad", () => {
  test("is a group named by its label; each thumb is a slider saying both its values", () => {
    setup();
    expect(screen.getByRole("group", { name: "Filter" })).toBeTruthy();
    expect(thumb().getAttribute("aria-valuetext")).toBe("0.50, 0.50");
    expect([thumb().style.insetInlineStart, thumb().style.bottom]).toEqual(["50%", "50%"]);
    expect(screen.getByTestId("value").textContent).toBe("0.50, 0.50");
    expect(screen.getByTestId("value-y").textContent).toBe("0.50");
  });

  test("a drag moves the thumb as far as the pointer, without rendering, as one gesture; Shift is finer", () => {
    const { log, commits } = setup();
    pointerDown(thumb(), { x: 100, y: 50 });
    const before = commits();
    pointerMove(thumb(), { x: 120, y: 40 });
    expect(log.values.at(-1)).toEqual([[0.6, 0.6]]);
    expect(log.details.at(-1)).toMatchObject({ reason: "drag", thumb: 0 });
    expect(thumb().style.insetInlineStart).toBe("60%");
    expect(thumb().getAttribute("aria-valuetext")).toBe("0.60, 0.60");
    pointerMove(thumb(), { x: 140, y: 40, shiftKey: true });
    // 20 px more with Shift: a tenth of 0.1.
    expect(log.values.at(-1)![0]![0]).toBeCloseTo(0.61);
    expect(commits()).toBe(before);
    pointerUp(thumb(), { x: 140, y: 40 });
    expect(log.gestures).toEqual(["start", "end"]);
  });

  test("a press on the control brings the nearest thumb to the pointer, and the drag goes on from there", () => {
    const { log, control } = setup({ defaultValue: [[0.2, 0.2], [0.8, 0.8]] }, 2);
    pointerDown(control, { x: 180, y: 20 });
    expect(log.values.at(-1)).toEqual([[0.2, 0.2], [0.9, 0.8]]);
    expect(log.details.at(-1)!.thumb).toBe(1);
    expect(document.activeElement).toBe(thumb(1));
    pointerMove(control, { x: 160, y: 20 });
    expect(log.values.at(-1)![1]).toEqual([0.8, 0.8]);
  });

  test("keys move the thumb on either axis, by steps when given; Delete and a double-click reset it", () => {
    const { log } = setup({ y: { min: 0, max: 10, step: 1 }, defaultValue: [[0.5, 5]] });
    fireEvent.keyDown(thumb(), { key: "ArrowRight" });
    expect(log.values.at(-1)).toEqual([[0.51, 5]]);
    fireEvent.keyDown(thumb(), { key: "ArrowUp" });
    expect(log.values.at(-1)).toEqual([[0.51, 6]]);
    fireEvent.keyDown(thumb(), { key: "PageDown" });
    expect(log.values.at(-1)).toEqual([[0.51, 5]]);
    fireEvent.keyDown(thumb(), { key: "End" });
    expect(log.values.at(-1)).toEqual([[1, 5]]);
    fireEvent.keyDown(thumb(), { key: "Delete" });
    expect(log.values.at(-1)).toEqual([[0.5, 5]]);
    expect(log.details.at(-1)!.reason).toBe("reset");
    fireEvent.keyDown(thumb(), { key: "Home" });
    fireEvent.doubleClick(thumb());
    expect(log.values.at(-1)).toEqual([[0.5, 5]]);
    // Each key, and the double-click, is one gesture: seven changes.
    expect(log.gestures.filter((gesture) => gesture === "start")).toHaveLength(7);
  });

  test("axes take a scale and a format, as a knob's or fader's range", () => {
    const { log, control } = setup({
      x: { min: 20, max: 20_000, scale: scales.log },
      format: { x: formats.frequency({ locale: "en" }) },
      defaultValue: [[1000, 0]],
    });
    pointerDown(control, { x: 100, y: 100 });
    // Halfway across a logarithmic 20 Hz … 20 kHz: the square root of their product.
    expect(log.values.at(-1)![0]![0]).toBeCloseTo(Math.sqrt(20 * 20_000));
    expect(thumb().getAttribute("aria-valuetext")).toBe("632 Hz, 0.00");
  });

  test("controlled, it shows the values the parent passes; read moves the thumbs once per frame", () => {
    let values: XYValue[] = [[0.1, 0.9]];
    const { rerender } = render(
      <XYPad.Root value={[[0.3, 0.3]]}>
        <XYPad.Control>
          <XYPad.Thumb index={0} aria-label="Controlled" />
        </XYPad.Control>
      </XYPad.Root>,
    );
    expect(screen.getByRole("slider", { name: "Controlled" }).style.bottom).toBe("30%");
    rerender(
      <XYPad.Root read={() => values}>
        <XYPad.Control>
          <XYPad.Thumb index={0} aria-label="Controlled" />
        </XYPad.Control>
      </XYPad.Root>,
    );
    frame();
    expect(screen.getByRole("slider", { name: "Controlled" }).style.bottom).toBe("90%");
    values = [[0.4, 0.2]];
    frame();
    expect(screen.getByRole("slider", { name: "Controlled" }).getAttribute("aria-valuetext")).toBe("0.40, 0.20");
  });

  test("disabled, it ignores input", () => {
    const { log, control } = setup({ disabled: true });
    pointerDown(control, { x: 10, y: 10 });
    fireEvent.keyDown(thumb(), { key: "ArrowUp" });
    expect(log.values).toEqual([]);
    expect(thumb().tabIndex).toBe(-1);
  });

  test("parts outside a root say where they belong", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<XYPad.Thumb index={0} />)).toThrow(/XYPad.Root/);
  });
});
