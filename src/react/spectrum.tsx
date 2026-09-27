"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { createRange, scales, type Range, type Scale } from "../core/index.js";
import { spectrumColumns, spectrumLevels, type SpectrumColumns } from "../core/spectrum.js";
import { onEveryFrame } from "./frame-loop.js";
import { useRenderPart, type PartProps } from "./render.js";
import { useIsomorphicLayoutEffect } from "./value-control.js";

export type SpectrumState = {
  /** Whether it follows `read`, once per frame. */
  live: boolean;
};

/** What the parts draw: the level of each column, and how to place them. */
type SpectrumFrame = {
  levels: Float32Array;
  /** CSS pixels. */
  width: number;
  height: number;
  floor: number;
  ceiling: number;
  /** The frame's time in milliseconds, or `null` for bins that do not change. */
  now: number | null;
};

type Painter = (frame: SpectrumFrame) => void;

type Settings = { sampleRate: number; axis: Range; floor: number; ceiling: number; tilt: number; fall: number };

/** The bins, turned into one level per column, outside React: the parts paint each new frame, and nothing renders. */
class SpectrumSource {
  width = 0;
  height = 0;
  visible = true;
  frame: SpectrumFrame | null = null;
  bins: ArrayLike<number> | null = null;
  private columns: { width: number; count: number; sampleRate: number; axis: Range; columns: SpectrumColumns } | null = null;
  private raw = new Float32Array(0);
  private levels = new Float32Array(0);
  private last: number | null = null;
  private readonly painters = new Set<Painter>();

  constructor(public settings: Settings) {}

  add(painter: Painter): () => void {
    this.painters.add(painter);
    if (this.frame) painter(this.frame);
    return () => {
      this.painters.delete(painter);
    };
  }

  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    if (this.bins) this.update(this.bins, null);
  }

  update(bins: ArrayLike<number>, now: number | null): void {
    this.bins = bins;
    const { width } = this;
    if (width <= 0 || bins.length === 0) return;
    const { sampleRate, axis, floor, ceiling, tilt, fall } = this.settings;
    let cached = this.columns;
    if (!cached || cached.width !== width || cached.count !== bins.length || cached.sampleRate !== sampleRate || cached.axis !== axis) {
      cached = this.columns = { width, count: bins.length, sampleRate, axis, columns: spectrumColumns(width, bins.length, sampleRate, axis) };
      this.raw = new Float32Array(width);
      this.levels = new Float32Array(width).fill(-Infinity);
      this.last = null;
    }
    spectrumLevels(bins, cached.columns, tilt, this.raw);
    // The level rises at once and falls at `fall` dB per second, as a meter's; without a fall, it follows the bins.
    const elapsed = now !== null && this.last !== null ? Math.max(0, now - this.last) / 1000 : null;
    for (let column = 0; column < width; column++) {
      const raw = this.raw[column]!;
      this.levels[column] = elapsed === null || !Number.isFinite(fall) ? raw : Math.max(raw, this.levels[column]! - fall * elapsed);
    }
    this.last = now;
    this.frame = { levels: this.levels, width, height: this.height, floor, ceiling, now };
    for (const painter of this.painters) painter(this.frame);
  }
}

const SpectrumContext = createContext<{ source: SpectrumSource; state: SpectrumState } | null>(null);

function useSpectrumContext(part: string) {
  const context = useContext(SpectrumContext);
  if (!context) throw new Error(`<Spectrum.${part}> must be placed inside <Spectrum.Root>.`);
  return context;
}

/**
 * A spectrum: how loud each frequency is, from the bins of an FFT, such as
 * an `AnalyserNode`'s, on a logarithmic axis from `min` to `max` hertz and
 * `floor` to `ceiling` dB. With `read`, it follows the sound once per
 * animation frame, as the analysers of equalizers do; with `bins`, it shows
 * a spectrum that does not change, such as a whole sample's.
 *
 * Where a column of pixels covers many bins, it shows the loudest, so that
 * narrow peaks show at high frequencies; where it covers less than one, a
 * smooth curve runs through the bins around it. `Spectrum.Line`,
 * `Spectrum.Fill` and `Spectrum.Peak` draw on canvas in their CSS `color`,
 * and nothing renders as the sound changes. Size it with CSS. Renders a
 * `div` with `role="img"`: name it with `aria-label`.
 */
export function SpectrumRoot({
  read,
  bins,
  sampleRate,
  min = 20,
  max = 20_000,
  scale = scales.log,
  floor = -90,
  ceiling = 0,
  tilt = 0,
  fall = Infinity,
  ...props
}: SpectrumRoot.Props) {
  const axis = useMemo(() => createRange({ min, max, scale }), [min, max, scale]);
  const settings: Settings = { sampleRate, axis, floor, ceiling, tilt, fall };
  const [source] = useState(() => new SpectrumSource(settings));
  const reads = read !== undefined;

  // Bins that do not change are drawn when they, or how they are drawn, change.
  useIsomorphicLayoutEffect(() => {
    source.settings = { sampleRate, axis, floor, ceiling, tilt, fall };
    if (!reads && bins) source.update(bins, null);
  }, [source, reads, bins, sampleRate, axis, floor, ceiling, tilt, fall]);

  // Bins that change are read once per frame, while the spectrum is in sight.
  const readRef = useRef(read);
  readRef.current = read;
  useEffect(() => {
    if (!reads) return;
    return onEveryFrame((now) => {
      if (!source.visible || !readRef.current) return;
      source.update(readRef.current(), now);
    });
  }, [reads, source]);

  const measure = useCallback(
    (element: HTMLElement | null) => {
      if (!element) return;
      const window = element.ownerDocument.defaultView;
      const size = () => source.resize(element.clientWidth, element.clientHeight);
      size();
      const cleanups: (() => void)[] = [];
      if (window?.ResizeObserver) {
        const observer = new window.ResizeObserver(size);
        observer.observe(element);
        cleanups.push(() => observer.disconnect());
      }
      if (window?.IntersectionObserver) {
        const observer = new window.IntersectionObserver(([entry]) => (source.visible = entry!.isIntersecting));
        observer.observe(element);
        cleanups.push(() => observer.disconnect());
      }
      return () => cleanups.forEach((cleanup) => cleanup());
    },
    [source],
  );

  const state: SpectrumState = { live: reads };
  const rendered = useRenderPart("div", state, props, { ref: measure, role: "img", style: { position: "relative" } });
  return <SpectrumContext.Provider value={{ source, state }}>{rendered}</SpectrumContext.Provider>;
}

export namespace SpectrumRoot {
  export type State = SpectrumState;
  export type Props = PartProps<"div", State> & {
    /**
     * Returns the level of each bin in dB, as `AnalyserNode.getFloatFrequencyData`
     * fills them, from 0 Hz to half the sample rate; called once per animation
     * frame. Return the same array each time, filled anew.
     */
    read?: (() => ArrayLike<number>) | undefined;
    /** The level of each bin in dB, for a spectrum that does not change. Ignored with `read`. */
    bins?: ArrayLike<number> | undefined;
    /** The sample rate of the sound the bins come from, as `AudioContext.sampleRate`: it tells which bin is which frequency. */
    sampleRate: number;
    /**
     * The lowest frequency, at the start, in hertz.
     * @default 20
     */
    min?: number | undefined;
    /**
     * The highest frequency, at the end, in hertz.
     * @default 20000
     */
    max?: number | undefined;
    /**
     * How frequency maps across, as a knob's range.
     * @default scales.log
     */
    scale?: Scale | undefined;
    /**
     * The level at the bottom, in dB.
     * @default -90
     */
    floor?: number | undefined;
    /**
     * The level at the top, in dB.
     * @default 0
     */
    ceiling?: number | undefined;
    /**
     * dB per octave added above 1 kHz and taken below it, so that pink noise,
     * and music, looks flat: 4.5 is common.
     * @default 0
     */
    tilt?: number | undefined;
    /**
     * dB per second the levels fall at most; they rise at once. Leave it out
     * to follow the bins, which an `AnalyserNode` already smooths.
     * @default Infinity
     */
    fall?: number | undefined;
  };
}

/** Where a level lies, from the top, in device pixels. */
const heightOf = (frame: SpectrumFrame, level: number, height: number) =>
  (1 - Math.min(1, Math.max(0, (level - frame.floor) / (frame.ceiling - frame.floor || 1)))) * height;

/**
 * The path through the levels, one point in the middle of each column: a new
 * path, or with `continuing`, on from where the path is.
 */
function trace(context: CanvasRenderingContext2D, frame: SpectrumFrame, levels: Float32Array, width: number, height: number, continuing = false) {
  const step = width / levels.length;
  for (let column = 0; column < levels.length; column++) {
    const x = (column + 0.5) * step;
    const y = heightOf(frame, levels[column]!, height);
    if (column === 0 && !continuing) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
}

/**
 * A canvas that fills the root and paints each frame, in its CSS `color`. The
 * colour is read again when it changes, which its 1 ms transition reports.
 */
function useCanvasPart(
  part: string,
  props: PartProps<"canvas", SpectrumState>,
  paint: (context: CanvasRenderingContext2D, frame: SpectrumFrame, ratio: number, width: number, height: number) => void,
) {
  const { source, state } = useSpectrumContext(part);
  const paintRef = useRef(paint);
  paintRef.current = paint;
  const attach = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      if (!canvas) return;
      let color = "";
      const window = canvas.ownerDocument.defaultView;
      const painter: Painter = (frame) => {
        const ratio = window?.devicePixelRatio || 1;
        const width = Math.max(1, Math.round(frame.width * ratio));
        const height = Math.max(1, Math.round(frame.height * ratio));
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) return;
        context.clearRect(0, 0, width, height);
        color ||= window?.getComputedStyle(canvas).color ?? "";
        context.fillStyle = color;
        context.strokeStyle = color;
        paintRef.current(context, frame, ratio, width, height);
      };
      const recolor = () => {
        color = "";
        if (source.frame) painter(source.frame);
      };
      canvas.addEventListener("transitionend", recolor);
      const stop = source.add(painter);
      return () => {
        stop();
        canvas.removeEventListener("transitionend", recolor);
      };
    },
    [source],
  );
  return useRenderPart("canvas", state, props, {
    ref: attach,
    "aria-hidden": true,
    style: { position: "absolute", inset: 0, width: "100%", height: "100%", transition: "color 1ms" },
  });
}

/** The spectrum as a line, `thickness` CSS pixels wide. */
export function SpectrumLine({ thickness = 1.5, ...props }: SpectrumLine.Props) {
  return useCanvasPart("Line", props, (context, frame, ratio, width, height) => {
    context.lineWidth = thickness * ratio;
    context.lineJoin = "round";
    context.beginPath();
    trace(context, frame, frame.levels, width, height);
    context.stroke();
  });
}

export namespace SpectrumLine {
  export type State = SpectrumState;
  export type Props = Omit<PartProps<"canvas", State>, "children"> & {
    /**
     * CSS pixels.
     * @default 1.5
     */
    thickness?: number | undefined;
  };
}

/** The area under the spectrum, down to the floor. */
export function SpectrumFill(props: SpectrumFill.Props) {
  return useCanvasPart("Fill", props, (context, frame, _ratio, width, height) => {
    context.beginPath();
    context.moveTo(0, height);
    trace(context, frame, frame.levels, width, height, true);
    context.lineTo(width, height);
    context.closePath();
    context.fill();
  });
}

export namespace SpectrumFill {
  export type State = SpectrumState;
  export type Props = Omit<PartProps<"canvas", State>, "children">;
}

/**
 * The highest levels lately, as a line: each column holds its peak for
 * `hold` milliseconds, then falls at `fall` dB per second.
 */
export function SpectrumPeak({ thickness = 1, hold = 1000, fall = 24, ...props }: SpectrumPeak.Props) {
  const [memory] = useState(() => ({ peaks: new Float32Array(0), until: new Float64Array(0), last: null as number | null }));
  return useCanvasPart("Peak", props, (context, frame, ratio, width, height) => {
    const { levels, now } = frame;
    if (memory.peaks.length !== levels.length || now === null) {
      memory.peaks = Float32Array.from(levels);
      memory.until = new Float64Array(levels.length).fill((now ?? 0) + hold);
    } else {
      const elapsed = memory.last === null ? 0 : Math.max(0, now - memory.last) / 1000;
      for (let column = 0; column < levels.length; column++) {
        if (levels[column]! >= memory.peaks[column]!) {
          memory.peaks[column] = levels[column]!;
          memory.until[column] = now + hold;
        } else if (now > memory.until[column]!) {
          memory.peaks[column] = Math.max(levels[column]!, memory.peaks[column]! - fall * elapsed);
        }
      }
    }
    memory.last = now;
    context.lineWidth = thickness * ratio;
    context.lineJoin = "round";
    context.beginPath();
    trace(context, frame, memory.peaks, width, height);
    context.stroke();
  });
}

export namespace SpectrumPeak {
  export type State = SpectrumState;
  export type Props = Omit<PartProps<"canvas", State>, "children"> & {
    /**
     * CSS pixels.
     * @default 1
     */
    thickness?: number | undefined;
    /**
     * Milliseconds a peak holds before it falls.
     * @default 1000
     */
    hold?: number | undefined;
    /**
     * dB per second a peak falls after its hold.
     * @default 24
     */
    fall?: number | undefined;
  };
}
