'use client';

import { formats } from '@addstack/daw-ui';
import { NumberBox } from '@addstack/daw-ui/react';

const label = 'text-[11px] font-medium tracking-wider text-neutral-500 uppercase select-none dark:text-neutral-400';
const group =
  'rounded-md border border-neutral-300 bg-white px-1.5 py-1 font-mono text-sm tabular-nums select-none data-dragging:border-orange-500 data-editing:w-32 data-editing:cursor-text data-editing:px-2.5 data-editing:py-1.5 dark:border-neutral-700 dark:bg-neutral-900';
// Fields highlight when focused; the text between them is dimmed.
const segment =
  'rounded-sm px-px data-literal:text-neutral-400 [&[data-segment]]:cursor-ns-resize focus-visible:bg-orange-500 focus-visible:text-white focus-visible:outline-none';

export default function SegmentsDemo() {
  return (
    <>
      <NumberBox.Root min={20} max={999} step={0.01} defaultValue={120} format={formats.number({ unit: 'BPM' })} className="flex flex-col items-start gap-1.5">
        <NumberBox.Label className={label}>Tempo</NumberBox.Label>
        {/* The words come from your app, in its language. */}
        <NumberBox.Segments labels={{ integer: 'Beats per minute', fraction: 'Hundredths' }} className={group}>
          {(part) => <NumberBox.Segment segment={part} className={segment} />}
        </NumberBox.Segments>
      </NumberBox.Root>

      <NumberBox.Root min={0} max={999 * 4} defaultValue={0} format={formats.position()} className="flex flex-col items-start gap-1.5">
        <NumberBox.Label className={label}>Position</NumberBox.Label>
        <NumberBox.Segments labels={{ bars: 'Bar', beats: 'Beat', divisions: 'Sixteenth' }} className={group}>
          {(part) => <NumberBox.Segment segment={part} className={segment} />}
        </NumberBox.Segments>
      </NumberBox.Root>

      <NumberBox.Root min={0} max={24 * 3600} defaultValue={0} format={formats.timecode({ fps: 25 })} className="flex flex-col items-start gap-1.5">
        <NumberBox.Label className={label}>Timecode</NumberBox.Label>
        <NumberBox.Segments labels={{ hours: 'Hours', minutes: 'Minutes', seconds: 'Seconds', frames: 'Frames' }} className={group}>
          {(part) => <NumberBox.Segment segment={part} className={segment} />}
        </NumberBox.Segments>
      </NumberBox.Root>
    </>
  );
}
