'use client';

import { formats, readPitch } from '@addstack/daw-ui';
import { useEffect, useRef } from 'react';

const names = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const pitch = formats.pitch({ names });
// The key: C major. Its notes are dark and named on the wheel, and a voice snaps to them.
const key = [0, 2, 4, 5, 7, 9, 11];
const inKey = Array.from({ length: 128 }, (_, note) => note).filter((note) => key.includes(note % 12));

/**
 * A made-up voice for the demo: a tune around D3, gliding from note to note, with vibrato and a little drift.
 * In an app, the frequency your pitch detector hears in the voice, or null.
 */
function singing(now = performance.now() / 1000) {
  const tune = [50, 52, 53, 55, 57, 55, 53, 52];
  const step = Math.floor(now / 0.9);
  const time = (now / 0.9) % 1;
  const from = tune[step % tune.length]!;
  const to = tune[(step + 1) % tune.length]!;
  const glide = Math.min(1, Math.max(0, (time - 0.85) / 0.15));
  const note = from + (to - from) * glide + 0.2 * Math.sin(now * 5.5 * 2 * Math.PI) + 0.12 * Math.sin(now * 0.7);
  return 440 * 2 ** ((note - 69) / 12);
}

export default function PitchWheelDemo() {
  const beam = useRef<HTMLDivElement>(null);
  const note = useRef<HTMLSpanElement>(null);
  const segments = useRef<(HTMLDivElement | null)[]>([]);

  // Once per frame: the segment of the note sung lights up, the beam turns to the pitch itself, between segments
  // when it is off, and the note is written in the middle. Nothing renders.
  useEffect(() => {
    let previous: number | null = null;
    let frame = requestAnimationFrame(function tick() {
      const reading = readPitch(singing(), { targets: inKey, previous });
      if (reading) {
        previous = reading.target;
        segments.current.forEach((segment, pitchClass) => segment?.toggleAttribute('data-lit', pitchClass === reading.target % 12));
        beam.current?.style.setProperty('--pitch-class', String((((reading.note % 12) + 12) % 12).toFixed(3)));
        const text = pitch.format(reading.target);
        if (note.current && note.current.textContent !== text) note.current.textContent = text;
      }
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="relative size-72 overflow-hidden rounded-full bg-neutral-800 select-none">
      {/* Twelve wedges, one per note, C at the top and clockwise, cut into a ring. */}
      {names.map((name, pitchClass) => (
        <div
          key={name}
          ref={(element) => {
            segments.current[pitchClass] = element;
          }}
          aria-hidden
          style={{ rotate: `${pitchClass * 30}deg` }}
          className={`absolute inset-0 [clip-path:polygon(50%_50%,36.8%_0,63.2%_0)] [mask-image:radial-gradient(circle_closest-side,transparent_62%,black_63%)] data-lit:bg-rose-400 ${key.includes(pitchClass) ? 'bg-neutral-950' : 'bg-neutral-700'}`}
        >
          {name.length === 1 && (
            <span style={{ rotate: `${-pitchClass * 30}deg` }} className="absolute top-[6%] left-1/2 -translate-x-1/2 text-sm font-semibold text-white">
              {name}
            </span>
          )}
        </div>
      ))}
      {/* The beam: turned by the pitch, from the middle towards the ring. */}
      <div ref={beam} aria-hidden className="absolute inset-0 [rotate:calc(var(--pitch-class,0)*30deg)]">
        <div className="absolute top-[21%] left-1/2 h-[29%] w-16 -translate-x-1/2 bg-linear-to-t from-rose-400/0 to-rose-400/80 [clip-path:polygon(50%_100%,0_0,100%_0)]" />
      </div>
      <div aria-hidden className="absolute inset-[30%] rounded-full border-8 border-neutral-900/40" />
      <span ref={note} aria-live="polite" className="absolute inset-0 m-auto grid size-16 place-items-center rounded-full bg-black font-mono text-xs text-rose-400" />
    </div>
  );
}
