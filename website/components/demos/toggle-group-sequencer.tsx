'use client';

import { Toggle, ToggleGroup } from '@addstack/daw-ui/react';

const ROWS = ['Kick', 'Snare', 'Hi-hat', 'Clap'];
const PATTERN = ['Kick:0', 'Kick:4', 'Kick:8', 'Kick:12', 'Snare:4', 'Snare:12', 'Clap:14'];

export default function SequencerDemo() {
  return (
    <ToggleGroup paint erase="secondary" multiple defaultValue={PATTERN} className="grid gap-1.5">
      {ROWS.map((row) => (
        <div key={row} className="flex items-center gap-1">
          <span className="w-14 text-xs text-neutral-500 dark:text-neutral-400">{row}</span>
          {Array.from({ length: 16 }, (_, step) => (
            <Toggle
              key={step}
              lane={row}
              value={`${row}:${step}`}
              aria-label={`${row}, step ${step + 1}`}
              className={`size-6 rounded-sm bg-neutral-200 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-orange-500 data-pressed:bg-orange-500 sm:size-7 dark:bg-neutral-800 dark:data-pressed:bg-orange-500 ${step > 0 && step % 4 === 0 ? 'ms-1.5' : ''}`}
            />
          ))}
        </div>
      ))}
    </ToggleGroup>
  );
}
