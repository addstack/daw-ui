'use client';

import { createPeaks, musicalGrid, scales, type CurvePoint, type Peaks } from '@addstack/daw-ui';
import { Curve, Notes, Region, Timeline, Toggle, useCurveEditing, Waveform, type Note } from '@addstack/daw-ui/react';
import { Fragment, useMemo, useState } from 'react';

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
/** A lane of automation under a track, in decibels: it lies on the timeline itself, not in a clip. */
type Automation = { name: string; points: CurvePoint[] };
/** A track of audio, drawn as a waveform, or of MIDI, drawn as notes. */
type Track = { id: string; name: string; clips: Clip[]; automation?: Automation } & ({ peaks: Peaks } | { notes: Note[] });

/** Four bars of chords, a bar each (2 s at 120 BPM), in seconds of the clip. */
const chords: Note[] = [57, 53, 55, 52].flatMap((root, bar) => [0, 4, 7].map((third) => ({ at: bar * 2, duration: 1.75, pitch: root + third })));

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
        // Swells into bar 2, a dip in bar 4, and a fade out at the end.
        automation: {
          name: 'Volume',
          points: [
            { at: 0, value: -24, shape: -0.5 },
            { at: 2, value: 0 },
            { at: 6, value: 0, shape: 0.5 },
            { at: 7, value: -12, shape: -0.5 },
            { at: 8, value: 0 },
            { at: 9.5, value: 0, shape: 0.6 },
            { at: 10, value: -Infinity },
          ],
        },
      },
      {
        id: 'keys',
        name: 'Keys',
        notes: chords,
        clips: [
          { id: 'e', name: 'Chords', at: 4, duration: 4 },
          { id: 'f', name: 'Chords', at: 8, duration: 4 },
        ],
      },
    ],
    [],
  );
  // The automation lane can be edited: drag its points, double-click to add one. The application keeps what each
  // gesture leaves.
  const [automation, setAutomation] = useState(() => tracks.find((track) => track.automation)!.automation!.points);
  const editing = useCurveEditing({ snap: { time: grid }, onGestureEnd: setAutomation });

  return (
    <div className="flex w-full max-w-2xl overflow-hidden rounded-md bg-neutral-900 text-white select-none">
      {/* The headers: a column of the page's own, beside the timeline, with rows as tall as the timeline's. */}
      <div className="w-28 shrink-0 border-e border-neutral-800">
        <div className="h-6 border-b border-neutral-800" />
        {tracks.map((track) => (
          <Fragment key={track.id}>
            <div className="flex h-16 items-center gap-1 border-b border-neutral-800 px-2 text-xs last:border-0">
              <span className="flex-1 truncate">{track.name}</span>
              <Toggle
                aria-label={`Mute ${track.name}`}
                className="h-5 w-5 rounded-sm bg-neutral-800 text-[10px] text-neutral-400 data-pressed:bg-yellow-500 data-pressed:text-black"
              >
                M
              </Toggle>
            </div>
            {track.automation && (
              <div className="flex h-10 items-center border-b border-neutral-800 ps-4 text-[10px] text-neutral-400 last:border-0">{track.automation.name}</div>
            )}
          </Fragment>
        ))}
      </div>

      {/* The timeline shows time; the rows in it are the page's too, with audio or MIDI in their regions. */}
      <Timeline.Root start={0} end={12} position={5} className="flex-1">
        <Timeline.Ruler grid={grid} className="h-6 border-b border-neutral-800 font-mono text-[10px] text-neutral-400 [&_[data-label]]:top-0.5 [&_[data-label]]:ps-1">
          <Timeline.Grid grid={grid} spacing={64} style={{ top: '65%' }} className="text-neutral-600" />
        </Timeline.Ruler>
        <div className="relative">
          <Timeline.Grid grid={grid} className="text-white/5" />
          <Timeline.Grid grid={grid} spacing={64} className="text-white/15" />
          {tracks.map((track) => (
            <Fragment key={track.id}>
              <div role="group" aria-label={track.name} className="relative h-16 border-b border-neutral-800 last:border-0">
                {track.clips.map((clip) => (
                  <Region.Root key={clip.id} at={clip.at} duration={clip.duration} className="flex flex-col overflow-hidden rounded-sm bg-sky-950/80 px-px">
                    <Region.Header className="flex h-4 shrink-0 items-center bg-sky-800 px-1 text-[10px]">
                      <Region.Label className="truncate">{clip.name}</Region.Label>
                    </Region.Header>
                    <Region.Content className="flex-1">
                      {'peaks' in track ? (
                        <Waveform.Root peaks={track.peaks} className="h-full">
                          <Waveform.Shape className="text-sky-500" />
                          <Waveform.Progress className="text-sky-300" />
                        </Waveform.Root>
                      ) : (
                        <Notes.Root notes={track.notes} className="h-full">
                          <Notes.Shape className="text-emerald-500" />
                          <Notes.Progress className="text-emerald-300" />
                        </Notes.Root>
                      )}
                    </Region.Content>
                  </Region.Root>
                ))}
              </div>
              {track.automation && (
                // Outside a region, a curve lies on the timeline itself, from its second 0, for ever.
                <div className="relative h-10 border-b border-neutral-800 last:border-0">
                  <Curve.Root points={automation} editing={editing} min={-Infinity} max={6} scale={scales.decibel} aria-label={`${track.name} ${track.automation.name}`} className="h-full">
                    <Curve.Fill className="text-amber-500/20" />
                    <Curve.Line thickness={1.5} className="text-amber-500" />
                    <Curve.Dots className="text-amber-300" size={4} />
                    <Curve.Bend className="size-2 rotate-45 border border-amber-300 bg-neutral-900" />
                    <Curve.Handle aria-label="Point" className="size-2.5 rounded-full bg-white data-selected:bg-amber-400" />
                  </Curve.Root>
                </div>
              )}
            </Fragment>
          ))}
        </div>
        <Timeline.Playhead className="w-px bg-white" />
      </Timeline.Root>
    </div>
  );
}
