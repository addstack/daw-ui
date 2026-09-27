// What a tuner shows of a frequency: the note it is nearest, or the target it is tuned to, and how far off it is.
// Not part of the public API: `Tuner` reads with it.

/** The note of a frequency as a MIDI note number with a fraction: A4 at `reference` hertz is 69. */
export function noteOf(frequency: number, reference: number): number {
  return 69 + 12 * Math.log2(frequency / reference);
}

/**
 * The note a tuner shows for `note`: the nearest whole note, or the nearest
 * of `targets`, such as the strings of a guitar or the notes of a key. It
 * stays on `current` until the pitch is `hysteresis` cents nearer another,
 * so that a pitch between two notes does not flicker between them.
 */
export function targetOf(note: number, current: number | null, targets: readonly number[] | undefined, hysteresis: number): number {
  const candidates = targets && targets.length > 0 ? targets : null;
  const nearest = candidates
    ? candidates.reduce((best, one) => (Math.abs(one - note) < Math.abs(best - note) ? one : best))
    : Math.round(note);
  if (current === null || nearest === current) return nearest;
  if (candidates && !candidates.includes(current)) return nearest;
  return Math.abs(note - nearest) + hysteresis / 100 < Math.abs(note - current) ? nearest : current;
}
