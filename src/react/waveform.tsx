"use client";

import { createContext, useCallback, useContext, useEffect, useRef } from "react";

import { readPeaks, type Peaks } from "../core/index.js";
import { useMergedRef, useRenderPart, type PartProps } from "./render.js";
import { TimeTiles, type TilePainter, type TileStretch } from "./time-tiles.js";
import { placement, useTimelineContext, type TimelineView } from "./timeline.js";
import { useIsomorphicLayoutEffect } from "./value-control.js";

export type WaveformState = { at: number; offset: number; duration: number };

/** What a waveform draws: which audio, and where it sits on the timeline. */
type WaveformSource = {
  peaks: Peaks;
  samples: readonly Float32Array[] | undefined;
  at: number;
  offset: number;
  /** Without it, the rest of the audio, which grows with peaks that grow. */
  duration: number | undefined;
  channel: number | undefined;
};

type WaveformContextValue = { view: TimelineView; state: WaveformState; source: Omit<WaveformSource, "channel"> };

const WaveformContext = createContext<WaveformContextValue | null>(null);

function useWaveformContext(part: string): WaveformContextValue {
  const context = useContext(WaveformContext);
  if (!context) throw new Error(`<Waveform.${part}> must be placed inside <Waveform.Root>.`);
  return context;
}

const durationOf = (source: Pick<WaveformSource, "peaks" | "offset" | "duration">) =>
  source.duration ?? Math.max(0, source.peaks.duration - source.offset);

const width = (duration: number) => `calc(${duration} * var(--timeline-scale))`;

/**
 * Audio on a timeline: from `offset` seconds into the audio, for `duration`
 * seconds, starting `at` seconds on the timeline. It places itself like a
 * `Timeline.Item`, and grows with peaks that grow, as while recording.
 * Renders a `div` with `role="img"`: name it with `aria-label`, in the
 * application's language.
 */
export function WaveformRoot({ peaks, samples, at = 0, offset = 0, duration, ...props }: WaveformRoot.Props) {
  const { view } = useTimelineContext("Waveform.Root");
  const state: WaveformState = { at, offset, duration: durationOf({ peaks, offset, duration }) };
  const element = useRef<HTMLElement | null>(null);

  // Peaks that grow widen the waveform once per frame, without rendering.
  useEffect(() => {
    if (duration !== undefined || !peaks.subscribe) return;
    let frame = 0;
    const unsubscribe = peaks.subscribe(() => {
      frame ||= requestAnimationFrame(() => {
        frame = 0;
        element.current?.style.setProperty("width", width(durationOf({ peaks, offset, duration })));
      });
    });
    return () => {
      unsubscribe();
      cancelAnimationFrame(frame);
    };
  }, [peaks, offset, duration]);

  const ref = useMergedRef(element);
  const rendered = useRenderPart("div", state, props, {
    ref,
    role: "img",
    style: placement(state.at, state.duration),
  });
  return (
    <WaveformContext.Provider value={{ view, state, source: { peaks, samples, at, offset, duration } }}>
      {rendered}
    </WaveformContext.Provider>
  );
}

export namespace WaveformRoot {
  export type State = WaveformState;
  export type Props = PartProps<"div", State> & {
    /** The audio, from `createPeaks`, `createPeaksRecorder` or `peaksFromAudiowaveform`. */
    peaks: Peaks;
    /**
     * The samples themselves, one array per channel, e.g. from the
     * `AudioBuffer` the peaks came from. Zoomed in beyond the peaks' finest
     * level, the waveform is drawn from them, down to single samples as a
     * line; without them, it shows the peaks as steps.
     */
    samples?: readonly Float32Array[] | undefined;
    /**
     * Seconds on the timeline where it starts.
     * @default 0
     */
    at?: number | undefined;
    /**
     * Seconds into the audio at its start, for a clip that starts later in its file.
     * @default 0
     */
    offset?: number | undefined;
    /**
     * Seconds it shows.
     * @default the rest of the audio after `offset`, growing with peaks that grow
     */
    duration?: number | undefined;
  };
}

// One buffer of columns for every waveform: tiles are drawn one at a time.
let columns = new Float32Array(0);

/** Paints peaks: one column per device pixel, from the maximum to the minimum around the middle. */
class WaveformPainter implements TilePainter {
  constructor(public source: WaveformSource) {}

  extent() {
    return { from: this.source.at, to: this.source.at + durationOf(this.source) };
  }

  paint(context: CanvasRenderingContext2D, { start, length, width, height }: TileStretch): void {
    const { peaks, samples, at, offset, channel } = this.source;
    if (columns.length < width * 2) columns = new Float32Array(width * 2);
    const read = columns.subarray(0, width * 2);
    readPeaks(peaks, read, { time: offset + (start - at), secondsPerColumn: length / width, channel, samples });
    const middle = height / 2;
    for (let x = 0; x < width; x++) {
      let top = middle - read[x * 2 + 1]! * middle;
      let bottom = middle - read[x * 2]! * middle;
      // Silence is a line one device pixel thick, as DAWs draw it.
      if (bottom - top < 1) {
        const center = (top + bottom) / 2;
        top = center - 0.5;
        bottom = center + 0.5;
      }
      context.fillRect(x, top, 1, bottom - top);
    }
  }
}

const sameAudio = (a: WaveformSource, b: WaveformSource) =>
  a.peaks === b.peaks && a.samples === b.samples && a.offset === b.offset && a.duration === b.duration && a.channel === b.channel;

/** Tiles of a waveform, which follow its source and the peaks as they grow. */
class WaveformDrawing {
  private readonly painter: WaveformPainter;
  private readonly tiles: TimeTiles;
  private unsubscribe: (() => void) | undefined;

  constructor(element: HTMLElement, view: TimelineView, source: WaveformSource) {
    this.painter = new WaveformPainter(source);
    this.tiles = new TimeTiles(element, view, this.painter, "item");
    this.listen(source.peaks);
  }

  update(source: WaveformSource): void {
    const previous = this.painter.source;
    this.painter.source = source;
    if (previous.peaks !== source.peaks) this.listen(source.peaks);
    // A move along the timeline changes no tile: only which ones are in view.
    if (sameAudio(previous, source)) this.tiles.cull();
    else this.tiles.reset();
  }

  destroy(): void {
    this.unsubscribe?.();
    this.tiles.destroy();
  }

  private listen(peaks: Peaks): void {
    this.unsubscribe?.();
    // Audio that arrives is drawn again from where it changed; the last tile grows with it.
    this.unsubscribe = peaks.subscribe?.((from) => {
      const { at, offset } = this.painter.source;
      this.tiles.invalidate(at + from - offset);
    });
  }
}

/** Keeps canvas tiles drawing the waveform inside the part's element. */
function useDrawing(context: WaveformContextValue, channel: number | undefined) {
  const source: WaveformSource = { ...context.source, channel };
  const latest = useRef(source);
  latest.current = source;
  const drawing = useRef<WaveformDrawing | null>(null);

  const { view } = context;
  const ref = useCallback(
    (element: HTMLElement | null) => {
      if (!element) return;
      const current = new WaveformDrawing(element, view, latest.current);
      drawing.current = current;
      return () => {
        current.destroy();
        drawing.current = null;
      };
    },
    [view],
  );
  // A render with other audio or another channel draws again; one that only moves it along the timeline does not.
  useIsomorphicLayoutEffect(() => {
    drawing.current?.update(latest.current);
  });
  return ref;
}

/**
 * The waveform, drawn on canvas in the CSS `color` of this element: style
 * it with `className="text-sky-600"`. Fills the root; for channels one
 * above the other, render one per channel and place them with `style`.
 */
export function WaveformShape({ channel, ...props }: WaveformShape.Props) {
  const context = useWaveformContext("Shape");
  const ref = useDrawing(context, channel);
  return useRenderPart("div", context.state, props, { ref, style: { position: "absolute", inset: 0 } });
}

export namespace WaveformShape {
  export type State = WaveformState;
  export type Props = Omit<PartProps<"div", State>, "children"> & {
    /**
     * The channel to draw.
     * @default all channels together
     */
    channel?: number | undefined;
  };
}

/**
 * The part of the waveform before the timeline's playhead, drawn over
 * `Waveform.Shape` in its own `color`. It is clipped in CSS from
 * `--timeline-position`: playback draws nothing.
 */
export function WaveformProgress({ channel, ...props }: WaveformProgress.Props) {
  const context = useWaveformContext("Progress");
  const ref = useDrawing(context, channel);
  const played = `(var(--timeline-position) - ${context.state.at}) * var(--timeline-scale)`;
  return useRenderPart("div", context.state, props, {
    ref,
    style: { position: "absolute", inset: 0, clipPath: `inset(0 max(0px, calc(100% - ${played})) 0 0)` },
  });
}

export namespace WaveformProgress {
  export type State = WaveformState;
  export type Props = WaveformShape.Props;
}
