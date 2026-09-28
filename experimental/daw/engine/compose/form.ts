import type { Section, SectionKind, Style } from "./composer.js";
import { SECTION_NAMES } from "./composer.js";
import type { Random } from "./random.js";

// The form of a song in a style: which sections follow which, how many bars each lasts, and how much goes on in
// each (its energy), from the forms these styles are usually in. A seed picks among a few, as a writer would.

type Step = { kind: SectionKind; bars: number };

const FORMS: Record<Style, Step[][]> = {
  // Verse and chorus, twice, a bridge, and the chorus again.
  pop: [
    [
      { kind: "intro", bars: 4 },
      { kind: "verse", bars: 8 },
      { kind: "pre", bars: 4 },
      { kind: "chorus", bars: 8 },
      { kind: "verse", bars: 8 },
      { kind: "pre", bars: 4 },
      { kind: "chorus", bars: 8 },
      { kind: "bridge", bars: 8 },
      { kind: "chorus", bars: 8 },
      { kind: "outro", bars: 4 },
    ],
    [
      { kind: "intro", bars: 4 },
      { kind: "verse", bars: 8 },
      { kind: "chorus", bars: 8 },
      { kind: "verse", bars: 8 },
      { kind: "chorus", bars: 8 },
      { kind: "bridge", bars: 8 },
      { kind: "chorus", bars: 8 },
      { kind: "chorus", bars: 8 },
      { kind: "outro", bars: 4 },
    ],
  ],
  // Phrases of eight and sixteen bars: a build before each drop, a breakdown between them.
  edm: [
    [
      { kind: "intro", bars: 8 },
      { kind: "build", bars: 8 },
      { kind: "drop", bars: 16 },
      { kind: "breakdown", bars: 8 },
      { kind: "build", bars: 8 },
      { kind: "drop", bars: 16 },
      { kind: "outro", bars: 8 },
    ],
    [
      { kind: "intro", bars: 16 },
      { kind: "breakdown", bars: 8 },
      { kind: "build", bars: 8 },
      { kind: "drop", bars: 16 },
      { kind: "breakdown", bars: 16 },
      { kind: "build", bars: 8 },
      { kind: "drop", bars: 16 },
      { kind: "outro", bars: 8 },
    ],
  ],
  // A loop in two parts, taken round twice.
  lofi: [
    [
      { kind: "intro", bars: 4 },
      { kind: "verse", bars: 8 },
      { kind: "chorus", bars: 8 },
      { kind: "verse", bars: 8 },
      { kind: "chorus", bars: 8 },
      { kind: "outro", bars: 4 },
    ],
    [
      { kind: "intro", bars: 4 },
      { kind: "verse", bars: 16 },
      { kind: "bridge", bars: 8 },
      { kind: "verse", bars: 16 },
      { kind: "outro", bars: 4 },
    ],
  ],
};

/** How much goes on in a section, 0 … 1: its parts, their density, their loudness. */
export const ENERGY: Record<SectionKind, number> = {
  intro: 0.3,
  verse: 0.55,
  pre: 0.7,
  chorus: 0.9,
  bridge: 0.5,
  build: 0.75,
  drop: 1,
  breakdown: 0.35,
  outro: 0.3,
};

/** The tempo each style is usually at, as a range to pick from. */
export const TEMPI: Record<Style, [number, number]> = { pop: [96, 118], edm: [124, 128], lofi: [72, 88] };

let count = 0;

/** A form in `style`, its sections one after another from beat 0. The last chorus or drop is a little hotter. */
export function form(style: Style, random: Random): Section[] {
  const steps = random.pick(FORMS[style]);
  let at = 0;
  const kinds = steps.map((step) => step.kind);
  return steps.map((step, index) => {
    const last = kinds.lastIndexOf(step.kind) === index && kinds.indexOf(step.kind) !== index;
    const section: Section = {
      id: `section-${++count}`,
      kind: step.kind,
      name: SECTION_NAMES[step.kind],
      at,
      duration: step.bars * 4,
      energy: Math.min(1, ENERGY[step.kind] + (last && (step.kind === "chorus" || step.kind === "drop") ? 0.1 : 0)),
    };
    at += section.duration;
    return section;
  });
}
