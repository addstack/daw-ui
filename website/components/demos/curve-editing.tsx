'use client';

import { musicalGrid, scales, type CurvePoint } from '@addstack/daw-ui';
import { Curve, Timeline, useCurveEditing } from '@addstack/daw-ui/react';
import { useState } from 'react';

// 120 BPM: a bar is 2 seconds. Moves snap to the grid the timeline shows.
const grid = musicalGrid({ bpm: 120 });

export default function CurveEditingDemo() {
  // The application keeps the points: each gesture that ends is one undo step.
  const [points, setPoints] = useState<CurvePoint[]>([
    { at: 0, value: -12, shape: -0.4 },
    { at: 2, value: 0 },
    { at: 4.5, value: 0, shape: 0.5 },
    { at: 6, value: -18 },
    { at: 8, value: -6 },
  ]);
  const editing = useCurveEditing({ snap: { time: grid }, onGestureEnd: setPoints });

  return (
    <Timeline.Root start={0} end={8} className="w-full max-w-2xl overflow-hidden rounded-md bg-neutral-900 select-none">
      <Timeline.Ruler grid={grid} className="h-6 border-b border-neutral-800 font-mono text-[10px] text-neutral-400 [&_[data-label]]:top-0.5 [&_[data-label]]:ps-1" />
      <div className="relative h-36">
        <Timeline.Grid grid={grid} className="text-white/5" />
        <Timeline.Grid grid={grid} spacing={64} className="text-white/15" />
        {/* On the timeline, outside a region: an automation lane in decibels, on the range of a volume fader. */}
        <Curve.Root points={points} editing={editing} min={-Infinity} max={6} scale={scales.decibel} aria-label="Volume" className="h-full">
          <Curve.Fill className="text-orange-500/15" />
          <Curve.Line thickness={1.5} className="text-orange-500" />
          <Curve.Dots className="text-orange-300" />
          <Curve.Bend className="size-2 rotate-45 border border-orange-300 bg-neutral-900 data-dragging:bg-orange-300" />
          <Curve.Handle aria-label="Point" className="size-3 rounded-full border-2 border-orange-500 bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white data-selected:bg-orange-400" />
        </Curve.Root>
      </div>
    </Timeline.Root>
  );
}
