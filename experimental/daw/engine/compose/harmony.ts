import type { Chord, Section, SectionKind, Style } from "./composer.js";
import type { Random } from "./random.js";
import { diatonic, pitchClass, type ChordSymbol, type Key, type Quality } from "./theory.js";

// Chords for a form. Each kind of section gets a loop of four chords, which its sections repeat (so that every
// chorus has the chorus's chords), from a pattern the style is known for or from a Markov chain over the scale's
// degrees; a section that leads into a chorus or a drop ends on the dominant, and the song ends on the tonic.
//
// The chain's weights follow what counts of pop songs report: after V comes I, vi or IV about equally (32%, 29%,
// 25% in Hooktheory's data); after iii nearly always vi or IV (93%); IV most often follows I and comes before it
// (the McGill Billboard corpus). The rest are estimates in the same spirit, not measurements.

/** A degree: a step of the scale (0 is the tonic), a semitone lower (♭VII in major), or with another quality. */
type Degree = { step: number; flat?: boolean; quality?: Quality };

const d = (step: number, extra: Omit<Degree, "step"> = {}): Degree => ({ step, ...extra });
const name = (degree: Degree) => `${degree.flat ? "b" : ""}${degree.step}${degree.quality ?? ""}`;

// Transitions by degree name: "0" is I (or i), "4" is V, "b6" is ♭VII in major, "4maj" is V made major in minor.
const MAJOR: Record<string, [Degree, number][]> = {
  "0": [[d(3), 30], [d(4), 25], [d(5), 25], [d(1), 10], [d(2), 5], [d(6, { flat: true }), 5]],
  "1": [[d(4), 55], [d(0), 15], [d(3), 10], [d(5), 10], [d(2), 10]],
  "2": [[d(5), 55], [d(3), 38], [d(1), 7]],
  "3": [[d(0), 35], [d(4), 30], [d(5), 15], [d(1), 10], [d(2), 5], [d(3, { quality: "min" }), 5]],
  "4": [[d(0), 32], [d(5), 29], [d(3), 25], [d(1), 7], [d(2), 7]],
  "5": [[d(3), 45], [d(4), 20], [d(1), 15], [d(2), 10], [d(0), 10]],
  b6: [[d(0), 50], [d(3), 30], [d(4), 20]],
  "3min": [[d(0), 70], [d(4), 30]],
};

const MINOR: Record<string, [Degree, number][]> = {
  "0": [[d(5), 30], [d(3), 25], [d(6), 20], [d(2), 10], [d(4), 10], [d(4, { quality: "maj" }), 5]],
  "2": [[d(5), 30], [d(6), 30], [d(3), 20], [d(0), 20]],
  "3": [[d(0), 30], [d(6), 25], [d(4, { quality: "maj" }), 20], [d(5), 15], [d(4), 10]],
  "4": [[d(0), 40], [d(5), 35], [d(3), 25]],
  "4maj": [[d(0), 80], [d(5), 20]],
  "5": [[d(6), 40], [d(2), 20], [d(3), 20], [d(0), 10], [d(4), 10]],
  "6": [[d(0), 35], [d(2), 35], [d(5), 20], [d(3), 10]],
};

// Patterns each style is known for, as degrees: I–V–vi–IV and its rotations, i–VI–III–VII, ii–V–I in lo-fi.
const PATTERNS: Record<Style, Record<"major" | "minor", Degree[][]>> = {
  pop: {
    major: [
      [d(0), d(4), d(5), d(3)],
      [d(5), d(3), d(0), d(4)],
      [d(0), d(5), d(3), d(4)],
      [d(3), d(0), d(4), d(5)],
      [d(0), d(3), d(5), d(4)],
    ],
    minor: [
      [d(0), d(5), d(2), d(6)],
      [d(0), d(3), d(6), d(2)],
      [d(5), d(6), d(0), d(0)],
    ],
  },
  edm: {
    major: [
      [d(5), d(3), d(0), d(4)],
      [d(0), d(4), d(5), d(3)],
      [d(3), d(4), d(5), d(0)],
    ],
    minor: [
      [d(0), d(5), d(2), d(6)],
      [d(5), d(6), d(0), d(0)],
      [d(0), d(6), d(5), d(6)],
      [d(5), d(3), d(0), d(6)],
    ],
  },
  lofi: {
    major: [
      [d(1), d(4), d(0), d(5)],
      [d(3), d(2), d(5), d(1)],
      [d(0), d(5), d(1), d(4)],
    ],
    minor: [
      [d(0), d(3), d(6), d(2)],
      [d(3), d(4), d(0), d(0)],
      [d(0), d(5), d(3), d(4, { quality: "maj" })],
    ],
  },
};

/** Where a kind of section's loop likes to start. */
const STARTS: Record<SectionKind, number[]> = {
  intro: [0, 5],
  verse: [0, 5],
  pre: [1, 3],
  chorus: [3, 0, 5],
  bridge: [5, 3, 1],
  build: [3, 5],
  drop: [0, 5],
  breakdown: [5, 3],
  outro: [0, 3],
};

/** Which kinds share a loop: an intro plays the verse's (or the drop's), an outro the chorus's. */
const SHARES: Partial<Record<SectionKind, SectionKind>> = { intro: "verse", outro: "chorus", breakdown: "drop" };

function chain(key: Key) {
  return key.mode === "major" ? MAJOR : MINOR;
}

function weight(key: Key, from: Degree, to: Degree): number {
  const options = chain(key)[name(from)] ?? chain(key)[String(from.step)] ?? [];
  const found = options.find(([degree]) => name(degree) === name(to));
  return found ? found[1] / 100 : 0.01;
}

/** A loop of four degrees for a kind of section: a known pattern, or the likeliest of a few walks of the chain. */
function loop(key: Key, style: Style, kind: SectionKind, random: Random): Degree[] {
  if (random.chance(style === "pop" ? 0.45 : 0.55)) return random.pick(PATTERNS[style][key.mode]);
  let best: Degree[] = [];
  let bestScore = -1;
  for (let attempt = 0; attempt < 12; attempt++) {
    const start = random.pick(STARTS[kind]);
    const degrees = [d(start)];
    while (degrees.length < 4) {
      const options = chain(key)[name(degrees[degrees.length - 1]!)] ?? chain(key)["0"]!;
      degrees.push(random.weighted(options));
    }
    // A loop comes round: its last chord should lead back to its first. The same chord twice is dull.
    let score = weight(key, degrees[3]!, degrees[0]!);
    for (let i = 1; i < 4; i++) score *= name(degrees[i]!) === name(degrees[i - 1]!) ? 0.05 : weight(key, degrees[i - 1]!, degrees[i]!) + 0.2;
    // A little of the chain's randomness in which walk wins, so that seeds differ.
    score *= 0.75 + random.next() * 0.5;
    if (score > bestScore) [best, bestScore] = [degrees, score];
  }
  return best;
}

/** The chord of a degree in `key`, in the style's colours: sevenths in lo-fi, now and then a sus or add9 in pop. */
function chordOf(key: Key, degree: Degree, style: Style, random: Random): ChordSymbol {
  const root = pitchClass(diatonic(key, degree.step).root - (degree.flat ? 1 : 0));
  if (degree.quality) {
    const quality: Quality = style === "lofi" ? (degree.quality === "maj" ? "7" : "m7") : degree.quality;
    return { root, quality };
  }
  if (degree.flat) return { root, quality: style === "lofi" ? "maj7" : "maj" };
  const chord = diatonic(key, degree.step, style === "lofi");
  if (style === "lofi" && (chord.quality === "m7" || chord.quality === "maj7") && random.chance(0.25)) return { root, quality: chord.quality === "m7" ? "m9" : "maj7" };
  if (style === "pop" && chord.quality === "maj" && random.chance(0.12)) return { root, quality: random.pick(["sus2", "sus4", "add9"] as const) };
  return chord;
}

/** The dominant of `key`: V, made major in minor too, as a cadence wants. */
const dominant = (key: Key, style: Style): ChordSymbol => ({ root: pitchClass(key.tonic + 7), quality: style === "lofi" ? "7" : "maj" });
const tonic = (key: Key, style: Style): ChordSymbol => diatonic(key, 0, style === "lofi");

let count = 0;

/** Chords for `sections`, a bar each (two in quiet EDM sections), with cadences where sections turn. */
export function harmonize(sections: readonly Section[], key: Key, style: Style, seed: (name: string) => Random): Chord[] {
  const loops = new Map<SectionKind, ChordSymbol[]>();
  const loopFor = (kind: SectionKind) => {
    const shared = SHARES[kind] && sections.some((section) => section.kind === SHARES[kind]) ? SHARES[kind]! : kind;
    let chords = loops.get(shared);
    if (!chords) {
      // Each kind its own loop: a bridge that plays the verse's chords is no bridge.
      const taken = new Set([...loops.values()].map((one) => one.map((chord) => chord.root).join()));
      for (let attempt = 0; attempt < 6 && (!chords || taken.has(chords.map((chord) => chord.root).join())); attempt++) {
        const random = seed(`chords/${shared}/${attempt}`);
        chords = loop(key, style, shared, random).map((degree) => chordOf(key, degree, style, random));
      }
      loops.set(shared, chords!);
    }
    return chords!;
  };

  const chords: Chord[] = [];
  sections.forEach((section, index) => {
    const next = sections[index + 1];
    const pattern = loopFor(section.kind);
    // Quiet EDM sections move twice as slowly.
    const length = style === "edm" && section.energy < 0.5 ? 8 : 4;
    const count_ = Math.max(1, Math.round(section.duration / length));
    for (let i = 0; i < count_; i++) {
      let symbol = pattern[i % pattern.length]!;
      const last = i === count_ - 1;
      if (last && next && (next.kind === "chorus" || next.kind === "drop") && section.kind !== next.kind) symbol = dominant(key, style);
      if (last && !next) symbol = tonic(key, style);
      chords.push({ id: `chord-${++count}`, at: section.at + i * length, duration: Math.min(length, section.duration - i * length), ...symbol });
    }
  });
  return chords;
}
