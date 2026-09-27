'use client';

import { Knob } from '@addstack/daw-ui/react';
import { useRef } from 'react';

export default function ModulationDemo() {
  // The knob's own value, kept for the modulation; nothing here renders.
  const value = useRef(0.5);
  // An LFO at 0.5 Hz, 25% deep. In an app, read the modulated value from the audio engine.
  const modulated = () => value.current + 0.25 * Math.sin((performance.now() / 1000) * Math.PI);

  return (
    <Knob.Root defaultValue={0.5} onValueChange={(next) => (value.current = next)} className="flex flex-col items-center gap-1.5">
      <Knob.Label className="text-[11px] font-medium tracking-wider text-neutral-500 uppercase dark:text-neutral-400">
        Filter
      </Knob.Label>
      <Knob.Control className="size-16 cursor-ns-resize rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500">
        <svg viewBox="0 0 100 100" className="size-full overflow-visible">
          <Knob.Track radius={36} className="fill-none stroke-neutral-200 stroke-9 [stroke-linecap:round] dark:stroke-neutral-800" />
          <Knob.Range radius={36} className="fill-none stroke-orange-500 stroke-9 [stroke-linecap:round]" />
          <Knob.Modulation read={modulated} radius={47} className="fill-none stroke-sky-500 stroke-4 [stroke-linecap:round]" />
          <Knob.Pointer from={10} to={26} className="stroke-neutral-900 stroke-7 [stroke-linecap:round] dark:stroke-neutral-100" />
        </svg>
      </Knob.Control>
      <Knob.Value className="font-mono text-xs text-neutral-700 tabular-nums dark:text-neutral-300" />
    </Knob.Root>
  );
}
