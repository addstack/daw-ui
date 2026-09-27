'use client';

import { createPeaks } from '@addstack/daw-ui';
import { Waveform } from '@addstack/daw-ui/react';
import { useMemo, useRef } from 'react';

const RATE = 22_050;

/** Made-up one-shots for the demo. In an app, they come from the files of a sample browser. */
function sample(seconds: number, sound: (t: number) => number) {
  const samples = new Float32Array(Math.round(seconds * RATE));
  for (let index = 0; index < samples.length; index++) samples[index] = sound(index / RATE);
  return { samples: [samples], peaks: createPeaks([samples], RATE) };
}

const sounds = [
  { name: 'Kick', seconds: 0.6, sound: (t: number) => Math.exp(-t * 9) * Math.sin(2 * Math.PI * 50 * t * (1 + 4 * Math.exp(-t * 40))) },
  { name: 'Clap', seconds: 0.5, sound: (t: number) => Math.exp(-t * 14) * Math.sin(t * 9000 + Math.sin(t * 31_000) * 4) },
  { name: 'Pad', seconds: 2.4, sound: (t: number) => Math.sin(Math.PI * (t / 2.4)) * 0.7 * Math.sin(2 * Math.PI * 220 * t) },
];

export default function SampleDemo() {
  const audio = useMemo(() => sounds.map((one) => sample(one.seconds, one.sound)), []);
  // Which sample plays and since when: outside React, as a player would keep it.
  const playing = useRef<{ index: number; since: number } | null>(null);
  const position = (index: number) => {
    const current = playing.current;
    return current?.index === index ? (performance.now() - current.since) / 1000 : 0;
  };

  return (
    <ul className="flex w-full max-w-sm flex-col gap-2">
      {sounds.map((one, index) => (
        <li key={one.name}>
          <button
            type="button"
            onClick={() => (playing.current = { index, since: performance.now() })}
            className="flex w-full items-center gap-3 rounded-md border border-neutral-200 p-2 text-start focus-visible:outline-2 focus-visible:outline-orange-500 dark:border-neutral-800"
          >
            <span className="w-10 text-xs text-neutral-500">{one.name}</span>
            {/* On its own, a waveform is its own axis: the whole sample across its width, with its own playhead.
                A short sample is wider than its peaks are fine: with the samples, it is drawn from them. */}
            <Waveform.Root
              peaks={audio[index]!.peaks}
              samples={audio[index]!.samples}
              read={() => position(index)}
              aria-label={one.name}
              className="h-8 flex-1"
            >
              <Waveform.Shape className="text-neutral-400 dark:text-neutral-600" />
              <Waveform.Progress className="text-orange-500" />
            </Waveform.Root>
          </button>
        </li>
      ))}
    </ul>
  );
}
