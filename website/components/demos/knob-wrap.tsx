'use client';

import { formats, type ValueFormat } from '@addstack/daw-ui';
import { Knob } from '@addstack/daw-ui/react';

// Degrees without a space, "90°": a format is an object, and this one builds on the number format.
const number = formats.number({ digits: 0 });
const degrees: ValueFormat = { format: (value) => `${number.format(value)}°`, parse: number.parse };

export default function WrapKnobDemo() {
  return (
    <Knob.Root min={-180} max={180} wrap step={1} origin={0} format={degrees} className="flex flex-col items-center gap-1.5">
      <Knob.Label className="text-[11px] font-medium tracking-wider text-neutral-500 uppercase dark:text-neutral-400">
        Phase
      </Knob.Label>
      <Knob.Control className="size-16 cursor-ns-resize rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500">
        <svg viewBox="0 0 100 100" className="size-full overflow-visible">
          {/* A wrapping knob turns a full circle: 180° and -180° are the same point, at 6 o'clock. */}
          <Knob.Track radius={38} className="fill-none stroke-neutral-200 stroke-9 dark:stroke-neutral-800" />
          <Knob.Range radius={38} className="fill-none stroke-violet-500 stroke-9 [stroke-linecap:round]" />
          <Knob.Pointer from={10} to={28} className="stroke-neutral-900 stroke-7 [stroke-linecap:round] dark:stroke-neutral-100" />
        </svg>
      </Knob.Control>
      <Knob.Value className="font-mono text-xs text-neutral-700 tabular-nums dark:text-neutral-300" />
    </Knob.Root>
  );
}
