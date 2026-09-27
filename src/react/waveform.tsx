"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties } from "react";

import { readPeaks, type Peaks } from "../core/index.js";
import { useMergedRef, useRenderPart, type PartProps } from "./render.js";
import { TimeTiles, type TilePainter, type TileStretch } from "./time-tiles.js";
import { RegionPlacement, useOptionalRegion, useTimelineView, type TimelineView } from "./timeline.js";
import { useIsomorphicLayoutEffect } from "./value-control.js";

export type WaveformState = { offset: number; duration: number };

/** What a waveform draws. */
type WaveformSource = {
  peaks: Peaks;
  samples: readonly Float32Array[] | undefined;
  channel: number | undefined;
};

type WaveformContextValue = {
  view: TimelineView;
  placement: RegionPlacement;
  state: WaveformState;
  source: Omit<WaveformSource, "channel">;
};

const WaveformContext = createContext<WaveformContextValue | null>(null);

function useWaveformContext(part: string): WaveformContextValue {
  const context = useContext(WaveformContext);
  if (!context) throw new Error(`<Waveform.${part}> must be placed inside <Waveform.Root>.`);
  return context;
}

/**
 * Audio, drawn from its peaks. In a `Timeline.Region`, it shows the part
 * of the audio the region shows, from its `offset` for its `duration`, on
 * the timeline's axis, and follows the region without rendering. On its
 * own, as the preview of a sample, it shows `offset` … `offset + duration`
 * across its width, and takes its playhead from `position` or `read`.
 *
 * Size it with CSS; in a region, it spans the region's width. Renders a
 * `div` with `role="img"`: name it with `aria-label`, in the application's
 * language.
 */
export function WaveformRoot({ peaks, samples, offset = 0, duration, position, read, ...props }: WaveformRoot.Props) {
  const region = useOptionalRegion();
  const own = region === null;
  const length = () => duration ?? Math.max(0, peaks.duration - offset);

  // On its own, the waveform is its own axis: 0 … its duration across its width, where 0 is `offset` in the audio.
  const axis = useTimelineView(
    {
      start: 0,
      end: Math.max(length(), 0.001),
      position: (position ?? offset) - offset,
      read: read && (() => read() - offset),
    },
    own,
  );
  const [ownPlacement] = useState(() => new RegionPlacement(0, length(), offset));
  useIsomorphicLayoutEffect(() => ownPlacement.set(0, length(), offset));

  // Peaks that grow, as while recording, lengthen a waveform on its own without rendering.
  useEffect(() => {
    if (!own || duration !== undefined || !peaks.subscribe) return;
    return peaks.subscribe(() => {
      ownPlacement.set(0, length(), offset);
      axis.view.set(0, Math.max(length(), 0.001));
    });
  });

  const view = region?.view ?? axis.view;
  const placement = region?.placement ?? ownPlacement;
  const state: WaveformState = region ? { offset: region.placement.offset, duration: region.placement.duration } : { offset, duration: length() };
  const rendered = useRenderPart("div", state, props, {
    role: "img",
    ...(own
      ? {
          ref: axis.ref,
          style: { position: "relative", overflow: "hidden", ...axis.style } as CSSProperties,
        }
      : { style: { position: "relative", overflow: "hidden" } }),
  });
  return (
    <WaveformContext.Provider value={{ view, placement, state, source: { peaks, samples } }}>{rendered}</WaveformContext.Provider>
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
     * On its own: seconds into the audio at its left edge. In a region, the region's `offset` applies.
     * @default 0
     */
    offset?: number | undefined;
    /**
     * On its own: seconds across its width. In a region, the region's `duration` applies.
     * @default the rest of the audio after `offset`, growing with peaks that grow
     */
    duration?: number | undefined;
    /** On its own: the playhead, in seconds of the audio, for `Waveform.Progress`. In a timeline, the timeline's applies. */
    position?: number | undefined;
    /** On its own: returns the playhead in seconds of the audio; called once per animation frame. */
    read?: (() => number) | undefined;
  };
}

// One buffer of columns for every waveform: tiles are drawn one at a time.
let columns = new Float32Array(0);

/**
 * Paints peaks: one column per device pixel, from the maximum to the
 * minimum around the middle. Tiles are in seconds of audio, so moving or
 * trimming the region only places them again, and draws only what comes
 * into view.
 */
class WaveformPainter implements TilePainter {
  constructor(
    public source: WaveformSource,
    private readonly view: TimelineView,
    private readonly placement: RegionPlacement,
  ) {}

  extent() {
    return { from: 0, to: this.source.peaks.duration };
  }

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

  paint(context: CanvasRenderingContext2D, { start, length, width, height }: TileStretch): void {
    const { peaks, samples, channel } = this.source;
    if (columns.length < width * 2) columns = new Float32Array(width * 2);
    const read = columns.subarray(0, width * 2);
    readPeaks(peaks, read, { time: start, secondsPerColumn: length / width, channel, samples });
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
  a.peaks === b.peaks && a.samples === b.samples && a.channel === b.channel;

/** Tiles of a waveform, which follow its audio as it grows and its placement as it moves. */
class WaveformDrawing {
  private readonly painter: WaveformPainter;
  private readonly tiles: TimeTiles;
  private unsubscribePeaks: (() => void) | undefined;
  private readonly unsubscribePlacement: () => void;

  constructor(element: HTMLElement, view: TimelineView, placement: RegionPlacement, source: WaveformSource) {
    this.painter = new WaveformPainter(source, view, placement);
    this.tiles = new TimeTiles(element, view, this.painter);
    this.listen(source.peaks);
    // Moving, trimming or lengthening the region draws nothing already drawn: a new offset places the tiles again,
    // and the change of what is in view draws what comes into it.
    let offset = placement.offset;
    this.unsubscribePlacement = placement.subscribe(() => {
      if (placement.offset !== offset) {
        offset = placement.offset;
        this.tiles.reposition();
      }
      this.tiles.cull();
    });
  }

  update(source: WaveformSource): void {
    const previous = this.painter.source;
    this.painter.source = source;
    if (previous.peaks !== source.peaks) this.listen(source.peaks);
    if (sameAudio(previous, source)) this.tiles.cull();
    else this.tiles.reset();
  }

  destroy(): void {
    this.unsubscribePeaks?.();
    this.unsubscribePlacement();
    this.tiles.destroy();
  }

  private listen(peaks: Peaks): void {
    this.unsubscribePeaks?.();
    // Audio that arrives is drawn again from where it changed; the last tile grows with it.
    this.unsubscribePeaks = peaks.subscribe?.((from) => this.tiles.invalidate(from));
  }
}

/** Keeps canvas tiles drawing the waveform inside the part's element. */
function useDrawing(context: WaveformContextValue, channel: number | undefined) {
  const source: WaveformSource = { ...context.source, channel };
  const latest = useRef(source);
  latest.current = source;
  const drawing = useRef<WaveformDrawing | null>(null);

  const { view, placement } = context;
  const ref = useCallback(
    (element: HTMLElement | null) => {
      if (!element) return;
      const current = new WaveformDrawing(element, view, placement, latest.current);
      drawing.current = current;
      return () => {
        current.destroy();
        drawing.current = null;
      };
    },
    [view, placement],
  );
  // A render with other audio or another channel draws again; any other render does not.
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
 * The part of the waveform before the playhead, drawn over
 * `Waveform.Shape` in its own `color`. It is clipped in CSS at the
 * playhead: playback rewrites its `clip-path` and draws nothing.
 */
export function WaveformProgress({ channel, ...props }: WaveformProgress.Props) {
  const context = useWaveformContext("Progress");
  const drawing = useDrawing(context, channel);
  const { placement, view } = context;
  // The playhead, and a region that moves, clip the played part without rendering.
  const follow = useCallback(
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
  const ref = useMergedRef(drawing, follow);
  return useRenderPart("div", context.state, props, {
    ref,
    style: { position: "absolute", inset: 0, clipPath: playedClip(placement.at, view.position) },
  });
}

/**
 * Clips a progress layer to the part before the playhead, for a region that
 * starts `at` seconds on the timeline: the numbers written in, no CSS
 * variable of its own.
 */
const playedClip = (at: number, position: number) =>
  `inset(0 max(0px, calc(100% - ${position - at} * var(--timeline-scale))) 0 0)`;

export namespace WaveformProgress {
  export type State = WaveformState;
  export type Props = WaveformShape.Props;
}
