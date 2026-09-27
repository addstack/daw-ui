'use client';

import { formats, readPitch } from '@addstack/daw-ui';
import { useEffect, useRef, useState } from 'react';

const pitch = formats.pitch({ names: ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'] });
const signed = new Intl.NumberFormat(undefined, { signDisplay: 'exceptZero', maximumFractionDigits: 0 });
// Standard tuning, E2 to E4, as MIDI notes.
const strings = [40, 45, 50, 55, 59, 64];

/** Made-up playing for the demo, as in the classic tuner. In an app, the frequency your pitch detector hears. */
function playing(now = performance.now() / 1000) {
  const string = strings[Math.floor(now / 4) % 6]!;
  const time = now % 4;
  if (time > 3.4) return null;
  const cents = (((Math.floor(now / 4) * 37) % 80) - 40) * Math.exp(-time * 1.4) + 1.5 * Math.sin(now * 9);
  return 440 * 2 ** ((string + cents / 100 - 69) / 12);
}

export default function GuitarTunerDemo() {
  // The string to tune to: none tunes to the nearest string, as guitar tuners do. It changes on a press, so it is state.
  const [chosen, setChosen] = useState<number>();
  const root = useRef<HTMLDivElement>(null);
  const needle = useRef<HTMLDivElement>(null);
  const note = useRef<HTMLSpanElement>(null);
  const cents = useRef<HTMLSpanElement>(null);
  const lit = useRef(new Map<number, HTMLElement>());
  const target = useRef(chosen);
  target.current = chosen;

  // Once per frame, the reading goes straight to the DOM. Nothing renders.
  useEffect(() => {
    let previous: number | null = null;
    let frame = requestAnimationFrame(function tick() {
      const reading = readPitch(playing(), { targets: strings, target: target.current, previous });
      const element = root.current;
      element?.toggleAttribute('data-active', reading !== null);
      if (reading && element) {
        previous = reading.target;
        element.toggleAttribute('data-in-tune', Math.abs(reading.cents) <= 4);
        element.toggleAttribute('data-flat', reading.cents < -4);
        element.toggleAttribute('data-sharp', reading.cents > 4);
        needle.current?.style.setProperty('--offset', String(Math.max(-1, Math.min(1, reading.cents / 50))));
        for (const [string, mark] of lit.current) mark.toggleAttribute('data-lit', string === reading.target);
        for (const [ref, text] of [[note, pitch.format(reading.target)], [cents, signed.format(Math.round(reading.cents) || 0)]] as const) {
          if (ref.current && ref.current.textContent !== text) ref.current.textContent = text;
        }
      }
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div ref={root} className="group flex w-full max-w-xs flex-col items-center gap-3 select-none">
      {/* An arc: the needle turns with the cents off, green in tune. */}
      <div aria-hidden className="relative h-28 w-56 overflow-hidden">
        <div className="absolute inset-x-0 top-2 aspect-square rounded-full border-8 border-neutral-200 dark:border-neutral-800" />
        <div
          ref={needle}
          className="absolute bottom-0 left-1/2 h-24 w-1 -translate-x-1/2 origin-bottom rounded-full bg-neutral-400 opacity-0 [rotate:calc(var(--offset,0)*60deg)] group-data-active:opacity-100 group-data-in-tune:bg-green-500"
        />
      </div>
      <div className="flex items-baseline gap-2">
        <span aria-hidden className="text-neutral-300 group-data-flat:text-orange-500">▼</span>
        <span ref={note} aria-live="polite" className="text-4xl font-semibold text-neutral-800 dark:text-neutral-100" />
        <span aria-hidden className="text-neutral-300 group-data-sharp:text-orange-500">▲</span>
      </div>
      <span ref={cents} className="font-mono text-xs text-neutral-500 tabular-nums" />
      {/* The strings: the one being tuned lights up; pressing one tunes to it alone. */}
      <div className="flex gap-1.5">
        {strings.map((string) => (
          <button
            key={string}
            type="button"
            aria-pressed={chosen === string}
            onClick={() => setChosen(chosen === string ? undefined : string)}
            ref={(element) => {
              if (element) lit.current.set(string, element);
              else lit.current.delete(string);
            }}
            className="grid size-9 place-items-center rounded-full border border-neutral-300 text-xs text-neutral-600 outline-offset-2 focus-visible:outline-2 focus-visible:outline-orange-500 aria-pressed:border-orange-500 data-lit:bg-neutral-800 data-lit:text-white group-data-in-tune:data-lit:bg-green-500 dark:border-neutral-700 dark:text-neutral-300"
          >
            {pitch.format(string)}
          </button>
        ))}
      </div>
    </div>
  );
}
