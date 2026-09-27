'use client';

import { Keys, Notes, type Note } from '@addstack/daw-ui/react';
import { useRef } from 'react';

// A3 to C5, one row per semitone, for the keys and the notes alike.
const range = [57, 72] as const;
const keys = Array.from({ length: range[1] - range[0] + 1 }, (_, index) => range[0] + index);
// 120 BPM: a beat is half a second. A made-up melody of two bars: [beat, beats, pitch].
const melody: Note[] = (
  [[0, 1, 64], [1, 1, 67], [2, 2, 72], [4, 1, 71], [5, 1, 67], [6, 2, 69], [0, 4, 57], [4, 4, 60], [2, 2, 60], [6, 2, 64]] as const
).map(([beat, beats, pitch]) => ({ at: beat / 2, duration: beats / 2, pitch }));
const LENGTH = 4;

export default function PianoRollDemo() {
  // The loop's playhead, outside React, as a player would keep it.
  const start = useRef<number | null>(null);
  const position = () => ((performance.now() - (start.current ??= performance.now())) / 1000) % LENGTH;
  // The keys of the notes under the playhead, once per frame.
  const sounding = () => {
    const time = position();
    return melody.filter((note) => note.at <= time && time < note.at + note.duration).map((note) => note.pitch);
  };

  return (
    <div className="flex h-64 w-full max-w-xl overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-800">
      {/* "rows" gives every semitone the same height, so the keys line up with the rows of the notes beside them. */}
      <Keys.Root range={range} orientation="vertical" layout="rows" read={sounding} aria-label="Keys" className="w-14 shrink-0 bg-white">
        {keys.map((note) => (
          <Keys.Key
            key={note}
            note={note}
            className="border-b border-neutral-300 bg-white outline-offset-[-2px] focus-visible:outline-2 focus-visible:outline-orange-500 data-black:w-3/5 data-black:border-0 data-black:bg-neutral-900 data-held:bg-emerald-300 data-pressed:bg-orange-200 data-black:data-held:bg-emerald-600 data-black:data-pressed:bg-orange-500"
          />
        ))}
      </Keys.Root>
      <Notes.Root
        notes={melody}
        range={range}
        duration={LENGTH}
        read={position}
        aria-label="Melody"
        className="flex-1 bg-neutral-50 bg-[linear-gradient(to_bottom,rgb(0_0_0/0.06)_1px,transparent_1px)] bg-[size:100%_calc(100%/16)] dark:bg-neutral-900 dark:bg-[linear-gradient(to_bottom,rgb(255_255_255/0.06)_1px,transparent_1px)]"
      >
        <Notes.Shape className="text-emerald-600" />
        <Notes.Progress className="text-emerald-400" />
      </Notes.Root>
    </div>
  );
}
