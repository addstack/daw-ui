import type { Chord, Part, PartNote, PartRequest, Section } from "./composer.js";
import type { Random } from "./random.js";
import { chordTones, degreePc, nearest, scaleNotes, voice, type Key } from "./theory.js";

// The notes of a part, for each section, from the section's chords and energy. Every section of a kind plays the
// same notes (a chorus is the chorus), drawn from a stream named by the part and the kind; what a section does at
// its end (a fill, an approach note) depends on what comes next.

const KICK = 36;
const RIM = 37;
const SNARE = 38;
const CLAP = 39;
const CLOSED_HAT = 42;
const TOM = 45;
const OPEN_HAT = 46;
const CRASH = 49;

type Context = {
  section: Section;
  next: Section | undefined;
  /** The chords the section plays over, in beats from its start. */
  chords: { at: number; duration: number; chord: Chord }[];
  key: Key;
  random: Random;
  request: PartRequest;
};

/** The chords over a section, in beats from its start, cut at its edges. */
function chordsOver(section: Section, chords: readonly Chord[]) {
  const end = section.at + section.duration;
  return chords
    .filter((chord) => chord.at < end && chord.at + chord.duration > section.at)
    .map((chord) => {
      const at = Math.max(chord.at, section.at);
      return { at: at - section.at, duration: Math.min(chord.at + chord.duration, end) - at, chord };
    });
}

/** The chord sounding at beat `at` of the section. */
const chordAt = (context: Context, at: number) =>
  (context.chords.find((one) => one.at <= at && at < one.at + one.duration) ?? context.chords[context.chords.length - 1])?.chord;

const clampVelocity = (value: number) => Math.max(1, Math.min(127, Math.round(value)));

/** A velocity around `base`, louder with energy, a little different each time. */
const velocity = (context: Context, base: number, accent = 0) => clampVelocity(base * (0.75 + 0.35 * context.section.energy) + accent + (context.random.next() - 0.5) * 10);

/** Onsets of a Euclidean rhythm (Toussaint): `hits` spread as evenly as they go over `steps`, turned by `rotate`. */
export function euclid(hits: number, steps: number, rotate = 0): number[] {
  const onsets: number[] = [];
  for (let step = 0; step < steps; step++) if (Math.floor(((step + rotate) * hits) / steps) !== Math.floor(((step + rotate - 1) * hits) / steps)) onsets.push(step);
  return onsets;
}

// --- drums ---

function drums(context: Context): PartNote[] {
  const { section, next, random, request } = context;
  const notes: PartNote[] = [];
  const bars = section.duration / 4;
  const energy = section.energy;
  const hit = (at: number, pitch: number, base: number, accent = 0) => notes.push({ at, duration: 0.25, pitch, velocity: velocity(context, base, accent) });
  // A percussion layer of rim shots for busy sections, as an even rhythm.
  const perc = euclid(random.pick([3, 5, 7]), 16, random.int(0, 3));
  const swing = request.style === "lofi" ? 0.08 : 0;

  for (let bar = 0; bar < bars; bar++) {
    const t = bar * 4;
    const lastBar = bar === bars - 1;
    const fill = lastBar && next && energy >= 0.45 && next.kind !== section.kind;
    for (let step = 0; step < 16; step++) {
      const at = t + step / 4 + (step % 4 === 2 ? swing : 0);
      const quarter = step % 4 === 0;
      if (request.style === "edm") {
        if (section.kind === "build") {
          // A roll that speeds up: quarters, then eighths, then sixteenths, louder towards the drop.
          const rate = bar < bars / 2 ? 4 : bar < bars - 2 ? 2 : 1;
          if (step % rate === 0) hit(at, SNARE, 55 + (40 * bar) / bars);
          if (quarter && bar < bars - 1) hit(at, KICK, 100);
          continue;
        }
        if (quarter && energy >= 0.4 && section.kind !== "breakdown") hit(at, KICK, 115, step === 0 ? 6 : 0);
        if ((step === 4 || step === 12) && energy >= 0.5) hit(at, CLAP, 105);
        if (step % 4 === 2) hit(at, energy >= 0.95 ? OPEN_HAT : CLOSED_HAT, energy >= 0.95 ? 80 : 90);
        else if (step % 2 === 1 && energy >= 0.85) hit(at, CLOSED_HAT, 45);
        if (energy >= 0.95 && perc.includes(step)) hit(at, RIM, 55);
      } else if (request.style === "pop") {
        if (step === 0 || step === 8 || (step === 10 && energy >= 0.6) || (step === 6 && energy >= 0.85 && bar % 2 === 1)) hit(at, KICK, 110, step === 0 ? 6 : 0);
        if ((step === 4 || step === 12) && energy >= 0.45) hit(at, SNARE, 105);
        if (step % 2 === 0) hit(at, energy >= 0.85 && step === 14 && bar % 2 === 1 ? OPEN_HAT : CLOSED_HAT, quarter ? 85 : 65);
        if (energy >= 0.85 && perc.includes(step)) hit(at, RIM, 45);
      } else {
        // Lo-fi: a lazy boom-bap, the snare a little behind, the hats swung.
        if (step === 0 || step === 7 || (step === 10 && energy >= 0.5)) hit(at, KICK, 100);
        if ((step === 4 || step === 12) && energy >= 0.45) hit(at + 0.03, SNARE, 90);
        if (step % 2 === 0) hit(at, CLOSED_HAT, step % 4 === 0 ? 70 : 50);
        if (energy >= 0.8 && perc.includes(step)) hit(at, RIM, 40);
      }
    }
    if (fill) {
      // The last beat of the section: sixteenths down the toms and the snare, in place of what was there.
      const kept = notes.filter((note) => note.at < t + 3 || note.pitch === KICK);
      notes.splice(0, notes.length, ...kept);
      for (let step = 12; step < 16; step++) hit(t + step / 4, step < 14 ? TOM : SNARE, 80 + step * 2);
    }
  }
  if (energy >= 0.8 && section.kind !== "build") hit(0, CRASH, 100);
  return notes.sort((a, b) => a.at - b.at);
}

// --- bass ---

function bass(context: Context): PartNote[] {
  const { section, next, key, random, request } = context;
  const notes: PartNote[] = [];
  const energy = section.energy;
  const low = 28;
  const high = 45;
  const rootOf = (chord: Chord | undefined) => (chord ? nearest(chord.root, 35) : nearest(key.tonic, 35));
  const inRange = (pitch: number) => (pitch < low ? pitch + 12 : pitch > high ? pitch - 12 : pitch);
  const add = (at: number, duration: number, pitch: number, base: number) => {
    if (at < section.duration) notes.push({ at, duration: Math.min(duration, section.duration - at), pitch: inRange(pitch), velocity: velocity(context, base) });
  };
  // A rhythm for the section's kind: the same for every section of it.
  const walk = random.chance(0.5);

  for (const { at, duration, chord } of context.chords) {
    const root = rootOf(chord);
    const fifth = root + 7;
    const following = chordAt(context, at + duration) ?? (next ? undefined : chord);
    const bars = Math.max(1, Math.round(duration / 4));
    for (let bar = 0; bar < bars; bar++) {
      const t = at + bar * 4;
      const lastOfChord = bar === bars - 1;
      if (request.style === "edm") {
        if (energy < 0.5) add(t, 4, root, 90);
        else if (section.kind === "build") for (let e = 0; e < 8; e++) add(t + e / 2, 0.45, root, 85 + e * 2);
        else for (let e = 0; e < 4; e++) add(t + e + 0.5, 0.45, e === 3 && random.chance(0.35) ? root + 12 : root, e === 0 ? 110 : 95);
      } else if (request.style === "pop") {
        if (energy < 0.5) add(t, 3.5, root, 90);
        else if (energy < 0.8) {
          add(t, 1.5, root, 100);
          add(t + 1.5, 0.5, root, 80);
          add(t + 2, 1.5, walk ? fifth : root, 90);
        } else for (let e = 0; e < 8; e++) add(t + e / 2, 0.45, e === 7 ? root + 12 : root, e % 2 === 0 ? 105 : 85);
      } else {
        add(t, 1.75, root, 90);
        add(t + 2, 1.25, walk ? fifth : root + (key.mode === "major" ? 4 : 3), 80);
      }
      // Into the next chord by a step from below, where there is room: an approach note.
      if (lastOfChord && following && following.root !== chord.root && energy >= 0.5 && request.style !== "edm") {
        const target = rootOf(following);
        const approach = random.chance(0.5) ? target - 1 : target - (target - root > 0 ? 2 : -2);
        notes.splice(0, notes.length, ...notes.filter((note) => note.at < t + 3.5));
        add(t + 3.5, 0.45, approach, 85);
      }
    }
  }
  return notes;
}

// --- chords ---

function pad(context: Context): PartNote[] {
  const { section, request } = context;
  const notes: PartNote[] = [];
  let previous: number[] | null = null;
  const [low, high] = request.style === "lofi" ? [50, 72] : [52, 74];
  const pushed = section.energy >= 0.85 && request.style === "pop";
  for (const { at, duration, chord } of context.chords) {
    const voicing = voice(chord, previous, low, high);
    previous = voicing;
    const bars = Math.max(1, Math.round(duration / 4));
    for (let bar = 0; bar < bars; bar++) {
      const t = at + bar * 4;
      const length = Math.min(4, duration - bar * 4);
      const strikes = pushed ? [[0, 2.5], [2.5, length - 2.5]] : [[0, length]];
      for (const [offset, span] of strikes) {
        voicing.forEach((pitch, index) => {
          // Lo-fi rolls its chords upwards, as fingers do.
          const roll = request.style === "lofi" ? index * 0.03 : 0;
          notes.push({ at: t + offset! + roll, duration: Math.max(0.1, span! - roll - 0.02), pitch, velocity: velocity(context, 80, index === 0 ? 4 : 0) });
        });
      }
    }
  }
  return notes;
}

// --- arpeggio ---

function arp(context: Context): PartNote[] {
  const { section, random, request } = context;
  if (section.energy < 0.3) return [];
  const notes: PartNote[] = [];
  const step = section.energy >= 0.85 && request.style !== "lofi" ? 0.25 : 0.5;
  const shape = random.pick(["up", "updown", "skip"] as const);
  let previous: number[] | null = null;
  for (const { at, duration, chord } of context.chords) {
    const voicing = voice(chord, previous, 60, 76);
    previous = voicing;
    const pool = [...voicing, voicing[0]! + 12];
    const order = shape === "up" ? pool : shape === "updown" ? [...pool, ...pool.slice(1, -1).reverse()] : [pool[0]!, pool[2]!, pool[1]!, pool[3]!];
    for (let t = 0, index = 0; t < duration - 1e-9; t += step, index++) {
      const swing = request.style === "lofi" && index % 2 === 1 ? 0.08 : 0;
      notes.push({ at: at + t + swing, duration: step * 0.85, pitch: order[index % order.length]!, velocity: velocity(context, 80, (t % 1 === 0 ? 12 : 0)) });
    }
  }
  return notes;
}

// --- melody ---

/** Rhythms of one bar, as [beat, beats] pairs: busier with energy. The last is for the end of a phrase. */
const CELLS: [number, number][][] = [
  [[0, 1], [1, 1], [2, 1], [3, 1]],
  [[0, 0.5], [0.5, 0.5], [1, 1], [2, 1.5], [3.5, 0.5]],
  [[0, 1.5], [1.5, 0.5], [2, 1], [3, 1]],
  [[0.5, 0.5], [1, 0.5], [1.5, 1], [2.5, 0.5], [3, 1]],
  [[0, 0.75], [0.75, 0.75], [1.5, 0.5], [2, 2]],
  [[0, 0.5], [0.5, 0.5], [1, 0.5], [1.5, 0.5], [2, 1], [3, 0.5], [3.5, 0.5]],
];
const ENDING: [number, number][][] = [
  [[0, 1], [1, 3]],
  [[0, 0.5], [0.5, 0.5], [1, 3]],
  [[0, 1.5], [1.5, 2.5]],
];

function melody(context: Context): PartNote[] {
  const { section, key, random } = context;
  if (section.energy < 0.5 || section.kind === "build" || section.kind === "pre") return [];
  const scale = scaleNotes(key, 62, 86);
  const notes: PartNote[] = [];
  // A motif of two bars: a rhythm, and moves along the scale from note to note.
  const busy = section.energy >= 0.85 ? CELLS : CELLS.slice(0, 4);
  const motif = [random.pick(busy), random.pick(ENDING)].flatMap((cell, bar) => cell.map(([beat, length]) => [bar * 4 + beat, length] as const));
  const moves = motif.map(() => random.weighted([[-2, 1], [-1, 3], [0, 1], [1, 3], [2, 1]] as const));
  const sparse = section.energy < 0.7;
  const center = 72;
  const nearestIndex = (pitch: number) => scale.reduce((best, note, index) => (Math.abs(note - pitch) < Math.abs(scale[best]! - pitch) ? index : best), 0);
  /** The chord tone nearest `pitch`, of the chord at `at`; other than the root, for a phrase that asks. */
  const chordTone = (at: number, pitch: number, avoidRoot = false) => {
    const chord = chordAt(context, at);
    if (!chord) return pitch;
    const tones = chordTones(chord).filter((pc) => !(avoidRoot && pc === chord.root));
    return tones.map((pc) => nearest(pc, pitch)).reduce((best, one) => (Math.abs(one - pitch) < Math.abs(best - pitch) ? one : best));
  };

  // Units of two bars, in fours: the motif, its question (ending away from the root), the motif a step lower,
  // and its answer (ending on the root). A quieter section rests in the third.
  for (let unit = 0; unit * 8 < section.duration; unit++) {
    const place = unit % 4;
    if (sparse && place === 2) continue;
    const t = unit * 8;
    let index = nearestIndex(chordTone(t, center - (place === 2 ? 2 : 0)));
    motif.forEach(([beat, length], n) => {
      const at = t + beat;
      if (at >= section.duration) return;
      index = Math.max(0, Math.min(scale.length - 1, index + (n === 0 ? 0 : moves[n]!)));
      let pitch = scale[index]!;
      // On the beats that carry the chord, and at the end, a note of the chord.
      const strong = Math.abs(beat - Math.round(beat)) < 1e-9 && Math.round(beat) % 2 === 0;
      const last = n === motif.length - 1;
      if (strong || last) pitch = chordTone(at, pitch, last && place === 1);
      if (last && place === 3) pitch = nearest(chordAt(context, at)?.root ?? degreePc(key, 0), pitch);
      index = nearestIndex(pitch);
      notes.push({ at, duration: Math.min(length * 0.92, section.duration - at), pitch, velocity: velocity(context, 95, strong ? 8 : 0) });
    });
  }
  return notes;
}

const WRITERS = { drums, bass, chords: pad, arp, lead: melody } as const;

/** The notes of `request.role` for each section it plays in, from `stream(kind)`, one per kind of section. */
export function writePart(request: PartRequest, stream: (kind: string) => Random): Part {
  const part: Part = {};
  request.sections.forEach((section, index) => {
    const context: Context = {
      section,
      next: request.sections[index + 1],
      chords: chordsOver(section, request.chords),
      key: request.key,
      random: stream(`${request.role}/${section.kind}`),
      request,
    };
    const notes = WRITERS[request.role](context).filter((note) => note.at >= 0 && note.at < section.duration);
    if (notes.length > 0) part[section.id] = notes;
  });
  return part;
}
