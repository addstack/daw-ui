'use client';

import { formats, scales } from '@addstack/daw-ui';
import { Slider, Spectrum, Toggle } from '@addstack/daw-ui/react';
import { useRef, useState } from 'react';

const bands = ['Low', 'Mid', 'High'];

/**
 * The audio for the block: a bass, a chord and noise, split into three bands by the crossover's frequencies, each
 * band with its own gain for solo, summed into the analyser. In an app, your audio engine's multiband processor.
 */
function createCrossover(context: AudioContext, analyser: AnalyserNode, [low, high]: readonly number[]) {
  const input = new GainNode(context, { gain: 0.06 });
  const sources = [55, 220, 277, 330].map((frequency) => new OscillatorNode(context, { type: 'sawtooth', frequency }));
  for (const source of sources) source.connect(input);
  const noise = new AudioBufferSourceNode(context, { loop: true, buffer: new AudioBuffer({ length: context.sampleRate, sampleRate: context.sampleRate }) });
  noise.buffer!.getChannelData(0).forEach((_, index, samples) => (samples[index] = (Math.random() * 2 - 1) * 0.4));
  noise.connect(input);

  // Two filters in a row at each split: 24 dB per octave, as Linkwitz–Riley crossovers are.
  const filters: { node: BiquadFilterNode; split: number }[] = [];
  const through = (from: AudioNode, stages: [BiquadFilterType, number][]) =>
    stages.reduce((node, [type, split]) => {
      for (let pass = 0; pass < 2; pass++) {
        const filter = new BiquadFilterNode(context, { type, Q: Math.SQRT1_2 });
        filters.push({ node: filter, split });
        node = node.connect(filter);
      }
      return node;
    }, from);
  const outputs = [through(input, [['lowpass', 0]]), through(input, [['highpass', 0], ['lowpass', 1]]), through(input, [['highpass', 1]])];
  const gains = outputs.map((output) => output.connect(new GainNode(context)) as GainNode);
  for (const gain of gains) gain.connect(analyser);
  analyser.connect(context.destination);

  const crossover = {
    split(frequencies: readonly number[]) {
      for (const { node, split } of filters) node.frequency.setTargetAtTime(frequencies[split]!, context.currentTime, 0.01);
    },
    solo(soloed: readonly boolean[]) {
      const any = soloed.some(Boolean);
      gains.forEach((gain, band) => gain.gain.setTargetAtTime(!any || soloed[band] ? 1 : 0, context.currentTime, 0.01));
    },
    stop: () => void context.close(),
  };
  crossover.split([low!, high!]);
  for (const source of [...sources, noise]) source.start();
  return crossover;
}

export default function MultibandDemo() {
  // The audio and what the controls set on it, outside React: moving a split renders nothing.
  const crossover = useRef<ReturnType<typeof createCrossover> | null>(null);
  const splits = useRef<readonly number[]>([258, 7610]);
  const soloed = useRef([false, false, false]);
  const analyser = useRef<AnalyserNode | null>(null);
  const bins = useRef(new Float32Array(2048).fill(-Infinity));
  const [sampleRate, setSampleRate] = useState(48_000);

  const start = () => {
    const context = new AudioContext();
    analyser.current = new AnalyserNode(context, { fftSize: 4096, smoothingTimeConstant: 0.7 });
    setSampleRate(context.sampleRate);
    crossover.current = createCrossover(context, analyser.current, splits.current);
    crossover.current.solo(soloed.current);
  };
  const stop = () => {
    crossover.current?.stop();
    crossover.current = analyser.current = null;
    bins.current.fill(-Infinity);
  };

  return (
    <Slider.Root
      min={20}
      max={20_000}
      scale={scales.log}
      format={formats.frequency()}
      defaultValue={splits.current}
      onValueChange={(values) => {
        splits.current = values;
        crossover.current?.split(values);
      }}
      className="w-full max-w-xl overflow-hidden rounded-md bg-neutral-900 text-neutral-400 select-none"
    >
      <Slider.Label className="sr-only">Crossover</Slider.Label>
      <div className="relative mx-6 h-36">
        {/* The spectrum of what the bands sum to, on the same logarithmic axis as the slider. */}
        <Spectrum.Root
          read={() => {
            analyser.current?.getFloatFrequencyData(bins.current);
            return bins.current;
          }}
          sampleRate={sampleRate}
          floor={-110}
          ceiling={-20}
          tilt={3}
          aria-label="Spectrum"
          style={{ position: 'absolute', inset: 0 }}
        >
          <Spectrum.Fill className="text-black/40" />
          <Spectrum.Line thickness={1} className="text-neutral-300" />
        </Spectrum.Root>
        {bands.map((band, index) => (
          <Slider.Band key={band} index={index} className={`inset-y-0 border-dashed border-neutral-500 p-2 text-xs ${index > 0 ? 'border-s-2' : ''}`}>
            <div className="flex items-center justify-between gap-1">
              <span className="truncate">{band}</span>
              <Toggle
                aria-label={`Solo ${band}`}
                onPressedChange={(pressed) => {
                  soloed.current = soloed.current.map((one, at) => (at === index ? pressed : one));
                  crossover.current?.solo(soloed.current);
                }}
                className="flex size-5 items-center justify-center rounded-sm text-neutral-400 data-pressed:bg-fuchsia-500 data-pressed:text-white"
              >
                {/* Headphones: listen to this band alone. */}
                <svg viewBox="0 0 16 16" className="size-3.5 fill-none stroke-current stroke-[1.5]" aria-hidden>
                  <path d="M2.5 10V8a5.5 5.5 0 0 1 11 0v2" />
                  <rect x="2" y="9.5" width="3" height="4.5" rx="1" />
                  <rect x="11" y="9.5" width="3" height="4.5" rx="1" />
                </svg>
              </Toggle>
            </div>
          </Slider.Band>
        ))}
      </div>
      <Slider.Control className="cursor-pointer bg-black px-6 py-4">
        <Slider.Track className="h-1 rounded-full bg-neutral-800">
          <Slider.Range className="inset-y-0 rounded-full bg-fuchsia-500" />
          {[0, 1].map((index) => (
            <Slider.Thumb
              key={index}
              index={index}
              aria-label={index === 0 ? 'Low to mid' : 'Mid to high'}
              className="top-1/2 -mt-[7px] size-3.5 rounded-full bg-neutral-200 outline-offset-2 focus-visible:outline-2 focus-visible:outline-fuchsia-400 data-dragging:bg-white"
            >
              <Slider.Value
                index={index}
                className="pointer-events-none absolute bottom-5 left-1/2 -translate-x-1/2 rounded-sm bg-neutral-800 px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap text-neutral-200 tabular-nums"
              />
            </Slider.Thumb>
          ))}
        </Slider.Track>
      </Slider.Control>
      <div className="flex items-center justify-between bg-black px-6 pb-3 text-[11px]">
        <Toggle
          aria-label="Play"
          onPressedChange={(playing) => (playing ? start() : stop())}
          className="rounded-sm bg-neutral-800 px-2 py-0.5 text-neutral-300 data-pressed:bg-fuchsia-500 data-pressed:text-white"
        >
          Play
        </Toggle>
        <span>Bands</span>
      </div>
    </Slider.Root>
  );
}
