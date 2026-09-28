import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { BarGraph, Keys, Notes, Timeline, Toggle, ToggleGroup } from "../../../src/react/index.js";
import { PADS } from "../engine/drums.js";
import type { MidiClip, Note, Track } from "../engine/project.js";
import { beatGrid, host, pitch, position } from "./state.js";

// The piano roll of a MIDI clip, as the piano roll block does it: the keys beside the notes on the clip's own
// timeline, and a velocity for each note under them. Press an empty place to draw a note, drag a note to move it,
// its right end to lengthen it; the secondary button or a double-click removes one. The keys and the notes drawn
// play on the track's instrument.

const ROW = 14;
const GRIDS = [
  { label: "1/32", beats: 1 / 8 },
  { label: "1/16", beats: 1 / 4 },
  { label: "1/8", beats: 1 / 2 },
  { label: "1/4", beats: 1 },
] as const;
const isBlack = (note: number) => [1, 3, 6, 8, 10].includes(note % 12);
const PAD_NAMES = new Map(PADS.map((pad) => [pad.note, pad.name]));

export function PianoRoll({ track, clip }: { track: Track; clip: MidiClip }) {
  const drums = track.instrument === "drums";
  const range = (drums ? [35, 51] : [24, 96]) as readonly [number, number];
  const pitches = useMemo(() => Array.from({ length: range[1] - range[0] + 1 }, (_, index) => range[1] - index), [range[0], range[1]]);
  const [grid, setGrid] = useState(0.25);
  const [length, setLength] = useState(drums ? 0.25 : 1);
  const [selected, setSelected] = useState<number | null>(null);
  // The note being dragged, drawn on its own layer, so that the others are not drawn again on every move.
  const [dragged, setDragged] = useState<Note | null>(null);
  const [resizing, setResizing] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const roll = useRef<HTMLDivElement>(null);
  // The note the last press drew, so that the double-click it began does not remove it.
  const drawn = useRef<{ id: number; time: number } | null>(null);
  const { notes } = clip;
  const start = clip.offset;
  const end = clip.offset + clip.duration;

  // Opens on the notes: their middle in the middle of the view; without notes, on middle C, or the hats.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const pitches = notes.map((note) => note.pitch);
    const middle = pitches.length > 0 ? (Math.max(...pitches) + Math.min(...pitches)) / 2 : drums ? 42 : 60;
    element.scrollTop = (range[1] - middle) * ROW - element.clientHeight / 2 + 28;
  }, [clip.id]);

  const shown = useMemo(() => (dragged ? notes.filter((note) => note.id !== dragged.id) : notes), [notes, dragged?.id]);
  const highlighted = useMemo(() => {
    const note = dragged ?? notes.find((one) => one.id === selected);
    return note ? [note] : [];
  }, [dragged, notes, selected]);
  const current = notes.find((note) => note.id === selected);

  const save = (next: Note[]) => host.updateClip(track.id, clip.id, (one) => ({ ...(one as MidiClip), notes: next }));
  const change = (note: Note) => save(notes.map((one) => (one.id === note.id ? note : one)));
  const snap = (time: number) => Math.round(time / grid) * grid;
  const clampPitch = (key: number) => Math.min(range[1], Math.max(range[0], key));
  const clampAt = (time: number, duration: number) => Math.min(end - Math.min(duration, grid), Math.max(start, time));

  /** Where a pointer is in the roll: beats of the clip's content, and pitch. */
  const cell = (event: { clientX: number; clientY: number }) => {
    const box = roll.current!.getBoundingClientRect();
    return { time: start + ((event.clientX - box.left) / box.width) * (end - start), key: range[1] - Math.floor((event.clientY - box.top) / ROW) };
  };
  const pixelsPerBeat = () => roll.current!.clientWidth / (end - start);
  const noteAt = (time: number, key: number) => notes.find((note) => note.pitch === key && note.at <= time && time < note.at + note.duration);
  /** Whether the pointer is at a note's right end, to lengthen it. */
  const atEnd = (note: Note, time: number) => (note.at + note.duration - time) * pixelsPerBeat() < 6 && note.duration * pixelsPerBeat() > 10;

  // A press on a note selects it and drags it, or its end; a press elsewhere draws a note. The secondary button
  // removes a note, as in FL Studio.
  const press = (event: PointerEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    const { time, key } = cell(event);
    const hit = noteAt(time, key);
    if (event.button === 2) {
      if (hit) save(notes.filter((note) => note.id !== hit.id));
      return;
    }
    if (event.button !== 0) return;
    element.focus({ preventScroll: true });
    if (!hit) {
      const note: Note = { id: Math.max(-1, ...notes.map((one) => one.id)) + 1, at: clampAt(Math.floor(time / grid) * grid, length), duration: length, pitch: key, velocity: 100 };
      save([...notes, note]);
      setSelected(note.id);
      drawn.current = { id: note.id, time: event.timeStamp };
      void host.preview(track.id, key);
      return;
    }
    setSelected(hit.id);
    const lengthen = atEnd(hit, time);
    element.setPointerCapture(event.pointerId);
    let moved = hit;
    const follow = (move: globalThis.PointerEvent) => {
      const target = cell(move);
      const next = lengthen
        ? { ...hit, duration: Math.max(grid, snap(hit.duration + target.time - time)) }
        : { ...hit, at: clampAt(snap(hit.at + target.time - time), hit.duration), pitch: clampPitch(hit.pitch + target.key - key) };
      if (next.at === moved.at && next.pitch === moved.pitch && next.duration === moved.duration) return;
      if (next.pitch !== moved.pitch) void host.preview(track.id, next.pitch);
      moved = next;
      setDragged(next);
    };
    const drop = () => {
      element.removeEventListener("pointermove", follow);
      element.removeEventListener("pointerup", drop);
      if (moved !== hit) {
        change(moved);
        setLength(moved.duration);
      }
      setDragged(null);
    };
    element.addEventListener("pointermove", follow);
    element.addEventListener("pointerup", drop);
  };

  // The pointer shows where a press lengthens a note.
  const hover = (event: PointerEvent<HTMLDivElement>) => {
    if (dragged) return;
    const { time, key } = cell(event);
    const hit = noteAt(time, key);
    setResizing(hit !== undefined && atEnd(hit, time));
  };

  const remove = (id: number) => {
    const sorted = [...notes].sort((a, b) => a.at - b.at || a.pitch - b.pitch);
    const index = sorted.findIndex((note) => note.id === id);
    save(notes.filter((note) => note.id !== id));
    setSelected(sorted[index + 1]?.id ?? sorted[index - 1]?.id ?? null);
  };

  // The keyboard does the same: arrows select a note, Up and Down move it a semitone (Shift: an octave),
  // Shift+Left and Shift+Right a step of the grid; Delete removes it.
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    const sorted = [...notes].sort((a, b) => a.at - b.at || a.pitch - b.pitch);
    const index = sorted.findIndex((note) => note.id === selected);
    const note = sorted[index];
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step && !event.shiftKey) setSelected(sorted[Math.min(sorted.length - 1, Math.max(0, index + step))]?.id ?? null);
    else if (note && step) change({ ...note, at: clampAt(note.at + step * grid, note.duration) });
    else if (note && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      const moved = { ...note, pitch: clampPitch(note.pitch + (event.key === "ArrowUp" ? 1 : -1) * (event.shiftKey ? 12 : 1)) };
      change(moved);
      void host.preview(track.id, moved.pitch);
    } else if (note && (event.key === "Delete" || event.key === "Backspace")) remove(note.id);
    else return;
    event.preventDefault();
    event.stopPropagation();
  };

  const label = (key: number) => (drums ? (PAD_NAMES.get(key) ?? pitch.format(key)) : key % 12 === 0 ? pitch.format(key) : "");
  const instrument = () => host.instruments.get(track.id)?.notes ?? [];

  return (
    <div className="roll" data-drums={drums || undefined}>
      <div className="roll-toolbar">
        <span className="roll-title" style={{ color: track.color }}>
          {track.name} · {clip.name}
        </span>
        <span className="roll-info">
          {current ? `${drums ? label(current.pitch) : pitch.format(current.pitch)} at ${position.format(current.at)}, velocity ${current.velocity}` : `${notes.length} notes`}
        </span>
        <ToggleGroup aria-label="Grid" value={[String(grid)]} onValueChange={(value) => value[0] && setGrid(Number(value[0]))} className="segmented">
          {GRIDS.map((one) => (
            <Toggle key={one.label} value={String(one.beats)} className="segment" aria-label={`Grid of ${one.label} notes`}>
              {one.label}
            </Toggle>
          ))}
        </ToggleGroup>
      </div>
      <div ref={scroller} className="roll-scroll">
        <div className="roll-keys">
          <div className="roll-corner" />
          <Keys.Root
            range={range}
            orientation="vertical"
            layout="rows"
            format={pitch}
            read={instrument}
            onPress={(key, { velocity }) => void host.noteOn(track.id, key, velocity)}
            onRelease={(key) => host.noteOff(track.id, key)}
            aria-label="Keys"
            style={{ height: pitches.length * ROW }}
          >
            {pitches.map((key) => (
              <Keys.Key key={key} note={key} className="roll-key">
                <span>{label(key)}</span>
              </Keys.Key>
            ))}
          </Keys.Root>
        </div>
        <Timeline.Root start={start} end={end} read={() => host.position() - clip.at + clip.offset} className="roll-timeline">
          <div className="ruler-row">
            <Timeline.Ruler grid={beatGrid} className="ruler" />
          </div>
          <div
            ref={roll}
            role="group"
            aria-label={`Notes of ${clip.name}`}
            tabIndex={0}
            onPointerDown={press}
            onPointerMove={hover}
            onDoubleClick={(event) => {
              const { time, key } = cell(event);
              const hit = noteAt(time, key);
              const fresh = drawn.current && drawn.current.id === hit?.id && event.timeStamp - drawn.current.time < 600;
              if (hit && !fresh) remove(hit.id);
            }}
            onKeyDown={keys}
            onContextMenu={(event) => event.preventDefault()}
            className="roll-notes"
            data-resizing={resizing || undefined}
          >
            {pitches.map((key) => (
              <div key={key} style={{ height: ROW }} className={isBlack(key) && !drums ? "roll-row black" : key % 12 === 0 && !drums ? "roll-row octave" : "roll-row"} />
            ))}
            <Timeline.Grid grid={beatGrid} className="grid-fine" />
            <Timeline.Grid grid={beatGrid} spacing={64} className="grid-coarse" />
            <Notes.Root notes={shown} range={range} aria-label="Notes" style={{ position: "absolute", inset: 0 }}>
              <Notes.Shape className="note" style={{ color: track.color }} />
              <Notes.Progress className="note-played" />
            </Notes.Root>
            <Notes.Root notes={highlighted} range={range} aria-hidden style={{ position: "absolute", inset: 0 }}>
              <Notes.Shape className="note-selected" />
            </Notes.Root>
          </div>
          <Timeline.Playhead className="playhead" />
        </Timeline.Root>
      </div>
      <div className="roll-velocity">
        <span className="roll-velocity-label">Velocity</span>
        <Timeline.Root start={start} end={end} className="roll-velocity-timeline">
          {/* One velocity per note, at the note's start: items placed on the timeline's axis. */}
          <BarGraph.Root
            key={notes.map((note) => note.id).join()}
            min={1}
            max={127}
            step={1}
            defaultValue={notes.map((note) => note.velocity)}
            onGestureEnd={(velocities) => save(notes.map((note, index) => ({ ...note, velocity: velocities[index]! })))}
            aria-label="Velocity"
          >
            <BarGraph.Control className="velocity-lane">
              {notes.map((note, index) => (
                <BarGraph.Item
                  key={note.id}
                  index={index}
                  aria-label={`${label(note.pitch) || pitch.format(note.pitch)} ${position.format(note.at)}`}
                  style={{ insetInlineStart: `calc((${(dragged?.id === note.id ? dragged : note).at} - var(--timeline-start)) * var(--timeline-scale))`, width: 6 }}
                  className="velocity-item"
                >
                  <BarGraph.Range className="velocity-bar" data-selected={note.id === selected || undefined} style={{ color: track.color }} />
                </BarGraph.Item>
              ))}
            </BarGraph.Control>
          </BarGraph.Root>
        </Timeline.Root>
      </div>
    </div>
  );
}
