'use client';

import { Slider } from '@addstack/daw-ui/react';

export default function SliderRangeDemo() {
  return (
    // The velocities a sampler zone answers to: two thumbs, and the range between them.
    <Slider.Root min={0} max={127} step={1} defaultValue={[40, 100]} className="flex w-full max-w-xs flex-col gap-2">
      <div className="flex items-baseline justify-between text-xs">
        <Slider.Label className="text-[11px] font-medium tracking-wider text-neutral-500 uppercase dark:text-neutral-400">Velocity</Slider.Label>
        <span className="font-mono text-neutral-700 tabular-nums dark:text-neutral-300">
          <Slider.Value index={0} /> – <Slider.Value index={1} />
        </span>
      </div>
      <Slider.Control className="cursor-pointer py-2">
        <Slider.Track className="h-1.5 rounded-full bg-neutral-200 dark:bg-neutral-800">
          <Slider.Range className="inset-y-0 rounded-full bg-orange-500" />
          <Slider.Thumb index={0} aria-label="Lowest velocity" className="top-1/2 -mt-2 size-4 rounded-full border-2 border-orange-500 bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500" />
          <Slider.Thumb index={1} aria-label="Highest velocity" className="top-1/2 -mt-2 size-4 rounded-full border-2 border-orange-500 bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500" />
        </Slider.Track>
      </Slider.Control>
    </Slider.Root>
  );
}
