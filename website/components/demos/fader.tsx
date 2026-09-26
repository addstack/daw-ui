'use client';

import { formats, scales } from '@addstack/daw-ui';
import { Fader } from '@addstack/daw-ui/react';

const TICKS = [6, 0, -6, -12, -24, -48];

export default function FaderDemo() {
  return (
    <Fader.Root
      min={-Infinity}
      max={6}
      defaultValue={0}
      scale={scales.decibel}
      format={formats.decibel()}
      className="group flex flex-col items-center gap-2"
    >
      <Fader.Label className="text-[11px] font-medium tracking-wider text-neutral-500 uppercase select-none dark:text-neutral-400">
        Volume
      </Fader.Label>
      <Fader.Control className="cursor-ns-resize rounded-md py-2 ps-3 pe-9 focus-visible:outline-2 focus-visible:outline-orange-500">
        <Fader.Track className="h-48 w-1 rounded-full bg-neutral-200 dark:bg-neutral-800">
          <Fader.Range className="w-full rounded-full bg-orange-500" />
          {TICKS.map((db) => (
            <Fader.Tick key={db} value={db} dir="ltr" className="start-4 font-mono text-[10px] text-neutral-400">
              {db > 0 ? `+${db}` : db}
            </Fader.Tick>
          ))}
          <Fader.Thumb className="-ms-2.5 h-3 w-6 rounded-sm border border-black/20 bg-white shadow-sm group-data-dragging:bg-neutral-100" />
        </Fader.Track>
      </Fader.Control>
      <Fader.Value className="font-mono text-xs text-neutral-700 tabular-nums dark:text-neutral-300" />
    </Fader.Root>
  );
}
