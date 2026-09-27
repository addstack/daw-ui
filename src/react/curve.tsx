"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { createRange, type CurvePoint, type Range, type Scale } from "../core/index.js";
import { curvePosition, pointAfter } from "../core/curve.js";
import {
  ContentPainter,
  contentPlace,
  useContentAxis,
  useContentDrawing,
  type ContentAxis,
  type ContentKind,
  type ContentState,
  type LiveContent,
} from "./content.js";
import { curveFormats, type CurveEditing } from "./curve-editing.js";
import { writeLive } from "./live.js";
import { useMergedRef, useRenderPart, type PartProps } from "./render.js";
import type { TileStretch } from "./time-tiles.js";
import { useIsomorphicLayoutEffect } from "./value-control.js";

export type CurveState = ContentState;

/** Points sorted by time, indexed once per array for the root and every part that draws them. */
type CurveIndex = { sorted: readonly CurvePoint[]; last: number };

const indexes = new WeakMap<readonly CurvePoint[], CurveIndex>();

function indexPoints(points: readonly CurvePoint[]): CurveIndex {
  let index = indexes.get(points);
  if (index) return index;
  const inOrder = points.every((point, at) => at === 0 || points[at - 1]!.at <= point.at);
  // A stable sort: points at the same time keep their order, the jump they make.
  const sorted = inOrder ? points : [...points].sort((a, b) => a.at - b.at);
  index = { sorted, last: sorted.length ? sorted[sorted.length - 1]!.at : 0 };
  indexes.set(points, index);
  return index;
}

/** What a curve draws: its points, on its range. */
type CurveSource = { index: CurveIndex; range: Range };

type CurveContextValue = { axis: ContentAxis; source: CurveSource; editing: CurveEditing | null };

const CurveContext = createContext<CurveContextValue | null>(null);

function useCurveContext(part: string): CurveContextValue {
  const context = useContext(CurveContext);
  if (!context) throw new Error(`<Curve.${part}> must be placed inside <Curve.Root>.`);
  return context;
}

/** Whether an event started on a handle or a bend, which take their own gestures. */
const onHandle = (target: EventTarget) => target instanceof Element && target.closest("[data-curve-handle], [data-curve-bend]") !== null;

/**
 * A curve through points in time: automation of a parameter, an envelope,
 * a fade, a tempo that changes. The values are placed on `min` … `max`
 * with `scale`, bottom to top, as a fader of that range would show them:
 * a curve in decibels on the range of a volume fader goes where the fader
 * would. Before the first point and after the last, it holds their value.
 *
 * In a `Region.Root`, it shows the part the region shows, from its `offset`
 * for its `duration`. On a `Timeline.Root` outside a region, it lies on the
 * timeline from its second 0, for ever, as an automation lane does. On its
 * own, it is its own axis, from `offset` for `duration`, up to its last
 * point by default.
 *
 * With `editing` from `useCurveEditing`, its points can be moved, added,
 * removed and bent: see `Curve.Handle` and `Curve.Bend`. Renders a `div`
 * with `role="img"`, or `role="group"` when editable: name it with
 * `aria-label`, in the application's language.
 */
export function CurveRoot({ points, editing, min = 0, max = 1, scale, offset = 0, duration, position, read, ...props }: CurveRoot.Props) {
  const index = indexPoints(points);
  const range = useMemo(() => createRange({ min, max, scale }), [min, max, scale]);
  const axis = useContentAxis({ length: () => index.last, offset, duration, position, read });
  const element = useRef<HTMLElement | null>(null);
  useIsomorphicLayoutEffect(() => {
    editing?.attach({ points: index.sorted, range, axis, element: element.current });
  });
  const ref = useMergedRef(element, axis.root.ref);
  const rendered = useRenderPart("div", axis.state, props, {
    role: editing ? "group" : "img",
    ...axis.root,
    ref,
    ...(editing
      ? {
          "data-editable": "",
          onPointerMove: (event: ReactPointerEvent<HTMLElement>) => editing.hoverAt(event.nativeEvent),
          onPointerLeave: () => editing.leave(),
          onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
            if (!onHandle(event.target)) editing.pressEmpty(event.nativeEvent);
          },
          onDoubleClick: (event: ReactMouseEvent<HTMLElement>) => {
            if (!onHandle(event.target)) editing.addAt(event.nativeEvent);
          },
        }
      : {}),
  });
  return <CurveContext.Provider value={{ axis, source: { index, range }, editing: editing ?? null }}>{rendered}</CurveContext.Provider>;
}

export namespace CurveRoot {
  export type State = CurveState;
  export type Props = PartProps<"div", State> & {
    /**
     * The points, in seconds. A new array draws the curve again: keep the
     * same one between renders while the points stay the same.
     */
    points: readonly CurvePoint[];
    /** Makes the points editable, from `useCurveEditing`. */
    editing?: CurveEditing | undefined;
    /**
     * The value at the bottom.
     * @default 0
     */
    min?: number | undefined;
    /**
     * The value at the top.
     * @default 1
     */
    max?: number | undefined;
    /**
     * How values are placed between `min` and `max`, as on a knob or fader: `scales.decibel` for volume.
     * @default scales.linear
     */
    scale?: Scale | undefined;
    /**
     * On its own, or on a timeline: seconds of the curve at its left edge, or at the timeline's second 0.
     * In a region, the region's `offset` applies.
     * @default 0
     */
    offset?: number | undefined;
    /**
     * On its own: seconds across its width. On a timeline: seconds it lasts. In a region, the region's `duration` applies.
     * @default on its own, up to the last point; on a timeline, for ever
     */
    duration?: number | undefined;
    /** On its own: the playhead, in seconds of the curve. On a timeline, the timeline's applies. */
    position?: number | undefined;
    /** On its own: returns the playhead in seconds of the curve; called once per animation frame. */
    read?: (() => number) | undefined;
  };
}

/**
 * Traces a curve across a tile: straight segments as lines between their
 * points, held ones as a step, bent ones through a point every two device
 * pixels. Only what the tile shows is traced, a little beyond its edges.
 */
abstract class CurvePainter<S extends CurveSource> extends ContentPainter<S> {
  extent() {
    return { from: -Infinity, to: Infinity };
  }

  /** Where a travel position is from the top of a tile `height` device pixels tall. */
  protected y(position: number, height: number): number {
    return (1 - Math.min(1, Math.max(0, position))) * height;
  }

  /** Traces the tile's part of the curve as the current path; returns its ends, or `null` without points. */
  protected trace(context: CanvasRenderingContext2D, { start, length, width, height }: TileStretch, margin: number) {
    const { index, range } = this.source;
    const points = index.sorted;
    if (points.length === 0) return null;
    const perSecond = width / length;
    const from = start - margin / perSecond;
    const to = start + length + margin / perSecond;
    const x = (time: number) => (time - start) * perSecond;
    const y = (position: number) => this.y(position, height);

    let next = pointAfter(points, from);
    context.beginPath();
    context.moveTo(x(from), y(curvePosition(points[next - 1], points[next], from, range)));
    for (let time = from; time < to; next++) {
      const previous = points[next - 1];
      const point = points[next];
      const until = point && point.at < to ? point.at : to;
      // A bent segment, through a point every two device pixels of what is traced.
      if (previous && point && typeof previous.shape === "number" && previous.shape !== 0) {
        const step = 2 / perSecond;
        for (let at = time + step; at < until; at += step) context.lineTo(x(at), y(curvePosition(previous, point, at, range)));
      }
      const end = curvePosition(previous, point, until, range);
      context.lineTo(x(until), y(end));
      // At a point, a held segment, or points at the same time, jump.
      if (point && until === point.at) {
        const after = range.normalize(point.value);
        if (after !== end) context.lineTo(x(until), y(after));
      }
      time = until;
    }
    return { from: x(from), to: x(to), y };
  }
}

type LineSource = CurveSource & { thickness: number };

/** Strokes the curve, `thickness` CSS pixels wide. */
class LinePainter extends CurvePainter<LineSource> {
  paint(context: CanvasRenderingContext2D, stretch: TileStretch): void {
    const width = this.source.thickness * stretch.ratio;
    if (!this.trace(context, stretch, width + 2)) return;
    context.lineWidth = width;
    context.lineJoin = "round";
    context.strokeStyle = context.fillStyle;
    context.stroke();
  }
}

type FillSource = CurveSource & { origin: number | undefined };

/** Fills between the curve and its origin. */
class FillPainter extends CurvePainter<FillSource> {
  paint(context: CanvasRenderingContext2D, stretch: TileStretch): void {
    const traced = this.trace(context, stretch, 2);
    if (!traced) return;
    const { origin, range } = this.source;
    const base = traced.y(range.normalize(origin ?? range.min));
    context.lineTo(traced.to, base);
    context.lineTo(traced.from, base);
    context.closePath();
    context.fill();
  }
}

type DotsSource = CurveSource & { size: number };

/** A dot at every point, `size` CSS pixels across. */
class DotsPainter extends CurvePainter<DotsSource> {
  paint(context: CanvasRenderingContext2D, { start, length, width, height, ratio }: TileStretch): void {
    const { index, range, size } = this.source;
    const points = index.sorted;
    const radius = (size * ratio) / 2;
    const perSecond = width / length;
    const end = start + length + radius / perSecond;
    context.beginPath();
    for (let at = pointAfter(points, start - radius / perSecond - 1e-9); at < points.length; at++) {
      const point = points[at]!;
      if (point.at > end) break;
      const x = (point.at - start) * perSecond;
      const y = this.y(range.normalize(point.value), height);
      context.moveTo(x + radius, y);
      context.arc(x, y, radius, 0, 2 * Math.PI);
    }
    context.fill();
  }
}

/**
 * The stretch of time over which two versions of a curve differ, as when a
 * point moved: from the point before the first that changed, to the point
 * after the last. Points are compared by identity: an edit keeps the points
 * it does not change.
 */
function changed(a: readonly CurvePoint[], b: readonly CurvePoint[]): { from: number; to: number } | undefined {
  let first = 0;
  while (first < a.length && first < b.length && a[first] === b[first]) first++;
  if (first === a.length && first === b.length) return undefined;
  let last = 0;
  while (last < a.length - first && last < b.length - first && a[a.length - 1 - last] === b[b.length - 1 - last]) last++;
  return {
    from: Math.min(a[first - 1]?.at ?? -Infinity, b[first - 1]?.at ?? -Infinity),
    to: Math.max(a[a.length - last]?.at ?? Infinity, b[b.length - last]?.at ?? Infinity),
  };
}

/** The kind of a curve's drawing, with `extra` telling whether the rest of two sources draws the same. */
function curveKind<S extends CurveSource>(extra: (a: S, b: S) => boolean): ContentKind<S> {
  return {
    same: (a, b) => a.index === b.index && a.range === b.range && extra(a, b),
    differs: (a, b) => (a.range === b.range && extra(a, b) ? changed(a.index.sorted, b.index.sorted) : undefined),
  };
}

const line = curveKind<LineSource>((a, b) => a.thickness === b.thickness);
const fill = curveKind<FillSource>((a, b) => a.origin === b.origin);
const dots = curveKind<DotsSource>((a, b) => a.size === b.size);

const createLine = (...args: ConstructorParameters<typeof LinePainter>) => new LinePainter(...args);
const createFill = (...args: ConstructorParameters<typeof FillPainter>) => new FillPainter(...args);
const createDots = (...args: ConstructorParameters<typeof DotsPainter>) => new DotsPainter(...args);

/**
 * Draws a part of a curve: its points, or the points an edit makes as it
 * goes, which it draws again without rendering, only over the stretch that
 * changed.
 */
function useCurveDrawing<S extends CurveSource>(
  part: string,
  extra: Omit<S, keyof CurveSource>,
  createPainter: (source: S, axis: ContentAxis) => ContentPainter<S>,
  kind: ContentKind<S>,
) {
  const { axis, source, editing } = useCurveContext(part);
  const latest = useRef({ source, extra });
  latest.current = { source, extra };
  const live = useMemo<LiveContent<S> | undefined>(
    () =>
      editing
        ? {
            subscribe: editing.subscribe,
            // The points a gesture makes while it goes; else the root's own, also before the root has attached them.
            source: () => {
              const { source, extra } = latest.current;
              const preview = editing.preview;
              return { ...source, ...extra, index: preview ? indexPoints(preview) : source.index } as S;
            },
          }
        : undefined,
    [editing],
  );
  const drawing = useContentDrawing(axis, { ...source, ...extra } as S, createPainter, kind, live);
  return { axis, drawing };
}

/**
 * The curve as a line, drawn on canvas in the CSS `color` of this element:
 * style it with `className="text-amber-400"`. Fills the root. With editing,
 * a double-click on the curve adds a point there.
 */
export function CurveLine({ thickness = 1, ...props }: CurveLine.Props) {
  const { axis, drawing } = useCurveDrawing<LineSource>("Line", { thickness }, createLine, line);
  return useRenderPart("div", axis.state, props, { ref: drawing, style: { position: "absolute", inset: 0 } });
}

export namespace CurveLine {
  export type State = CurveState;
  export type Props = Omit<PartProps<"div", State>, "children"> & {
    /**
     * CSS pixels.
     * @default 1
     */
    thickness?: number | undefined;
  };
}

/**
 * The area between the curve and `origin`, drawn on canvas in the CSS
 * `color` of this element, usually a lighter one than the line's. Fills the
 * root: render it before the line, to lie under it.
 */
export function CurveFill({ origin, ...props }: CurveFill.Props) {
  const { axis, drawing } = useCurveDrawing<FillSource>("Fill", { origin }, createFill, fill);
  return useRenderPart("div", axis.state, props, { ref: drawing, style: { position: "absolute", inset: 0 } });
}

export namespace CurveFill {
  export type State = CurveState;
  export type Props = Omit<PartProps<"div", State>, "children"> & {
    /**
     * The value the area grows from: the middle, for pan or pitch bend.
     * @default the root's `min`
     */
    origin?: number | undefined;
  };
}

/**
 * A dot at every point, drawn on canvas in the CSS `color` of this element,
 * as a lane of automation shows its points. Fills the root. Dots cost
 * nothing to scroll, however many points there are: with editing, a
 * `Curve.Handle` takes the place of the dot the pointer is near.
 */
export function CurveDots({ size = 5, ...props }: CurveDots.Props) {
  const { axis, drawing } = useCurveDrawing<DotsSource>("Dots", { size }, createDots, dots);
  return useRenderPart("div", axis.state, props, { ref: drawing, style: { position: "absolute", inset: 0 } });
}

export namespace CurveDots {
  export type State = CurveState;
  export type Props = Omit<PartProps<"div", State>, "children"> & {
    /**
     * CSS pixels across.
     * @default 5
     */
    size?: number | undefined;
  };
}

/** What a handle shows of its point. */
export type CurveHandleState = { at: number; value: number; selected: boolean; dragging: boolean };

const noSubscribe = () => () => {};

/** The CSS that centres a handle on content time `at` and travel position `position`. */
const handleAt = (axis: ContentAxis, at: number, position: number) => ({
  translate: `calc(${contentPlace(axis, at)} * var(--timeline-scale) - 50%) -50%`,
  // Rounded, so that float noise does not rewrite the style.
  top: `${Math.round((1 - Math.min(1, Math.max(0, position))) * 1e5) / 1e3}%`,
});

/**
 * The handle of a point, rendered for each point that needs one now: the
 * one the pointer is near, the selected ones, and the one that takes the
 * focus from Tab. Drag it to move the point, with the selection; a
 * double-click removes it. A `slider` of the point's value, whose text
 * says its time and value; Up and Down move the value, Left and Right go to
 * the next point, Cmd or Ctrl with Left and Right move it in time, Alt with
 * Up and Down bend the segment after it, Delete removes it, Space selects
 * it. Name it with `aria-label`, in the application's language.
 */
export function CurveHandle(props: CurveHandle.Props) {
  const { editing } = useCurveContext("Handle");
  const shown = useSyncExternalStore(editing?.subscribe ?? noSubscribe, () => editing?.handles().join(",") ?? "", () => "");
  if (!editing || shown === "") return null;
  return shown.split(",").map((index) => <PointHandle key={index} index={Number(index)} editing={editing} props={props} />);
}

/** What a point's handle says of it, as attributes: its value and time, and whether it is the tab stop, selected or held. */
function describePoint(editing: CurveEditing, index: number, point: CurvePoint) {
  const formats = curveFormats(editing.options);
  return {
    "aria-valuenow": Number.isFinite(point.value) ? point.value : null,
    "aria-valuetext": `${formats.time.format(point.at)}, ${formats.value.format(point.value)}`,
    tabindex: editing.isTabStop(index) ? "0" : "-1",
    "data-selected": editing.isSelected(index) ? "" : null,
    "data-dragging": editing.isHeld("point", index) ? "" : null,
  };
}

function PointHandle({ index, editing, props }: { index: number; editing: CurveEditing; props: CurveHandle.Props }) {
  const { axis, source } = useCurveContext("Handle");
  const { range } = source;
  const point = editing.points[index] ?? { at: 0, value: range.min };

  // A point that moves moves its handle, and changes what it says, without rendering.
  const follow = useCallback(
    (element: HTMLElement | null) => {
      if (!element) return;
      const write = () => {
        const current = editing.points[index];
        if (!current) return;
        writeLive(element, { attributes: describePoint(editing, index, current), style: handleAt(axis, current.at, range.normalize(current.value)) });
        if (editing.takeFocus(index)) element.focus({ preventScroll: true });
      };
      write();
      return editing.subscribe(write);
    },
    [editing, index, axis, range],
  );
  const state: CurveHandleState = { at: point.at, value: point.value, selected: editing.isSelected(index), dragging: editing.isHeld("point", index) };
  const described = describePoint(editing, index, point);
  return useRenderPart("div", state, props, {
    ref: follow,
    role: "slider",
    "aria-orientation": "vertical",
    "aria-valuemin": Number.isFinite(range.min) ? range.min : undefined,
    "aria-valuemax": Number.isFinite(range.max) ? range.max : undefined,
    "aria-valuenow": described["aria-valuenow"] ?? undefined,
    "aria-valuetext": described["aria-valuetext"],
    tabIndex: editing.isTabStop(index) ? 0 : -1,
    "data-curve-handle": "",
    ...(editing.isSelected(index) ? { "data-selected": "" } : {}),
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => editing.pressPoint(index, event.nativeEvent, event.currentTarget),
    onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
      if (editing.keyOnPoint(index, event.nativeEvent)) event.preventDefault();
    },
    onDoubleClick: (event: ReactMouseEvent<HTMLElement>) => editing.remove([index], event.nativeEvent),
    onFocus: () => editing.focusOn(index),
    style: { position: "absolute", left: 0, ...handleAt(axis, point.at, range.normalize(point.value)), touchAction: "none" } as CSSProperties,
  });
}

export namespace CurveHandle {
  export type State = CurveHandleState;
  export type Props = Omit<PartProps<"div", State>, "children">;
}

/**
 * The handle that bends a segment, in its middle, on the curve: rendered
 * for the segment the pointer is near, or the one being bent. Drag it up or
 * down, and the segment follows through it; a double-click makes it
 * straight again. Hidden from assistive technology: Alt with Up or Down on
 * a point's handle bends the segment after it.
 */
export function CurveBend(props: CurveBend.Props) {
  const { editing } = useCurveContext("Bend");
  const shown = useSyncExternalStore(editing?.subscribe ?? noSubscribe, () => editing?.bends().join(",") ?? "", () => "");
  if (!editing || shown === "") return null;
  return shown.split(",").map((index) => <BendHandle key={index} index={Number(index)} editing={editing} props={props} />);
}

function BendHandle({ index, editing, props }: { index: number; editing: CurveEditing; props: CurveBend.Props }) {
  const { axis, source } = useCurveContext("Bend");
  const middle = editing.bendAt(index) ?? { at: 0, position: 0 };
  const follow = useCallback(
    (element: HTMLElement | null) => {
      if (!element) return;
      const write = () => {
        const current = editing.bendAt(index);
        if (!current) return;
        writeLive(element, {
          attributes: { "data-dragging": editing.isHeld("bend", index) ? "" : null },
          style: handleAt(axis, current.at, current.position),
        });
      };
      write();
      return editing.subscribe(write);
    },
    [editing, index, axis],
  );
  const state: CurveBend.State = { at: middle.at, value: source.range.denormalize(middle.position), selected: false, dragging: editing.isHeld("bend", index) };
  return useRenderPart("div", state, props, {
    ref: follow,
    "aria-hidden": true,
    "data-curve-bend": "",
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => editing.pressBend(index, event.nativeEvent, event.currentTarget),
    onDoubleClick: (event: ReactMouseEvent<HTMLElement>) => editing.straighten(index, event.nativeEvent),
    style: { position: "absolute", left: 0, ...handleAt(axis, middle.at, middle.position), touchAction: "none" } as CSSProperties,
  });
}

export namespace CurveBend {
  export type State = CurveHandleState;
  export type Props = Omit<PartProps<"div", State>, "children">;
}
