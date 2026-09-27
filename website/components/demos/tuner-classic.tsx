'use client';

import { formats, readPitch } from '@addstack/daw-ui';
import { useEffect, useRef } from 'react';

const pitch = formats.pitch({ names: ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'] });
const hertz = formats.number({ digits: 2, unit: 'Hz' });
const midi = formats.number({ digits: 0 });
const signed = new Intl.NumberFormat(undefined, { signDisplay: 'exceptZero', maximumFractionDigits: 0 });

/**
 * Made-up playing for the demo: the strings of a guitar in turn, each starting out of tune and tuned in, with a
 * little vibrato and a pause between them. In an app, the frequency your pitch detector hears, or null.
 */
function playing(now = performance.now() / 1000) {
  const string = [40, 45, 50, 55, 59, 64][Math.floor(now / 4) % 6]!;
  const time = now % 4;
  if (time > 3.4) return null;
  const cents = (((Math.floor(now / 4) * 37) % 80) - 40) * Math.exp(-time * 1.4) + 1.5 * Math.sin(now * 9);
  return 440 * 2 ** ((string + cents / 100 - 69) / 12);
}

export default function ClassicTunerDemo() {
  const root = useRef<HTMLDivElement>(null);
  const needle = useRef<HTMLDivElement>(null);
  const texts = { hertz: useRef<HTMLSpanElement>(null), midi: useRef<HTMLSpanElement>(null), note: useRef<HTMLSpanElement>(null), cents: useRef<HTMLSpanElement>(null) };

  // Once per frame, the reading goes straight to the DOM: attributes, a variable on the needle, and text. Nothing renders.
  useEffect(() => {
    const write = (element: HTMLElement | null, text: string) => {
      if (element && element.textContent !== text) element.textContent = text;
    };
    let previous: number | null = null;
    let frame = requestAnimationFrame(function tick() {
      const frequency = playing();
      const reading = readPitch(frequency, { previous });
      root.current?.toggleAttribute('data-active', reading !== null);
      if (reading && frequency) {
        previous = reading.target;
        root.current?.toggleAttribute('data-in-tune', Math.abs(reading.cents) <= 3);
        needle.current?.style.setProperty('--offset', String(Math.max(-1, Math.min(1, reading.cents / 50))));
        write(texts.hertz.current, hertz.format(frequency));
        write(texts.midi.current, midi.format(reading.target));
        write(texts.note.current, pitch.format(reading.target));
        write(texts.cents.current, signed.format(Math.round(reading.cents) || 0));
      }
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div ref={root} className="group w-full max-w-md rounded-md bg-neutral-900 p-3 font-mono text-neutral-300 select-none">
      <div className="relative h-16 rounded-sm bg-neutral-100 text-neutral-900">
        {[-50, -25, 0, 25, 50].map((cents) => (
          <div key={cents} style={{ left: `${50 + cents}%` }} className="absolute bottom-0 h-3 w-px bg-neutral-900">
            {Math.abs(cents) !== 50 && <span className="absolute -top-6 -translate-x-1/2 text-sm font-bold">{cents > 0 ? `+${cents}` : cents}</span>}
          </div>
        ))}
        <div ref={needle} aria-hidden className="absolute inset-y-1 left-[calc(50%+var(--offset,0)*50%)] w-0.5 bg-red-600 opacity-0 group-data-active:opacity-100" />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <div className="flex flex-col items-end rounded-sm border border-neutral-700 px-2 py-1 text-xs text-rose-300 tabular-nums">
          <span ref={texts.hertz} />
          <span ref={texts.midi} />
        </div>
        {/* The note is a polite live region: a screen reader says it when it changes. */}
        <span ref={texts.note} aria-live="polite" className="flex-1 rounded-sm border border-neutral-700 py-1 text-center text-2xl text-white" />
        <span className="rounded-sm border border-neutral-700 px-2 py-1 text-rose-300 tabular-nums">
          <span ref={texts.cents} /> <span className="text-xs text-neutral-500">cents</span>
        </span>
        <span className="size-2.5 rounded-full bg-neutral-700 group-data-in-tune:bg-green-500" />
      </div>
    </div>
  );
}
