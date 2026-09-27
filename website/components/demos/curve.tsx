'use client';

import { scales, type CurvePoint } from '@addstack/daw-ui';
import { Curve } from '@addstack/daw-ui/react';

// Made-up curves for the demo, in seconds. In an app, they come from the song's automation or a clip's fades.
const volume: CurvePoint[] = [
  { at: 0, value: -Infinity, shape: -0.6 },
  { at: 1, value: 0 },
  { at: 2.5, value: -6, shape: 0.5 },
  { at: 3.5, value: 0 },
  { at: 4, value: 0 },
];

const pan: CurvePoint[] = [
  { at: 0, value: 0 },
  { at: 1, value: -0.8, shape: 0.3 },
  { at: 2, value: 0.8, shape: -0.3 },
  { at: 3, value: -0.4 },
  { at: 4, value: 0 },
];

const steps: CurvePoint[] = [0, 0.75, 0.25, 1, 0.5, 0.75, 0, 0.5].map((value, index) => ({ at: index * 0.5, value, shape: 'hold' }));

const label = 'w-14 text-xs text-neutral-500';

export default function CurveDemo() {
  return (
    <ul className="flex w-full max-w-md flex-col gap-2">
      <li className="flex items-center gap-3 rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
        <span className={label}>Volume</span>
        {/* On the range of a volume fader: a fade in from silence, a dip, back to 0 dB. */}
        <Curve.Root points={volume} min={-Infinity} max={6} scale={scales.decibel} aria-label="Volume" className="h-12 flex-1">
          <Curve.Fill className="text-orange-500/20" />
          <Curve.Line thickness={1.5} className="text-orange-500" />
        </Curve.Root>
      </li>
      <li className="flex items-center gap-3 rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
        <span className={label}>Pan</span>
        {/* From left to right, filled from the middle. */}
        <Curve.Root points={pan} min={-1} max={1} aria-label="Pan" className="h-12 flex-1">
          <Curve.Fill origin={0} className="text-sky-500/20" />
          <Curve.Line thickness={1.5} className="text-sky-500" />
        </Curve.Root>
      </li>
      <li className="flex items-center gap-3 rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
        <span className={label}>Steps</span>
        {/* Held segments: a value until the next point, as a stepped modulation. */}
        <Curve.Root points={steps} duration={4} aria-label="Steps" className="h-12 flex-1">
          <Curve.Fill className="text-emerald-500/20" />
          <Curve.Line thickness={1.5} className="text-emerald-500" />
        </Curve.Root>
      </li>
    </ul>
  );
}
