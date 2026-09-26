'use client';

import { Meter } from '@addstack/daw-ui/react';

/** A stand-in for an AnalyserNode: a beat with a slow swell that clips now and then, in dBFS. */
function signal(channel: number) {
  return () => {
    const t = performance.now() / 1000;
    const beat = Math.pow(1 - ((t * 2 + channel * 0.1) % 1), 3);
    const swell = 0.5 + 0.5 * Math.sin(t * 0.8 + channel);
    return -40 + 42 * beat * (0.7 + 0.3 * swell);
  };
}

export default function MeterDemo() {
  return (
    <div className="flex gap-2">
      {['Left', 'Right'].map((name, channel) => (
        <Meter.Root key={name} read={signal(channel)} min={-60} max={6} className="group flex flex-col items-center gap-1.5">
          <Meter.Clip
            aria-label={`Reset clip, ${name}`}
            className="h-1.5 w-3 rounded-sm bg-neutral-300 data-clipped:bg-red-500 dark:bg-neutral-700"
          />
          <Meter.Track aria-label={`Level, ${name}`} className="h-48 w-3 overflow-hidden rounded-sm bg-neutral-200 dark:bg-neutral-900">
            <Meter.Bar className="bg-[linear-gradient(to_top,#22c55e_0%,#22c55e_64%,#eab308_82%,#ef4444_92%)]" />
            <Meter.Peak className="hidden h-0.5 w-full bg-neutral-900 group-data-active:block dark:bg-white" />
          </Meter.Track>
        </Meter.Root>
      ))}
    </div>
  );
}
