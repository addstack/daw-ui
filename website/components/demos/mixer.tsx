'use client';

import { formats, scales } from '@addstack/daw-ui';
import { Fader, Knob, Meter, Toggle, ToggleGroup } from '@addstack/daw-ui/react';
import { useRef } from 'react';

const CHANNELS = ['Drums', 'Bass', 'Keys'];
// The letters come from your app: "L/R/C" in English, "L/P/Ś" in Polish.
const pan = formats.pan({ left: 'L', right: 'R', center: 'C' });
const decibels = formats.decibel();

/** A stand-in for an AnalyserNode before the fader: a beat with a slow swell, in dBFS. */
function source(channel: number, side: number) {
  const t = performance.now() / 1000;
  const beat = Math.pow(1 - ((t * 2 + channel * 0.23 + side * 0.04) % 1), 3);
  const swell = 0.5 + 0.5 * Math.sin(t * 0.8 + channel * 2 + side);
  return -36 + 30 * beat * (0.7 + 0.3 * swell);
}

const label = 'text-[10px] font-medium tracking-wider text-neutral-500 uppercase dark:text-neutral-400';
const button =
  'size-7 rounded-md border border-neutral-300 bg-white text-xs font-semibold text-neutral-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500 dark:border-neutral-700 dark:bg-neutral-900';

export default function MixerDemo() {
  // What the audio engine would hold, outside React: controls write to it, meters read it every frame.
  const mix = useRef(CHANNELS.map(() => ({ volume: 0, pan: 0, mute: false, solo: false })));
  const level = (channel: number, side: number) => {
    const strip = mix.current[channel]!;
    const soloing = mix.current.some((one) => one.solo);
    if (strip.mute || (soloing && !strip.solo)) return -Infinity;
    // Equal-power pan, 0 dB on both sides in the middle.
    const angle = ((strip.pan + 1) * Math.PI) / 4;
    const gain = Math.SQRT2 * (side === 0 ? Math.cos(angle) : Math.sin(angle));
    return source(channel, side) + strip.volume + 20 * Math.log10(gain);
  };

  return (
    // One group for the mute and solo buttons of every strip: solo is exclusive across them (Cmd/Ctrl+click adds).
    <ToggleGroup paint exclusive={{ solo: 'click' }} className="flex gap-3">
      {CHANNELS.map((name, channel) => (
        <div
          key={name}
          role="group"
          aria-label={name}
          className="flex flex-col items-center gap-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800"
        >
          <span className="text-xs font-medium">{name}</span>

          <Knob.Root
            min={-1}
            max={1}
            origin={0}
            format={pan}
            onValueChange={(value) => (mix.current[channel]!.pan = value)}
            className="flex flex-col items-center gap-1"
          >
            <Knob.Label className={label}>Pan</Knob.Label>
            <Knob.Control className="size-9 cursor-ns-resize rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500">
              <svg viewBox="0 0 100 100" className="size-full overflow-visible">
                <Knob.Track radius={38} className="fill-none stroke-neutral-200 stroke-12 [stroke-linecap:round] dark:stroke-neutral-800" />
                <Knob.Range radius={38} className="fill-none stroke-sky-500 stroke-12 [stroke-linecap:round]" />
                <Knob.Pointer from={6} to={26} className="stroke-neutral-900 stroke-10 [stroke-linecap:round] dark:stroke-neutral-100" />
              </svg>
            </Knob.Control>
            <Knob.Value className="font-mono text-[10px] text-neutral-600 tabular-nums dark:text-neutral-400" />
          </Knob.Root>

          <div className="flex gap-1.5">
            <Toggle
              lane="mute"
              aria-label={`Mute ${name}`}
              onPressedChange={(pressed) => (mix.current[channel]!.mute = pressed)}
              className={`${button} data-pressed:border-yellow-400 data-pressed:bg-yellow-400 data-pressed:text-neutral-900`}
            >
              M
            </Toggle>
            <Toggle
              lane="solo"
              aria-label={`Solo ${name}`}
              onPressedChange={(pressed) => (mix.current[channel]!.solo = pressed)}
              className={`${button} data-pressed:border-sky-400 data-pressed:bg-sky-400 data-pressed:text-neutral-900`}
            >
              S
            </Toggle>
          </div>

          <Fader.Root
            min={-Infinity}
            max={6}
            defaultValue={0}
            scale={scales.decibel}
            format={decibels}
            zones={{ hot: 0 }}
            onValueChange={(value) => (mix.current[channel]!.volume = value)}
            className="flex flex-col items-center gap-2"
          >
            <Fader.Label className={label}>Volume</Fader.Label>
            <div className="flex items-stretch gap-2">
              <Fader.Control className="cursor-ns-resize rounded-md px-2.5 py-1.5 focus-visible:outline-2 focus-visible:outline-orange-500">
                <Fader.Track className="h-36 w-1 rounded-full bg-neutral-200 dark:bg-neutral-800">
                  <Fader.Range className="w-full rounded-full bg-orange-500 data-[zone=hot]:bg-red-500" />
                  <Fader.Thumb className="-ms-2.5 h-3 w-6 rounded-sm border border-black/20 bg-white shadow-sm" />
                </Fader.Track>
              </Fader.Control>
              {/* The level after the fader and the pan: the meters read it every frame, without rendering. */}
              <div className="flex gap-0.5 py-1.5">
                {['left', 'right'].map((side, index) => (
                  <Meter.Root key={side} read={() => level(channel, index)} min={-60} max={6}>
                    <Meter.Track aria-label={`${name}, ${side}`} className="h-36 w-1.5 overflow-hidden rounded-sm bg-neutral-200 dark:bg-neutral-900">
                      <Meter.Bar className="bg-[linear-gradient(to_top,#22c55e_0%,#22c55e_64%,#eab308_82%,#ef4444_92%)]" />
                    </Meter.Track>
                  </Meter.Root>
                ))}
              </div>
            </div>
            <Fader.Value className="font-mono text-[10px] text-neutral-600 tabular-nums data-[zone=hot]:text-red-500 dark:text-neutral-400" />
          </Fader.Root>
        </div>
      ))}
    </ToggleGroup>
  );
}
