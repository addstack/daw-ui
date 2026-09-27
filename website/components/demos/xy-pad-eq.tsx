'use client';

import { formats, scales } from '@addstack/daw-ui';
import { XYPad, type XYValue } from '@addstack/daw-ui/react';
import { useState } from 'react';

const BANDS = [
  { name: 'Low', color: 'bg-sky-500' },
  { name: 'Mid', color: 'bg-emerald-500' },
  { name: 'High', color: 'bg-orange-500' },
];

export default function EqualizerDemo() {
  // Frequency across, gain up: one thumb per band, which the application keeps.
  const [bands, setBands] = useState<XYValue[]>([
    [120, 3],
    [1200, -4],
    [8000, 2],
  ]);
  return (
    <XYPad.Root
      x={{ min: 20, max: 20_000, scale: scales.log }}
      y={{ min: -18, max: 18 }}
      value={bands}
      onValueChange={setBands}
      resetValue={[
        [120, 0],
        [1200, 0],
        [8000, 0],
      ]}
      format={{ x: formats.frequency(), y: formats.decibel() }}
      className="flex w-full max-w-md flex-col gap-2"
    >
      <XYPad.Label className="text-[11px] font-medium tracking-wider text-neutral-500 uppercase dark:text-neutral-400">Equalizer</XYPad.Label>
      {/* The 0 dB line across the middle; bands cross each other freely. */}
      <XYPad.Control className="h-40 w-full cursor-crosshair rounded-md bg-neutral-900 bg-[linear-gradient(to_bottom,transparent_calc(50%-0.5px),rgb(255_255_255/0.2)_calc(50%-0.5px),rgb(255_255_255/0.2)_calc(50%+0.5px),transparent_calc(50%+0.5px))]">
        {BANDS.map((band, index) => (
          <XYPad.Thumb
            key={band.name}
            index={index}
            aria-label={band.name}
            className={`size-4 rounded-full border-2 border-white ${band.color} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white data-dragging:scale-125`}
          />
        ))}
      </XYPad.Control>
      <ul className="grid grid-cols-3 gap-2 font-mono text-xs tabular-nums">
        {BANDS.map((band, index) => (
          <li key={band.name} className="flex flex-col">
            <span className="text-neutral-500">{band.name}</span>
            <XYPad.Value index={index} axis="x" />
            <XYPad.Value index={index} axis="y" />
          </li>
        ))}
      </ul>
    </XYPad.Root>
  );
}
