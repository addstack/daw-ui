'use client';

import { formats, scales } from '@addstack/daw-ui';
import { Knob } from '@addstack/daw-ui/react';

export default function KnobDemo() {
  return (
    <Knob.Root
      min={20}
      max={20_000}
      defaultValue={1000}
      scale={scales.log}
      format={formats.frequency()}
      className="flex flex-col items-center gap-1.5"
    >
      <Knob.Label className="text-[11px] font-medium tracking-wider text-neutral-500 uppercase select-none dark:text-neutral-400">
        Cutoff
      </Knob.Label>
      <Knob.Control className="size-16 cursor-ns-resize rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500">
        <svg viewBox="0 0 100 100" className="size-full overflow-visible">
          <Knob.Track radius={38} className="fill-none stroke-neutral-200 stroke-9 [stroke-linecap:round] dark:stroke-neutral-800" />
          <Knob.Range radius={38} className="fill-none stroke-orange-500 stroke-9 [stroke-linecap:round] data-dragging:stroke-orange-400" />
          <Knob.Pointer from={10} to={28} className="stroke-neutral-900 stroke-7 [stroke-linecap:round] dark:stroke-neutral-100" />
        </svg>
      </Knob.Control>
      <Knob.Value className="font-mono text-xs text-neutral-700 tabular-nums dark:text-neutral-300" />
    </Knob.Root>
  );
}
