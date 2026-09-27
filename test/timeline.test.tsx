// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { clockGrid, createPeaks, createPeaksRecorder, musicalGrid, scales, type CurvePoint, type Peaks } from "../src/core/index.js";
import { Curve, Notes, Region, Timeline, Waveform, type Note } from "../src/react/index.js";

// jsdom has no layout, animation frames or canvas: the tests give the timeline a
// width, run frames when they say so, and record what the tiles draw.

let frames: FrameRequestCallback[] = [];
let resizeCallbacks: (() => void)[] = [];
const size = { width: 1000, height: 40 };
const drawn = {
  tiles: 0,
  columns: 0,
  colors: new Set<string>(),
  tops: [] as number[],
  rects: [] as number[][],
  /** Paths, as their moves and lines in whole pixels, and how each ended. */
  path: [] as [string, number, number][],
  ends: [] as string[],
};

beforeEach(() => {
  frames = [];
  resizeCallbacks = [];
  Object.assign(drawn, { tiles: 0, columns: 0, colors: new Set(), tops: [], rects: [], path: [], ends: [] });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal("cancelAnimationFrame", () => {
    frames = [];
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: () => void) {}
      observe() {
        resizeCallbacks.push(this.callback);
        this.callback();
      }
      disconnect() {}
    },
  );
  // Time stands still, so that the frame budget for drawing never runs out on a slow machine; one test moves it.
  vi.spyOn(performance, "now").mockReturnValue(0);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => size.width);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => size.height);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () =>
      ({
        clearRect: () => drawn.tiles++,
        fillRect: (x: number, top: number, width: number, height: number) => {
          drawn.columns++;
          drawn.tops.push(top);
          drawn.rects.push([x, top, width, height]);
        },
        set fillStyle(color: string) {
          drawn.colors.add(color);
        },
        beginPath: () => (drawn.path = []),
        moveTo: (x: number, y: number) => drawn.path.push(["M", Math.round(x), Math.round(y)]),
        lineTo: (x: number, y: number) => drawn.path.push(["L", Math.round(x), Math.round(y)]),
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

function frame(now = 0) {
  const pending = frames;
  frames = [];
  for (const callback of pending) callback(now);
}

const variable = (name: string) => screen.getByTestId("timeline").style.getPropertyValue(name);

// A minute of audio at 1 kHz: enough for tiles, cheap to build.
const minute: Peaks = createPeaks([new Float32Array(60_000).map((_, index) => Math.sin(index / 10))], 1000, { samplesPerPeak: 16 });

describe("Timeline", () => {
  test("writes the view on the root, and the playhead on the parts that follow it", () => {
    render(
      <Timeline.Root start={2} end={12} position={3.5} data-testid="timeline">
        <Timeline.Playhead data-testid="playhead" />
      </Timeline.Root>,
    );
    expect(variable("--timeline-start")).toBe("2");
    // 1000 px for 10 s.
    expect(variable("--timeline-scale")).toBe("100px");
    // Not a variable on the root: a change there would recalculate the style of everything on the timeline, every frame.
    expect(variable("--timeline-position")).toBe("");
    expect(screen.getByTestId("playhead").style.translate).toBe("calc((3.5 - var(--timeline-start)) * var(--timeline-scale)) 0");
  });

  test("reads the playhead and the view once per frame, and renders nothing for them", () => {
    let commits = 0;
    let time = 0;
    let view: readonly [number, number] = [0, 10];
    render(
      <Profiler id="timeline" onRender={() => commits++}>
        <Timeline.Root start={0} end={10} read={() => time} readView={() => view} data-testid="timeline">
          <Timeline.Playhead data-testid="playhead" />
        </Timeline.Root>
      </Profiler>,
    );
    commits = 0;
    time = 4.25;
    view = [2, 7];
    frame();
    expect(screen.getByTestId("playhead").style.translate).toBe("calc((4.25 - var(--timeline-start)) * var(--timeline-scale)) 0");
    expect([variable("--timeline-start"), variable("--timeline-scale")]).toEqual(["2", "200px"]);
    expect(commits).toBe(0);
  });

  test("the playhead is a line placed by the variables, hidden from assistive technology", () => {
    render(
      <Timeline.Root start={0} end={10}>
        <Timeline.Playhead data-testid="playhead" />
      </Timeline.Root>,
    );
    const playhead = screen.getByTestId("playhead");
    expect(playhead.getAttribute("aria-hidden")).toBe("true");
    expect(playhead.style.translate).toBe("calc((0 - var(--timeline-start)) * var(--timeline-scale)) 0");
  });

  test("holds anything: what is inside it is the application's, it adds no roles or elements for it", () => {
    render(
      <Timeline.Root start={0} end={10} data-testid="timeline">
        <div data-testid="row" />
      </Timeline.Root>,
    );
    const timeline = screen.getByTestId("timeline");
    expect(timeline.getAttribute("role")).toBeNull();
    expect([...timeline.children]).toEqual([screen.getByTestId("row")]);
  });

  test("parts outside a root say where they belong", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Timeline.Playhead />)).toThrow(/Timeline.Root/);
  });
});

describe("Region", () => {
  test("a region is placed in CSS from the view's variables", () => {
    render(
      <Timeline.Root start={0} end={10}>
        <Region.Root at={4} duration={2.5} offset={1} data-testid="region" />
      </Timeline.Root>,
    );
    const region = screen.getByTestId("region");
    expect(region.style.width).toBe("calc(2.5 * var(--timeline-scale))");
    expect(region.style.translate).toBe("calc((4 - var(--timeline-start)) * var(--timeline-scale)) 0");
  });

  test("a region reads a placement that changes on its own once per frame, without rendering", () => {
    let commits = 0;
    let length = 1;
    render(
      <Profiler id="region" onRender={() => commits++}>
        <Timeline.Root start={0} end={10}>
          <Region.Root at={2} read={() => ({ duration: length })} data-testid="region" />
        </Timeline.Root>
      </Profiler>,
    );
    commits = 0;
    length = 3.5;
    frame();
    expect(screen.getByTestId("region").style.width).toBe("calc(3.5 * var(--timeline-scale))");
    expect(commits).toBe(0);
  });

  test("fills the height of the box it is placed in", () => {
    render(
      <Timeline.Root start={0} end={10}>
        <div style={{ position: "relative" }}>
          <Region.Root at={0} duration={1} data-testid="region" />
        </div>
      </Timeline.Root>,
    );
    const { style } = screen.getByTestId("region");
    expect([style.position, style.insetBlock, style.left]).toEqual(["absolute", "0px", "0px"]);
  });

  test("is a group named by its label, with a header and content for the application", () => {
    render(
      <Timeline.Root start={0} end={10}>
        <Region.Root at={0} duration={1} data-testid="region">
          <Region.Header data-testid="header">
            <Region.Label>Beat</Region.Label>
          </Region.Header>
          <Region.Content data-testid="content" />
        </Region.Root>
      </Timeline.Root>,
    );
    expect(screen.getByRole("group", { name: "Beat" })).toBe(screen.getByTestId("region"));
    expect(screen.getByTestId("content").style.position).toBe("relative");
  });

  test("parts outside a region, and a region outside a timeline, say where they belong", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Region.Root at={0} />)).toThrow(/Timeline.Root/);
    expect(() => render(<Region.Label />)).toThrow(/Region.Root/);
  });
});

describe("Waveform", () => {
  function Session({ view = [0, 10], time = 0, at = 0, offset = 0 }: { view?: [number, number]; time?: number; at?: number; offset?: number }) {
    return (
      <Timeline.Root start={view[0]} end={view[1]} position={time} data-testid="timeline">
        <div>
          <Region.Root at={at} duration={60 - offset} offset={offset}>
            <Waveform.Root peaks={minute} aria-label="Take 1" data-testid="waveform">
              <Waveform.Shape data-testid="shape" style={{ color: "rgb(1, 2, 3)" }} />
              <Waveform.Progress data-testid="progress" />
            </Waveform.Root>
          </Region.Root>
        </div>
      </Timeline.Root>
    );
  }
  const canvases = (part: string) => screen.getByTestId(part).querySelectorAll("canvas");
  const layers = (part: string) => screen.getByTestId(part).querySelectorAll(":scope > div");

  test("is an image named by the application", () => {
    render(<Session />);
    expect(screen.getByRole("img", { name: "Take 1" })).toBe(screen.getByTestId("waveform"));
  });

  test("on a timeline outside a region, it scrolls with the view: tiles and the played part count from the view's start", () => {
    render(
      <Timeline.Root start={20} end={30} position={25}>
        <Waveform.Root peaks={minute}>
          <Waveform.Shape data-testid="shape" />
          <Waveform.Progress data-testid="progress" />
        </Waveform.Root>
      </Timeline.Root>,
    );
    frame();
    // 100 px per second from 20 s: tile 1 (10.24 … 20.48 s) is in view, placed from the view's start.
    expect([...canvases("shape")].map((canvas) => canvas.style.translate)).toContain(
      "calc((10.24 - var(--timeline-start)) * var(--timeline-scale)) 0",
    );
    expect(screen.getByTestId("progress").style.clipPath).toBe(
      "inset(0 max(0px, calc(100% - (25 - var(--timeline-start)) * var(--timeline-scale))) 0 0)",
    );
  });

  test("on its own, it is its own axis: its audio across its width, with its own playhead", () => {
    render(
      <Waveform.Root peaks={minute} offset={10} duration={20} read={() => 15} data-testid="waveform">
        <Waveform.Shape data-testid="shape" />
        <Waveform.Progress data-testid="progress" />
      </Waveform.Root>,
    );
    const waveform = screen.getByTestId("waveform");
    // 1000 px for 20 s, from 10 s into the audio.
    expect(waveform.style.getPropertyValue("--timeline-scale")).toBe("50px");
    frame();
    // Played up to 5 s of the 20 s it shows.
    expect(screen.getByTestId("progress").style.clipPath).toBe("inset(0 max(0px, calc(100% - 5 * var(--timeline-scale))) 0 0)");
    // 20 s at 50 px per second: tiles of 20.48 s from 0 s of the audio, the two with 10 … 30 s, and none beyond what it shows.
    expect([...canvases("shape")].map((canvas) => canvas.style.translate)).toEqual([
      "calc(-10 * var(--timeline-scale)) 0",
      "calc(10.48 * var(--timeline-scale)) 0",
    ]);
  });

  test("draws the tiles in view on the next frame, one column per device pixel, in the CSS color", () => {
    render(<Session />);
    expect(drawn.tiles).toBe(0);
    frame();
    // 100 px per second: tile 0 is in view and tile 1 is drawn ahead, for the shape and the progress.
    expect(drawn.tiles).toBe(4);
    expect(drawn.columns).toBe(4 * 1024);
    expect(drawn.colors).toContain("rgb(1, 2, 3)");
  });

  test("tiles are placed in time, so that a zoom stretches them in place", () => {
    render(<Session />);
    frame();
    // In seconds of the audio, from the region's offset: moving or trimming the region only places them again.
    expect([...canvases("shape")].map((canvas) => [canvas.style.translate, canvas.style.width])).toEqual([
      ["calc(0 * var(--timeline-scale)) 0", "calc(10.24 * var(--timeline-scale))"],
      ["calc(10.24 * var(--timeline-scale)) 0", "calc(10.24 * var(--timeline-scale))"],
    ]);
  });

  test("moving or trimming the region draws nothing already drawn", () => {
    const { rerender } = render(<Session />);
    frame();
    drawn.tiles = 0;
    // Moved 1 s right, then its start trimmed by 2 s: the audio in view is still in tiles 0 and 1.
    rerender(<Session at={1} />);
    rerender(<Session at={3} offset={2} />);
    frame();
    expect(drawn.tiles).toBe(0);
    expect(canvases("shape")[1]!.style.translate).toBe("calc(8.24 * var(--timeline-scale)) 0");
    // The playhead at 0 is 3 s before the region's new start.
    expect(screen.getByTestId("progress").style.clipPath).toContain("100% - -3 * var(--timeline-scale)");
  });

  test("playback draws nothing: the played part is clipped in CSS", () => {
    const { rerender } = render(<Session />);
    frame();
    drawn.tiles = 0;
    rerender(<Session time={8} />);
    frame();
    expect(drawn.tiles).toBe(0);
    expect(screen.getByTestId("progress").style.clipPath).toBe(
      "inset(0 max(0px, calc(100% - 8 * var(--timeline-scale))) 0 0)",
    );
  });

  test("scrolling draws only the tiles that come into view", () => {
    const { rerender } = render(<Session />);
    frame();
    drawn.tiles = 0;
    rerender(<Session view={[5, 15]} />);
    frame();
    // 500 … 1500 px: tile 2 is new, ahead of the view; for the shape and the progress.
    expect(drawn.tiles).toBe(2);
    rerender(<Session view={[5.5, 15.5]} />);
    frame();
    expect(drawn.tiles).toBe(2);
  });

  test("a zoom stretches the tiles, then draws a sharp layer over them when it rests", () => {
    // Timers only: the test runs animation frames itself.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const { rerender } = render(<Session />);
      frame();
      drawn.tiles = 0;
      rerender(<Session view={[0, 8]} />);
      frame();
      expect(drawn.tiles).toBe(0);
      act(() => void vi.advanceTimersByTime(200));
      expect(layers("shape")).toHaveLength(2);
      frame();
      expect(drawn.tiles).toBeGreaterThan(0);
      // The new layer covers the view: the stretched one is gone.
      expect(layers("shape")).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test("a zoom past twice the scale starts a sharp layer at once", () => {
    const { rerender } = render(<Session />);
    frame();
    drawn.tiles = 0;
    rerender(<Session view={[0, 4]} />);
    frame();
    expect(drawn.tiles).toBeGreaterThan(0);
    expect(layers("shape")).toHaveLength(1);
  });

  test("drawing takes at most a few milliseconds per frame, visible tiles first", () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () =>
        ({
          clearRect: () => {
            drawn.tiles++;
            // Each tile takes 1.5 ms.
            now += 1.5;
          },
          fillRect: () => {},
          set fillStyle(_: string) {},
        }) as unknown as CanvasRenderingContext2D,
    );
    render(<Session />);
    frame();
    // 4 ms: three tiles (the third starts before the budget runs out), the visible ones first.
    expect(drawn.tiles).toBe(3);
    frame();
    expect(drawn.tiles).toBe(4);
  });

  test("a change of its color draws it again", () => {
    render(<Session />);
    frame();
    drawn.tiles = 0;
    const shape = screen.getByTestId("shape");
    shape.style.color = "rgb(4, 5, 6)";
    shape.querySelector("span")!.dispatchEvent(new Event("transitionend"));
    drawn.colors.clear();
    frame();
    expect([...drawn.colors]).toEqual(["rgb(4, 5, 6)"]);
    expect(drawn.tiles).toBe(2);
  });

  test("unmounting removes its tiles", () => {
    const { unmount } = render(<Session />);
    frame();
    const [canvas] = canvases("shape");
    unmount();
    expect(canvas!.isConnected).toBe(false);
  });
});

describe("Notes", () => {
  // Three notes going up, one per second, in seconds of the clip.
  const line: Note[] = [
    { at: 0, duration: 1, pitch: 60 },
    { at: 1, duration: 1, pitch: 62 },
    { at: 2, duration: 1, pitch: 64 },
  ];

  function Clip({ at = 0, offset = 0, notes = line }: { at?: number; offset?: number; notes?: Note[] }) {
    return (
      <Timeline.Root start={0} end={10} position={1.5}>
        <div>
          <Region.Root at={at} duration={3 - offset} offset={offset}>
            <Notes.Root notes={notes}>
              <Notes.Shape data-testid="shape" />
              <Notes.Progress data-testid="progress" />
            </Notes.Root>
          </Region.Root>
        </div>
      </Timeline.Root>
    );
  }

  test("is an image named by the application", () => {
    render(<Notes.Root notes={line} aria-label="Chords" data-testid="notes" />);
    expect(screen.getByRole("img", { name: "Chords" })).toBe(screen.getByTestId("notes"));
  });

  test("on its own, draws each note as a bar: in time across, one row per pitch, the highest at the top", () => {
    render(
      <Notes.Root notes={line} data-testid="notes">
        <Notes.Shape style={{ color: "rgb(4, 5, 6)" }} />
      </Notes.Root>,
    );
    // Its own axis: the 3 s of notes across 1000 px.
    expect(screen.getByTestId("notes").style.getPropertyValue("--timeline-scale")).toBe(`${1000 / 3}px`);
    frame();
    // 40 px for the pitches 60 … 64: five rows of 8 px, 64 at the top.
    expect(drawn.rects).toEqual([
      [0, 32, 333, 8],
      [333, 16, 334, 8],
      [667, 0, 333, 8],
    ]);
    expect(drawn.colors).toContain("rgb(4, 5, 6)");
  });

  test("a range sets the rows, as the keys beside a piano roll do; notes outside it are not drawn", () => {
    render(
      <Notes.Root notes={line} range={[62, 65]}>
        <Notes.Shape />
      </Notes.Root>,
    );
    frame();
    // Four rows of 10 px, 65 at the top; 60 is below the range.
    expect(drawn.rects.map(([, top, , height]) => [top, height])).toEqual([
      [30, 10],
      [10, 10],
    ]);
  });

  test("in a region, it shows what the region shows, and moving the region draws nothing already drawn", () => {
    const { rerender } = render(<Clip />);
    frame();
    // 100 px per second: one tile holds the three notes, for the shape and for the progress.
    expect(drawn.tiles).toBe(2);
    drawn.tiles = 0;
    rerender(<Clip at={2} />);
    rerender(<Clip at={3} offset={1} />);
    frame();
    expect(drawn.tiles).toBe(0);
    expect(screen.getByTestId("shape").querySelector("canvas")!.style.translate).toBe("calc(-1 * var(--timeline-scale)) 0");
  });

  test("the same notes draw nothing again; other notes draw again", () => {
    const { rerender } = render(<Clip />);
    frame();
    drawn.tiles = 0;
    rerender(<Clip />);
    frame();
    expect(drawn.tiles).toBe(0);
    rerender(<Clip notes={[...line, { at: 2.5, duration: 0.5, pitch: 67 }]} />);
    frame();
    expect(drawn.tiles).toBe(2);
  });

  test("the notes played are clipped at the playhead in CSS", () => {
    render(<Clip at={1} />);
    expect(screen.getByTestId("progress").style.clipPath).toBe("inset(0 max(0px, calc(100% - 0.5 * var(--timeline-scale))) 0 0)");
  });

  test("parts outside a root say where they belong", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Notes.Shape />)).toThrow(/Notes.Root/);
  });
});

describe("Curve", () => {
  // A second up from 0 to 1, a held second at 0.5, then a jump down to 0.
  const ramp: CurvePoint[] = [
    { at: 0, value: 0 },
    { at: 1, value: 1 },
    { at: 2, value: 0.5, shape: "hold" },
    { at: 3, value: 0 },
  ];

  test("is an image named by the application", () => {
    render(<Curve.Root points={ramp} aria-label="Volume" data-testid="curve" />);
    expect(screen.getByRole("img", { name: "Volume" })).toBe(screen.getByTestId("curve"));
  });

  test("on its own, draws lines between points, a step for a held segment, and holds past the last point", () => {
    render(
      <Curve.Root points={ramp}>
        <Curve.Line style={{ color: "rgb(7, 8, 9)" }} />
      </Curve.Root>,
    );
    frame();
    // The 3 s of points across 1000 px, 40 px tall with 1 at the top; the line starts and ends beyond the tile.
    expect(drawn.path).toEqual([
      ["M", -3, 40],
      ["L", 0, 40],
      ["L", 333, 0],
      ["L", 667, 20],
      ["L", 1000, 20],
      ["L", 1000, 40],
      ["L", 1027, 40],
    ]);
    expect(drawn.ends).toEqual(["stroke"]);
    expect(drawn.colors).toContain("rgb(7, 8, 9)");
  });

  test("a bent segment is traced through a point every two device pixels", () => {
    render(
      <Curve.Root points={[{ at: 0, value: 0, shape: 0.5 }, { at: 1, value: 1 }]}>
        <Curve.Line />
      </Curve.Root>,
    );
    frame();
    const bent = drawn.path.filter(([, x]) => x > 0 && x < 1000);
    expect(bent.length).toBeGreaterThan(450);
    // Late: halfway across, still low.
    const middle = bent.find(([, x]) => x >= 500)!;
    expect(middle[2]).toBeGreaterThan(30);
  });

  test("the fill closes the area down to its origin", () => {
    render(
      <Curve.Root points={ramp}>
        <Curve.Fill origin={0.5} />
      </Curve.Root>,
    );
    frame();
    expect(drawn.path.slice(-2).map(([, , y]) => y)).toEqual([20, 20]);
    expect(drawn.ends).toEqual(["close", "fill"]);
  });

  test("values are placed on the range as a fader of it would show them", () => {
    render(
      <Curve.Root points={[{ at: 0, value: 0 }, { at: 1, value: 0 }]} min={-Infinity} max={6} scale={scales.decibel}>
        <Curve.Line />
      </Curve.Root>,
    );
    frame();
    const volume = 1 - scales.decibel.toNormalized(0, -Infinity, 6);
    expect(drawn.path[1]![2]).toBe(Math.round(volume * 40));
  });

  test("on a timeline outside a region, it lies on the timeline for ever: scrolling draws what comes into view", () => {
    function Lane({ view }: { view: [number, number] }) {
      return (
        <Timeline.Root start={view[0]} end={view[1]}>
          <Curve.Root points={ramp}>
            <Curve.Line data-testid="line" />
          </Curve.Root>
        </Timeline.Root>
      );
    }
    const { rerender } = render(<Lane view={[0, 10]} />);
    frame();
    // The timeline's axis, from its second 0: placed from the view's start, since the view scrolls under it.
    expect(screen.getByTestId("line").querySelector("canvas")!.style.translate).toBe(
      "calc((0 - var(--timeline-start)) * var(--timeline-scale)) 0",
    );
    drawn.tiles = 0;
    rerender(<Lane view={[60, 70]} />);
    frame();
    // A minute on, past the last point, the held value is drawn.
    expect(drawn.tiles).toBeGreaterThan(0);
    expect(drawn.path.at(-1)![2]).toBe(40);
  });

  test("the same points draw nothing again; other points draw again", () => {
    function Clip({ points }: { points: CurvePoint[] }) {
      return (
        <Timeline.Root start={0} end={10}>
          <div>
            <Region.Root at={0} duration={3}>
              <Curve.Root points={points}>
                <Curve.Line />
              </Curve.Root>
            </Region.Root>
          </div>
        </Timeline.Root>
      );
    }
    const { rerender } = render(<Clip points={ramp} />);
    frame();
    drawn.tiles = 0;
    rerender(<Clip points={ramp} />);
    frame();
    expect(drawn.tiles).toBe(0);
    rerender(<Clip points={[...ramp, { at: 2.5, value: 1 }]} />);
    frame();
    expect(drawn.tiles).toBe(1);
  });

  test("parts outside a root say where they belong", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Curve.Line />)).toThrow(/Curve.Root/);
  });
});

describe("Timeline.Grid", () => {
  test("draws a line at every step that leaves the spacing, in tiles placed on the view", () => {
    render(
      <Timeline.Root start={0} end={10}>
        <Timeline.Grid grid={musicalGrid({ bpm: 120 })} data-testid="grid" />
      </Timeline.Root>,
    );
    frame();
    const grid = screen.getByTestId("grid");
    expect(grid.getAttribute("aria-hidden")).toBe("true");
    // 100 px per second: sixteenths are 12.5 px apart. A grid has no start, so the tile in view (0 … 10.24 s)
    // has one on each side: 81 + 82 + 82 lines.
    expect(drawn.tiles).toBe(3);
    expect(drawn.columns).toBe(245);
    expect(grid.querySelector("canvas")!.style.translate).toBe("calc((0 - var(--timeline-start)) * var(--timeline-scale)) 0");
  });

  test("a grid made again with the same steps draws nothing again", () => {
    const { rerender } = render(
      <Timeline.Root start={0} end={10}>
        <Timeline.Grid grid={musicalGrid({ bpm: 120 })} />
      </Timeline.Root>,
    );
    frame();
    drawn.tiles = 0;
    rerender(
      <Timeline.Root start={0} end={10}>
        <Timeline.Grid grid={musicalGrid({ bpm: 120 })} />
      </Timeline.Root>,
    );
    frame();
    expect(drawn.tiles).toBe(0);
    rerender(
      <Timeline.Root start={0} end={10}>
        <Timeline.Grid grid={musicalGrid({ bpm: 90 })} />
      </Timeline.Root>,
    );
    frame();
    expect(drawn.tiles).toBeGreaterThan(0);
  });
});

describe("Timeline.Ruler", () => {
  const labels = () => [...screen.getByTestId("ruler").querySelectorAll("[data-label]")].map((label) => label.textContent);

  function Ruler({ view }: { view: [number, number] }) {
    return (
      <Timeline.Root start={view[0]} end={view[1]}>
        <Timeline.Ruler grid={musicalGrid({ bpm: 120, locale: "en" })} data-testid="ruler" />
      </Timeline.Root>
    );
  }

  test("labels every step that leaves the spacing, for the view and half a view on each side", () => {
    render(<Ruler view={[0, 10]} />);
    // 100 px per second: bars (200 px) are the finest step 64 px apart; -5 … 15 s.
    expect(labels()).toEqual(["-1", "0", "1", "2", "3", "4", "5", "6", "7", "8"]);
    const label = screen.getByTestId("ruler").querySelector("[data-label]") as HTMLElement;
    expect(label.style.translate).toBe("calc((-4 - var(--timeline-start)) * var(--timeline-scale)) 0");
    expect(screen.getByTestId("ruler").getAttribute("aria-hidden")).toBe("true");
  });

  test("scrolling within that stretch changes no label; zooming in labels beats", () => {
    const { rerender } = render(<Ruler view={[0, 10]} />);
    const first = screen.getByTestId("ruler").querySelector("[data-label]");
    rerender(<Ruler view={[3, 13]} />);
    expect(screen.getByTestId("ruler").querySelector("[data-label]")).toBe(first);
    rerender(<Ruler view={[0, 2]} />);
    expect(labels()).toContain("1.2");
  });

  test("a clock grid reads minutes and seconds", () => {
    render(
      <Timeline.Root start={0} end={100}>
        <Timeline.Ruler grid={clockGrid({ locale: "en" })} data-testid="ruler" />
      </Timeline.Root>,
    );
    // 10 px per second: 10 s steps.
    expect(labels()).toContain("1:10");
  });
});

describe("recording", () => {
  test("a waveform of growing peaks widens and draws only what arrived", () => {
    const recorder = createPeaksRecorder({ sampleRate: 1000, channels: 1, samplesPerPeak: 10 });
    recorder.append([new Float32Array(2000).fill(0.5)]);
    render(
      <Timeline.Root start={0} end={10}>
        <Region.Root at={0} read={() => ({ duration: recorder.duration })} data-testid="region">
          <Waveform.Root peaks={recorder}>
            <Waveform.Shape />
          </Waveform.Root>
        </Region.Root>
      </Timeline.Root>,
    );
    frame();
    expect(screen.getByTestId("region").style.width).toBe("calc(2 * var(--timeline-scale))");
    drawn.tiles = 0;
    recorder.append([new Float32Array(500).fill(-0.5)]);
    recorder.append([new Float32Array(500).fill(-0.5)]);
    frame();
    // Both blocks in one frame: one tile, the one they fell into.
    expect(drawn.tiles).toBe(1);
    expect(screen.getByTestId("region").style.width).toBe("calc(3 * var(--timeline-scale))");
  });
});

describe("zoomed in beyond the peaks", () => {
  // One second at 48 kHz of a sine 20 samples long: a bucket of the finest level (256 samples) holds a dozen cycles.
  const sine = new Float32Array(48_000).map((_, index) => Math.sin((index * Math.PI) / 10));
  const peaks = createPeaks([sine], 48_000);

  function Zoomed({ samples }: { samples?: Float32Array[] }) {
    // 1000 px for 10 ms: two pixels per sample.
    return (
      <Timeline.Root start={0.5} end={0.51}>
        <Region.Root at={0} duration={1}>
          <Waveform.Root peaks={peaks} samples={samples}>
            <Waveform.Shape />
          </Waveform.Root>
        </Region.Root>
      </Timeline.Root>
    );
  }
  const steps = () => new Set(drawn.tops.slice(0, 512).map((top) => Math.round(top * 1000))).size;

  test("without the samples, the peaks show as steps", () => {
    render(<Zoomed />);
    frame();
    // 512 columns fall into two buckets.
    expect(steps()).toBeLessThanOrEqual(3);
  });

  test("with the samples, the cycles are drawn as a line", () => {
    render(<Zoomed samples={[sine]} />);
    frame();
    expect(steps()).toBeGreaterThan(50);
  });
});
