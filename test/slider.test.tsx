// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { formats, scales } from "../src/core/index.js";
import { Slider, type SliderChangeDetails } from "../src/react/index.js";
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

type Log = { values: number[][]; details: SliderChangeDetails[]; gestures: string[] };

/** Two thumbs on 0 … 1, on a horizontal track 200 px long. */
function setup(props: Partial<Slider.Root.Props> = {}) {
  const log: Log = { values: [], details: [], gestures: [] };
  let commits = 0;
  const count = props.value?.length ?? props.defaultValue?.length ?? 2;
  render(
    <Profiler id="slider" onRender={() => commits++}>
      <Slider.Root
        defaultValue={[0.25, 0.75]}
        onValueChange={(values, details) => {
          log.values.push(values);
          log.details.push(details);
        }}
        onGestureStart={() => log.gestures.push("start")}
        onGestureEnd={() => log.gestures.push("end")}
        data-testid="root"
        {...props}
      >
        <Slider.Label>Crossover</Slider.Label>
        <Slider.Control data-testid="control">
          <Slider.Track data-testid="track">
            <Slider.Range data-testid="range" />
            {Array.from({ length: count + 1 }, (_, index) => (
              <Slider.Band key={index} index={index} data-testid={`band ${index}`} />
            ))}
            {Array.from({ length: count }, (_, index) => (
              <Slider.Thumb key={index} index={index} aria-label={`Split ${index + 1}`}>
                <Slider.Value index={index} data-testid={`value ${index}`} />
              </Slider.Thumb>
            ))}
          </Slider.Track>
        </Slider.Control>
      </Slider.Root>
    </Profiler>,
  );
  setBox(screen.getByTestId("track"), { x: 0, y: 0, width: 200, height: 10 });
  setBox(screen.getByTestId("control"), { x: 0, y: 0, width: 200, height: 10 });
  return { log, control: screen.getByTestId("control"), commits: () => commits };
}

const thumb = (index: number) => screen.getByRole("slider", { name: `Split ${index + 1}` });
const place = (testId: string) => [screen.getByTestId(testId).style.insetInlineStart, screen.getByTestId(testId).style.width];

describe("Slider", () => {
  test("is a group named by its label; each thumb is a slider whose bounds are its neighbours", () => {
    setup();
    expect(screen.getByRole("group", { name: "Crossover" })).toBeTruthy();
    expect([thumb(0).getAttribute("aria-valuemin"), thumb(0).getAttribute("aria-valuemax")]).toEqual(["0", "0.75"]);
    expect([thumb(1).getAttribute("aria-valuemin"), thumb(1).getAttribute("aria-valuemax")]).toEqual(["0.25", "1"]);
    expect(thumb(0).getAttribute("aria-valuetext")).toBe("0.25");
    expect(thumb(0).getAttribute("aria-orientation")).toBe("horizontal");
    expect([thumb(0).tabIndex, thumb(1).tabIndex]).toEqual([0, 0]);
    expect(thumb(1).style.insetInlineStart).toBe("75%");
    expect(screen.getByTestId("value 1").textContent).toBe("0.75");
  });

  test("the range runs from the first thumb to the last; bands lie between the thumbs and the ends", () => {
    setup();
    expect(place("range")).toEqual(["25%", "50%"]);
    expect([place("band 0"), place("band 1"), place("band 2")]).toEqual([
      ["0%", "25%"],
      ["25%", "50%"],
      ["75%", "25%"],
    ]);
    expect(screen.getByTestId("root").style.getPropertyValue("--slider-value-1")).toBe("0.75");
  });

  test("a drag moves a thumb as far as the pointer, stops at its neighbour and comes back at once, without rendering", () => {
    const { log, commits } = setup();
    const before = commits();
    pointerDown(thumb(0), { x: 50 });
    pointerMove(thumb(0), { x: 90 });
    expect(last(log)).toEqual([0.45, 0.75]);
    expect(log.details.at(-1)).toMatchObject({ reason: "drag", thumb: 0 });
    // Far past the second thumb: it stops there.
    pointerMove(thumb(0), { x: 190 });
    expect(last(log)).toEqual([0.75, 0.75]);
    // Back 20 px: it follows at once, with no dead zone past the neighbour.
    pointerMove(thumb(0), { x: 170 });
    expect(last(log)).toEqual([0.65, 0.75]);
    expect(screen.getByTestId("band 1").style.width).toBe("10%");
    pointerMove(thumb(0), { x: 190, shiftKey: true });
    expect(last(log)[0]).toBeCloseTo(0.66);
    pointerUp(thumb(0), { x: 190 });
    expect(log.gestures).toEqual(["start", "end"]);
    expect(commits()).toBe(before);
  });

  test("a press on the track brings the nearest thumb there, and the drag goes on from there", () => {
    const { log, control } = setup();
    pointerDown(control, { x: 180 });
    expect(last(log)).toEqual([0.25, 0.9]);
    expect(document.activeElement).toBe(thumb(1));
    pointerMove(control, { x: 170 });
    expect(last(log)).toEqual([0.25, 0.85]);
  });

  test("of thumbs at the same value, the first move up takes the upper one, down the lower one", () => {
    const { log } = setup({ defaultValue: [0.5, 0.5] });
    pointerDown(thumb(0), { x: 100 });
    pointerMove(thumb(0), { x: 120 });
    expect(last(log)).toEqual([0.5, 0.6]);
    expect(log.details.at(-1)!.thumb).toBe(1);
    expect(document.activeElement).toBe(thumb(1));
    pointerUp(thumb(0), { x: 120 });
    pointerDown(thumb(1), { x: 120 });
    pointerMove(thumb(1), { x: 60 });
    expect(last(log)).toEqual([0.5, 0.5]);
  });

  test("keys move a thumb up to its neighbours; Home and End go as far as they let it; Delete resets", () => {
    const { log } = setup({ step: 0.05 });
    fireEvent.keyDown(thumb(0), { key: "ArrowRight" });
    expect(last(log)).toEqual([0.3, 0.75]);
    fireEvent.keyDown(thumb(0), { key: "End" });
    expect(last(log)).toEqual([0.75, 0.75]);
    fireEvent.keyDown(thumb(1), { key: "ArrowLeft" });
    expect(last(log)).toEqual([0.75, 0.75]);
    fireEvent.keyDown(thumb(1), { key: "PageUp" });
    expect(last(log)).toEqual([0.75, 0.85]);
    fireEvent.keyDown(thumb(0), { key: "Delete" });
    expect(last(log)).toEqual([0.25, 0.85]);
    fireEvent.doubleClick(thumb(1));
    expect(last(log)).toEqual([0.25, 0.75]);
    expect(log.gestures.filter((gesture) => gesture === "start")).toHaveLength(5);
  });

  test("a logarithmic scale and a format, as for frequencies; vertical, thumbs rise from the bottom", () => {
    setup({ min: 20, max: 20_000, scale: scales.log, format: formats.frequency({ locale: "en" }), defaultValue: [200, 2000] });
    expect(thumb(0).getAttribute("aria-valuetext")).toBe("200 Hz");
    expect(thumb(0).style.insetInlineStart).toBe("33.333%");
    cleanup();
    setup({ orientation: "vertical" });
    expect(thumb(1).style.bottom).toBe("75%");
    expect(thumb(1).getAttribute("aria-orientation")).toBe("vertical");
    expect([screen.getByTestId("range").style.bottom, screen.getByTestId("range").style.height]).toEqual(["25%", "50%"]);
  });

  test("with one thumb, the range runs from origin to its value", () => {
    setup({ min: -1, max: 1, origin: 0, defaultValue: [-0.5] });
    expect(place("range")).toEqual(["25%", "25%"]);
  });

  test("controlled, it shows the values the parent passes, in order; read moves the thumbs once per frame", () => {
    let values = [0.1, 0.2];
    const { rerender } = render(
      <Slider.Root value={[0.6, 0.3]}>
        <Slider.Track>
          <Slider.Thumb index={0} aria-label="Low" />
          <Slider.Thumb index={1} aria-label="High" />
        </Slider.Track>
      </Slider.Root>,
    );
    // Out of order, the second takes the first's value.
    expect(screen.getByRole("slider", { name: "High" }).getAttribute("aria-valuenow")).toBe("0.6");
    rerender(
      <Slider.Root read={() => values}>
        <Slider.Track>
          <Slider.Thumb index={0} aria-label="Low" />
          <Slider.Thumb index={1} aria-label="High" />
        </Slider.Track>
      </Slider.Root>,
    );
    frame();
    expect(screen.getByRole("slider", { name: "High" }).getAttribute("aria-valuenow")).toBe("0.2");
    values = [0.4, 0.9];
    frame();
    expect(screen.getByRole("slider", { name: "Low" }).style.insetInlineStart).toBe("40%");
  });

  test("disabled, it ignores input and leaves the tab order", () => {
    const { log, control } = setup({ disabled: true });
    pointerDown(control, { x: 180 });
    fireEvent.keyDown(thumb(0), { key: "ArrowRight" });
    expect(log.values).toEqual([]);
    expect(thumb(0).tabIndex).toBe(-1);
  });

  test("parts outside a root say where they belong", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Slider.Thumb index={0} />)).toThrow(/Slider.Root/);
  });
});

function last(log: Log) {
  return log.values.at(-1)!;
}
