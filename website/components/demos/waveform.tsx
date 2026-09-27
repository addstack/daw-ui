'use client';

import { createPeaks, formats, musicalGrid } from '@addstack/daw-ui';
import { Fader, Region, Timeline, Toggle, Waveform } from '@addstack/daw-ui/react';
import { useMemo, useRef } from 'react';

const RATE = 22_050;
const LOOP = 16;
// 120 BPM: a bar is 2 seconds. Made once, not per render.
const grid = musicalGrid({ bpm: 120 });

/** Made-up audio for the demo. In an app, peaks come from an `AudioBuffer`, or from the server. */
function synthesize(seconds: number, sample: (t: number) => number) {
  const samples = new Float32Array(seconds * RATE);
  for (let index = 0; index < samples.length; index++) samples[index] = sample(index / RATE);
  return createPeaks([samples], RATE);
}

const kick = (t: number) => Math.exp(-(t % 0.5) * 14) * Math.sin(2 * Math.PI * 55 * (t % 0.5) * (1 + 3 * Math.exp(-(t % 0.5) * 30)));
const bass = (t: number) => 0.6 * Math.exp(-(t % 2) * 0.8) * Math.sin(2 * Math.PI * [41, 49, 37, 44][Math.floor(t / 2) % 4]! * t);

export default function WaveformDemo() {
  const tracks = useMemo(
    () => [
      { name: 'Drums', peaks: synthesize(LOOP, kick), at: 0 },
      { name: 'Bass', peaks: synthesize(12, bass), at: 4 },
    ],
    [],
  );

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
          min={2}
          max={LOOP}
          defaultValue={LOOP}
          format={formats.number({ digits: 1, unit: 's' })}
          onValueChange={(seconds) => (visible.current = seconds)}
          className="flex items-center gap-3"
        >
          <Fader.Label className="text-[11px] font-medium tracking-wider text-neutral-500 uppercase dark:text-neutral-400">
            Zoom
          </Fader.Label>
          <Fader.Control className="cursor-ew-resize rounded-md px-2 py-3 focus-visible:outline-2 focus-visible:outline-orange-500">
            <Fader.Track className="h-1 w-32 rounded-full bg-neutral-200 dark:bg-neutral-800">
              <Fader.Thumb className="h-3 w-3 rounded-full border border-black/20 bg-white shadow-sm" />
            </Fader.Track>
          </Fader.Control>
        </Fader.Root>
      </div>

      <Timeline.Root
        start={0}
        end={LOOP}
        readView={() => [0, visible.current]}
        read={position}
        className="overflow-hidden rounded-md bg-neutral-900"
      >
        {/* Bars, then beats and sixteenths as you zoom in. */}
        <Timeline.Ruler grid={grid} className="h-6 border-b border-neutral-800 font-mono text-[10px] text-neutral-400 [&_[data-label]]:top-0.5 [&_[data-label]]:ps-1">
          <Timeline.Grid grid={grid} style={{ top: '65%' }} className="text-neutral-600" />
        </Timeline.Ruler>
        <div className="relative">
          <Timeline.Grid grid={grid} className="text-white/5" />
          <Timeline.Grid grid={grid} spacing={64} className="text-white/15" />
          {tracks.map((track) => (
            <div key={track.name} role="group" aria-label={track.name} className="relative h-14 border-b border-neutral-800 last:border-0">
              <Region.Root at={track.at} duration={track.peaks.duration} className="bg-sky-950/70">
                <Waveform.Root peaks={track.peaks} aria-label={track.name} className="h-full">
                  <Waveform.Shape className="text-sky-700" />
                  <Waveform.Progress className="text-sky-300" />
                </Waveform.Root>
              </Region.Root>
            </div>
          ))}
        </div>
        <Timeline.Playhead className="w-px bg-white" />
      </Timeline.Root>
    </div>
  );
}
