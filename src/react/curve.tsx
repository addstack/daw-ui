"use client";

import { createContext, useContext, useMemo } from "react";

import { createRange, type CurvePoint, type Range, type Scale } from "../core/index.js";
import { curvePosition, pointAfter } from "../core/curve.js";
import { ContentPainter, useContentAxis, useContentDrawing, type ContentAxis, type ContentKind, type ContentState } from "./content.js";
import { useRenderPart, type PartProps } from "./render.js";
import type { TileStretch } from "./time-tiles.js";

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

type CurveContextValue = { axis: ContentAxis; source: CurveSource };

const CurveContext = createContext<CurveContextValue | null>(null);

function useCurveContext(part: string): CurveContextValue {
  const context = useContext(CurveContext);
  if (!context) throw new Error(`<Curve.${part}> must be placed inside <Curve.Root>.`);
  return context;
}

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
 * It only shows the curve: editing its points is for an engine the
 * application owns. Renders a `div` with `role="img"`: name it with
 * `aria-label`, in the application's language.
 */
export function CurveRoot({ points, min = 0, max = 1, scale, offset = 0, duration, position, read, ...props }: CurveRoot.Props) {
  const index = indexPoints(points);
  const range = useMemo(() => createRange({ min, max, scale }), [min, max, scale]);
  const axis = useContentAxis({ length: () => index.last, offset, duration, position, read });
  const rendered = useRenderPart("div", axis.state, props, { role: "img", ...axis.root });
  return <CurveContext.Provider value={{ axis, source: { index, range } }}>{rendered}</CurveContext.Provider>;
}

export namespace CurveRoot {
  export type State = CurveState;
  export type Props = PartProps<"div", State> & {
    /**
     * The points, in seconds. A new array draws the curve again: keep the
     * same one between renders while the points stay the same.
     */
    points: readonly CurvePoint[];
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

  /** Traces the tile's part of the curve as the current path; returns its ends, or `null` without points. */
  protected trace(context: CanvasRenderingContext2D, { start, length, width, height }: TileStretch, margin: number) {
    const { index, range } = this.source;
    const points = index.sorted;
    if (points.length === 0) return null;
    const perSecond = width / length;
    const from = start - margin / perSecond;
    const to = start + length + margin / perSecond;
    const x = (time: number) => (time - start) * perSecond;
    const y = (position: number) => (1 - Math.min(1, Math.max(0, position))) * height;

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
    const { origin } = this.source;
    const base = traced.y(this.source.range.normalize(origin ?? this.source.range.min));
    context.lineTo(traced.to, base);
    context.lineTo(traced.from, base);
    context.closePath();
    context.fill();
  }
}

const line: ContentKind<LineSource> = {
  same: (a, b) => a.index === b.index && a.range === b.range && a.thickness === b.thickness,
};

const fill: ContentKind<FillSource> = {
  same: (a, b) => a.index === b.index && a.range === b.range && a.origin === b.origin,
};

const createLine = (...args: ConstructorParameters<typeof LinePainter>) => new LinePainter(...args);
const createFill = (...args: ConstructorParameters<typeof FillPainter>) => new FillPainter(...args);

/**
 * The curve as a line, drawn on canvas in the CSS `color` of this element:
 * style it with `className="text-amber-400"`. Fills the root.
 */
export function CurveLine({ thickness = 1, ...props }: CurveLine.Props) {
  const { axis, source } = useCurveContext("Line");
  const drawing = useContentDrawing(axis, { ...source, thickness }, createLine, line);
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
  const { axis, source } = useCurveContext("Fill");
  const drawing = useContentDrawing(axis, { ...source, origin }, createFill, fill);
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
