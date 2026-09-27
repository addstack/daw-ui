'use client';

import { createPeaks, musicalGrid } from '@addstack/daw-ui';
import { Region, Timeline, Waveform } from '@addstack/daw-ui/react';
import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

const RATE = 22_050;
const END = 12;
// 120 BPM: moves snap to beats, half a second.
const BEAT = 0.5;
const grid = musicalGrid({ bpm: 120 });

/** Made-up audio for the demo: four seconds of a beat. */
function beat() {
  const samples = new Float32Array(4 * RATE);
  for (let index = 0; index < samples.length; index++) {
    const t = (index / RATE) % 0.5;
    samples[index] = Math.exp(-t * 14) * Math.sin(2 * Math.PI * 55 * t * (1 + 3 * Math.exp(-t * 30)));
  }
  return createPeaks([samples], RATE);
}

type Clip = { id: string; name: string; at: number; duration: number; offset: number };

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

// What a move of `seconds` does to a clip, from where it was when the drag started.
const move = (clip: Clip, seconds: number): Clip => ({ ...clip, at: clamp(clip.at + seconds, 0, END - clip.duration) });
// The start moves the content with it: the audio stays where it is in time.
const trimStart = (clip: Clip, seconds: number): Clip => {
  const by = clamp(seconds, -Math.min(clip.offset, clip.at), clip.duration - BEAT);
  return { ...clip, at: clip.at + by, offset: clip.offset + by, duration: clip.duration - by };
};
const trimEnd = (clip: Clip, seconds: number): Clip => ({ ...clip, duration: clamp(clip.duration + seconds, BEAT, 4 - clip.offset) });

export default function RegionEditingDemo() {
  const peaks = useMemo(beat, []);
  const [clips, setClips] = useState<Clip[]>([
    { id: 'a', name: 'Beat', at: 1, duration: 3, offset: 0 },
    { id: 'b', name: 'Fill', at: 6, duration: 2, offset: 1 },
  ]);
  const timeline = useRef<HTMLDivElement>(null);
  const update = (clip: Clip) => setClips((current) => current.map((one) => (one.id === clip.id ? clip : one)));

  /** Follows a drag: the pointer's move in seconds, snapped to beats, applied to the clip as it was at the press. */
  const drag = (event: PointerEvent<HTMLElement>, clip: Clip, edit: (clip: Clip, seconds: number) => Clip) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const element = event.currentTarget;
    element.setPointerCapture(event.pointerId);
    const secondsPerPixel = END / timeline.current!.clientWidth;
    const from = event.clientX;
    const follow = (moved: globalThis.PointerEvent) =>
      update(edit(clip, Math.round(((moved.clientX - from) * secondsPerPixel) / BEAT) * BEAT));
    const release = () => {
      element.removeEventListener('pointermove', follow);
      element.removeEventListener('pointerup', release);
    };
    element.addEventListener('pointermove', follow);
    element.addEventListener('pointerup', release);
  };

  // The keyboard does the same: arrows move a clip by a beat, with Shift they change its length.
  const keys = (event: KeyboardEvent, clip: Clip) => {
    const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!direction) return;
    event.preventDefault();
    update(event.shiftKey ? trimEnd(clip, direction * BEAT) : move(clip, direction * BEAT));
  };

  return (
    <Timeline.Root ref={timeline} start={0} end={END} className="w-full max-w-2xl overflow-hidden rounded-md bg-neutral-900 text-white select-none">
      <Timeline.Ruler grid={grid} className="h-6 border-b border-neutral-800 font-mono text-[10px] text-neutral-400 [&_[data-label]]:top-0.5 [&_[data-label]]:ps-1" />
      <div className="relative h-20">
        <Timeline.Grid grid={grid} className="text-white/10" />
        {clips.map((clip) => (
          <Region.Root
            key={clip.id}
            at={clip.at}
            duration={clip.duration}
            offset={clip.offset}
            tabIndex={0}
            onPointerDown={(event) => drag(event, clip, move)}
            onKeyDown={(event) => keys(event, clip)}
            className="flex cursor-grab flex-col overflow-hidden rounded-sm bg-sky-950/80 outline-offset-[-1px] focus-visible:outline-2 focus-visible:outline-orange-500 active:cursor-grabbing"
          >
            <Region.Header className="flex h-4 shrink-0 items-center bg-sky-800 px-1 text-[10px]">
              <Region.Label className="truncate">{clip.name}</Region.Label>
            </Region.Header>
            <Region.Content className="flex-1">
              <Waveform.Root peaks={peaks} className="h-full">
                <Waveform.Shape className="text-sky-500" />
              </Waveform.Root>
            </Region.Content>
            {/* The edges: plain elements of the page, at the sides of the region. */}
            <div onPointerDown={(event) => drag(event, clip, trimStart)} className="absolute inset-y-0 left-0 w-2 cursor-ew-resize hover:bg-white/30" />
            <div onPointerDown={(event) => drag(event, clip, trimEnd)} className="absolute inset-y-0 right-0 w-2 cursor-ew-resize hover:bg-white/30" />
          </Region.Root>
        ))}
      </div>
    </Timeline.Root>
  );
}
