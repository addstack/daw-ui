'use client';

import { formats } from '@addstack/daw-ui';
import { NumberBox } from '@addstack/daw-ui/react';

export default function NumberBoxDemo() {
  return (
    <NumberBox.Root
      min={20}
      max={999}
      step={0.01}
      defaultValue={120}
      format={formats.number({ digits: 2, unit: 'BPM' })}
      className="flex flex-col items-start gap-1.5"
    >
      <NumberBox.Label className="text-[11px] font-medium tracking-wider text-neutral-500 uppercase select-none dark:text-neutral-400">
        Tempo
      </NumberBox.Label>
      <NumberBox.Field className="w-32 cursor-ns-resize rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 font-mono text-sm tabular-nums select-none focus-visible:border-orange-500 focus-visible:outline-none data-dragging:border-orange-500 data-editing:cursor-text dark:border-neutral-700 dark:bg-neutral-900" />
    </NumberBox.Root>
  );
}
