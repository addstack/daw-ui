'use client';

import { formats } from '@addstack/daw-ui';
import { Tuner } from '@addstack/daw-ui/react';

const pitch = formats.pitch({ names: ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'] });
// A row of 21 lights, each a stretch of cents: the middle one is ±2.4 cents.
const lights = Array.from({ length: 21 }, (_, index) => [-50 + (index * 100) / 21, -50 + ((index + 1) * 100) / 21] as const);

/** Made-up playing for the demo, as on the tuner's page. In an app, the frequency your pitch detector hears. */
function playing(now = performance.now() / 1000) {
  const string = [40, 45, 50, 55, 59, 64][Math.floor(now / 4) % 6]!;
  const time = now % 4;
  if (time > 3.4) return null;
  const cents = (((Math.floor(now / 4) * 37) % 80) - 40) * Math.exp(-time * 1.4) + 1.5 * Math.sin(now * 9);
  return 440 * 2 ** ((string + cents / 100 - 69) / 12);
}

export default function StrobeDemo() {
  return (
    <Tuner.Root read={() => playing()} format={pitch} tolerance={2.4} className="group flex w-full max-w-md flex-col gap-3 rounded-md bg-black p-4 select-none">
      <div className="flex items-center gap-4">
        <Tuner.Note className="w-14 text-center font-mono text-3xl text-red-500 group-data-in-tune:text-green-400" />
        {/* A row of lights, as on a pedal tuner: the light for the cents off is lit. */}
        <div className="flex flex-1 gap-0.5">
          {lights.map((cents, index) => (
            <Tuner.Mark
              key={index}
              cents={cents}
              className={`h-8 flex-1 rounded-[1px] bg-neutral-800 ${index === 10 ? 'data-active:bg-green-400' : 'data-active:bg-red-500'}`}
            />
          ))}
        </div>
      </div>
      {/* A strobe: the stripes run the way the pitch is off, faster the further off, and stand still in tune. */}
      <Tuner.Strobe className="h-6 rounded-sm bg-[repeating-linear-gradient(90deg,rgb(248_113_113)_0_10px,transparent_10px_20px)] opacity-20 [background-position-x:calc(var(--tuner-phase)*2px)] group-data-active:opacity-100 group-data-in-tune:bg-[repeating-linear-gradient(90deg,rgb(74_222_128)_0_10px,transparent_10px_20px)]" />
    </Tuner.Root>
  );
}
