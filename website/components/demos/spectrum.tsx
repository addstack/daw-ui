'use client';

import { Spectrum, Toggle } from '@addstack/daw-ui/react';
import { useRef, useState } from 'react';

/** Sound for the demo: noise through a filter that sweeps, and a chord. In an app, whatever your audio engine plays. */
function play(context: AudioContext, analyser: AnalyserNode) {
  const noise = new AudioBufferSourceNode(context, { loop: true, buffer: new AudioBuffer({ length: context.sampleRate * 2, sampleRate: context.sampleRate }) });
  const samples = noise.buffer!.getChannelData(0);
  for (let index = 0; index < samples.length; index++) samples[index] = Math.random() * 2 - 1;
  const filter = new BiquadFilterNode(context, { type: 'bandpass', Q: 1.5 });
  const sweep = new OscillatorNode(context, { frequency: 0.2 });
  const depth = new GainNode(context, { gain: 1800 });
  filter.frequency.value = 2000;
  sweep.connect(depth).connect(filter.frequency);
  const chord = [220, 277, 330].map((frequency) => new OscillatorNode(context, { type: 'sawtooth', frequency }));
  const level = new GainNode(context, { gain: 0.05 });
  // The noise quieter than the chord, so that its band shows as a hump that moves.
  noise.connect(filter).connect(new GainNode(context, { gain: 0.3 })).connect(level);
  for (const note of chord) note.connect(level);
  level.connect(analyser).connect(context.destination);
  for (const source of [noise, sweep, ...chord]) source.start();
  return () => void context.close();
}

export default function SpectrumDemo() {
  // The analyser and the array it fills, outside React; silence until the sound plays.
  const analyser = useRef<AnalyserNode | null>(null);
  const bins = useRef(new Float32Array(2048).fill(-Infinity));
  const stop = useRef<(() => void) | null>(null);
  const [sampleRate, setSampleRate] = useState(48_000);

  return (
    <div className="flex w-full max-w-xl flex-col gap-2">
      <Toggle
        aria-label="Play"
        onPressedChange={(playing) => {
          if (!playing) {
            stop.current?.();
            analyser.current = null;
            bins.current.fill(-Infinity);
            return;
          }
          const context = new AudioContext();
          analyser.current = new AnalyserNode(context, { fftSize: 4096 });
          setSampleRate(context.sampleRate);
          stop.current = play(context, analyser.current);
        }}
        className="self-start rounded-md bg-neutral-200 px-3 py-1 text-xs data-pressed:bg-emerald-600 data-pressed:text-white dark:bg-neutral-800"
      >
        Play
      </Toggle>
      <Spectrum.Root
        read={() => {
          analyser.current?.getFloatFrequencyData(bins.current);
          return bins.current;
        }}
        sampleRate={sampleRate}
        floor={-100}
        ceiling={-10}
        tilt={3}
        aria-label="Spectrum"
        className="h-40 rounded-md bg-neutral-900"
      >
        <Spectrum.Fill className="text-emerald-500/15" />
        <Spectrum.Peak className="text-white/30" />
        <Spectrum.Line className="text-emerald-400" />
      </Spectrum.Root>
    </div>
  );
}
