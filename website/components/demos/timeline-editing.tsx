'use client';

import { createPeaks, formats, musicalGrid, type Peaks } from '@addstack/daw-ui';
import { Timeline, Waveform } from '@addstack/daw-ui/react';
import { useMemo, useState } from 'react';

const RATE = 22_050;
// 120 BPM: a bar is 2 seconds. Moves and trims snap to the finest lines of the grid that you see.
const grid = musicalGrid({ bpm: 120 });
const position = formats.number({ digits: 2, unit: 's' });

/** Made-up audio for the demo. In an app, clips point to files and their peaks. */
function synthesize(seconds: number, sample: (t: number) => number): Peaks {
  const samples = new Float32Array(seconds * RATE);
  for (let index = 0; index < samples.length; index++) samples[index] = sample(index / RATE);
  return createPeaks([samples], RATE);
}

type Clip = { value: string; name: string; track: string; at: number; duration: number; offset: number };

const tracks = [
  { value: 'drums', name: 'Drums' },
  { value: 'bass', name: 'Bass' },
  { value: 'keys', name: 'Keys' },
];

export default function EditingDemo() {
  const audio = useMemo(
    () => ({
      drums: synthesize(8, (t) => Math.exp(-(t % 0.5) * 14) * Math.sin(2 * Math.PI * 55 * (t % 0.5) * (1 + 3 * Math.exp(-(t % 0.5) * 30)))),
      bass: synthesize(8, (t) => 0.6 * Math.exp(-(t % 2) * 0.8) * Math.sin(2 * Math.PI * [41, 49, 37, 44][Math.floor(t / 2) % 4]! * t)),
      keys: synthesize(8, (t) => 0.4 * Math.sin(Math.PI * ((t % 4) / 4)) * Math.sin(2 * Math.PI * 262 * t) * Math.sin(2 * Math.PI * 330 * t)),
    }),
    [],
  );
  const [clips, setClips] = useState<Clip[]>([
    { value: 'a', name: 'Beat', track: 'drums', at: 0, duration: 4, offset: 0 },
    { value: 'b', name: 'Beat 2', track: 'drums', at: 4, duration: 4, offset: 0 },
    { value: 'c', name: 'Bassline', track: 'bass', at: 2, duration: 6, offset: 0 },
    { value: 'd', name: 'Chords', track: 'keys', at: 4, duration: 4, offset: 0 },
  ]);

  return (
    <Timeline.Root
      start={0}
      end={12}
      snap={grid}
      format={position}
      // The regions show where a gesture takes them; keep the changes when it ends: one undo step.
      onRegionsChange={() => {}}
      onGestureEnd={(changes) =>
        setClips((current) =>
          current.map((clip) => {
            const change = changes.find((one) => one.value === clip.value);
            return change ? { ...clip, ...change, track: change.track ?? clip.track } : clip;
          }),
        )
      }
      className="w-full max-w-2xl overflow-hidden rounded-md bg-neutral-900 select-none"
    >
      <Timeline.Ruler grid={grid} className="h-6 border-b border-neutral-800 font-mono text-[10px] text-neutral-400 [&_[data-label]]:top-0.5 [&_[data-label]]:ps-1">
        <Timeline.Grid grid={grid} spacing={64} style={{ top: '65%' }} className="text-neutral-600" />
      </Timeline.Ruler>
      <div className="relative">
        <Timeline.Grid grid={grid} className="text-white/5" />
        <Timeline.Grid grid={grid} spacing={64} className="text-white/15" />
        {tracks.map((track) => (
          <Timeline.Track key={track.value} value={track.value} aria-label={track.name} className="h-16 border-b border-neutral-800 last:border-0">
            {clips
              .filter((clip) => clip.track === track.value)
              .map((clip) => (
                <Timeline.Region
                  key={clip.value}
                  value={clip.value}
                  at={clip.at}
                  duration={clip.duration}
                  offset={clip.offset}
                  length={8}
                  className="group flex flex-col overflow-hidden rounded-sm bg-sky-950/80 outline-offset-[-1px] focus-visible:outline-2 focus-visible:outline-orange-500 data-dragging:opacity-80"
                >
                  <Timeline.RegionHeader className="flex h-4 shrink-0 items-center gap-1 bg-sky-800 px-1 text-[10px] text-white data-selected:bg-orange-600">
                    <Timeline.RegionLabel className="truncate">{clip.name}</Timeline.RegionLabel>
                  </Timeline.RegionHeader>
                  <Timeline.RegionContent className="flex-1">
                    <Waveform.Root peaks={audio[clip.track as keyof typeof audio]} className="h-full">
                      <Waveform.Shape className="text-sky-500 group-data-selected:text-orange-300" />
                    </Waveform.Root>
                  </Timeline.RegionContent>
                  {/* Transparent zones at the edges that change the cursor; a bar of colour shows while you hover them. */}
                  <Timeline.RegionHandle side="start" aria-label="Start" className="w-2 cursor-ew-resize hover:bg-white/30" />
                  <Timeline.RegionHandle side="end" aria-label="End" className="w-2 cursor-ew-resize hover:bg-white/30" />
                </Timeline.Region>
              ))}
          </Timeline.Track>
        ))}
      </div>
    </Timeline.Root>
  );
}
