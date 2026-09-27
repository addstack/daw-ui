'use client';

import { formats } from '@addstack/daw-ui';
import { Tuner } from '@addstack/daw-ui/react';

const pitch = formats.pitch({ names: ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'] });

/**
 * Made-up playing for the demo: the strings of a guitar in turn, each starting out of tune and tuned in, with a
 * little vibrato and a pause between them. In an app, the frequency your pitch detector hears, or null.
 */
function playing(now = performance.now() / 1000) {
  const string = [40, 45, 50, 55, 59, 64][Math.floor(now / 4) % 6]!;
  const time = now % 4;
  if (time > 3.4) return null;
  const cents = (((Math.floor(now / 4) * 37) % 80) - 40) * Math.exp(-time * 1.4) + 1.5 * Math.sin(now * 9);
  return 440 * 2 ** ((string + cents / 100 - 69) / 12);
}

export default function TunerDemo() {
  return (
    // A classic tuner: a scale of ±50 cents with a needle, and the frequency, MIDI note, name and cents below.
    <Tuner.Root read={() => playing()} format={pitch} tolerance={3} className="group w-full max-w-md rounded-md bg-neutral-900 p-3 font-mono text-neutral-300 select-none">
      <div className="relative h-16 rounded-sm bg-neutral-100 text-neutral-900">
        {[-50, -25, 0, 25, 50].map((cents) => (
          <div key={cents} style={{ left: `${50 + cents}%` }} className="absolute bottom-0 h-3 w-px bg-neutral-900">
            {cents % 50 !== 0 || cents === 0 ? (
              <span className="absolute -top-6 -translate-x-1/2 text-sm font-bold">{cents > 0 ? `+${cents}` : cents}</span>
            ) : null}
          </div>
        ))}
        {/* The needle: placed by the cents off, and only while a pitch is heard. */}
        <Tuner.Indicator className="absolute inset-y-1 left-[calc(50%+var(--tuner-offset)*50%)] w-0.5 bg-red-600 opacity-0 group-data-active:opacity-100" />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <div className="flex flex-col items-end rounded-sm border border-neutral-700 px-2 py-1 text-xs text-rose-300 tabular-nums">
          <Tuner.Frequency format={formats.number({ digits: 2, unit: 'Hz' })} />
          <Tuner.Note format={formats.number({ digits: 0 })} aria-live="off" />
        </div>
        <Tuner.Note className="flex-1 rounded-sm border border-neutral-700 py-1 text-center text-2xl text-white" />
        <span className="rounded-sm border border-neutral-700 px-2 py-1 text-rose-300 tabular-nums">
          <Tuner.Cents /> <span className="text-xs text-neutral-500">cents</span>
        </span>
        {/* Green when in tune. */}
        <span className="size-2.5 rounded-full bg-neutral-700 group-data-in-tune:bg-green-500" />
      </div>
    </Tuner.Root>
  );
}
