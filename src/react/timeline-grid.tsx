"use client";

import { useCallback, useRef } from "react";

import { gridStep, type TimeGrid } from "../core/index.js";
import { unselectable, useRenderPart, type PartProps } from "./render.js";
import { TimeTiles, type TilePainter, type TileStretch } from "./time-tiles.js";
import { useTimelineContext, type TimelineState, type TimelineView } from "./timeline.js";
import { useIsomorphicLayoutEffect } from "./value-control.js";

/** Paints a line one CSS pixel wide at every step of the grid that leaves `spacing` pixels between lines. */
class GridPainter implements TilePainter {
  constructor(
    public grid: TimeGrid,
    public spacing: number,
  ) {}

  extent() {
    return { from: -Infinity, to: Infinity };
  }

  paint(context: CanvasRenderingContext2D, { start, length, width, height, ratio }: TileStretch): void {
    const pixelsPerSecond = width / length;
    const step = gridStep(this.grid, pixelsPerSecond / ratio, this.spacing);
    const line = Math.max(1, Math.round(ratio));
    for (let index = Math.ceil(start / step); index * step < start + length; index++) {
      context.fillRect(Math.round((index * step - start) * pixelsPerSecond), 0, line, height);
    }
  }
}

const sameSteps = (a: TimeGrid, b: TimeGrid) =>
  a.steps.length === b.steps.length && a.steps.every((step, index) => step === b.steps[index]);

/**
 * Lines at every step of `grid` that leaves at least `spacing` pixels
 * between them, across its element: under the tracks, or as the marks of a
 * ruler. Two grids with different spacings give minor and major lines, and
 * the major ones fall on minor ones. Drawn like waveforms, in tiles, in the
 * element's CSS `color`: scrolling and playback draw nothing.
 */
export function TimelineGrid({ grid, spacing = 12, ...props }: TimelineGrid.Props) {
  const { view } = useTimelineContext("Timeline.Grid");
  const latest = useRef({ grid, spacing });
  latest.current = { grid, spacing };
  const drawing = useRef<{ painter: GridPainter; tiles: TimeTiles } | null>(null);

  const ref = useCallback(
    (element: HTMLElement | null) => {
      if (!element) return;
      const painter = new GridPainter(latest.current.grid, latest.current.spacing);
      const tiles = new TimeTiles(element, view, painter, "view");
      drawing.current = { painter, tiles };
      return () => {
        tiles.destroy();
        drawing.current = null;
      };
    },
    [view],
  );
  // A grid made again with the same steps, as by a render that calls musicalGrid(), draws nothing again.
  useIsomorphicLayoutEffect(() => {
    const current = drawing.current;
    if (!current) return;
    const { painter } = current;
    const changed = !sameSteps(painter.grid, grid) || painter.spacing !== spacing;
    painter.grid = grid;
    painter.spacing = spacing;
    if (changed) current.tiles.reset();
  });

  return useRenderPart("div", { start: view.start, end: view.end }, props, {
    ref,
    "aria-hidden": true,
    style: { position: "absolute", inset: 0, overflow: "hidden" },
  });
}

export namespace TimelineGrid {
  export type State = TimelineState;
  export type Props = Omit<PartProps<"div", State>, "children"> & {
    /** Where lines fall: `musicalGrid({ bpm })`, `clockGrid()`, or your own. */
    grid: TimeGrid;
    /**
     * The least distance between lines, in CSS pixels.
     * @default 12
     */
    spacing?: number | undefined;
  };
}

/**
 * Keeps a label at every step of the grid that leaves `spacing` pixels
 * between labels, for the view and half its width on each side. Labels
 * are placed in time in CSS, so scrolling moves them without work; the set
 * changes only when the view leaves that stretch or the zoom changes the step.
 */
class RulerLabels {
  private readonly holder: HTMLDivElement;
  private readonly labels = new Map<number, HTMLSpanElement>();
  private step = 0;
  private covered: [number, number] | null = null;
  private readonly unsubscribe: () => void;

  constructor(
    element: HTMLElement,
    private readonly view: TimelineView,
    public grid: TimeGrid,
    public spacing: number,
  ) {
    this.holder = element.ownerDocument.createElement("div");
    this.holder.style.cssText = "position:absolute;inset:0";
    element.append(this.holder);
    this.unsubscribe = view.subscribe(() => this.update());
    this.update();
  }

  /** Labels as they should be now; `relabel` writes every text again, for another grid. */
  update(relabel = false): void {
    const { start, end, scale } = this.view;
    if (!(scale > 0)) return;
    const step = gridStep(this.grid, scale, this.spacing);
    if (step !== this.step) {
      for (const label of this.labels.values()) label.remove();
      this.labels.clear();
      this.step = step;
      this.covered = null;
    }
    if (relabel) {
      for (const [index, label] of this.labels) {
        const text = this.grid.label(index * step, step);
        if (label.textContent !== text) label.textContent = text;
      }
    }
    if (this.covered && start >= this.covered[0] && end <= this.covered[1]) return;
    const margin = (end - start) / 2;
    this.covered = [start - margin, end + margin];
    const first = Math.ceil(this.covered[0] / step);
    const last = Math.floor(this.covered[1] / step);
    for (const [index, label] of this.labels) {
      if (index < first || index > last) {
        label.remove();
        this.labels.delete(index);
      }
    }
    for (let index = first; index <= last; index++) {
      if (this.labels.has(index)) continue;
      const label = this.holder.ownerDocument.createElement("span");
      label.setAttribute("data-label", "");
      // `translate`, not `left`, so that scrolling moves labels without layout.
      label.style.cssText = `position:absolute;left:0;white-space:nowrap;translate:calc((${index * step} - var(--timeline-start)) * var(--timeline-scale)) 0`;
      label.textContent = this.grid.label(index * step, step);
      this.holder.append(label);
      this.labels.set(index, label);
    }
  }

  destroy(): void {
    this.unsubscribe();
    this.holder.remove();
  }
}

/**
 * The labels of a time ruler: a `span` with `data-label` at every step of
 * `grid` that leaves at least `spacing` pixels between labels, starting at
 * its line. Style the labels with CSS (`[&_[data-label]]:ps-1`), and put a
 * `Timeline.Grid` inside for marks. Hidden from assistive technology, as
 * the playhead is.
 */
export function TimelineRuler({ grid, spacing = 64, children, ...props }: TimelineRuler.Props) {
  const { view } = useTimelineContext("Timeline.Ruler");
  const latest = useRef({ grid, spacing });
  latest.current = { grid, spacing };
  const labels = useRef<RulerLabels | null>(null);

  const ref = useCallback(
    (element: HTMLElement | null) => {
      if (!element) return;
      const current = new RulerLabels(element, view, latest.current.grid, latest.current.spacing);
      labels.current = current;
      return () => {
        current.destroy();
        labels.current = null;
      };
    },
    [view],
  );
  useIsomorphicLayoutEffect(() => {
    const current = labels.current;
    if (!current || (current.grid === grid && current.spacing === spacing)) return;
    const relabel = current.grid !== grid;
    current.grid = grid;
    current.spacing = spacing;
    current.update(relabel);
  });

  return useRenderPart("div", { start: view.start, end: view.end }, { ...props, children }, {
    ref,
    "aria-hidden": true,
    style: { ...unselectable, position: "relative", overflow: "hidden" },
  });
}

export namespace TimelineRuler {
  export type State = TimelineState;
  export type Props = PartProps<"div", State> & {
    /** Where labels fall and what they read: `musicalGrid({ bpm })`, `clockGrid()`, or your own. */
    grid: TimeGrid;
    /**
     * The least distance between labels, in CSS pixels. A `Timeline.Grid`
     * with the same spacing draws a line at every label.
     * @default 64
     */
    spacing?: number | undefined;
  };
}
