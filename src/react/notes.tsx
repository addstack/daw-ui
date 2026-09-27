"use client";

import { createContext, useContext } from "react";

import { ContentPainter, useContentAxis, useContentDrawing, usePlayedClip, type ContentAxis, type ContentKind, type ContentState } from "./content.js";
import { useMergedRef, useRenderPart, type PartProps } from "./render.js";
import type { TileStretch } from "./time-tiles.js";

/** A note of a MIDI clip or a pattern. */
export type Note = {
  /** Seconds into the content where it starts: from the start of the clip, not of the song. */
  at: number;
  /** Seconds it lasts. */
  duration: number;
  /** Its pitch: a MIDI note number, or any number that orders notes from low to high. */
  pitch: number;
};

export type NotesState = ContentState;

/** Notes sorted by start, to find the ones in a tile quickly. */
type NotesIndex = {
  sorted: readonly Note[];
  /** The longest note, in seconds: a note that reaches into a tile starts at most this long before it. */
  longest: number;
  /** Where the last note ends. */
  end: number;
  lowest: number;
  highest: number;
};

// Indexed once per array of notes, for the root and every part that draws them.
const indexes = new WeakMap<readonly Note[], NotesIndex>();

function indexNotes(notes: readonly Note[]): NotesIndex {
  let index = indexes.get(notes);
  if (index) return index;
  const sorted = [...notes].sort((a, b) => a.at - b.at);
  let longest = 0;
  let end = 0;
  let lowest = Infinity;
  let highest = -Infinity;
  for (const note of sorted) {
    longest = Math.max(longest, note.duration);
    end = Math.max(end, note.at + note.duration);
    lowest = Math.min(lowest, note.pitch);
    highest = Math.max(highest, note.pitch);
  }
  index = { sorted, longest, end, lowest, highest };
  indexes.set(notes, index);
  return index;
}

/** What notes draw: the notes, and the pitches from the lowest to the highest row. */
type NotesSource = { index: NotesIndex; lowest: number; highest: number };

type NotesContextValue = { axis: ContentAxis; source: NotesSource };

const NotesContext = createContext<NotesContextValue | null>(null);

function useNotesContext(part: string): NotesContextValue {
  const context = useContext(NotesContext);
  if (!context) throw new Error(`<Notes.${part}> must be placed inside <Notes.Root>.`);
  return context;
}

/**
 * The notes of a MIDI clip or a pattern, drawn as bars: in time across,
 * and one row per pitch, the highest at the top. In a `Region.Root`, it
 * shows the part of the clip the region shows, from its `offset` for its
 * `duration`, on the timeline's axis, and follows the region without
 * rendering. On its own, as the preview of a clip in a browser, it shows
 * `offset` … `offset + duration` across its width, and takes its playhead
 * from `position` or `read`.
 *
 * It only shows notes: editing them is for an engine the application owns.
 * Size it with CSS; in a region, it spans the region's width. Renders a
 * `div` with `role="img"`: name it with `aria-label`, in the application's
 * language.
 */
export function NotesRoot({ notes, range, offset = 0, duration, position, read, ...props }: NotesRoot.Props) {
  const index = indexNotes(notes);
  const axis = useContentAxis({ length: () => index.end, offset, duration, position, read });
  const source: NotesSource = { index, lowest: range?.[0] ?? index.lowest, highest: range?.[1] ?? index.highest };
  const rendered = useRenderPart("div", axis.state, props, { role: "img", ...axis.root });
  return <NotesContext.Provider value={{ axis, source }}>{rendered}</NotesContext.Provider>;
}

export namespace NotesRoot {
  export type State = NotesState;
  export type Props = PartProps<"div", State> & {
    /**
     * The notes, in seconds of the clip. A new array draws them again: keep
     * the same one between renders while the notes stay the same.
     */
    notes: readonly Note[];
    /**
     * The lowest and highest pitch it shows, one row each, as the keys beside
     * a piano roll. Notes outside are not drawn.
     * @default the lowest and highest pitch of the notes
     */
    range?: readonly [lowest: number, highest: number] | undefined;
    /**
     * On its own: seconds into the clip at its left edge. In a region, the region's `offset` applies.
     * @default 0
     */
    offset?: number | undefined;
    /**
     * On its own: seconds across its width. In a region, the region's `duration` applies.
     * @default the rest of the notes after `offset`
     */
    duration?: number | undefined;
    /** On its own: the playhead, in seconds of the clip, for `Notes.Progress`. In a timeline, the timeline's applies. */
    position?: number | undefined;
    /** On its own: returns the playhead in seconds of the clip; called once per animation frame. */
    read?: (() => number) | undefined;
  };
}

/** The first of `notes`, sorted by start, that starts at or after `time`. */
function firstFrom(notes: readonly Note[], time: number): number {
  let low = 0;
  let high = notes.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (notes[middle]!.at < time) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Paints notes as bars, snapped to device pixels, at least one pixel wide and tall. */
class NotesPainter extends ContentPainter<NotesSource> {
  extent() {
    return { from: 0, to: this.source.index.end };
  }

  paint(context: CanvasRenderingContext2D, { start, length, width, height }: TileStretch): void {
    const { index, lowest, highest } = this.source;
    const rows = highest - lowest + 1;
    if (!(rows > 0)) return;
    const row = height / rows;
    const perSecond = width / length;
    const end = start + length;
    const { sorted } = index;
    for (let i = firstFrom(sorted, start - index.longest); i < sorted.length; i++) {
      const note = sorted[i]!;
      if (note.at >= end) break;
      if (note.at + note.duration <= start || note.pitch < lowest || note.pitch > highest) continue;
      const left = Math.round((note.at - start) * perSecond);
      const right = Math.round((note.at + note.duration - start) * perSecond);
      const top = Math.round((highest - note.pitch) * row);
      const bottom = Math.round((highest - note.pitch + 1) * row);
      context.fillRect(left, top, Math.max(1, right - left), Math.max(1, bottom - top));
    }
  }
}

const notesKind: ContentKind<NotesSource> = {
  same: (a, b) => a.index === b.index && a.lowest === b.lowest && a.highest === b.highest,
};

const createPainter = (...args: ConstructorParameters<typeof NotesPainter>) => new NotesPainter(...args);

function useNotesDrawing(part: string) {
  const { axis, source } = useNotesContext(part);
  const drawing = useContentDrawing(axis, source, createPainter, notesKind);
  return { axis, drawing };
}

/**
 * The notes, drawn on canvas in the CSS `color` of this element: style it
 * with `className="text-emerald-500"`. Fills the root.
 */
export function NotesShape(props: NotesShape.Props) {
  const { axis, drawing } = useNotesDrawing("Shape");
  return useRenderPart("div", axis.state, props, { ref: drawing, style: { position: "absolute", inset: 0 } });
}

export namespace NotesShape {
  export type State = NotesState;
  export type Props = Omit<PartProps<"div", State>, "children">;
}

/**
 * The notes before the playhead, drawn over `Notes.Shape` in its own
 * `color`. It is clipped in CSS at the playhead: playback rewrites its
 * `clip-path` and draws nothing.
 */
export function NotesProgress(props: NotesProgress.Props) {
  const { axis, drawing } = useNotesDrawing("Progress");
  const played = usePlayedClip(axis);
  const ref = useMergedRef(drawing, played.ref);
  return useRenderPart("div", axis.state, props, { ref, style: { position: "absolute", inset: 0, clipPath: played.clipPath } });
}

export namespace NotesProgress {
  export type State = NotesState;
  export type Props = NotesShape.Props;
}
