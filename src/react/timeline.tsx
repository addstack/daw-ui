"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties } from "react";

import type { TimeGrid, ValueFormat } from "../core/index.js";
import { onEveryFrame } from "./frame-loop.js";
import { useMergedRef, useRenderPart, type PartProps } from "./render.js";
import {
  TimelineEditing,
  TrackEntry,
  type RegionChange,
  type RegionEntry,
  type RegionsChangeDetails,
  type SelectionChangeDetails,
} from "./timeline-editing.js";
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
  /** The playhead, in seconds. */
  position = 0;
  private listeners = new Set<() => void>();
  private readonly followers = new Set<(position: number) => void>();

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

  /**
   * Calls `write` with the playhead now and whenever it moves, until the
   * returned function is called. The parts that follow the playhead write
   * it into their own CSS, with the number written in: no CSS variable, so
   * that a frame of playback recalculates the style of those parts alone,
   * and the rest of the timeline carries nothing extra when it scrolls.
   */
  follow(write: (position: number) => void): () => void {
    this.followers.add(write);
    write(this.position);
    return () => {
      this.followers.delete(write);
    };
  }

  setPosition(position: number): void {
    if (position === this.position) return;
    this.position = position;
    for (const write of this.followers) write(position);
  }

  set(start: number, end: number, width = this.width): void {
    if (start === this.start && end === this.end && width === this.width) return;
    if (!(end > start)) throw new RangeError(`A timeline's end (${end}) must be after its start (${start}).`);
    this.start = start;
    this.end = end;
    this.width = width;
    for (const listener of this.listeners) listener();
  }
}

type TimelineContextValue = { view: TimelineView; editing: TimelineEditing };

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
 * measured before the first paint, `--timeline-start` and
 * `--timeline-scale` written to it, and the playhead for the parts that
 * follow it. The timeline root uses it, and so does a waveform on its own. Without `enabled`, it
 * writes nothing and reads nothing.
 */
export function useTimelineView({ start, end, readView, position = 0, read }: TimelineViewOptions, enabled = true) {
  const [view] = useState(() => {
    const created = new TimelineView(start, end);
    // Known before the first render, so that the parts that follow the playhead render it, also on the server.
    created.position = position;
    return created;
  });
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

  // The playhead: from props, or with `read`, once per frame; written only on the parts that follow it.
  useIsomorphicLayoutEffect(() => {
    if (enabled && read === undefined) view.setPosition(position);
  });
  const readRef = useRef(read);
  readRef.current = read;
  const reads = enabled && read !== undefined;
  useEffect(() => {
    if (!reads) return;
    return onEveryFrame(() => view.setPosition(readRef.current?.() ?? 0));
  }, [reads, view]);

  const ref = useMergedRef(element, enabled ? measure : undefined);
  const style = { "--timeline-start": String(view.start), "--timeline-scale": `${view.scale}px` } as CSSProperties;
  return { view, ref, style };
}

/**
 * A time axis shared by what is placed on it: tracks of regions, a ruler,
 * a grid, and one playhead over all of them. Time runs left to right, in
 * every language.
 *
 * Sets `--timeline-start` (seconds at the left edge) and `--timeline-scale`
 * (CSS pixels per second) on its element, and parts place themselves with
 * these in CSS: scrolling or zooming writes two variables, whatever the
 * number of regions. The playhead is written only into the parts that
 * follow it. Nothing renders.
 */
export function TimelineRoot({
  start,
  end,
  readView,
  position,
  read,
  snap,
  selected,
  defaultSelected,
  onSelectedChange,
  onRegionsChange,
  onGestureStart,
  onGestureEnd,
  format,
  ...props
}: TimelineRoot.Props) {
  const axis = useTimelineView({ start, end, readView, position, read });
  const [editing] = useState(() => {
    const created = new TimelineEditing(axis.view);
    created.setSelection(selected ?? defaultSelected ?? []);
    return created;
  });
  editing.options = { snap, onRegionsChange, onGestureStart, onGestureEnd, onSelectedChange, selected, format };
  editing.editable = onRegionsChange !== undefined;
  useIsomorphicLayoutEffect(() => {
    if (selected !== undefined) editing.setSelection(selected);
  });

  const root = useCallback(
    (element: HTMLElement | null) => {
      editing.root = element;
    },
    [editing],
  );
  const ref = useMergedRef(axis.ref, root);
  const state: TimelineState = { start, end };
  const rendered = useRenderPart("div", state, props, {
    ref,
    // Editable, the tracks are rows of regions, one tab stop for them all, and arrows between them.
    ...(editing.editable ? { role: "grid", "aria-multiselectable": true } : {}),
    style: { position: "relative", ...axis.style },
  });
  return <TimelineContext.Provider value={{ view: axis.view, editing }}>{rendered}</TimelineContext.Provider>;
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
    /**
     * Makes regions editable: called with where the regions of a gesture
     * go, as it goes (a drag, a key), with the `value` of each region and of
     * its track. Regions show where they go without rendering; when the
     * gesture ends they return to their props, so update them to keep the
     * changes, here or in `onGestureEnd`.
     */
    onRegionsChange?: ((changes: RegionChange[], details: RegionsChangeDetails) => void) | undefined;
    /** Called before the first change of a gesture on regions. */
    onGestureStart?: (() => void) | undefined;
    /** Called when a gesture on regions ends, with its last changes: one undo step. */
    onGestureEnd?: ((changes: RegionChange[]) => void) | undefined;
    /**
     * Moves and trims snap to the finest lines of this grid at least 12 px
     * apart, those of a `Timeline.Grid` with its default spacing; Shift
     * does not snap.
     */
    snap?: TimeGrid | undefined;
    /** The `value`s of the selected regions, when controlled. */
    selected?: readonly string[] | undefined;
    /** The `value`s of the regions selected at first, when uncontrolled. */
    defaultSelected?: readonly string[] | undefined;
    /** Called with the selection a press or a key makes. */
    onSelectedChange?: ((selected: string[], details: SelectionChangeDetails) => void) | undefined;
    /**
     * Text of a time in seconds, for what a region's handles announce, such
     * as a song position.
     * @default formats.number({ digits: 2, unit: "s" })
     */
    format?: ValueFormat | undefined;
  };
}

/** Where the playhead line sits, with the playhead's seconds written in. */
const playheadAt = (position: number) => `calc((${position} - var(--timeline-start)) * var(--timeline-scale)) 0`;

/** A line at the playhead, across everything on the timeline. Hidden from assistive technology. */
export function TimelinePlayhead(props: TimelinePlayhead.Props) {
  const { view } = useTimelineContext("Timeline.Playhead");
  const follow = useCallback(
    (element: HTMLElement | null) => {
      if (!element) return;
      return view.follow((position) => {
        const translate = playheadAt(position);
        if (element.style.translate !== translate) element.style.translate = translate;
      });
    },
    [view],
  );
  return useRenderPart("div", { start: view.start, end: view.end }, props, {
    ref: follow,
    "aria-hidden": true,
    style: { position: "absolute", insetBlock: 0, left: 0, translate: playheadAt(view.position) },
  });
}

export namespace TimelinePlayhead {
  export type State = TimelineState;
  export type Props = PartProps<"div", State>;
}

type TrackContextValue = { track: TrackEntry | null };

const TrackContext = createContext<TrackContextValue>({ track: null });

/** The track around a region, if there is one. */
export const useTrack = () => useContext(TrackContext).track;

/**
 * A row of the timeline, such as one track of an arrangement, that holds
 * its regions: a `group`, or a `row` when regions are editable. Name it with
 * `aria-label`, in the application's language. It spans the timeline's
 * width, so that regions in it line up with the axis. A press on it outside
 * its regions clears the selection.
 */
export function TimelineTrack({ value, ...props }: TimelineTrack.Props) {
  const { view, editing } = useTimelineContext("Timeline.Track");
  const [track, setTrack] = useState<TrackEntry | null>(null);
  const register = useCallback(
    (element: HTMLElement | null) => {
      if (!element) return;
      const entry = new TrackEntry(value, element);
      setTrack(entry);
      const remove = editing.addTrack(entry);
      return () => {
        remove();
        setTrack(null);
      };
    },
    [editing, value],
  );
  const rendered = useRenderPart("div", { start: view.start, end: view.end }, props, {
    ref: register,
    role: editing.editable ? "row" : "group",
    style: { position: "relative" },
    onPointerDown: (event: { target: EventTarget; nativeEvent: PointerEvent }) => {
      if (!(event.target instanceof Element) || !event.target.closest("[data-region]")) editing.pressTrack(event.nativeEvent);
    },
  });
  return <TrackContext.Provider value={{ track }}>{rendered}</TrackContext.Provider>;
}

export namespace TimelineTrack {
  export type State = TimelineState;
  export type Props = PartProps<"div", State> & {
    /** Names the track in the changes a gesture reports, when regions move between tracks. */
    value?: string | undefined;
  };
}

/** Where a region is, outside React: parts inside follow it without rendering. */
export class RegionPlacement {
  /** CSS pixels up or down, while a gesture moves the region towards another track. */
  lift = 0;
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

  set(at: number, duration: number, offset: number, lift = this.lift): void {
    if (at === this.at && duration === this.duration && offset === this.offset && lift === this.lift) return;
    this.at = at;
    this.duration = duration;
    this.offset = offset;
    this.lift = lift;
    for (const listener of this.listeners) listener();
  }
}

export type RegionContextValue = { view: TimelineView; placement: RegionPlacement; entry: RegionEntry; editing: TimelineEditing };

export const RegionContext = createContext<RegionContextValue | null>(null);

export function useRegionContext(part: string): RegionContextValue {
  const context = useContext(RegionContext);
  if (!context) throw new Error(`<${part}> must be placed inside <Timeline.Region>.`);
  return context;
}

/** The region around a part, if there is one. */
export const useOptionalRegion = () => useContext(RegionContext);

export type RegionState = { at: number; duration: number; offset: number };

export type RegionValue = Partial<RegionState>;
