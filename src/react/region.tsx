"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type CSSProperties } from "react";

import { onEveryFrame } from "./frame-loop.js";
import { unselectable, useMergedRef, useRenderPart, type PartProps } from "./render.js";
import { useTimelineContext, type TimelineView } from "./timeline.js";
import { useIsomorphicLayoutEffect } from "./value-control.js";

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

export type RegionState = { at: number; duration: number; offset: number };

export type RegionValue = Partial<RegionState>;

/** The region's element and the id of its label, which names it while mounted. */
type RegionLabelling = { element: HTMLElement | null; labelId: string | undefined };

export type RegionContextValue = { view: TimelineView; placement: RegionPlacement; state: RegionState; labelling: RegionLabelling };

const RegionContext = createContext<RegionContextValue | null>(null);

function useRegionContext(part: string): RegionContextValue {
  const context = useContext(RegionContext);
  if (!context) throw new Error(`<Region.${part}> must be placed inside <Region.Root>.`);
  return context;
}

/** The region around a part, if there is one. */
export const useOptionalRegion = () => useContext(RegionContext);

/**
 * The CSS that places a region, with its numbers written in: no CSS
 * variables of its own, because every element that defines some costs a
 * style recalculation each time the view's variables change above it.
 */
const regionStyle = ({ at, duration }: { at: number; duration: number }) => ({
  width: `calc(${duration} * var(--timeline-scale))`,
  translate: `calc((${at} - var(--timeline-start)) * var(--timeline-scale)) 0`,
});

/**
 * Something that lasts on a timeline: a clip or pattern with its header and
 * content, a loop range, a take being recorded. It starts `at` seconds on
 * the timeline's axis, lasts `duration`, and shows its content from
 * `offset` seconds into it, as a clip that starts later in its file does.
 *
 * Horizontally it follows the axis of the `Timeline.Root` around it: it is
 * placed in CSS from the timeline's variables, so scrolling and zooming move
 * it without work, and a change of its placement rewrites its position and
 * width without rendering what is inside. Vertically it fills the box it is
 * placed in: render it in the row it belongs to. A `group`, named by its
 * `Region.Label`.
 */
export function RegionRoot({ at, duration = 0, offset = 0, read, ...props }: RegionRoot.Props) {
  const { view } = useTimelineContext("Region.Root");
  const [placement] = useState(() => new RegionPlacement(at, duration, offset));
  const [labelling] = useState<RegionLabelling>(() => ({ element: null, labelId: undefined }));
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

  const register = useCallback(
    (node: HTMLElement | null) => {
      labelling.element = node;
      // A label mounted before the region names it now.
      if (node && labelling.labelId) node.setAttribute("aria-labelledby", labelling.labelId);
    },
    [labelling],
  );
  const ref = useMergedRef(element, register);
  const state: RegionState = { at, duration, offset };
  const rendered = useRenderPart("div", state, props, {
    ref,
    role: "group",
    style: { position: "absolute", insetBlock: 0, left: 0, ...regionStyle(placement) } as CSSProperties,
  });
  return <RegionContext.Provider value={{ view, placement, state, labelling }}>{rendered}</RegionContext.Provider>;
}

export namespace RegionRoot {
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

/** The top of a region, for its label and the application's controls (a menu, a colour). */
export function RegionHeader(props: RegionHeader.Props) {
  const { state } = useRegionContext("Header");
  return useRenderPart("div", state, props, { style: unselectable });
}

export namespace RegionHeader {
  export type State = RegionState;
  export type Props = PartProps<"div", State>;
}

/** The name of a region: its text names the region for assistive technology. */
export function RegionLabel(props: RegionLabel.Props) {
  const { state, labelling } = useRegionContext("Label");
  const generated = useId();
  const id = props.id ?? generated;
  useIsomorphicLayoutEffect(() => {
    labelling.labelId = id;
    labelling.element?.setAttribute("aria-labelledby", id);
    return () => {
      labelling.labelId = undefined;
      labelling.element?.removeAttribute("aria-labelledby");
    };
  }, [labelling, id]);
  return useRenderPart("span", state, props, { id, style: unselectable });
}

export namespace RegionLabel {
  export type State = RegionState;
  export type Props = PartProps<"span", State>;
}

/** Where a region's content goes: a waveform, notes. */
export function RegionContent(props: RegionContent.Props) {
  const { state } = useRegionContext("Content");
  return useRenderPart("div", state, props, { style: { position: "relative" } });
}

export namespace RegionContent {
  export type State = RegionState;
  export type Props = PartProps<"div", State>;
}
