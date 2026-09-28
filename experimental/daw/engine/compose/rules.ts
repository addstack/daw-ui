import type { Composer } from "./composer.js";
import { TEMPI, form } from "./form.js";
import { harmonize } from "./harmony.js";
import { writePart } from "./parts.js";
import { random } from "./random.js";

// The composer of rules: the form, chords and parts of `form.ts`, `harmony.ts` and `parts.ts`, from a seed. The same
// request gives the same song, and each thing it writes draws from a stream of its own, so that another seed for
// one part leaves the rest as it was.

export const rules: Composer = {
  name: "Rules",

  async plan({ style, key, seed }) {
    const sections = form(style, random(seed, "form", style));
    const chords = harmonize(sections, key, style, (name) => random(seed, name, style, key.mode));
    const [low, high] = TEMPI[style];
    return { sections, chords, bpm: random(seed, "tempo", style).int(low, high) };
  },

  async chords({ style, key, seed, sections }) {
    return harmonize(sections, key, style, (name) => random(seed, name, style, key.mode));
  },

  async part(request) {
    return writePart(request, (name) => random(request.seed, name, request.style));
  },
};
