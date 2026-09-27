'use client';

import { formats } from '@addstack/daw-ui';
import { Keys } from '@addstack/daw-ui/react';
import { useRef } from 'react';

const pitch = formats.pitch({ names: ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'] });
// C3 to C5.
const range = [48, 72] as const;
const notes = Array.from({ length: range[1] - range[0] + 1 }, (_, index) => range[0] + index);

/** A small synth for the demo: a triangle wave per key, as loud as the key was pressed. In an app, your audio engine. */
function useSynth() {
  const audio = useRef<AudioContext | null>(null);
  const voices = useRef(new Map<number, { oscillator: OscillatorNode; gain: GainNode }>());
  return {
    play(note: number, velocity: number) {
      const context = (audio.current ??= new AudioContext());
      const oscillator = new OscillatorNode(context, { type: 'triangle', frequency: 440 * 2 ** ((note - 69) / 12) });
      const gain = new GainNode(context, { gain: 0 });
      gain.gain.setTargetAtTime(0.25 * velocity, context.currentTime, 0.005);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      voices.current.set(note, { oscillator, gain });
    },
    stop(note: number) {
      const voice = voices.current.get(note);
      if (!voice || !audio.current) return;
      voices.current.delete(note);
      voice.gain.gain.setTargetAtTime(0, audio.current.currentTime, 0.1);
      voice.oscillator.stop(audio.current.currentTime + 1);
    },
  };
}

export default function KeysDemo() {
  const synth = useSynth();
  return (
    <Keys.Root
      range={range}
      format={pitch}
      onPress={(note, { velocity }) => synth.play(note, velocity)}
      onRelease={(note) => synth.stop(note)}
      aria-label="Keyboard"
      className="h-36 w-full max-w-xl"
    >
      {notes.map((note) => (
        <Keys.Key
          key={note}
          note={note}
          className="flex items-end justify-center rounded-b-md border border-neutral-300 bg-white pb-1.5 text-[10px] text-neutral-400 outline-offset-[-3px] focus-visible:outline-2 focus-visible:outline-orange-500 data-black:h-3/5 data-black:border-neutral-950 data-black:bg-neutral-900 data-pressed:bg-orange-200 data-black:data-pressed:bg-orange-500 dark:border-neutral-700 dark:bg-neutral-200 dark:data-pressed:bg-orange-300"
        >
          {/* A label on each C, from the same format that names the keys. */}
          {note % 12 === 0 && pitch.format(note)}
        </Keys.Key>
      ))}
    </Keys.Root>
  );
}
