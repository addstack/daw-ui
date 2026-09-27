'use client';

import { clockGrid, formats, musicalGrid } from '@addstack/daw-ui';
import { Fader, Timeline, Toggle } from '@addstack/daw-ui/react';
import { useRef } from 'react';

const LOOP = 16;
// Made once, not per render: bars and beats at 120 BPM, and minutes and seconds.
const bars = musicalGrid({ bpm: 120 });
const clock = clockGrid();

const ruler = 'h-6 font-mono text-[10px] text-neutral-400 [&_[data-label]]:top-0.5 [&_[data-label]]:ps-1';

export default function TimelineDemo() {
  // The transport and the zoom live outside React: playing and zooming render nothing.
  const transport = useRef({ playing: false, from: 0, since: 0 });
  const position = () => {
    const { playing, from, since } = transport.current;
    return playing ? (from + (performance.now() - since) / 1000) % LOOP : from;
  };
  const visible = useRef(LOOP);

  return (
    <div className="flex w-full max-w-2xl flex-col gap-3">
      <div className="flex items-center gap-4">
        <Toggle
          aria-label="Play"
          onPressedChange={(playing) => (transport.current = { playing, from: position(), since: performance.now() })}
          className="h-8 rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500 data-pressed:border-orange-500 data-pressed:bg-orange-500 data-pressed:text-white dark:border-neutral-700 dark:bg-neutral-900"
        >
          ▶
        </Toggle>
        <Fader.Root
          orientation="horizontal"
          min={1}
          max={LOOP}
          defaultValue={LOOP}
          format={formats.number({ digits: 1, unit: 's' })}
          onValueChange={(seconds) => (visible.current = seconds)}
          className="flex items-center gap-3"
        >
          <Fader.Label className="text-[11px] font-medium tracking-wider text-neutral-500 uppercase dark:text-neutral-400">Zoom</Fader.Label>
          <Fader.Control className="cursor-ew-resize rounded-md px-2 py-3 focus-visible:outline-2 focus-visible:outline-orange-500">
            <Fader.Track className="h-1 w-32 rounded-full bg-neutral-200 dark:bg-neutral-800">
              <Fader.Thumb className="h-3 w-3 rounded-full border border-black/20 bg-white shadow-sm" />
            </Fader.Track>
          </Fader.Control>
        </Fader.Root>
      </div>

      {/* A timeline on its own: time, and nothing else. Zoom in to see beats, then sixteenths. */}
      <Timeline.Root
        start={0}
        end={LOOP}
        readView={() => [0, visible.current]}
        read={position}
        className="overflow-hidden rounded-md bg-neutral-900"
      >
        <Timeline.Ruler grid={bars} className={`${ruler} border-b border-neutral-800`}>
          <Timeline.Grid grid={bars} style={{ top: '65%' }} className="text-neutral-600" />
        </Timeline.Ruler>
        <div className="relative h-24">
          <Timeline.Grid grid={bars} className="text-white/5" />
          <Timeline.Grid grid={bars} spacing={64} className="text-white/15" />
        </div>
        {/* The same time in minutes and seconds: a second ruler of another grid. */}
        <Timeline.Ruler grid={clock} className={`${ruler} border-t border-neutral-800`} />
        <Timeline.Playhead className="w-px bg-orange-500" />
      </Timeline.Root>
    </div>
  );
}
