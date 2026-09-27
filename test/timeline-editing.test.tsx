// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Profiler, useState } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { musicalGrid } from "../src/core/index.js";
import { Timeline } from "../src/react/index.js";
import type { RegionChange } from "../src/react/timeline-editing.js";
import { pointerDown, pointerMove, pointerUp, setBox } from "./helpers.js";

// A timeline 1000 px wide for 10 s (100 px per second), three tracks 40 px tall, and a grid at
// 120 BPM whose sixteenths (0.125 s, 12.5 px) are the snap steps.

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", () => 0);
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
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1000);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Clip = { value: string; track: string; at: number; duration: number; offset?: number; length?: number };

const clips: Clip[] = [
  { value: "one", track: "a", at: 1, duration: 2, length: 3 },
  { value: "two", track: "a", at: 4, duration: 2 },
  { value: "three", track: "b", at: 3.5, duration: 1 },
];

type Events = { changes: RegionChange[][]; gestures: string[]; selected: string[][] };

function Arrangement({ events, commit = false, snap = true }: { events: Events; commit?: boolean; snap?: boolean }) {
  const [regions, setRegions] = useState(clips);
  return (
    <Timeline.Root
      start={0}
      end={10}
      snap={snap ? musicalGrid({ bpm: 120 }) : undefined}
      onRegionsChange={(changes) => events.changes.push(changes)}
      onGestureStart={() => events.gestures.push("start")}
      onGestureEnd={(changes) => {
        events.gestures.push("end");
        if (commit) {
          setRegions((current) =>
            current.map((clip) => {
              const change = changes.find((one) => one.value === clip.value);
              return change ? { ...clip, at: change.at, duration: change.duration, offset: change.offset, track: change.track! } : clip;
            }),
          );
        }
      }}
      onSelectedChange={(selected) => events.selected.push(selected)}
      data-testid="timeline"
    >
      {["a", "b", "c"].map((track) => (
        <Timeline.Track key={track} value={track} aria-label={`Track ${track}`} data-testid={`track ${track}`}>
          {regions
            .filter((clip) => clip.track === track)
            .map((clip) => (
              <Timeline.Region key={clip.value} data-testid={clip.value} {...clip}>
                <Timeline.RegionHeader>
                  <button type="button">Menu</button>
                  <Timeline.RegionLabel>{clip.value}</Timeline.RegionLabel>
                </Timeline.RegionHeader>
                <Timeline.RegionContent />
                <Timeline.RegionHandle side="start" aria-label="Start" />
                <Timeline.RegionHandle side="end" aria-label="End" />
              </Timeline.Region>
            ))}
        </Timeline.Track>
      ))}
    </Timeline.Root>
  );
}

function setup(options: { commit?: boolean; snap?: boolean } = {}) {
  const events: Events = { changes: [], gestures: [], selected: [] };
  const result = render(<Arrangement events={events} {...options} />);
  setBox(screen.getByTestId("timeline"), { x: 0, y: 0, width: 1000, height: 120 });
  ["a", "b", "c"].forEach((track, index) => setBox(screen.getByTestId(`track ${track}`), { x: 0, y: index * 40, width: 1000, height: 40 }));
  return { events, ...result };
}

const region = (value: string) => screen.getByTestId(value);
const translate = (value: string) => region(value).style.translate;
const lastChanges = (events: Events) => events.changes.at(-1)!.map(({ value, at, duration, offset, track }) => ({ value, at, duration, offset, track }));

/** Presses at `from` (x, y) on `element`, moves through the points and releases. */
function drag(element: Element, points: { x: number; y?: number; shiftKey?: boolean }[], release = true) {
  const [first, ...rest] = points;
  pointerDown(element, { x: first!.x, y: first!.y ?? 0 });
  for (const point of rest) pointerMove(element, { x: point.x, y: point.y ?? 0, ...(point.shiftKey ? { shiftKey: true } : {}) });
  if (release) pointerUp(element, { x: rest.at(-1)?.x ?? first!.x, y: rest.at(-1)?.y ?? 0 });
}

describe("accessibility", () => {
  test("editable, the timeline is a grid of tracks as rows and regions as cells named by their labels", () => {
    setup();
    expect(screen.getByRole("grid").getAttribute("aria-multiselectable")).toBe("true");
    expect(screen.getByRole("row", { name: "Track a" })).toBe(screen.getByTestId("track a"));
    const one = screen.getByRole("gridcell", { name: "one" });
    expect(one.getAttribute("aria-selected")).toBe("false");
  });

  test("regions are one tab stop together", () => {
    setup();
    expect(["one", "two", "three"].map((value) => region(value).tabIndex)).toEqual([0, -1, -1]);
  });
});

describe("selection", () => {
  test("a press selects a region alone; Cmd or Ctrl adds or takes it out; a press on a track clears it", () => {
    const { events } = setup();
    drag(region("one"), [{ x: 150 }]);
    drag(region("two"), [{ x: 450 }]);
    fireEvent.pointerDown(region("three"), { pointerId: 1, button: 0, clientX: 380, ctrlKey: true });
    fireEvent.pointerUp(region("three"), { pointerId: 1, button: 0, clientX: 380 });
    expect(events.selected).toEqual([["one"], ["two"], ["two", "three"]]);
    expect(region("three").hasAttribute("data-selected")).toBe(true);
    expect(region("three").getAttribute("aria-selected")).toBe("true");
    fireEvent.pointerDown(screen.getByTestId("track c"), { pointerId: 1, button: 0 });
    expect(events.selected.at(-1)).toEqual([]);
    expect(region("three").hasAttribute("data-selected")).toBe(false);
  });

  test("a press on a control inside a region, such as its menu, neither selects nor moves it", () => {
    const { events } = setup();
    drag(screen.getAllByRole("button", { name: "Menu" })[0]!, [{ x: 150 }, { x: 300 }]);
    expect(events.selected).toEqual([]);
    expect(events.changes).toEqual([]);
  });
});

describe("moving", () => {
  test("a drag moves the region, snapped to the grid, without rendering, as one gesture", () => {
    const { events } = setup();
    let commits = 0;
    render(<Profiler id="probe" onRender={() => commits++} />);
    // Grab at 150 px; +37 px is 1.37 s, which snaps to 1.375 s.
    pointerDown(region("one"), { x: 150 });
    commits = 0;
    pointerMove(region("one"), { x: 160 });
    pointerMove(region("one"), { x: 187 });
    expect(lastChanges(events)).toEqual([{ value: "one", at: 1.375, duration: 2, offset: 0, track: "a" }]);
    expect(translate("one")).toBe("calc((1.375 - var(--timeline-start)) * var(--timeline-scale)) 0");
    expect(region("one").hasAttribute("data-dragging")).toBe(true);
    expect(commits).toBe(0);
    pointerUp(region("one"), { x: 187 });
    expect(events.gestures).toEqual(["start", "end"]);
    // Not taken by the application: back where its props say.
    expect(translate("one")).toBe("calc((1 - var(--timeline-start)) * var(--timeline-scale)) 0");
    expect(region("one").hasAttribute("data-dragging")).toBe(false);
  });

  test("Shift does not snap, and a region taken by the application stays where it went", () => {
    const { events } = setup({ commit: true });
    drag(region("one"), [{ x: 150 }, { x: 187, shiftKey: true }]);
    expect(lastChanges(events)[0]!.at).toBeCloseTo(1.37);
    expect(translate("one")).toMatch(/^calc\(\(1\.37/);
  });

  test("a click that trembles less than 3 px moves nothing", () => {
    const { events } = setup();
    drag(region("one"), [{ x: 150 }, { x: 152 }]);
    expect(events.changes).toEqual([]);
  });

  test("the selection moves together, and stops as a group at the start of the timeline", () => {
    const { events } = setup();
    drag(region("one"), [{ x: 150 }]);
    fireEvent.pointerDown(region("two"), { pointerId: 1, button: 0, clientX: 450, ctrlKey: true });
    fireEvent.pointerUp(region("two"), { pointerId: 1, button: 0, clientX: 450 });
    // Two seconds to the left: "one" would start before 0, so both stop one second earlier.
    drag(region("two"), [{ x: 450 }, { x: 250 }]);
    expect(lastChanges(events).map(({ value, at }) => [value, at])).toEqual([
      ["one", 0],
      ["two", 3],
    ]);
  });

  test("a drag down moves the region to the track under the pointer", () => {
    const { events } = setup();
    drag(region("one"), [{ x: 150, y: 20 }, { x: 150, y: 95 }], false);
    expect(lastChanges(events)[0]!.track).toBe("c");
    // Previewed 80 px down, where track c is, until the application moves it there.
    expect(translate("one")).toBe("calc((1 - var(--timeline-start)) * var(--timeline-scale)) 80px");
    pointerUp(region("one"), { x: 150, y: 95 });
  });
});

describe("trimming", () => {
  const handle = (value: string, name: "Start" | "End") => {
    fireEvent.pointerEnter(region(value));
    return within(region(value)).getByRole("slider", { name });
  };

  test("handles are there only while the region is pointed at, focused or selected", () => {
    setup();
    expect(screen.queryAllByRole("slider")).toEqual([]);
    fireEvent.pointerEnter(region("one"));
    expect(screen.getAllByRole("slider")).toHaveLength(2);
    fireEvent.pointerLeave(region("one"));
    expect(screen.queryAllByRole("slider")).toEqual([]);
  });

  test("the end handle changes the duration, up to the length of the content", () => {
    const { events } = setup();
    const end = handle("one", "End");
    expect(end.getAttribute("aria-valuenow")).toBe("3");
    expect(end.getAttribute("aria-valuetext")).toBe("3.00 s");
    // +2 s would need 4 s of content; there are 3.
    drag(end, [{ x: 300 }, { x: 500 }]);
    expect(lastChanges(events)[0]).toEqual({ value: "one", at: 1, duration: 3, offset: 0, track: "a" });
  });

  test("the start handle moves the start and the content with it, never before the content's start", () => {
    const { events } = setup();
    const start = handle("one", "Start");
    drag(start, [{ x: 100 }, { x: 150 }]);
    expect(lastChanges(events)[0]).toEqual({ value: "one", at: 1.5, duration: 1.5, offset: 0.5, track: "a" });
    drag(start, [{ x: 100 }, { x: 0 }]);
    expect(lastChanges(events)[0]).toEqual({ value: "one", at: 1, duration: 2, offset: 0, track: "a" });
  });

  test("a region is never shorter than a snap step", () => {
    const { events } = setup();
    drag(handle("two", "End"), [{ x: 600 }, { x: 0 }]);
    expect(lastChanges(events)[0]!.duration).toBe(0.125);
  });

  test("trimming one of a selection trims them all", () => {
    const { events } = setup();
    drag(region("two"), [{ x: 450 }]);
    fireEvent.pointerDown(region("three"), { pointerId: 1, button: 0, clientX: 380, ctrlKey: true });
    fireEvent.pointerUp(region("three"), { pointerId: 1, button: 0, clientX: 380 });
    drag(handle("two", "End"), [{ x: 600 }, { x: 650 }]);
    expect(lastChanges(events).map(({ value, duration }) => [value, duration])).toEqual([
      ["two", 2.5],
      ["three", 1.5],
    ]);
  });
});

describe("keyboard", () => {
  test("arrows move the focus between regions, along a track and across tracks", () => {
    setup();
    region("one").focus();
    fireEvent.keyDown(region("one"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(region("two"));
    fireEvent.keyDown(region("two"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(region("three"));
    expect(region("three").tabIndex).toBe(0);
    expect(region("one").tabIndex).toBe(-1);
  });

  test("Space selects; Cmd or Ctrl and arrows move the selection by a snap step, or a track", () => {
    const { events } = setup({ commit: true });
    region("one").focus();
    fireEvent.keyDown(region("one"), { key: " " });
    expect(events.selected).toEqual([["one"]]);
    fireEvent.keyDown(region("one"), { key: "ArrowRight", ctrlKey: true });
    expect(lastChanges(events)[0]).toEqual({ value: "one", at: 1.125, duration: 2, offset: 0, track: "a" });
    expect(events.gestures).toEqual(["start", "end"]);
  });

  test("a focused region shows its handles, next in the tab order; arrows on one move its edge", () => {
    const { events } = setup();
    act(() => region("one").focus());
    const end = screen.getByRole("slider", { name: "End" });
    expect(end.tabIndex).toBe(0);
    fireEvent.keyDown(end, { key: "ArrowLeft" });
    expect(lastChanges(events)[0]!.duration).toBe(1.875);
  });

  test("a key that moves a region to another track keeps the focus on it", async () => {
    setup({ commit: true });
    region("one").focus();
    fireEvent.keyDown(region("one"), { key: "ArrowDown", metaKey: true });
    await act(async () => {});
    expect(document.activeElement).toBe(region("one"));
    expect(screen.getByTestId("track b").contains(region("one"))).toBe(true);
  });
});
