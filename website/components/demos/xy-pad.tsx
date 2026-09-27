'use client';

import { formats, scales } from '@addstack/daw-ui';
import { XYPad } from '@addstack/daw-ui/react';

export default function XYPadDemo() {
  return (
    // A filter: cutoff across, on a logarithmic scale as a knob would have it, resonance up.
    <XYPad.Root
      x={{ min: 20, max: 20_000, scale: scales.log }}
      y={{ min: 0, max: 1 }}
      defaultValue={[[1000, 0.3]]}
      format={{ x: formats.frequency(), y: formats.percent() }}
      className="flex flex-col items-center gap-2"
    >
      <XYPad.Label className="text-[11px] font-medium tracking-wider text-neutral-500 uppercase dark:text-neutral-400">Filter</XYPad.Label>
      <XYPad.Control className="size-48 cursor-crosshair rounded-md bg-neutral-100 bg-[linear-gradient(to_right,rgb(0_0_0/0.06)_1px,transparent_1px),linear-gradient(to_bottom,rgb(0_0_0/0.06)_1px,transparent_1px)] bg-[size:24px_24px] dark:bg-neutral-900 dark:bg-[linear-gradient(to_right,rgb(255_255_255/0.06)_1px,transparent_1px),linear-gradient(to_bottom,rgb(255_255_255/0.06)_1px,transparent_1px)]">
        <XYPad.Thumb
          index={0}
          aria-label="Cutoff and resonance"
          className="size-4 rounded-full border-2 border-white bg-orange-500 shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500 data-dragging:scale-125"
        />
      </XYPad.Control>
      <div className="flex gap-4 font-mono text-xs text-neutral-700 tabular-nums dark:text-neutral-300">
        <XYPad.Value axis="x" />
        <XYPad.Value axis="y" />
      </div>
    </XYPad.Root>
  );
}
