"use client";

import { createContext, useContext } from "react";

import { readPeaks, type Peaks } from "../core/index.js";
import { ContentPainter, useContentAxis, useContentDrawing, usePlayedClip, type ContentAxis, type ContentKind, type ContentState } from "./content.js";
import { useMergedRef, useRenderPart, type PartProps } from "./render.js";
import type { TileStretch } from "./time-tiles.js";

export type WaveformState = ContentState;

/** What a waveform draws. */
type WaveformSource = {
  peaks: Peaks;
  samples: readonly Float32Array[] | undefined;
  channel: number | undefined;
};

type WaveformContextValue = { axis: ContentAxis; source: Omit<WaveformSource, "channel"> };

const WaveformContext = createContext<WaveformContextValue | null>(null);

function useWaveformContext(part: string): WaveformContextValue {
  const context = useContext(WaveformContext);
  if (!context) throw new Error(`<Waveform.${part}> must be placed inside <Waveform.Root>.`);
  return context;
}

/**
 * Audio, drawn from its peaks. In a `Region.Root`, it shows the part of the
 * audio the region shows, from its `offset` for its `duration`, on the
 * timeline's axis, and follows the region without rendering. On its own,
 * as the preview of a sample, it shows `offset` … `offset + duration`
 * across its width, and takes its playhead from `position` or `read`.
 *
 * Size it with CSS; in a region, it spans the region's width. Renders a
 * `div` with `role="img"`: name it with `aria-label`, in the application's
 * language.
 */
export function WaveformRoot({ peaks, samples, offset = 0, duration, position, read, ...props }: WaveformRoot.Props) {
  // Peaks that grow, as while recording, lengthen a waveform on its own without rendering.
  const axis = useContentAxis({ length: () => peaks.duration, offset, duration, position, read, subscribe: peaks.subscribe });
  const rendered = useRenderPart("div", axis.state, props, { role: "img", ...axis.root });
  return <WaveformContext.Provider value={{ axis, source: { peaks, samples } }}>{rendered}</WaveformContext.Provider>;
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

/** Paints peaks: one column per device pixel, from the maximum to the minimum around the middle. */
class WaveformPainter extends ContentPainter<WaveformSource> {
  extent() {
    return { from: 0, to: this.source.peaks.duration };
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

const audio: ContentKind<WaveformSource> = {
  same: (a, b) => a.peaks === b.peaks && a.samples === b.samples && a.channel === b.channel,
  // Audio that arrives is drawn again from where it changed; the last tile grows with it.
  changes: (source, changed) => source.peaks.subscribe?.(changed),
};

const createPainter = (...args: ConstructorParameters<typeof WaveformPainter>) => new WaveformPainter(...args);

function useWaveformDrawing(part: string, channel: number | undefined) {
  const { axis, source } = useWaveformContext(part);
  const drawing = useContentDrawing(axis, { ...source, channel }, createPainter, audio);
  return { axis, drawing };
}

/**
 * The waveform, drawn on canvas in the CSS `color` of this element: style
 * it with `className="text-sky-600"`. Fills the root; for channels one
 * above the other, render one per channel and place them with `style`.
 */
export function WaveformShape({ channel, ...props }: WaveformShape.Props) {
  const { axis, drawing } = useWaveformDrawing("Shape", channel);
  return useRenderPart("div", axis.state, props, { ref: drawing, style: { position: "absolute", inset: 0 } });
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
  const { axis, drawing } = useWaveformDrawing("Progress", channel);
  const played = usePlayedClip(axis);
  const ref = useMergedRef(drawing, played.ref);
  return useRenderPart("div", axis.state, props, { ref, style: { position: "absolute", inset: 0, clipPath: played.clipPath } });
}

export namespace WaveformProgress {
  export type State = WaveformState;
  export type Props = WaveformShape.Props;
}
