'use client';

import { formats, type CurvePoint } from '@addstack/daw-ui';
import { Curve, Knob, useCurveEditing } from '@addstack/daw-ui/react';
import { useState } from 'react';

/** An envelope: three times, a level, and how its three slopes bend. */
type Adsr = { attack: number; decay: number; sustain: number; release: number; bends: [number, number, number] };

// Seconds across the drawing, and how long it holds the key down before the release.
const LENGTH = 4;
const HOLD = 0.5;

/** The shape of an envelope: its points follow from its numbers. */
const toPoints = ({ attack, decay, sustain, release, bends }: Adsr): CurvePoint[] => [
  { at: 0, value: 0, shape: bends[0] },
  { at: attack, value: 1, shape: bends[1] },
  { at: attack + decay, value: sustain },
  { at: attack + decay + HOLD, value: sustain, shape: bends[2] },
  { at: attack + decay + HOLD + release, value: 0 },
];

const bendOf = (point: CurvePoint) => (typeof point.shape === 'number' ? point.shape : 0);

/**
 * …and its numbers follow from the points, whichever of them moved. The release is measured from the end of the
 * held note, which a drag of the knee leaves where it was: the release keeps its length, and its end follows.
 */
const fromPoints = ([start, peak, knee, held, end]: CurvePoint[]): Adsr => {
  const knees = Math.min(knee!.at, LENGTH - HOLD);
  return {
    attack: Math.min(peak!.at, knees),
    decay: knees - Math.min(peak!.at, knees),
    sustain: knee!.value,
    release: Math.min(Math.max(0, end!.at - held!.at), LENGTH - knees - HOLD),
    bends: [bendOf(start!), bendOf(peak!), bendOf(held!)],
  };
};

const seconds = formats.number({ digits: 2, unit: 's' });
const level = formats.number({ digits: 2 });

function Parameter({ label, value, max, format, onChange }: { label: string; value: number; max: number; format: typeof seconds; onChange: (value: number) => void }) {
  return (
    <Knob.Root min={0} max={max} value={value} format={format} onValueChange={onChange} className="flex flex-col items-center gap-1">
      <Knob.Label className="text-[10px] font-medium tracking-wider text-neutral-500 uppercase dark:text-neutral-400">{label}</Knob.Label>
      <Knob.Control className="size-10 cursor-ns-resize rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500">
        <svg viewBox="0 0 100 100" className="size-full overflow-visible">
          <Knob.Track radius={38} className="fill-none stroke-neutral-200 stroke-10 [stroke-linecap:round] dark:stroke-neutral-800" />
          <Knob.Range radius={38} className="fill-none stroke-sky-500 stroke-10 [stroke-linecap:round]" />
          <Knob.Pointer from={8} to={26} className="stroke-neutral-900 stroke-8 [stroke-linecap:round] dark:stroke-neutral-100" />
        </svg>
      </Knob.Control>
      <Knob.Value className="font-mono text-[10px] text-neutral-600 tabular-nums dark:text-neutral-400" />
    </Knob.Root>
  );
}

export default function EnvelopeDemo() {
  const [adsr, setAdsr] = useState<Adsr>({ attack: 0.3, decay: 0.6, sustain: 0.6, release: 1.2, bends: [-0.5, 0.5, 0.5] });
  const editing = useCurveEditing({
    // The envelope's rule: after any move, the points are the shape of the numbers they give.
    constrain: (points) => toPoints(fromPoints(points)),
    // The start and the end of the held note do not move; the peak stays at the top, the release ends at the bottom.
    lock: { 0: 'both', 1: 'value', 3: 'both', 4: 'value' },
    canAdd: false,
    canRemove: false,
    // Live, so that the knobs follow the curve as it moves: five points render cheaply.
    onPointsChange: (points) => setAdsr(fromPoints(points)),
  });
  const set = (change: Partial<Adsr>) => setAdsr((current) => fromPoints(toPoints({ ...current, ...change })));

  return (
    <div className="flex flex-col items-center gap-4">
      <Curve.Root points={toPoints(adsr)} editing={editing} duration={LENGTH} aria-label="Envelope" className="h-32 w-80 rounded-md bg-neutral-900">
        <Curve.Fill className="text-sky-500/20" />
        <Curve.Line thickness={1.5} className="text-sky-500" />
        <Curve.Dots className="text-sky-300" />
        <Curve.Bend className="size-2 rotate-45 border border-sky-300 bg-neutral-900" />
        <Curve.Handle aria-label="Envelope point" className="size-3 rounded-full border-2 border-sky-500 bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white" />
      </Curve.Root>
      <div className="flex gap-5">
        <Parameter label="Attack" value={adsr.attack} max={2} format={seconds} onChange={(attack) => set({ attack })} />
        <Parameter label="Decay" value={adsr.decay} max={2} format={seconds} onChange={(decay) => set({ decay })} />
        <Parameter label="Sustain" value={adsr.sustain} max={1} format={level} onChange={(sustain) => set({ sustain })} />
        <Parameter label="Release" value={adsr.release} max={2} format={seconds} onChange={(release) => set({ release })} />
      </div>
    </div>
  );
}
