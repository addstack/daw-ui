'use client';

import { formats, readPitch } from '@addstack/daw-ui';
import { useEffect, useRef } from 'react';

const pitch = formats.pitch({ names: ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'] });
// A row of 21 lights across ±50 cents: the middle one is in tune.
const LIGHTS = 21;

/** Made-up playing for the demo, as in the classic tuner. In an app, the frequency your pitch detector hears. */
function playing(now = performance.now() / 1000) {
  const string = [40, 45, 50, 55, 59, 64][Math.floor(now / 4) % 6]!;
  const time = now % 4;
  if (time > 3.4) return null;
  const cents = (((Math.floor(now / 4) * 37) % 80) - 40) * Math.exp(-time * 1.4) + 1.5 * Math.sin(now * 9);
  return 440 * 2 ** ((string + cents / 100 - 69) / 12);
}

export default function PedalTunerDemo() {
  const root = useRef<HTMLDivElement>(null);
  const note = useRef<HTMLSpanElement>(null);
  const lights = useRef<(HTMLSpanElement | null)[]>([]);
  const strobe = useRef<HTMLDivElement>(null);

  // Once per frame: the light for the cents off, and the strobe, which moves by the cents off over time. Nothing renders.
  useEffect(() => {
    let previous: number | null = null;
    let phase = 0;
    let last = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const reading = readPitch(playing(), { previous });
      root.current?.toggleAttribute('data-active', reading !== null);
      if (reading) {
        previous = reading.target;
        root.current?.toggleAttribute('data-in-tune', Math.abs(reading.cents) <= 2.4);
        const lit = Math.max(0, Math.min(LIGHTS - 1, Math.floor(((reading.cents + 50) / 100) * LIGHTS)));
        lights.current.forEach((light, index) => light?.toggleAttribute('data-lit', index === lit));
        // The strobe runs the way the pitch is off, faster the further off, and stands still in tune.
        phase += (reading.cents * (now - last)) / 1000;
        strobe.current?.style.setProperty('--phase', String(phase));
        const text = pitch.format(reading.target);
        if (note.current && note.current.textContent !== text) note.current.textContent = text;
      } else {
        lights.current.forEach((light) => light?.removeAttribute('data-lit'));
      }
      last = now;
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div ref={root} className="group flex w-full max-w-md flex-col gap-3 rounded-md bg-black p-4 select-none">
      <div className="flex items-center gap-4">
        <span ref={note} aria-live="polite" className="w-14 text-center font-mono text-3xl text-red-500 group-data-in-tune:text-green-400" />
        <div aria-hidden className="flex flex-1 gap-0.5">
          {Array.from({ length: LIGHTS }, (_, index) => (
            <span
              key={index}
              ref={(element) => {
                lights.current[index] = element;
              }}
              className={`h-8 flex-1 rounded-[1px] bg-neutral-800 ${index === 10 ? 'data-lit:bg-green-400' : 'data-lit:bg-red-500'}`}
            />
          ))}
        </div>
      </div>
      <div
        ref={strobe}
        aria-hidden
        className="h-6 rounded-sm bg-[repeating-linear-gradient(90deg,rgb(248_113_113)_0_10px,transparent_10px_20px)] opacity-20 [background-position-x:calc(var(--phase,0)*2px)] group-data-active:opacity-100 group-data-in-tune:bg-[repeating-linear-gradient(90deg,rgb(74_222_128)_0_10px,transparent_10px_20px)]"
      />
    </div>
  );
}
