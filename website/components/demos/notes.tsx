'use client';

import { Notes, type Note } from '@addstack/daw-ui/react';
import { useRef } from 'react';

// 120 BPM: a beat is half a second, a sixteenth an eighth of one.
const BEAT = 0.5;

/** Notes on a grid of sixteenths: [sixteenth, length in sixteenths, pitch]. */
const clip = (steps: [number, number, number][]): Note[] =>
  steps.map(([step, length, pitch]) => ({ at: (step * BEAT) / 4, duration: (length * BEAT) / 4, pitch }));

// Made-up clips for the demo, two bars each. In an app, they come from MIDI files or from the song.
const clips = [
  { name: 'Chords', notes: clip([0, 16].flatMap((step, bar) => [0, 4, 7].map((third) => [step, 14, [57, 53][bar]! + third] as [number, number, number]))) },
  { name: 'Bass', notes: clip(Array.from({ length: 8 }, (_, index) => [index * 4, 3, [45, 45, 41, 41, 43, 43, 40, 40][index]!] as [number, number, number])) },
  { name: 'Hats', notes: clip(Array.from({ length: 16 }, (_, index) => [index * 2, 1, index % 4 === 2 ? 46 : 42] as [number, number, number])) },
];

export default function NotesDemo() {
  // Which clip plays and since when: outside React, as a player would keep it.
  const playing = useRef<{ index: number; since: number } | null>(null);
  const position = (index: number) => {
    const current = playing.current;
    return current?.index === index ? (performance.now() - current.since) / 1000 : 0;
  };

  return (
    <ul className="flex w-full max-w-sm flex-col gap-2">
      {clips.map((one, index) => (
        <li key={one.name}>
          <button
            type="button"
            onClick={() => (playing.current = { index, since: performance.now() })}
            className="flex w-full items-center gap-3 rounded-md border border-neutral-200 p-2 text-start focus-visible:outline-2 focus-visible:outline-orange-500 dark:border-neutral-800"
          >
            <span className="w-12 text-xs text-neutral-500">{one.name}</span>
            {/* On its own, notes are their own axis: the clip across their width, one row per pitch it uses. */}
            <Notes.Root notes={one.notes} duration={4} read={() => position(index)} aria-label={one.name} className="h-10 flex-1">
              <Notes.Shape className="text-neutral-400 dark:text-neutral-600" />
              <Notes.Progress className="text-emerald-500" />
            </Notes.Root>
          </button>
        </li>
      ))}
    </ul>
  );
}
