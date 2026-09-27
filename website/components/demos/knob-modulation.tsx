'use client';

import { formats } from '@addstack/daw-ui';
import { Knob } from '@addstack/daw-ui/react';
import { useRef } from 'react';

/** An LFO at 0.5 Hz, from −1 to 1. In an app, read it from the audio engine. */
const lfo = () => Math.sin((performance.now() / 1000) * Math.PI);

function ModulatedKnob({ label, bipolar = false, min = 0, max = 1, ...props }: Knob.Root.Props & { label: string; bipolar?: boolean }) {
  // The knob's value and the depth, in travel, kept for the modulation; nothing here renders.
  const travel = useRef(0.5);
  const depth = useRef(0.3);
  // Where the LFO moves the knob now: from the value up to the depth, or to either side when bipolar.
  const modulated = () => {
    const amount = bipolar ? lfo() : (lfo() + 1) / 2;
    return min + Math.min(1, Math.max(0, travel.current + depth.current * amount)) * (max - min);
  };

  return (
    <Knob.Root
      min={min}
      max={max}
      defaultValue={(min + max) / 2}
      onValueChange={(next) => (travel.current = (next - min) / (max - min))}
      className="relative flex flex-col items-center gap-1.5"
      {...props}
    >
      <Knob.Control className="size-16 cursor-ns-resize rounded-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky-500">
        <svg viewBox="0 0 100 100" className="size-full overflow-visible">
          <Knob.Track radius={36} className="fill-none stroke-neutral-200 stroke-9 [stroke-linecap:round] dark:stroke-neutral-800" />
          {/* The range the LFO moves the knob over, and where it is now. */}
          <Knob.ModulationRange bipolar={bipolar} radius={48} className="fill-none stroke-sky-500/30 stroke-5 [stroke-linecap:round]" />
          <Knob.Modulation read={modulated} radius={48} className="fill-none stroke-sky-500 stroke-5 [stroke-linecap:round]" />
          <Knob.Range radius={36} className="fill-none stroke-neutral-500 stroke-9 [stroke-linecap:round] dark:stroke-neutral-400" />
          <Knob.Pointer from={10} to={26} className="stroke-neutral-900 stroke-7 [stroke-linecap:round] dark:stroke-neutral-100" />
        </svg>
      </Knob.Control>
      {/* The handle for the depth, as Serum has it: drag it up and down, double-click to take the modulation away. */}
      <Knob.ModulationDepth
        defaultValue={0.3}
        onValueChange={(next) => (depth.current = next)}
        aria-label={`${label} LFO depth`}
        className="absolute -top-2 -left-3 size-4 cursor-ns-resize rounded-full border-2 border-sky-500 bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 data-dragging:bg-sky-500 dark:bg-neutral-950"
      />
      <Knob.Label className="text-[11px] font-medium tracking-wider text-neutral-500 uppercase dark:text-neutral-400">{label}</Knob.Label>
    </Knob.Root>
  );
}

export default function ModulationDemo() {
  return (
    <div className="flex gap-12">
      <ModulatedKnob label="Level" />
      <ModulatedKnob label="Pan" bipolar min={-1} max={1} origin={0} format={formats.pan({ left: 'L', right: 'R', center: 'C' })} />
    </div>
  );
}
