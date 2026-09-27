'use client';

import { Toggle, ToggleGroup } from '@addstack/daw-ui/react';

const CHANNELS = ['Kick', 'Snare', 'Bass', 'Keys'];

const button =
  'size-8 rounded-md border border-neutral-300 bg-white text-xs font-semibold text-neutral-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500 dark:border-neutral-700 dark:bg-neutral-900';

export default function MixerDemo() {
  return (
    // Mute buttons are independent; solo is exclusive (Cmd/Ctrl+click adds).
    <ToggleGroup paint exclusive={{ solo: 'click' }} className="flex gap-3">
      {CHANNELS.map((channel) => (
        <div key={channel} className="flex flex-col items-center gap-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
          <span className="text-xs font-medium">{channel}</span>
          <Toggle
            lane="mute"
            aria-label={`Mute ${channel}`}
            className={`${button} data-pressed:border-yellow-400 data-pressed:bg-yellow-400 data-pressed:text-neutral-900`}
          >
            M
          </Toggle>
          <Toggle
            lane="solo"
            aria-label={`Solo ${channel}`}
            className={`${button} data-pressed:border-sky-400 data-pressed:bg-sky-400 data-pressed:text-neutral-900`}
          >
            S
          </Toggle>
        </div>
      ))}
    </ToggleGroup>
  );
}
