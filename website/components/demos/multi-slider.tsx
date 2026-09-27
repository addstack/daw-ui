'use client';

import { MultiSlider } from '@addstack/daw-ui/react';

// The velocities of a sequencer's 16 steps: a made-up accent pattern.
const accents = [127, 64, 90, 64, 110, 64, 90, 40, 127, 64, 90, 64, 110, 80, 100, 120];

export default function MultiSliderDemo() {
  return (
    <MultiSlider.Root min={0} max={127} step={1} defaultValue={accents} className="flex w-full max-w-md flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <MultiSlider.Label className="text-[11px] font-medium tracking-wider text-neutral-500 uppercase dark:text-neutral-400">Velocity</MultiSlider.Label>
        {/* The value of the step last changed or focused. */}
        <MultiSlider.Value className="font-mono text-xs text-neutral-700 tabular-nums dark:text-neutral-300" />
      </div>
      <MultiSlider.Control className="h-32 cursor-crosshair rounded-md bg-neutral-100 dark:bg-neutral-900">
        {accents.map((_, index) => (
          <MultiSlider.Item
            key={index}
            index={index}
            aria-label={`Step ${index + 1}`}
            className="outline-offset-[-2px] focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-orange-500"
          >
            {/* Every fourth step darker, as the beats of a sequencer are. */}
            <MultiSlider.Range className={`inset-x-0.5 rounded-t-sm ${index % 4 === 0 ? 'bg-orange-500' : 'bg-orange-300 dark:bg-orange-400/70'}`} />
          </MultiSlider.Item>
        ))}
      </MultiSlider.Control>
    </MultiSlider.Root>
  );
}
