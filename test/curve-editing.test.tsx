// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Profiler, useState } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { musicalGrid, type CurvePoint } from "../src/core/index.js";
import { Curve, Timeline, useCurveEditing, type CurveEditingOptions } from "../src/react/index.js";
import { pointerDown, pointerMove, pointerUp, setBox } from "./helpers.js";

// A curve on its own, 1000 × 100 px for 4 s (250 px per second), from 0 at the bottom to 1 at the top.

let frames: FrameRequestCallback[] = [];
let tiles = 0;

beforeEach(() => {
  frames = [];
  tiles = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal("cancelAnimationFrame", () => {
    frames = [];
  });
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
  vi.spyOn(performance, "now").mockReturnValue(0);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(100);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () =>
      ({
        clearRect: () => tiles++,
        fillRect: () => {},
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        arc: () => {},
        closePath: () => {},
        stroke: () => {},
        fill: () => {},
      }) as unknown as CanvasRenderingContext2D,
  );
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

const initial: CurvePoint[] = [
  { at: 0, value: 0 },
  { at: 1, value: 0.5 },
  { at: 2, value: 1 },
  { at: 4, value: 0 },
];

type Events = { changes: { points: CurvePoint[]; reason: string }[]; gestures: string[]; selected: number[][] };
const events = (): Events => ({ changes: [], gestures: [], selected: [] });

function Lane({ log, options = {}, keep = false }: { log: Events; options?: CurveEditingOptions; keep?: boolean }) {
  const [points, setPoints] = useState(initial);
  const editing = useCurveEditing({
    ...options,
    onPointsChange: (next, details) => log.changes.push({ points: next, reason: details.reason }),
    onGestureStart: () => log.gestures.push("start"),
    onGestureEnd: (next) => {
      log.gestures.push("end");
      if (keep) setPoints(next);
    },
    onSelectedChange: (selected) => log.selected.push(selected),
  });
  return (
    <Curve.Root points={points} editing={editing} aria-label="Volume" data-testid="curve">
      <Curve.Line />
      <Curve.Dots />
      <Curve.Bend data-testid="bend" />
      <Curve.Handle aria-label="Point" />
    </Curve.Root>
  );
}

function setup(props: Omit<Parameters<typeof Lane>[0], "log"> = {}) {
  const log = events();
  let commits = 0;
  render(
    <Profiler id="lane" onRender={() => commits++}>
      <Lane log={log} {...props} />
    </Profiler>,
  );
  const curve = screen.getByTestId("curve");
  setBox(curve, { x: 0, y: 0, width: 1000, height: 100 });
  return { log, curve, commits: () => commits };
}

const handles = () => screen.queryAllByRole("slider", { name: "Point" });
const handleAt = (text: string) => handles().find((handle) => handle.getAttribute("aria-valuetext") === text)!;
const last = (log: Events) => log.changes.at(-1)!.points;

describe("Curve editing", () => {
  test("the curve is a group, and its tab stop a handle: a slider named by the application, saying the point's time and value", () => {
    setup();
    expect(screen.getByRole("group", { name: "Volume" })).toBe(screen.getByTestId("curve"));
    expect(handles()).toHaveLength(1);
    expect(handles()[0]!.getAttribute("aria-valuetext")).toBe("0.00 s, 0.00");
    expect(handles()[0]!.tabIndex).toBe(0);
  });

  test("a pointer near a point shows its handle, and away from it the handle goes", () => {
    const { curve } = setup();
    pointerMove(curve, { x: 252, y: 49 });
    expect(handles().map((handle) => handle.getAttribute("aria-valuetext"))).toEqual(["0.00 s, 0.00", "1.00 s, 0.50"]);
    pointerMove(curve, { x: 900, y: 90 });
    expect(handles()).toHaveLength(1);
  });

  test("a drag moves a point without rendering, reports one gesture, and the curve returns to its points after it", () => {
    const { curve, log, commits } = setup();
    pointerMove(curve, { x: 250, y: 50 });
    const handle = handleAt("1.00 s, 0.50");
    pointerDown(handle, { x: 250, y: 50 });
    const before = commits();
    pointerMove(handle, { x: 300, y: 30 });
    expect(commits()).toBe(before);
    expect(last(log)[1]).toEqual({ at: 1.2, value: 0.7 });
    expect(handle.style.translate).toBe("calc(1.2 * var(--timeline-scale) - 50%) -50%");
    expect(handle.style.top).toBe("30%");
    expect(handle.getAttribute("aria-valuetext")).toBe("1.20 s, 0.70");
    pointerUp(handle, { x: 300, y: 30 });
    expect(log.gestures).toEqual(["start", "end"]);
    expect(handle.style.translate).toBe("calc(1 * var(--timeline-scale) - 50%) -50%");
  });

  test("a point cannot pass the points around it, nor leave the range", () => {
    const { curve, log } = setup();
    pointerMove(curve, { x: 250, y: 50 });
    const handle = handleAt("1.00 s, 0.50");
    pointerDown(handle, { x: 250, y: 50 });
    pointerMove(handle, { x: 2000, y: -500 });
    expect(last(log)[1]).toEqual({ at: 2, value: 1 });
  });

  test("a drag moves the selection together, and the most constrained point stops them all", () => {
    const { curve, log } = setup();
    pointerMove(curve, { x: 250, y: 50 });
    pointerDown(handleAt("1.00 s, 0.50"), { x: 250, y: 50 });
    pointerUp(handleAt("1.00 s, 0.50"), { x: 250, y: 50 });
    pointerMove(curve, { x: 500, y: 0 });
    pointerDown(handleAt("2.00 s, 1.00"), { x: 500, y: 0, metaKey: true });
    pointerUp(handleAt("2.00 s, 1.00"), { x: 500, y: 0, metaKey: true });
    expect(log.selected.at(-1)).toEqual([1, 2]);

    const handle = handleAt("1.00 s, 0.50");
    pointerDown(handle, { x: 250, y: 50 });
    // Up: the point at 1 is already at the top, so neither moves up; right by 1 s stops where 2 s meets 4 s.
    pointerMove(handle, { x: 1000, y: 0 });
    expect(last(log).slice(1, 3)).toEqual([
      { at: 3, value: 0.5 },
      { at: 4, value: 1 },
    ]);
  });

  test("moves snap to the grid in time and to steps in value, and not with Shift", () => {
    // At 250 px per second, sixteenths at 120 BPM (0.125 s) are the finest lines 12 px apart.
    const { curve, log } = setup({ options: { snap: { time: musicalGrid({ bpm: 120 }), value: 0.25 } } });
    pointerMove(curve, { x: 250, y: 50 });
    const handle = handleAt("1.00 s, 0.50");
    pointerDown(handle, { x: 250, y: 50 });
    pointerMove(handle, { x: 280, y: 38 });
    expect(last(log)[1]).toEqual({ at: 1.125, value: 0.5 });
    pointerMove(handle, { x: 280, y: 38, shiftKey: true });
    expect(last(log)[1]!.at).toBeCloseTo(1.12);
    expect(last(log)[1]!.value).toBeCloseTo(0.62);
  });

  test("a point locked in value moves only in time, and one locked in both has no handle", () => {
    const { curve, log } = setup({ options: { lock: { 0: "both", 1: "value" } } });
    // The tab stop is the first point that can be grabbed.
    expect(handles().map((handle) => handle.getAttribute("aria-valuetext"))).toEqual(["1.00 s, 0.50"]);
    pointerMove(curve, { x: 0, y: 100 });
    expect(handles()).toHaveLength(1);
    const handle = handleAt("1.00 s, 0.50");
    pointerDown(handle, { x: 250, y: 50 });
    pointerMove(handle, { x: 300, y: 10 });
    expect(last(log)[1]).toEqual({ at: 1.2, value: 0.5 });
  });

  test("the application's rule applies as the points move", () => {
    // The last point follows the one before it, 2 s later, as the end of an envelope's release follows its knee.
    const constrain = (points: CurvePoint[]) => points.map((point, index) => (index === 3 ? { ...point, at: points[2]!.at + 2 } : point));
    const { curve, log } = setup({ options: { constrain } });
    pointerMove(curve, { x: 500, y: 0 });
    const handle = handleAt("2.00 s, 1.00");
    pointerDown(handle, { x: 500, y: 0 });
    pointerMove(handle, { x: 400, y: 0 });
    expect(last(log).map((point) => point.at)).toEqual([0, 1, 1.6, 3.6]);
  });

  test("a double-click on the curve adds a point, selected and focused; one on a point removes it", () => {
    const { curve, log } = setup({ keep: true });
    fireEvent.doubleClick(curve, { clientX: 750, clientY: 80 });
    expect(log.changes.at(-1)!.reason).toBe("add");
    expect(last(log)[3]).toEqual({ at: 3, value: 0.2 });
    expect(log.selected.at(-1)).toEqual([3]);
    expect(document.activeElement!.getAttribute("aria-valuetext")).toBe("3.00 s, 0.20");

    fireEvent.doubleClick(document.activeElement!);
    expect(log.changes.at(-1)!.reason).toBe("remove");
    expect(last(log)).toHaveLength(4);
  });

  test("without canAdd and canRemove, double-clicks change nothing", () => {
    const { curve, log } = setup({ options: { canAdd: false, canRemove: false } });
    fireEvent.doubleClick(curve, { clientX: 750, clientY: 80 });
    fireEvent.doubleClick(handles()[0]!);
    expect(log.changes).toEqual([]);
  });

  test("keys: arrows go from point to point, Up and Down move the value, Cmd or Ctrl with arrows move in time, Alt bends", () => {
    const { log } = setup({ keep: true });
    const first = handles()[0]!;
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(document.activeElement!.getAttribute("aria-valuetext")).toBe("1.00 s, 0.50");
    const second = document.activeElement!;
    fireEvent.keyDown(second, { key: "ArrowUp" });
    expect(last(log)[1]!.value).toBeCloseTo(0.51);
    fireEvent.keyDown(second, { key: "ArrowRight", ctrlKey: true });
    // Without a grid, ten pixels: 0.04 s.
    expect(last(log)[1]!.at).toBeCloseTo(1.04);
    fireEvent.keyDown(second, { key: "ArrowUp", altKey: true });
    // Up raises the middle of the rising segment after it: it moves earlier.
    expect(last(log)[1]!.shape).toBeCloseTo(-0.1);
    expect(log.gestures).toEqual(["start", "end", "start", "end", "start", "end"]);
    fireEvent.keyDown(second, { key: "Delete" });
    expect(last(log)).toHaveLength(3);
  });

  test("dragging the middle of a segment bends it through the pointer, and a double-click straightens it", () => {
    const { curve, log } = setup({ keep: true });
    // The middle of 1 s … 2 s, from 0.5 to 1: 1.5 s, at 0.75.
    pointerMove(curve, { x: 375, y: 25 });
    const bend = screen.getByTestId("bend");
    pointerDown(bend, { x: 375, y: 25 });
    pointerMove(bend, { x: 375, y: 40 });
    // Through 0.6: a fifth of the way up, as 0.5 ** 2 ** (3t) = 0.2.
    const tension = last(log)[1]!.shape as number;
    expect(0.5 ** (2 ** (3 * tension))).toBeCloseTo(0.2);
    expect(bend.style.top).toBe("40%");
    pointerUp(bend, { x: 375, y: 40 });
    fireEvent.doubleClick(bend);
    expect(last(log)[1]!.shape).toBe("linear");
  });
});

test("a move draws again only the tiles over the stretch it changed", () => {
  const points: CurvePoint[] = Array.from({ length: 41 }, (_, index) => ({ at: index, value: (index % 2) / 2 }));
  function Lane() {
    const editing = useCurveEditing();
    return (
      <Timeline.Root start={0} end={10}>
        <Curve.Root points={points} editing={editing} data-testid="curve">
          <Curve.Line />
          <Curve.Handle aria-label="Point" />
        </Curve.Root>
      </Timeline.Root>
    );
  }
  render(<Lane />);
  setBox(screen.getByTestId("curve"), { x: 0, y: 0, width: 1000, height: 100 });
  frame();
  // 100 px per second: tile 0 (0 … 10.24 s) in view, and tile 1 ahead of it.
  expect(tiles).toBe(2);
  tiles = 0;
  const handle = handles()[0]!;
  pointerDown(handle, { x: 0, y: 100 });
  pointerMove(handle, { x: 0, y: 80 });
  frame();
  // The first point moved: the curve changed up to the second point, at 1 s, in tile 0 alone.
  expect(tiles).toBe(1);
});
