'use client';

import { formats, musicalGrid } from '@addstack/daw-ui';
import { Keys, BarGraph, Notes, Timeline, Toggle, type Note } from '@addstack/daw-ui/react';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

// 120 BPM: a beat is half a second, a bar 2 seconds. Four bars, looped.
const BEAT = 0.5;
const SIXTEENTH = BEAT / 4;
const LENGTH = 8;
const grid = musicalGrid({ bpm: 120 });
// C3 to C5, one row of 12 px per semitone, for the keys and the notes alike.
const range = [48, 72] as const;
const ROW = 12;
const pitches = Array.from({ length: range[1] - range[0] + 1 }, (_, index) => range[1] - index);
const isBlack = (pitch: number) => [1, 3, 6, 8, 10].includes(pitch % 12);
const pitch = formats.pitch({ names: ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'] });
const position = formats.position();

type EditedNote = Note & { id: number; velocity: number };

/** A made-up tune: [beat, beats, pitch, velocity]. In an app, the notes of a MIDI clip. */
const tune: EditedNote[] = (
  [
    [0, 1, 64, 110], [1, 1, 67, 80], [2, 2, 72, 120], [4, 1, 71, 90], [5, 1, 67, 70], [6, 2, 69, 100],
    [8, 1, 64, 110], [9, 1, 67, 80], [10, 1, 74, 120], [11, 1, 72, 90], [12, 4, 67, 100],
    [0, 4, 48, 90], [4, 4, 53, 90], [8, 4, 50, 90], [12, 4, 55, 90],
  ] as const
).map(([beat, beats, key, velocity], id) => ({ id, at: beat * BEAT, duration: beats * BEAT, pitch: key, velocity }));

/** A small synth for the demo: a triangle wave per note, as loud as its velocity. In an app, your audio engine. */
function createSynth() {
  let audio: AudioContext | null = null;
  const held = new Map<number, () => void>();
  const start = (key: number, velocity: number) => {
    const context = (audio ??= new AudioContext());
    const oscillator = new OscillatorNode(context, { type: 'triangle', frequency: 440 * 2 ** ((key - 69) / 12) });
    const gain = new GainNode(context, { gain: 0 });
    gain.gain.setTargetAtTime(0.2 * velocity, context.currentTime, 0.005);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    return () => {
      gain.gain.setTargetAtTime(0, context.currentTime, 0.08);
      oscillator.stop(context.currentTime + 1);
    };
  };
  return {
    /** Plays a note for `seconds`. */
    play: (key: number, velocity: number, seconds: number) => setTimeout(start(key, velocity), seconds * 1000),
    /** Holds a key until `release`. */
    press: (key: number, velocity: number) => held.set(key, start(key, velocity)),
    release: (key: number) => held.get(key)?.(),
  };
}

export default function PianoRollDemo() {
  const [synth] = useState(createSynth);
  const [notes, setNotes] = useState(tune);
  const [selected, setSelected] = useState<number | null>(null);
  // The note being dragged, drawn on its own layer, so that the others are not drawn again on every move.
  const [dragged, setDragged] = useState<EditedNote | null>(null);

  // The transport, outside React: whether it plays, where from and since when.
  const [playing, setPlaying] = useState(false);
  const transport = useRef({ playing: false, since: 0, from: 0 });
  const now = useCallback(() => {
    const { playing, since, from } = transport.current;
    return playing ? (from + (performance.now() - since) / 1000) % LENGTH : from;
  }, []);
  const notesNow = useRef(notes);
  notesNow.current = notes;
  // The keys of the notes under the playhead, once per frame.
  const sounding = () => {
    const time = now();
    return transport.current.playing ? notesNow.current.filter((note) => note.at <= time && time < note.at + note.duration).map((note) => note.pitch) : [];
  };
  // Plays the notes the playhead reaches.
  useEffect(() => {
    if (!playing) return;
    let last = now();
    let frame = requestAnimationFrame(function tick() {
      const time = now();
      for (const note of notesNow.current) {
        const reached = time < last ? note.at >= last || note.at < time : note.at >= last && note.at < time;
        if (reached) synth.play(note.pitch, note.velocity / 127, note.duration);
      }
      last = time;
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [playing, now, synth]);

  const shown = useMemo(() => (dragged ? notes.filter((note) => note.id !== dragged.id) : notes), [notes, dragged?.id]);
  const highlighted = useMemo(() => {
    const note = dragged ?? notes.find((one) => one.id === selected);
    return note ? [note] : [];
  }, [dragged, notes, selected]);
  const current = notes.find((note) => note.id === selected);
  const change = (note: EditedNote) => setNotes((all) => all.map((one) => (one.id === note.id ? note : one)));
  const snap = (time: number) => Math.min(LENGTH - SIXTEENTH, Math.max(0, Math.round(time / SIXTEENTH) * SIXTEENTH));
  const clampPitch = (key: number) => Math.min(range[1], Math.max(range[0], key));

  /** Where a pointer is in the roll: seconds and pitch. */
  const cell = (event: { clientX: number; clientY: number; currentTarget: Element }) => {
    const box = event.currentTarget.getBoundingClientRect();
    return { time: ((event.clientX - box.left) / box.width) * LENGTH, key: range[1] - Math.floor((event.clientY - box.top) / ROW) };
  };
  const noteAt = (time: number, key: number) => notes.find((note) => note.pitch === key && note.at <= time && time < note.at + note.duration);

  // A press on a note selects it and drags it, in sixteenths and semitones; a press elsewhere adds a note of a beat.
  // The secondary button removes a note, as in FL Studio.
  const press = (event: PointerEvent<HTMLDivElement>) => {
    const roll = event.currentTarget;
    const { time, key } = cell(event);
    const hit = noteAt(time, key);
    if (event.button === 2) {
      if (hit) setNotes(notes.filter((note) => note.id !== hit.id));
      return;
    }
    if (event.button !== 0) return;
    if (!hit) {
      const note = { id: Math.max(-1, ...notes.map((one) => one.id)) + 1, at: Math.floor(time / SIXTEENTH) * SIXTEENTH, duration: BEAT, pitch: key, velocity: 100 };
      setNotes([...notes, note]);
      setSelected(note.id);
      synth.play(key, 0.8, 0.25);
      return;
    }
    setSelected(hit.id);
    roll.setPointerCapture(event.pointerId);
    let moved = hit;
    const follow = (move: globalThis.PointerEvent) => {
      const target = cell({ clientX: move.clientX, clientY: move.clientY, currentTarget: roll });
      const next = { ...hit, at: snap(hit.at + target.time - time), pitch: clampPitch(hit.pitch + target.key - key) };
      if (next.at === moved.at && next.pitch === moved.pitch) return;
      if (next.pitch !== moved.pitch) synth.play(next.pitch, 0.8, 0.15);
      moved = next;
      setDragged(next);
    };
    const drop = () => {
      roll.removeEventListener('pointermove', follow);
      roll.removeEventListener('pointerup', drop);
      if (moved !== hit) change(moved);
      setDragged(null);
    };
    roll.addEventListener('pointermove', follow);
    roll.addEventListener('pointerup', drop);
  };

  // The keyboard does the same: arrows select a note, Up and Down move it a semitone (Shift: an octave),
  // Shift+Left and Shift+Right a sixteenth; Delete removes it.
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    const sorted = [...notes].sort((a, b) => a.at - b.at || a.pitch - b.pitch);
    const index = sorted.findIndex((note) => note.id === selected);
    const note = sorted[index];
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step && !event.shiftKey) setSelected(sorted[Math.min(sorted.length - 1, Math.max(0, index + step))]?.id ?? null);
    else if (note && step) change({ ...note, at: snap(note.at + step * SIXTEENTH) });
    else if (note && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      const moved = { ...note, pitch: clampPitch(note.pitch + (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 12 : 1)) };
      change(moved);
      synth.play(moved.pitch, 0.8, 0.15);
    } else if (note && (event.key === 'Delete' || event.key === 'Backspace')) {
      setNotes(notes.filter((one) => one.id !== note.id));
      setSelected(sorted[index + 1]?.id ?? sorted[index - 1]?.id ?? null);
    } else return;
    event.preventDefault();
  };

  return (
    <div className="flex w-full max-w-2xl overflow-hidden rounded-md bg-neutral-900 text-white select-none">
      {/* The keys, a column beside the timeline, as tall as its rows. */}
      <div className="w-16 shrink-0 border-e border-neutral-800">
        <div className="flex h-6 items-center justify-center border-b border-neutral-800">
          <Toggle
            aria-label="Play"
            onPressedChange={(next) => {
              transport.current = { playing: next, since: performance.now(), from: now() };
              setPlaying(next);
            }}
            className="flex size-5 items-center justify-center rounded-sm bg-neutral-800 text-neutral-300 data-pressed:bg-emerald-600 data-pressed:text-white"
          >
            <svg viewBox="0 0 10 10" className="size-2.5 fill-current" aria-hidden>
              <path d={playing ? 'M1 1h8v8H1z' : 'M2 1l7 4-7 4z'} />
            </svg>
          </Toggle>
        </div>
        <Keys.Root
          range={range}
          orientation="vertical"
          layout="rows"
          format={pitch}
          read={sounding}
          onPress={(key, { velocity }) => synth.press(key, velocity)}
          onRelease={synth.release}
          aria-label="Keys"
          style={{ height: pitches.length * ROW }}
        >
          {pitches.map((key) => (
            <Keys.Key
              key={key}
              note={key}
              className="flex items-center justify-end border-b border-neutral-300 bg-neutral-100 text-[8px] text-neutral-500 data-black:w-3/5 data-black:border-0 data-black:bg-neutral-950 data-held:bg-emerald-300 data-pressed:bg-orange-300"
            >
              {key % 12 === 0 && <span className="pe-1">{pitch.format(key)}</span>}
            </Keys.Key>
          ))}
        </Keys.Root>
        <output className="flex h-16 flex-col justify-center border-t border-neutral-800 px-1.5 font-mono text-[10px] text-neutral-400">
          {current ? (
            <>
              <span className="text-white">{pitch.format(current.pitch)}</span>
              <span>{position.format(current.at / BEAT)}</span>
            </>
          ) : (
            'Velocity'
          )}
        </output>
      </div>

      <Timeline.Root start={0} end={LENGTH} read={now} className="flex-1">
        <Timeline.Ruler grid={grid} className="h-6 border-b border-neutral-800 font-mono text-[10px] text-neutral-400 [&_[data-label]]:top-0.5 [&_[data-label]]:ps-1" />
        {/* The roll: rows of the page's own, darker for black keys, the grid, and the notes on the timeline. */}
        <div
          role="group"
          aria-label="Notes"
          tabIndex={0}
          onPointerDown={press}
          onKeyDown={keys}
          onContextMenu={(event) => event.preventDefault()}
          className="relative cursor-cell outline-offset-[-2px] focus-visible:outline-2 focus-visible:outline-orange-500">
          {pitches.map((key) => (
            <div key={key} style={{ height: ROW }} className={`border-b border-black/30 ${isBlack(key) ? 'bg-black/25' : ''}`} />
          ))}
          <Timeline.Grid grid={grid} className="text-white/5" />
          <Timeline.Grid grid={grid} spacing={64} className="text-white/15" />
          <Notes.Root notes={shown} range={range} aria-label="Notes" style={{ position: 'absolute', inset: 0 }}>
            <Notes.Shape className="text-emerald-600" />
            <Notes.Progress className="text-emerald-400" />
          </Notes.Root>
          {/* The selected or dragged note, over the others. */}
          <Notes.Root notes={highlighted} range={range} aria-hidden style={{ position: 'absolute', inset: 0 }}>
            <Notes.Shape className="text-amber-400" />
          </Notes.Root>
        </div>
        {/* One velocity per note, at the note's start: items placed on the timeline's axis. */}
        <BarGraph.Root
          key={notes.map((note) => note.id).join()}
          min={0}
          max={127}
          step={1}
          defaultValue={notes.map((note) => note.velocity)}
          onGestureEnd={(velocities) => setNotes((all) => all.map((note, index) => ({ ...note, velocity: velocities[index]! })))}
          aria-label="Velocity"
        >
          <BarGraph.Control className="h-16 cursor-crosshair border-t border-neutral-800">
            {notes.map((note, index) => (
              <BarGraph.Item
                key={note.id}
                index={index}
                aria-label={`${pitch.format(note.pitch)} ${position.format(note.at / BEAT)}`}
                style={{ insetInlineStart: `calc((${(dragged?.id === note.id ? dragged : note).at} - var(--timeline-start)) * var(--timeline-scale))`, width: 6 }}
                className="outline-offset-2 focus-visible:outline-2 focus-visible:outline-orange-500"
              >
                <BarGraph.Range className={`start-0 w-1.5 border-t-2 ${note.id === selected ? 'border-amber-400 bg-amber-400/30' : 'border-emerald-500 bg-emerald-500/20'}`} />
              </BarGraph.Item>
            ))}
          </BarGraph.Control>
        </BarGraph.Root>
        <Timeline.Playhead className="pointer-events-none w-px bg-white" />
      </Timeline.Root>
    </div>
  );
}
