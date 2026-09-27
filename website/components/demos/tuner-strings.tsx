'use client';

import { formats } from '@addstack/daw-ui';
import { Tuner } from '@addstack/daw-ui/react';
import { useState } from 'react';

const pitch = formats.pitch({ names: ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'] });
// Standard tuning, E2 to E4, as MIDI notes.
const strings = [40, 45, 50, 55, 59, 64];

/** Made-up playing for the demo, as on the tuner's page. In an app, the frequency your pitch detector hears. */
function playing(now = performance.now() / 1000) {
  const string = strings[Math.floor(now / 4) % 6]!;
  const time = now % 4;
  if (time > 3.4) return null;
  const cents = (((Math.floor(now / 4) * 37) % 80) - 40) * Math.exp(-time * 1.4) + 1.5 * Math.sin(now * 9);
  return 440 * 2 ** ((string + cents / 100 - 69) / 12);
}

export default function StringsDemo() {
  // The string to tune to: none tunes to the nearest string, as guitar tuners do.
  const [target, setTarget] = useState<number>();

  return (
    <Tuner.Root read={() => playing()} targets={strings} target={target} format={pitch} tolerance={4} className="group flex w-full max-w-xs flex-col items-center gap-3 select-none">
      {/* An arc: the needle turns with the cents off, green in tune. */}
      <div className="relative h-28 w-56 overflow-hidden">
        <div className="absolute inset-x-0 top-2 aspect-square rounded-full border-8 border-neutral-200 dark:border-neutral-800" />
        <Tuner.Indicator className="absolute bottom-0 left-1/2 h-24 w-1 -translate-x-1/2 origin-bottom rounded-full bg-neutral-400 opacity-0 [rotate:calc(var(--tuner-offset)*60deg)] group-data-active:opacity-100 group-data-in-tune:bg-green-500" />
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-neutral-300 group-data-flat:text-orange-500" aria-hidden>▼</span>
        <Tuner.Note className="text-4xl font-semibold text-neutral-800 dark:text-neutral-100" />
        <span className="text-neutral-300 group-data-sharp:text-orange-500" aria-hidden>▲</span>
      </div>
      <Tuner.Cents className="font-mono text-xs text-neutral-500 tabular-nums" />
      {/* The strings: the one being tuned lights up; pressing one tunes to it alone. */}
      <div className="flex gap-1.5">
        {strings.map((note) => (
          <button
            key={note}
            type="button"
            aria-pressed={target === note}
            onClick={() => setTarget(target === note ? undefined : note)}
            className="rounded-full outline-offset-2 focus-visible:outline-2 focus-visible:outline-orange-500"
          >
            <Tuner.Mark
              note={note}
              className="grid size-9 place-items-center rounded-full border border-neutral-300 text-xs text-neutral-600 in-aria-pressed:border-orange-500 data-active:bg-neutral-800 data-active:text-white group-data-in-tune:data-active:bg-green-500 dark:border-neutral-700 dark:text-neutral-300"
            >
              {pitch.format(note)}
            </Tuner.Mark>
          </button>
        ))}
      </div>
    </Tuner.Root>
  );
}
