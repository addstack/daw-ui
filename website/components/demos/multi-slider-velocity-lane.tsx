'use client';

import { Keys, MultiSlider, Notes, type Note } from '@addstack/daw-ui/react';

// A3 to C5, one row per semitone. 120 BPM: a beat is half a second. A made-up melody over chords: [beat, beats, pitch].
const range = [57, 72] as const;
const keys = Array.from({ length: range[1] - range[0] + 1 }, (_, index) => range[0] + index);
const melody: Note[] = (
  [[0, 1, 64], [1, 1, 67], [2, 2, 72], [4, 1, 71], [5, 1, 67], [6, 2, 69], [0, 4, 57], [0, 4, 60], [4, 4, 60], [4, 4, 64]] as const
).map(([beat, beats, pitch]) => ({ at: beat / 2, duration: beats / 2, pitch }));
const LENGTH = 4;

export default function VelocityLaneDemo() {
  return (
    <div className="grid w-full max-w-xl grid-cols-[3.5rem_1fr] grid-rows-[12rem_4rem] gap-y-1 overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-800">
      <Keys.Root range={range} orientation="vertical" layout="rows" aria-label="Keys" className="bg-white">
        {keys.map((note) => (
          <Keys.Key key={note} note={note} className="border-b border-neutral-300 bg-white data-black:w-3/5 data-black:border-0 data-black:bg-neutral-900 data-pressed:bg-orange-200" />
        ))}
      </Keys.Root>
      <Notes.Root notes={melody} range={range} duration={LENGTH} aria-label="Melody" className="bg-neutral-50 dark:bg-neutral-900">
        <Notes.Shape className="text-emerald-600" />
      </Notes.Root>
      <span className="self-center text-center text-[10px] text-neutral-500 uppercase">Vel</span>
      {/* One velocity per note, at the note's start: the items are placed by the application, on the notes' time. */}
      <MultiSlider.Root min={0} max={127} step={1} defaultValue={melody.map(() => 100)} aria-label="Velocity" className="bg-neutral-50 dark:bg-neutral-900">
        <MultiSlider.Control className="size-full cursor-crosshair">
          {melody.map((note, index) => (
            <MultiSlider.Item
              key={index}
              index={index}
              aria-label={`Note ${index + 1}`}
              style={{ insetInlineStart: `${(note.at / LENGTH) * 100}%`, width: 6 }}
              className="outline-offset-2 focus-visible:outline-2 focus-visible:outline-orange-500"
            >
              <MultiSlider.Range className="start-0 w-1.5 border-t-2 border-emerald-600 bg-emerald-600/20" />
            </MultiSlider.Item>
          ))}
        </MultiSlider.Control>
      </MultiSlider.Root>
    </div>
  );
}
