'use client';

import { clockGrid, createPeaksRecorder, type PeaksRecorder } from '@addstack/daw-ui';
import { Region, Timeline, Toggle, Waveform } from '@addstack/daw-ui/react';
import { useEffect, useRef, useState } from 'react';

const RATE = 22_050;
const BLOCK = 128;
const grid = clockGrid();

/** A made-up voice: in an app, the blocks come from an AudioWorklet on the microphone. */
function voice(t: number) {
  const syllable = Math.max(0, Math.sin(t * 5.3)) ** 2 * Math.max(0, Math.sin(t * 0.9 + 1));
  return syllable * Math.sin(2 * Math.PI * 180 * t + Math.sin(t * 40));
}

export default function RecordingDemo() {
  const [take, setTake] = useState<PeaksRecorder>(() => createPeaksRecorder({ sampleRate: RATE, channels: 1 }));
  const [recording, setRecording] = useState(false);
  const elapsed = () => take.duration;

  // Appends what the microphone would have delivered since the last frame, in blocks of 128 samples.
  const started = useRef(0);
  useEffect(() => {
    if (!recording) return;
    started.current = performance.now() - take.duration * 1000;
    const block = new Float32Array(BLOCK);
    let frame = requestAnimationFrame(function tick() {
      while (take.length < ((performance.now() - started.current) / 1000) * RATE) {
        for (let index = 0; index < BLOCK; index++) block[index] = voice((take.length + index) / RATE);
        take.append([block]);
      }
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [recording, take]);

  return (
    <div className="flex w-full max-w-2xl flex-col gap-3">
      <div className="flex gap-2">
        <Toggle
          pressed={recording}
          onPressedChange={setRecording}
          aria-label="Record"
          className="h-8 rounded-md border border-neutral-300 bg-white px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500 data-pressed:border-red-500 data-pressed:bg-red-500 data-pressed:text-white dark:border-neutral-700 dark:bg-neutral-900"
        >
          ●
        </Toggle>
        <button
          type="button"
          aria-label="New take"
          onClick={() => {
            setRecording(false);
            setTake(createPeaksRecorder({ sampleRate: RATE, channels: 1 }));
          }}
          className="h-8 rounded-md border border-neutral-300 bg-white px-3 text-sm select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500 dark:border-neutral-700 dark:bg-neutral-900"
        >
          ⟲
        </button>
      </div>

      {/* The view follows the end of the take: the last 8 seconds. */}
      <Timeline.Root
        start={0}
        end={8}
        readView={() => [Math.max(0, elapsed() - 8), Math.max(8, elapsed())]}
        read={elapsed}
        className="overflow-hidden rounded-md bg-neutral-900"
      >
        <Timeline.Ruler grid={grid} className="h-6 border-b border-neutral-800 font-mono text-[10px] text-neutral-400 [&_[data-label]]:top-0.5 [&_[data-label]]:ps-1">
          <Timeline.Grid grid={grid} spacing={64} style={{ top: '65%' }} className="text-neutral-600" />
        </Timeline.Ruler>
        {/* The region grows with the take: read once per frame, without rendering. */}
        <div role="group" aria-label="Vocals" className="relative h-20">
          <Region.Root at={0} read={() => ({ duration: take.duration })} className="bg-red-950/60">
            <Waveform.Root peaks={take} aria-label="Take" className="h-full">
              <Waveform.Shape className="text-red-400" />
            </Waveform.Root>
          </Region.Root>
        </div>
        <Timeline.Playhead className="w-px bg-white" />
      </Timeline.Root>
    </div>
  );
}
