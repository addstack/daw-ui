import { useEffect, useMemo, useRef, useState } from "react";

import { formats } from "../../../src/core/index.js";
import { Keys } from "../../../src/react/index.js";

// Keys to play a synth: with the mouse, and with the computer's keys, as musical typing.

export const pitch = formats.pitch({ names: ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"] });

// Musical typing: the middle row of a QWERTY keyboard plays white keys, the row above black ones; Z and X shift octaves.
const TYPING: Record<string, number> = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15, ";": 16 };

/** Whether a key press is for playing: not with a modifier, and not in a control that takes keys itself. */
export function isTyping(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement;
  return !(event.metaKey || event.ctrlKey || event.altKey || target.closest("input, select, textarea, [role=slider], [role=spinbutton]"));
}

/**
 * Calls `play` and `stop` as keys of the computer's keyboard are pressed and released, from the octave it keeps
 * (Z and X move it), while `enabled`. Returns the octave.
 */
export function useMusicalTyping(play: (note: number, velocity: number) => void, stop: (note: number) => void, enabled = true): number {
  const [octave, setOctave] = useState(4);
  const octaveRef = useRef(octave);
  octaveRef.current = octave;
  useEffect(() => {
    if (!enabled) return;
    const down = new Map<string, number>();
    const onDown = (event: KeyboardEvent) => {
      if (!isTyping(event) || event.repeat) return;
      const key = event.key.toLowerCase();
      if (key === "z" || key === "x") {
        setOctave((current) => Math.min(7, Math.max(1, current + (key === "x" ? 1 : -1))));
        return;
      }
      const offset = TYPING[key];
      if (offset === undefined || down.has(key)) return;
      const note = (octaveRef.current + 1) * 12 + offset;
      down.set(key, note);
      play(note, 0.8);
    };
    const onUp = (event: KeyboardEvent) => {
      const note = down.get(event.key.toLowerCase());
      if (note === undefined) return;
      down.delete(event.key.toLowerCase());
      stop(note);
    };
    const release = () => {
      for (const note of down.values()) stop(note);
      down.clear();
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", release);
    return () => {
      release();
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", release);
    };
  }, [play, stop, enabled]);
  return octave;
}

/** Keys from C2 to C6 to play with the mouse; `read` returns the notes that sound, to light their keys. */
export function Keyboard({
  play,
  stop,
  read,
  octave,
}: {
  play: (note: number, velocity: number) => void;
  stop: (note: number) => void;
  read: () => readonly number[];
  /** The octave musical typing plays, to say so. */
  octave?: number | undefined;
}) {
  const range = [36, 84] as const;
  const notes = useMemo(() => Array.from({ length: range[1] - range[0] + 1 }, (_, index) => range[0] + index), [range[0], range[1]]);
  return (
    <section className="keyboard" aria-label="Keyboard">
      {octave !== undefined && (
        <p className="hint">
          Play with the mouse, a MIDI keyboard, or your computer's keys: A W S E D F T G Y H U J K, Z and X for octaves
          (now {pitch.format((octave + 1) * 12)}).
        </p>
      )}
      <Keys.Root range={range} format={pitch} onPress={(note, { velocity }) => play(note, velocity)} onRelease={stop} read={read} aria-label="Keys" className="keys">
        {notes.map((note) => (
          <Keys.Key key={note} note={note} className="key">
            {note % 12 === 0 && <span className="key-label">{pitch.format(note)}</span>}
          </Keys.Key>
        ))}
      </Keys.Root>
    </section>
  );
}
