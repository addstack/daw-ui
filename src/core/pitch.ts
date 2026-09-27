/** What a frequency is as a note: see `readPitch`. */
export type PitchReading = {
  /** The note heard, as a MIDI note number with a fraction: 69.23 is 23 cents above A4. */
  note: number;
  /** The note it is tuned to: the nearest note, the nearest of `targets`, or `target`. */
  target: number;
  /** How far the note heard is from the target, in cents: negative when flat. */
  cents: number;
};

export type ReadPitchOptions = {
  /**
   * The frequency of A4, in hertz.
   * @default 440
   */
  reference?: number | undefined;
  /**
   * The notes a pitch is tuned to, as MIDI note numbers: the strings of an
   * instrument, or the notes of a key.
   * @default every note
   */
  targets?: readonly number[] | undefined;
  /** The one note a pitch is tuned to, whatever it is nearest. */
  target?: number | undefined;
  /** The target of the previous reading, for `hysteresis`. */
  previous?: number | null | undefined;
  /**
   * Cents a pitch has to be nearer another note before the reading moves
   * from `previous` to it, so that a pitch between two notes does not
   * flicker between them.
   * @default 10
   */
  hysteresis?: number | undefined;
};

/**
 * Reads a frequency, in hertz, as a tuner does: the note it is, the note it
 * is tuned to, and how many cents it is off. `null` for silence: a
 * frequency that is not a positive number. Pass the last reading's target as
 * `previous`, so that the note shown stays steady between two notes.
 *
 * ```ts
 * readPitch(446) // { note: 69.23, target: 69, cents: 23.4 }: A4, 23 cents sharp
 * readPitch(83, { targets: [40, 45, 50, 55, 59, 64] }) // tuned to E2, the nearest string
 * ```
 */
export function readPitch(frequency: number | null | undefined, options: ReadPitchOptions = {}): PitchReading | null {
  if (typeof frequency !== "number" || !(frequency > 0) || !Number.isFinite(frequency)) return null;
  const { reference = 440, targets, target, previous = null, hysteresis = 10 } = options;
  const note = 69 + 12 * Math.log2(frequency / reference);
  const tuned = target ?? nearest(note, previous, targets, hysteresis);
  return { note, target: tuned, cents: (note - tuned) * 100 };
}

/** The nearest target, which takes over from `previous` only once it is nearer by the hysteresis. */
function nearest(note: number, previous: number | null, targets: readonly number[] | undefined, hysteresis: number): number {
  const candidates = targets && targets.length > 0 ? targets : null;
  const closest = candidates
    ? candidates.reduce((best, one) => (Math.abs(one - note) < Math.abs(best - note) ? one : best))
    : Math.round(note);
  if (previous === null || closest === previous) return closest;
  if (candidates && !candidates.includes(previous)) return closest;
  return Math.abs(note - closest) + hysteresis / 100 < Math.abs(note - previous) ? closest : previous;
}
