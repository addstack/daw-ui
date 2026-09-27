"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type Ref } from "react";

import { RegionPlacement, useOptionalRegion } from "./region.js";
import { TimeTiles, type TilePainter, type TileStretch } from "./time-tiles.js";
import { useOptionalTimeline, useTimelineView, type TimelineView } from "./timeline.js";
import { useIsomorphicLayoutEffect } from "./value-control.js";

// What a waveform and notes share: content drawn in time, in canvas tiles, either
// in a region on a timeline, or on its own axis as a preview.

export type ContentState = { offset: number; duration: number };

export type ContentAxisOptions = {
  /** Seconds of content there are. */
  length: () => number;
  offset: number;
  duration: number | undefined;
  position: number | undefined;
  read: (() => number) | undefined;
  /** For content that grows, as audio being recorded: calls the listener when it does. */
  subscribe?: ((listener: () => void) => () => void) | undefined;
};

export type ContentAxis = {
  view: TimelineView;
  placement: RegionPlacement;
  state: ContentState;
  /** For the root element: on its own, it is the axis. */
  root: { ref?: Ref<HTMLElement>; style: CSSProperties };
};

/**
 * The axis content is drawn on. In a region, the region's: its `offset` for
 * its `duration`, where it is on the timeline. On a timeline outside a
 * region, the timeline's, from its second 0, which is `offset` in the
 * content, for `duration` (by default, for ever: an automation lane). On its
 * own, its own axis: `offset` … `offset + duration` of the content across its
 * width, with its own playhead from `position` or `read`, in seconds of the
 * content.
 */
export function useContentAxis({ length, offset, duration, position, read, subscribe }: ContentAxisOptions): ContentAxis {
  const region = useOptionalRegion();
  const timeline = useOptionalTimeline();
  const own = region === null && timeline === null;
  const shown = () => (own ? (duration ?? Math.max(0, length() - offset)) : (duration ?? Infinity));

  // On its own, 0 … the duration shown across its width, where 0 is `offset` in the content.
  const axis = useTimelineView(
    {
      start: 0,
      end: Math.max(shown(), 0.001),
      position: (position ?? offset) - offset,
      read: read && (() => read() - offset),
    },
    own,
  );
  const [ownPlacement] = useState(() => new RegionPlacement(0, shown(), offset));
  useIsomorphicLayoutEffect(() => ownPlacement.set(0, shown(), offset));

  // Content that grows lengthens it on its own, without rendering.
  useEffect(() => {
    if (!own || duration !== undefined || !subscribe) return;
    return subscribe(() => {
      ownPlacement.set(0, shown(), offset);
      axis.view.set(0, Math.max(shown(), 0.001));
    });
  });

  if (region) {
    const { placement } = region;
    return {
      view: region.view,
      placement,
      state: { offset: placement.offset, duration: placement.duration },
      root: { style: { position: "relative", overflow: "hidden" } },
    };
  }
  if (timeline) {
    return {
      view: timeline.view,
      placement: ownPlacement,
      state: { offset, duration: shown() },
      root: { style: { position: "relative", overflow: "hidden" } },
    };
  }
  return {
    view: axis.view,
    placement: ownPlacement,
    state: { offset, duration: shown() },
    root: { ref: axis.ref, style: { position: "relative", overflow: "hidden", ...axis.style } },
  };
}

/**
 * Paints content that is placed like a region's: tiles in seconds of the
 * content, so that moving or trimming the region only places them again,
 * and draws only what comes into view.
 */
export abstract class ContentPainter<S> implements TilePainter {
  constructor(
    public source: S,
    protected readonly view: TimelineView,
    protected readonly placement: RegionPlacement,
  ) {}

  abstract extent(): { from: number; to: number };

  abstract paint(context: CanvasRenderingContext2D, stretch: TileStretch): void;

  shown() {
    const { duration, offset } = this.placement;
    return { from: offset, to: offset + duration };
  }

  inView() {
    const { at, duration, offset } = this.placement;
    return { from: Math.max(offset, this.view.start - at + offset), to: Math.min(offset + duration, this.view.end - at + offset) };
  }

  place(start: number) {
    return String(start - this.placement.offset);
  }
}

export type ContentKind<S> = {
  /** Whether two sources draw the same: a render with the same draws nothing again. */
  same(a: S, b: S): boolean;
  /** For content that changes from a time on, as audio arriving: calls `changed` with that time. */
  changes?(source: S, changed: (from: number) => void): (() => void) | undefined;
};

/** Tiles of content, which follow it as it changes and its placement as it moves. */
class ContentDrawing<S> {
  private readonly tiles: TimeTiles;
  private stopChanges: (() => void) | undefined;
  private readonly stopPlacement: () => void;

  constructor(
    element: HTMLElement,
    view: TimelineView,
    placement: RegionPlacement,
    private readonly painter: ContentPainter<S>,
    private readonly kind: ContentKind<S>,
  ) {
    this.tiles = new TimeTiles(element, view, painter);
    this.listen();
    // Moving, trimming or lengthening the region draws nothing already drawn: a new offset places the tiles again,
    // and the change of what is in view draws what comes into it.
    let offset = placement.offset;
    this.stopPlacement = placement.subscribe(() => {
      if (placement.offset !== offset) {
        offset = placement.offset;
        this.tiles.reposition();
      }
      this.tiles.cull();
    });
  }

  update(source: S): void {
    const previous = this.painter.source;
    this.painter.source = source;
    if (this.kind.same(previous, source)) {
      this.tiles.cull();
      return;
    }
    this.listen();
    this.tiles.reset();
  }

  destroy(): void {
    this.stopChanges?.();
    this.stopPlacement();
    this.tiles.destroy();
  }

  private listen(): void {
    this.stopChanges?.();
    // Content that changes is drawn again from where it changed.
    this.stopChanges = this.kind.changes?.(this.painter.source, (from) => this.tiles.invalidate(from));
  }
}

/** Keeps canvas tiles drawing `source` inside the part's element. */
export function useContentDrawing<S>(
  { view, placement }: ContentAxis,
  source: S,
  createPainter: (source: S, view: TimelineView, placement: RegionPlacement) => ContentPainter<S>,
  kind: ContentKind<S>,
) {
  const latest = useRef(source);
  latest.current = source;
  const drawing = useRef<ContentDrawing<S> | null>(null);
  const create = useRef(createPainter);
  create.current = createPainter;
  const kindRef = useRef(kind);
  kindRef.current = kind;

  const ref = useCallback(
    (element: HTMLElement | null) => {
      if (!element) return;
      const current = new ContentDrawing(element, view, placement, create.current(latest.current, view, placement), kindRef.current);
      drawing.current = current;
      return () => {
        current.destroy();
        drawing.current = null;
      };
    },
    [view, placement],
  );
  // A render with other content draws again; any other render does not.
  useIsomorphicLayoutEffect(() => {
    drawing.current?.update(latest.current);
  });
  return ref;
}

/**
 * Clips a progress layer to the part before the playhead, for content that
 * starts `at` seconds on the timeline: the numbers written in, no CSS
 * variable of its own.
 */
const playedClip = (at: number, position: number) =>
  `inset(0 max(0px, calc(100% - ${position - at} * var(--timeline-scale))) 0 0)`;

/**
 * A progress layer's clip at the playhead: a ref that rewrites it as the
 * playhead and the region move, without rendering, and its value now.
 */
export function usePlayedClip({ view, placement }: ContentAxis) {
  const ref = useCallback(
    (element: HTMLElement | null) => {
      if (!element) return;
      const clip = () => {
        const clipPath = playedClip(placement.at, view.position);
        if (element.style.clipPath !== clipPath) element.style.clipPath = clipPath;
      };
      const stopFollowing = view.follow(clip);
      const stopListening = placement.subscribe(clip);
      return () => {
        stopFollowing();
        stopListening();
      };
    },
    [placement, view],
  );
  return { ref, clipPath: playedClip(placement.at, view.position) };
}
