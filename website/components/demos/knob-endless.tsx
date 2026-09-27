'use client';

import type { ValueFormat } from '@addstack/daw-ui';
import { Knob } from '@addstack/daw-ui/react';

const presets = ['Init', 'Warm Pad', 'Sub Bass', 'Glass Keys', 'Pluck', 'Saw Lead', 'Choir', 'Noise Sweep'];

// The knob counts detents without end; the preset is where the count lands in the list, so the list loops.
// Screen readers announce the preset's name, and nothing renders as you turn.
const preset: ValueFormat = {
  format: (count) => presets[((count % presets.length) + presets.length) % presets.length]!,
  parse: () => null,
};

export default function EndlessKnobDemo() {
  return (
    // 24 detents per turn. 0 is in the middle of min … max, so the pointer starts at 12 o'clock.
    <Knob.Root endless min={-12} max={12} step={1} defaultValue={0} format={preset} className="flex flex-col items-center gap-1.5">
      <Knob.Label className="text-[11px] font-medium tracking-wider text-neutral-500 uppercase dark:text-neutral-400">
        Preset
      </Knob.Label>
      <Knob.Control className="size-16 cursor-ns-resize rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500">
        <svg viewBox="0 0 100 100" className="size-full overflow-visible">
          <Knob.Track radius={38} className="fill-neutral-100 stroke-neutral-300 stroke-4 dark:fill-neutral-900 dark:stroke-neutral-700" />
          <Knob.Pointer from={24} to={36} className="stroke-orange-500 stroke-8 [stroke-linecap:round] data-dragging:stroke-orange-400" />
        </svg>
      </Knob.Control>
      <Knob.Value className="w-24 text-center font-mono text-xs text-neutral-700 dark:text-neutral-300" />
    </Knob.Root>
  );
}
