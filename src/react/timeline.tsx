"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties } from "react";

import { onEveryFrame } from "./frame-loop.js";
import { useMergedRef, useRenderPart, type PartProps } from "./render.js";
import { useIsomorphicLayoutEffect } from "./value-control.js";

/**
 * The visible time of a timeline and its width, outside React. Tiled
 * drawings subscribe to draw what comes into view; everything else follows
 * the CSS variables the root writes.
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

/** The timeline around a part, if there is one. */
export const useOptionalTimeline = () => useContext(TimelineContext);

export type TimelineState = { start: number; end: number };

export type TimelineViewOptions = {
  start: number;
  end: number;
  readView?: (() => readonly [start: number, end: number]) | undefined;
  position?: number | undefined;
  read?: (() => number) | undefined;
};

/**
 * A time axis on an element: the view outside React, the element's width
 * measured before the first paint, and `--timeline-start`,
 * `--timeline-scale` and `--timeline-position` written to it. The timeline
 * root uses it, and so does a waveform on its own. Without `enabled`, it
 * writes nothing and reads nothing.
 */
export function useTimelineView({ start, end, readView, position = 0, read }: TimelineViewOptions, enabled = true) {
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
    if (enabled) view.set(start, end, view.width || element.current?.clientWidth || 0);
  }, [view, start, end, enabled]);

  const measure = useCallback(
    (node: HTMLElement | null) => {
      if (!node || typeof ResizeObserver === "undefined") return;
      // The padding box, which absolutely placed parts fill.
      const observer = new ResizeObserver(() => view.set(view.start, view.end, node.clientWidth));
      observer.observe(node);
      return () => observer.disconnect();
    },
    [view],
  );

  const readViewRef = useRef(readView);
  readViewRef.current = readView;
  const readsView = enabled && readView !== undefined;
  useEffect(() => {
    if (!readsView) return;
    return onEveryFrame(() => {
      const next = readViewRef.current?.();
      if (next) view.set(next[0], next[1]);
    });
  }, [readsView, view]);

  const readRef = useRef(read);
  readRef.current = read;
  const reads = enabled && read !== undefined;
  useEffect(() => {
    if (!reads) return;
    return onEveryFrame(() => {
      const style = element.current?.style;
      const next = String(readRef.current?.() ?? 0);
      if (style && style.getPropertyValue("--timeline-position") !== next) style.setProperty("--timeline-position", next);
    });
  }, [reads]);

  const ref = useMergedRef(element, enabled ? measure : undefined);
  const style = {
    "--timeline-start": String(view.start),
    "--timeline-scale": `${view.scale}px`,
    // With `read`, the frame loop writes it after this first value.
    "--timeline-position": String(position),
  } as CSSProperties;
  return { view, ref, style };
}

/**
 * A time axis shared by what is placed on it: tracks of regions, a ruler,
 * a grid, and one playhead over all of them. Time runs left to right, in
 * every language.
 *
 * Sets `--timeline-start` (seconds at the left edge), `--timeline-scale`
 * (CSS pixels per second) and `--timeline-position` (seconds) on its
 * element. Parts place themselves with these in CSS: playback writes one
 * variable per frame, and scrolling or zooming two, whatever the number of
 * regions; nothing renders.
 */
export function TimelineRoot({ start, end, readView, position, read, ...props }: TimelineRoot.Props) {
  const axis = useTimelineView({ start, end, readView, position, read });
  const state: TimelineState = { start, end };
  const rendered = useRenderPart("div", state, props, { ref: axis.ref, style: { position: "relative", ...axis.style } });
  return <TimelineContext.Provider value={{ view: axis.view }}>{rendered}</TimelineContext.Provider>;
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
 * A row of the timeline, such as one track of an arrangement, that holds
 * its regions. A `group`: name it with `aria-label`, in the application's
 * language. It spans the timeline's width, so that regions in it line up
 * with the axis.
 */
export function TimelineTrack(props: TimelineTrack.Props) {
  const { view } = useTimelineContext("Timeline.Track");
  return useRenderPart("div", { start: view.start, end: view.end }, props, {
    role: "group",
    style: { position: "relative" },
  });
}

export namespace TimelineTrack {
  export type State = TimelineState;
  export type Props = PartProps<"div", State>;
}

/** Where a region is, outside React: parts inside follow it without rendering. */
export class RegionPlacement {
  private listeners = new Set<() => void>();

  constructor(
    public at: number,
    public duration: number,
    public offset: number,
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  set(at: number, duration: number, offset: number): void {
    if (at === this.at && duration === this.duration && offset === this.offset) return;
    this.at = at;
    this.duration = duration;
    this.offset = offset;
    for (const listener of this.listeners) listener();
  }
}

type RegionContextValue = { view: TimelineView; placement: RegionPlacement };

const RegionContext = createContext<RegionContextValue | null>(null);

/** The region around a part, if there is one. */
export const useOptionalRegion = () => useContext(RegionContext);

export type RegionState = { at: number; duration: number; offset: number };

export type RegionValue = Partial<RegionState>;

/**
 * The CSS that places a region, with its numbers written in: no CSS
 * variables of its own, because every element that defines some costs a
 * style recalculation each time the playhead's variable changes above it.
 */
const regionStyle = ({ at, duration }: Pick<RegionState, "at" | "duration">) => ({
  width: `calc(${duration} * var(--timeline-scale))`,
  translate: `calc((${at} - var(--timeline-start)) * var(--timeline-scale)) 0`,
});

/**
 * Something that lasts on the timeline: a region, clip or pattern with its
 * content (a waveform, a label), a loop range, a marker with no duration.
 * It starts `at` seconds on the timeline, lasts `duration`, and shows its
 * content from `offset` seconds into it, as a clip that starts later in its
 * file does.
 *
 * It is placed in CSS from the timeline's variables, so scrolling and
 * zooming move it without work; a change of its own placement rewrites its
 * position and width, without rendering what is inside. Place it in a
 * `Timeline.Track`, or another element that spans the timeline's width.
 */
export function TimelineRegion({ at, duration = 0, offset = 0, read, ...props }: TimelineRegion.Props) {
  const { view } = useTimelineContext("Timeline.Region");
  const [placement] = useState(() => new RegionPlacement(at, duration, offset));
  const element = useRef<HTMLElement | null>(null);

  useEffect(
    () =>
      placement.subscribe(() => {
        const style = element.current?.style;
        if (!style) return;
        const { width, translate } = regionStyle(placement);
        if (style.width !== width) style.width = width;
        if (style.translate !== translate) style.translate = translate;
      }),
    [placement],
  );
  useIsomorphicLayoutEffect(() => placement.set(at, duration, offset), [placement, at, duration, offset]);

  const readRef = useRef(read);
  readRef.current = read;
  const reads = read !== undefined;
  useEffect(() => {
    if (!reads) return;
    return onEveryFrame(() => {
      const next = readRef.current?.();
      if (next) placement.set(next.at ?? placement.at, next.duration ?? placement.duration, next.offset ?? placement.offset);
    });
  }, [reads, placement]);

  const ref = useMergedRef(element);
  const state: RegionState = { at, duration, offset };
  const rendered = useRenderPart("div", state, props, {
    ref,
    style: { position: "absolute", insetBlock: 0, left: 0, ...regionStyle(state) },
  });
  return <RegionContext.Provider value={{ view, placement }}>{rendered}</RegionContext.Provider>;
}

export namespace TimelineRegion {
  export type State = RegionState;
  export type Props = PartProps<"div", State> & {
    /** Seconds on the timeline where it starts. */
    at: number;
    /**
     * Seconds it lasts.
     * @default 0
     */
    duration?: number | undefined;
    /**
     * Seconds into its content at its start: a clip that starts later in its file.
     * @default 0
     */
    offset?: number | undefined;
    /**
     * Returns the placement that changes on its own, called once per
     * animation frame: the growing `duration` of a take being recorded.
     */
    read?: (() => RegionValue) | undefined;
  };
}
