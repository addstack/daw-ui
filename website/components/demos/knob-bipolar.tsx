'use client';

import { formats } from '@addstack/daw-ui';
import { Knob } from '@addstack/daw-ui/react';

// The letters come from your app: "L/R/C" in English, "L/P/Ś" in Polish.
const pan = formats.pan({ left: 'L', right: 'R', center: 'C' });

export default function BipolarKnobDemo() {
  return (
    <Knob.Root min={-1} max={1} origin={0} format={pan} className="flex flex-col items-center gap-1.5">
      <Knob.Label className="text-[11px] font-medium tracking-wider text-neutral-500 uppercase dark:text-neutral-400">
        Pan
      </Knob.Label>
      <Knob.Control className="size-12 cursor-ns-resize rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500">
        <svg viewBox="0 0 100 100" className="size-full overflow-visible">
          <Knob.Track radius={38} className="fill-none stroke-neutral-200 stroke-10 [stroke-linecap:round] dark:stroke-neutral-800" />
          {/* With origin={0}, the range grows from 12 o'clock in both directions. */}
          <Knob.Range radius={38} className="fill-none stroke-sky-500 stroke-10 [stroke-linecap:round]" />
          <Knob.Pointer from={8} to={26} className="stroke-neutral-900 stroke-8 [stroke-linecap:round] dark:stroke-neutral-100" />
        </svg>
      </Knob.Control>
      <Knob.Value className="font-mono text-xs text-neutral-700 tabular-nums dark:text-neutral-300" />
    </Knob.Root>
  );
}
