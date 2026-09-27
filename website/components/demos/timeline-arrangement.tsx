'use client';

import { createPeaks, musicalGrid, type Peaks } from '@addstack/daw-ui';
import { Region, Timeline, Toggle, Waveform } from '@addstack/daw-ui/react';
import { useMemo } from 'react';

const RATE = 22_050;
// 120 BPM: a bar is 2 seconds.
const grid = musicalGrid({ bpm: 120 });

/** Made-up audio for the demo. In an app, clips point to files and their peaks. */
function synthesize(seconds: number, sample: (t: number) => number): Peaks {
  const samples = new Float32Array(seconds * RATE);
  for (let index = 0; index < samples.length; index++) samples[index] = sample(index / RATE);
  return createPeaks([samples], RATE);
}

type Clip = { id: string; name: string; at: number; duration: number };
type Track = { id: string; name: string; peaks: Peaks; clips: Clip[] };

export default function ArrangementDemo() {
  const tracks = useMemo<Track[]>(
    () => [
      {
        id: 'drums',
        name: 'Drums',
        peaks: synthesize(4, (t) => Math.exp(-(t % 0.5) * 14) * Math.sin(2 * Math.PI * 55 * (t % 0.5) * (1 + 3 * Math.exp(-(t % 0.5) * 30)))),
        clips: [
          { id: 'a', name: 'Beat', at: 0, duration: 4 },
          { id: 'b', name: 'Beat', at: 4, duration: 4 },
          { id: 'c', name: 'Beat', at: 8, duration: 4 },
        ],
      },
      {
        id: 'bass',
        name: 'Bass',
        peaks: synthesize(8, (t) => 0.6 * Math.exp(-(t % 2) * 0.8) * Math.sin(2 * Math.PI * [41, 49, 37, 44][Math.floor(t / 2) % 4]! * t)),
        clips: [{ id: 'd', name: 'Bassline', at: 2, duration: 8 }],
      },
      {
        id: 'keys',
        name: 'Keys',
        peaks: synthesize(4, (t) => 0.4 * Math.sin(Math.PI * (t / 4)) * Math.sin(2 * Math.PI * 262 * t) * Math.sin(2 * Math.PI * 330 * t)),
        clips: [
          { id: 'e', name: 'Chords', at: 4, duration: 4 },
          { id: 'f', name: 'Chords', at: 8, duration: 4 },
        ],
      },
    ],
    [],
  );

  return (
    <div className="flex w-full max-w-2xl overflow-hidden rounded-md bg-neutral-900 text-white select-none">
      {/* The headers: a column of the page's own, beside the timeline, with rows as tall as the timeline's. */}
      <div className="w-28 shrink-0 border-e border-neutral-800">
        <div className="h-6 border-b border-neutral-800" />
        {tracks.map((track) => (
          <div key={track.id} className="flex h-16 items-center gap-1 border-b border-neutral-800 px-2 text-xs last:border-0">
            <span className="flex-1 truncate">{track.name}</span>
            <Toggle
              aria-label={`Mute ${track.name}`}
              className="h-5 w-5 rounded-sm bg-neutral-800 text-[10px] text-neutral-400 data-pressed:bg-yellow-500 data-pressed:text-black"
            >
              M
            </Toggle>
          </div>
        ))}
      </div>

      {/* The timeline shows time; the rows in it are the page's too. */}
      <Timeline.Root start={0} end={12} position={5} className="flex-1">
        <Timeline.Ruler grid={grid} className="h-6 border-b border-neutral-800 font-mono text-[10px] text-neutral-400 [&_[data-label]]:top-0.5 [&_[data-label]]:ps-1">
          <Timeline.Grid grid={grid} spacing={64} style={{ top: '65%' }} className="text-neutral-600" />
        </Timeline.Ruler>
        <div className="relative">
          <Timeline.Grid grid={grid} className="text-white/5" />
          <Timeline.Grid grid={grid} spacing={64} className="text-white/15" />
          {tracks.map((track) => (
            <div key={track.id} role="group" aria-label={track.name} className="relative h-16 border-b border-neutral-800 last:border-0">
              {track.clips.map((clip) => (
                <Region.Root key={clip.id} at={clip.at} duration={clip.duration} className="flex flex-col overflow-hidden rounded-sm bg-sky-950/80 px-px">
                  <Region.Header className="flex h-4 shrink-0 items-center bg-sky-800 px-1 text-[10px]">
                    <Region.Label className="truncate">{clip.name}</Region.Label>
                  </Region.Header>
                  <Region.Content className="flex-1">
                    <Waveform.Root peaks={track.peaks} className="h-full">
                      <Waveform.Shape className="text-sky-500" />
                      <Waveform.Progress className="text-sky-300" />
                    </Waveform.Root>
                  </Region.Content>
                </Region.Root>
              ))}
            </div>
          ))}
        </div>
        <Timeline.Playhead className="w-px bg-white" />
      </Timeline.Root>
    </div>
  );
}
