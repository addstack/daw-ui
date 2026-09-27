"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { formats } from "../core/index.js";
import { onEveryFrame } from "./frame-loop.js";
import { writeLive, type Live } from "./live.js";
import { dataAttributes, unselectable, useMergedRef, useRenderPart, type PartProps } from "./render.js";
import {
  RegionContext,
  RegionPlacement,
  useRegionContext,
  useTimelineContext,
  useTrack,
  type RegionState,
  type RegionValue,
} from "./timeline.js";
import { RegionEntry, type TimelineEditing } from "./timeline-editing.js";
import { useIsomorphicLayoutEffect } from "./value-control.js";

/**
 * The CSS that places a region, with its numbers written in: no CSS
 * variables of its own, because every element that defines some costs a
 * style recalculation each time the view's variables change above it.
 */
const regionStyle = ({ at, duration, lift }: { at: number; duration: number; lift: number }) => ({
  width: `calc(${duration} * var(--timeline-scale))`,
  translate: `calc((${at} - var(--timeline-start)) * var(--timeline-scale)) ${lift ? `${lift}px` : 0}`,
});

/** The attributes of a region's state that every part shows, without rendering. */
function stateAttributes(editing: TimelineEditing, entry: RegionEntry): Live["attributes"] {
  return {
    "data-selected": editing.isSelected(entry) ? "" : null,
    "data-dragging": editing.isDragging(entry) ? "" : null,
  };
}

/** A ref that keeps a part's state attributes in line with its region. */
function useRegionState(editing: TimelineEditing, entry: RegionEntry, extra?: () => Live["attributes"]) {
  const latest = useRef(extra);
  latest.current = extra;
  return useCallback(
    (element: HTMLElement | null) => {
      if (!element) return;
      const write = () => writeLive(element, { attributes: { ...stateAttributes(editing, entry), ...latest.current?.() } });
      return entry.subscribe(write);
    },
    [editing, entry],
  );
}

const renderedState = (editing: TimelineEditing, entry: RegionEntry) =>
  dataAttributes({ selected: editing.isSelected(entry), dragging: editing.isDragging(entry) });

// Elements inside a region that take presses themselves: a press on them does not move it.
const INTERACTIVE = "button, a[href], input, select, textarea, [contenteditable='true'], [role='button'], [role='menuitem'], [role='slider']";

/**
 * Something that lasts on the timeline: a region, clip or pattern with its
 * header and content, a loop range, a marker with no duration. It starts
 * `at` seconds on the timeline, lasts `duration`, and shows its content from
 * `offset` seconds into it, as a clip that starts later in its file does.
 *
 * It is placed in CSS from the timeline's variables, so scrolling and
 * zooming move it without work; a change of its placement rewrites its
 * position and width without rendering what is inside. Place it in a
 * `Timeline.Track`.
 *
 * With `onRegionsChange` on the timeline and a `value`, it is editable: a
 * press selects it, a drag moves it with the rest of the selection, its
 * handles trim it; it is a `gridcell` named by its `RegionLabel`.
 */
export function TimelineRegion({ value, at, duration = 0, offset = 0, length, read, ...props }: TimelineRegion.Props) {
  const { view, editing } = useTimelineContext("Timeline.Region");
  const track = useTrack();
  const [placement] = useState(() => new RegionPlacement(at, duration, offset));
  const [entry] = useState(() => new RegionEntry(placement, { at, duration, offset }));
  entry.value = value;
  entry.length = length;
  entry.track = track;
  entry.props = { at, duration, offset };
  const element = useRef<HTMLElement | null>(null);

  // A new placement rewrites the position and width, without rendering.
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
  // The props, except during a gesture, whose preview holds until it ends.
  useIsomorphicLayoutEffect(() => {
    if (!editing.isDragging(entry)) placement.set(at, duration, offset);
  }, [editing, entry, placement, at, duration, offset]);

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

  const editable = editing.editable && value !== undefined;
  const register = useCallback(
    (node: HTMLElement | null) => {
      if (!node) return;
      element.current = node;
      entry.element = node;
      // A label mounted before the region names it now.
      if (entry.labelId) node.setAttribute("aria-labelledby", entry.labelId);
      const remove = editing.addRegion(entry);
      return () => {
        remove();
        entry.element = null;
        element.current = null;
      };
    },
    [editing, entry],
  );
  const live = useRegionState(editing, entry, () =>
    editing.editable && entry.value !== undefined
      ? { "aria-selected": String(editing.isSelected(entry)), tabindex: editing.isTabStop(entry) ? "0" : "-1" }
      : {},
  );
  const ref = useMergedRef(register, live);

  const state: RegionState = { at, duration, offset };
  const rendered = useRenderPart("div", state, props, {
    ref,
    role: editable ? "gridcell" : "group",
    "data-region": "",
    ...renderedState(editing, entry),
    ...(editable
      ? {
          "aria-selected": editing.isSelected(entry),
          tabIndex: editing.isTabStop(entry) ? 0 : -1,
          onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
            const target = event.target as Element;
            if (target.closest("[data-region-handle]")) return;
            const interactive = target.closest(INTERACTIVE);
            if (interactive && interactive !== event.currentTarget && event.currentTarget.contains(interactive)) return;
            editing.press(entry, "move", event.nativeEvent, event.currentTarget);
          },
          onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
            if (event.target === event.currentTarget && editing.keyOnRegion(entry, event.nativeEvent)) event.preventDefault();
          },
          onPointerEnter: () => editing.setHovered(entry, true),
          onPointerLeave: () => editing.setHovered(entry, false),
          onFocus: () => editing.setFocused(entry, true),
          onBlur: (event: FocusEvent<HTMLElement>) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) editing.setFocused(entry, false);
          },
        }
      : {}),
    style: {
      position: "absolute",
      insetBlock: 0,
      left: 0,
      ...regionStyle(placement),
      ...(editable ? { touchAction: "none" } : {}),
    } as CSSProperties,
  });
  return <RegionContext.Provider value={{ view, placement, entry, editing }}>{rendered}</RegionContext.Provider>;
}

export namespace TimelineRegion {
  export type State = RegionState;
  export type Props = PartProps<"div", State> & {
    /** Names the region in the selection and in the changes a gesture reports; editable regions need one. */
    value?: string | undefined;
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
     * Seconds of content, when bounded, as an audio file is: trimming never
     * shows more than there is. Without it, as for a pattern that repeats,
     * the end can go on.
     */
    length?: number | undefined;
    /**
     * Returns the placement that changes on its own, called once per
     * animation frame: the growing `duration` of a take being recorded.
     */
    read?: (() => RegionValue) | undefined;
  };
}

/**
 * The top of a region, for its label and the application's controls (a
 * menu, a colour). It carries the region's `data-selected` and
 * `data-dragging`, for a header that shows the selection.
 */
export function TimelineRegionHeader(props: TimelineRegionHeader.Props) {
  const { editing, entry } = useRegionContext("Timeline.RegionHeader");
  const ref = useRegionState(editing, entry);
  return useRenderPart("div", entry.props, props, { ref, ...renderedState(editing, entry), style: unselectable });
}

export namespace TimelineRegionHeader {
  export type State = RegionState;
  export type Props = PartProps<"div", State>;
}

/** The name of a region: its text names the region for assistive technology. */
export function TimelineRegionLabel(props: TimelineRegionLabel.Props) {
  const { entry } = useRegionContext("Timeline.RegionLabel");
  const generated = useId();
  const id = props.id ?? generated;
  useIsomorphicLayoutEffect(() => {
    entry.labelId = id;
    entry.element?.setAttribute("aria-labelledby", id);
    return () => {
      entry.labelId = undefined;
      entry.element?.removeAttribute("aria-labelledby");
    };
  }, [entry, id]);
  return useRenderPart("span", entry.props, props, { id, style: unselectable });
}

export namespace TimelineRegionLabel {
  export type State = RegionState;
  export type Props = PartProps<"span", State>;
}

/**
 * Where a region's content goes: a waveform, notes. It carries the
 * region's `data-selected` and `data-dragging`.
 */
export function TimelineRegionContent(props: TimelineRegionContent.Props) {
  const { editing, entry } = useRegionContext("Timeline.RegionContent");
  const ref = useRegionState(editing, entry);
  return useRenderPart("div", entry.props, props, { ref, ...renderedState(editing, entry), style: { position: "relative" } });
}

export namespace TimelineRegionContent {
  export type State = RegionState;
  export type Props = PartProps<"div", State>;
}

const defaultFormat = formats.number({ digits: 2, unit: "s" });

/**
 * A handle that trims the region's start or end, at that edge, across its
 * height. It is there only while the region is pointed at, focused,
 * selected or edited, so that regions nobody touches cost nothing: style it
 * as a visible bar, or as a transparent zone that only changes the cursor.
 * A `slider` for the edge's time, named by `aria-label` in the application's
 * language; arrows move the edge by a snap step, Shift by a pixel.
 */
export function TimelineRegionHandle(props: TimelineRegionHandle.Props) {
  const { editing, entry } = useRegionContext("Timeline.RegionHandle");
  const active = useSyncExternalStore(
    entry.subscribe,
    () => editing.editable && entry.value !== undefined && editing.isActive(entry),
    () => false,
  );
  return active ? <RegionHandle {...props} /> : null;
}

function RegionHandle({ side, ...props }: TimelineRegionHandle.Props) {
  const { editing, entry, placement } = useRegionContext("Timeline.RegionHandle");
  const format = editing.options.format ?? defaultFormat;
  const edge = () => (side === "start" ? placement.at : placement.at + placement.duration);
  const values = (): Live["attributes"] => ({ "aria-valuenow": edge(), "aria-valuetext": format.format(edge()) });

  const follow = useCallback(
    (element: HTMLElement | null) => {
      if (!element) return;
      const write = () =>
        writeLive(element, {
          attributes: { ...stateAttributes(editing, entry), ...values(), tabindex: editing.isTabStop(entry) ? "0" : "-1" },
        });
      const stopPlacement = placement.subscribe(write);
      const stopEntry = entry.subscribe(write);
      return () => {
        stopPlacement();
        stopEntry();
      };
    },
    [editing, entry, placement, side, format],
  );
  return useRenderPart("div", entry.props, props, {
    ref: follow,
    role: "slider",
    "aria-orientation": "horizontal",
    "data-region-handle": "",
    "data-side": side,
    ...renderedState(editing, entry),
    ...values(),
    tabIndex: editing.isTabStop(entry) ? 0 : -1,
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => editing.press(entry, side, event.nativeEvent, event.currentTarget),
    onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
      if (editing.keyOnHandle(entry, side, event.nativeEvent)) event.preventDefault();
    },
    style: { position: "absolute", insetBlock: 0, [side === "start" ? "left" : "right"]: 0, touchAction: "none" },
  });
}

export namespace TimelineRegionHandle {
  export type State = RegionState;
  export type Props = PartProps<"div", State> & {
    /** The edge it trims: `start` moves the start and the content with it, `end` the end. */
    side: "start" | "end";
  };
}
