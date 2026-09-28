// The music theory the generators need: keys and their scales, chords and their notes, names and Roman numerals,
// and voicings that move as little as they can from one chord to the next.

export type Mode = "major" | "minor";

/** A key: its tonic as a pitch class (0 is C) and its mode. */
export type Key = { tonic: number; mode: Mode };

export type Quality = "maj" | "min" | "dim" | "sus2" | "sus4" | "7" | "maj7" | "m7" | "m7b5" | "add9" | "m9";

/** A chord: its root as a pitch class, and its quality. */
export type ChordSymbol = { root: number; quality: Quality };

export const SCALES: Record<Mode, readonly number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  // Natural minor; the dominant is raised to a major chord where a cadence asks for it.
  minor: [0, 2, 3, 5, 7, 8, 10],
};

export const INTERVALS: Record<Quality, readonly number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  "7": [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  m7b5: [0, 3, 6, 10],
  add9: [0, 4, 7, 14],
  m9: [0, 3, 7, 10, 14],
};

const SUFFIX: Record<Quality, string> = { maj: "", min: "m", dim: "dim", sus2: "sus2", sus4: "sus4", "7": "7", maj7: "maj7", m7: "m7", m7b5: "m7♭5", add9: "add9", m9: "m9" };

const SHARPS = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const FLATS = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];

/** Keys written with flats: F, B♭, E♭, A♭, D♭ and G♭ major, and their relative minors. */
const flatKey = (key: Key) => (key.mode === "major" ? [5, 10, 3, 8, 1, 6] : [2, 7, 0, 5, 10, 3]).includes(key.tonic);

export const pitchClass = (pitch: number) => ((pitch % 12) + 12) % 12;

/** A pitch class's name, spelt as `key` writes it. */
export const noteName = (pc: number, key: Key) => (flatKey(key) ? FLATS : SHARPS)[pitchClass(pc)]!;

export const keyName = (key: Key) => `${noteName(key.tonic, key)} ${key.mode}`;

/** "Am7", "F", "G♯dim". */
export const chordName = (chord: ChordSymbol, key: Key) => noteName(chord.root, key) + SUFFIX[chord.quality];

/** The chord's pitch classes, from its root. */
export const chordTones = (chord: ChordSymbol) => INTERVALS[chord.quality].map((interval) => pitchClass(chord.root + interval));

/** The pitch class of scale degree `step` (0 is the tonic; beyond 6 it wraps). */
export const degreePc = (key: Key, step: number) => pitchClass(key.tonic + SCALES[key.mode][((step % 7) + 7) % 7]!);

/** The triad or seventh chord on scale degree `step` of `key`, as the scale builds it. */
export function diatonic(key: Key, step: number, sevenths = false): ChordSymbol {
  const root = degreePc(key, step);
  const third = pitchClass(degreePc(key, step + 2) - root);
  const fifth = pitchClass(degreePc(key, step + 4) - root);
  const seventh = pitchClass(degreePc(key, step + 6) - root);
  if (fifth === 6) return { root, quality: sevenths ? "m7b5" : "dim" };
  if (third === 3) return { root, quality: sevenths ? "m7" : "min" };
  return { root, quality: sevenths ? (seventh === 10 ? "7" : "maj7") : "maj" };
}

const NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII"];
const minorish = (quality: Quality) => quality === "min" || quality === "m7" || quality === "dim" || quality === "m7b5" || quality === "m9";

/** "vi7", "IVmaj7", "V", "♭VII", "ii°": the chord's degree in `key`, and its quality. */
export function romanNumeral(chord: ChordSymbol, key: Key): string {
  const scale = SCALES[key.mode];
  const interval = pitchClass(chord.root - key.tonic);
  let step = scale.indexOf(interval);
  let accidental = "";
  if (step < 0) {
    // Out of the scale: a degree lowered or raised by a semitone, as a borrowed chord is.
    step = scale.indexOf(pitchClass(interval + 1));
    accidental = "♭";
    if (step < 0) {
      step = scale.indexOf(pitchClass(interval - 1));
      accidental = "♯";
    }
  }
  const numeral = NUMERALS[Math.max(0, step)]!;
  const base = minorish(chord.quality) ? numeral.toLowerCase() : numeral;
  const suffix: Record<Quality, string> = { maj: "", min: "", dim: "°", sus2: "sus2", sus4: "sus4", "7": "7", maj7: "maj7", m7: "7", m7b5: "ø7", add9: "add9", m9: "9" };
  return accidental + base + suffix[chord.quality];
}

/**
 * The notes of `chord` between `low` and `high` that move least from `previous`: each inversion and octave is
 * tried, and the one whose notes are nearest the previous voicing's (or, first, nearest `center`) wins.
 */
export function voice(chord: ChordSymbol, previous: readonly number[] | null, low: number, high: number, center = (low + high) / 2): number[] {
  const tones = chordTones(chord);
  const candidates: number[][] = [];
  for (let inversion = 0; inversion < tones.length; inversion++) {
    const order = [...tones.slice(inversion), ...tones.slice(0, inversion)];
    for (let octave = Math.floor(low / 12) - 1; octave <= Math.ceil(high / 12); octave++) {
      const notes: number[] = [];
      let last = -Infinity;
      for (const pc of order) {
        let pitch = octave * 12 + pc;
        while (pitch <= last) pitch += 12;
        notes.push(pitch);
        last = pitch;
      }
      if (notes[0]! >= low && notes[notes.length - 1]! <= high) candidates.push(notes);
    }
  }
  if (candidates.length === 0) return tones.map((pc) => low + pitchClass(pc - low));
  const cost = (notes: number[]) => {
    if (!previous || previous.length === 0) return Math.abs(notes.reduce((sum, note) => sum + note, 0) / notes.length - center);
    // Each note to the nearest note of the previous chord: the distance voices move.
    return notes.reduce((sum, note) => sum + Math.min(...previous.map((one) => Math.abs(one - note))), 0);
  };
  return candidates.reduce((best, notes) => (cost(notes) < cost(best) ? notes : best));
}

/** The pitch of pitch class `pc` nearest to `near`. */
export const nearest = (pc: number, near: number) => {
  const below = near - pitchClass(near - pc);
  return near - below <= 6 ? below : below + 12;
};

/** The notes of `key`'s scale between `low` and `high`, rising. */
export const scaleNotes = (key: Key, low: number, high: number) => {
  const scale = SCALES[key.mode].map((interval) => pitchClass(key.tonic + interval));
  const notes: number[] = [];
  for (let pitch = low; pitch <= high; pitch++) if (scale.includes(pitchClass(pitch))) notes.push(pitch);
  return notes;
};
