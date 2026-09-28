// Randomness that comes out the same for the same seed: every choice a generator makes draws from a stream named by
// what it is for (the chords of the chorus, the bass of the verse), so that changing one part's seed, or adding a
// section, leaves the others as they were.

/** A hash of text to 32 bits (FNV-1a). */
export function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

export type Random = {
  /** 0 ≤ x < 1. */
  next(): number;
  /** A whole number from `low` to `high`, both included. */
  int(low: number, high: number): number;
  /** Whether a choice with probability `p` happens. */
  chance(p: number): boolean;
  /** One of `items`. */
  pick<T>(items: readonly T[]): T;
  /** One of `items`, each as likely as its weight. */
  weighted<T>(items: readonly (readonly [T, number])[]): T;
};

/** A stream of numbers from `seed` and a name, by Mulberry32. */
export function random(seed: number, ...names: (string | number)[]): Random {
  let state = (hash(names.join("/")) ^ Math.imul(seed >>> 0, 0x9e3779b1)) >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  const stream: Random = {
    next,
    int: (low, high) => low + Math.floor(next() * (high - low + 1)),
    chance: (p) => next() < p,
    pick: (items) => items[Math.floor(next() * items.length)]!,
    weighted: (items) => {
      const total = items.reduce((sum, [, weight]) => sum + weight, 0);
      let left = next() * total;
      for (const [item, weight] of items) {
        left -= weight;
        if (left < 0) return item;
      }
      return items[items.length - 1]![0];
    },
  };
  return stream;
}

/** A seed to start from: different each time it is asked for. */
export const freshSeed = () => Math.floor(Math.random() * 1_000_000);
