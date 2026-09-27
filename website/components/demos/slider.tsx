'use client';

import { formats, scales } from '@addstack/daw-ui';
import { Slider, Toggle } from '@addstack/daw-ui/react';

const bands = ['Low', 'Mid', 'High'];

export default function SliderDemo() {
  return (
    // The crossover of a multiband processor: two split frequencies on a logarithmic track, three bands between them.
    <Slider.Root
      min={20}
      max={20_000}
      scale={scales.log}
      format={formats.frequency()}
      defaultValue={[258, 7610]}
      className="w-full max-w-xl overflow-hidden rounded-md bg-neutral-900 text-neutral-400 select-none"
    >
      <Slider.Label className="sr-only">Crossover</Slider.Label>
      {/* The bands over the graph, as wide as the track: their edges are the dashed lines at the splits. */}
      <div className="relative mx-6 h-28">
        {bands.map((band, index) => (
          <Slider.Band key={band} index={index} className="inset-y-0 border-dashed border-neutral-500 p-2 text-xs not-first:border-s-2">
            {/* A band can hold controls of its own: here, its solo, beside its name. */}
            <div className="flex items-center justify-between gap-1">
              <span className="truncate">{band}</span>
              <Toggle aria-label={`Solo ${band}`} className="rounded-sm px-1 text-[10px] data-pressed:bg-fuchsia-500 data-pressed:text-white">
                S
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
              {/* The value rides above its thumb. */}
              <Slider.Value index={index} className="pointer-events-none absolute bottom-5 left-1/2 -translate-x-1/2 rounded-sm bg-neutral-800 px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap text-neutral-200 tabular-nums" />
            </Slider.Thumb>
          ))}
        </Slider.Track>
      </Slider.Control>
    </Slider.Root>
  );
}
