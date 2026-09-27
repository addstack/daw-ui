"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties } from "react";

import { onEveryFrame } from "./frame-loop.js";
import { useMergedRef, useRenderPart, type PartProps } from "./render.js";
import { useIsomorphicLayoutEffect } from "./value-control.js";

/**
 * The visible time of a timeline and its width, outside React. Waveforms
 * subscribe to draw what comes into view; everything else follows the CSS
 * variables the root writes.
 */
export class TimelineView {
  start: number;
  end: number;
  /** CSS pixels. */
  width = 0;
  private listeners = new Set<() => void>();

  constructor(start: number, end: number) {
    this.start = start;
    this.end = end;
  }

  /** CSS pixels per second; 0 until the timeline is measured. */
  get scale(): number {
    return this.width / (this.end - this.start) || 0;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  set(start: number, end: number, width = this.width): void {
    if (start === this.start && end === this.end && width === this.width) return;
    if (!(end > start)) throw new RangeError(`A timeline's end (${end}) must be after its start (${start}).`);
    this.start = start;
    this.end = end;
    this.width = width;
    for (const listener of this.listeners) listener();
  }
}

type TimelineContextValue = { view: TimelineView };

const TimelineContext = createContext<TimelineContextValue | null>(null);

export function useTimelineContext(part: string): TimelineContextValue {
  const context = useContext(TimelineContext);
  if (!context) throw new Error(`<${part}> must be placed inside <Timeline.Root>.`);
  return context;
}

export type TimelineState = { start: number; end: number };

/**
 * Where content that lasts `duration` seconds from `at` sits on the
 * timeline: all in CSS, from the root's variables, so that scrolling and
 * zooming move every item without running code for it.
 */
export function placement(at: number, duration: number): CSSProperties {
  return {
    position: "absolute",
    insetBlock: 0,
    left: 0,
    width: `calc(${duration} * var(--timeline-scale))`,
    translate: `calc((${at} - var(--timeline-start)) * var(--timeline-scale)) 0`,
  };
}

/**
 * A time axis shared by what is placed on it: waveforms, clips, markers and
 * one playhead over all of them. Time runs left to right, in every language.
 *
 * Sets `--timeline-start` (seconds at the left edge), `--timeline-scale`
 * (CSS pixels per second) and `--timeline-position` (seconds) on its
 * element. Parts place themselves with these in CSS: playback writes one
 * variable per frame, and scrolling or zooming two, whatever the number of
 * items; nothing renders.
 */
export function TimelineRoot({ start, end, readView, position = 0, read, ...props }: TimelineRoot.Props) {
  const [view] = useState(() => new TimelineView(start, end));
  const element = useRef<HTMLElement | null>(null);

  const writeView = useCallback(() => {
    const style = element.current?.style;
    if (!style) return;
    style.setProperty("--timeline-start", String(view.start));
    style.setProperty("--timeline-scale", `${view.scale}px`);
  }, [view]);
  // Subscribed before the view is first set below, so that the measured width reaches CSS before the first paint.
  useIsomorphicLayoutEffect(() => {
    writeView();
    return view.subscribe(writeView);
  }, [view, writeView]);

  // The view from props, and the width measured once before the first paint; the observer follows it after.
  useIsomorphicLayoutEffect(() => {
    view.set(start, end, view.width || element.current?.clientWidth || 0);
  }, [view, start, end]);

  const measure = useCallback(
    (node: HTMLElement | null) => {
      if (!node || typeof ResizeObserver === "undefined") return;
      // The padding box, which absolutely placed items fill.
      const observer = new ResizeObserver(() => view.set(view.start, view.end, node.clientWidth));
      observer.observe(node);
      return () => observer.disconnect();
    },
    [view],
  );

  const readViewRef = useRef(readView);
  readViewRef.current = readView;
  const readsView = readView !== undefined;
  useEffect(() => {
    if (!readsView) return;
    return onEveryFrame(() => {
      const next = readViewRef.current?.();
      if (next) view.set(next[0], next[1]);
    });
  }, [readsView, view]);

  const readRef = useRef(read);
  readRef.current = read;
  const reads = read !== undefined;
  useEffect(() => {
    if (!reads) return;
    return onEveryFrame(() => {
      const style = element.current?.style;
      const next = String(readRef.current?.() ?? 0);
      if (style && style.getPropertyValue("--timeline-position") !== next) style.setProperty("--timeline-position", next);
    });
  }, [reads]);

  const ref = useMergedRef(element, measure);
  const state: TimelineState = { start, end };
  const rendered = useRenderPart("div", state, props, {
    ref,
    style: {
      position: "relative",
      "--timeline-start": String(view.start),
      "--timeline-scale": `${view.scale}px`,
      // With `read`, the frame loop writes it after this first value.
      "--timeline-position": String(position),
    } as CSSProperties,
  });
  return <TimelineContext.Provider value={{ view }}>{rendered}</TimelineContext.Provider>;
}

export namespace TimelineRoot {
  export type State = TimelineState;
  export type Props = PartProps<"div", State> & {
    /** Seconds at the left edge. */
    start: number;
    /** Seconds at the right edge: `end − start` seconds fill the width. */
    end: number;
    /**
     * Returns `[start, end]`; called once per animation frame, for scrolling
     * and zooming that follow a gesture or the playhead without rendering.
     */
    readView?: (() => readonly [start: number, end: number]) | undefined;
    /**
     * The playhead, in seconds, when it changes rarely. For playback, use `read`.
     * @default 0
     */
    position?: number | undefined;
    /** Returns the playhead in seconds; called once per animation frame. */
    read?: (() => number) | undefined;
  };
}

/** A line at the playhead, across everything on the timeline. Hidden from assistive technology. */
export function TimelinePlayhead(props: TimelinePlayhead.Props) {
  const { view } = useTimelineContext("Timeline.Playhead");
  return useRenderPart("div", { start: view.start, end: view.end }, props, {
    "aria-hidden": true,
    style: {
      position: "absolute",
      insetBlock: 0,
      left: 0,
      translate: "calc((var(--timeline-position) - var(--timeline-start)) * var(--timeline-scale)) 0",
    },
  });
}

export namespace TimelinePlayhead {
  export type State = TimelineState;
  export type Props = PartProps<"div", State>;
}

/**
 * Anything that sits on the timeline for a time: a clip's frame, a region,
 * a marker (with no duration). Its width and position follow the view in
 * CSS. Place it in an element that spans the timeline's width.
 */
export function TimelineItem({ at, duration = 0, ...props }: TimelineItem.Props) {
  const { view } = useTimelineContext("Timeline.Item");
  return useRenderPart("div", { start: view.start, end: view.end }, props, { style: placement(at, duration) });
}

export namespace TimelineItem {
  export type State = TimelineState;
  export type Props = PartProps<"div", State> & {
    /** Seconds on the timeline where it starts. */
    at: number;
    /**
     * Seconds it lasts.
     * @default 0
     */
    duration?: number | undefined;
  };
}
