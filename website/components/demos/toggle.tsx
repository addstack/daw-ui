'use client';

import { Toggle } from '@addstack/daw-ui/react';

const button =
  'h-9 rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500 data-pressed:border-orange-500 data-pressed:bg-orange-500 data-pressed:text-white dark:border-neutral-700 dark:bg-neutral-900';

export default function ToggleDemo() {
  return (
    <div className="flex gap-3">
      <Toggle className={button}>Toggle</Toggle>
      <Toggle behavior="momentary" className={button}>
        Momentary
      </Toggle>
      <Toggle behavior="hybrid" className={button}>
        Hybrid
      </Toggle>
    </div>
  );
}
