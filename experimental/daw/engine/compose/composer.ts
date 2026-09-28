import type { ChordSymbol, Key } from "./theory.js";

// What a composer takes and gives. A composer writes a song's plan (its sections and chords) and the notes of a
// part that follows the plan. The one here follows rules and a seed; another, such as a language model asked for
// this same data as JSON, or a model of music run in the page, can take its place without the rest changing: the
// DAW only sees these types. Every call is asynchronous for that reason.

export type Style = "pop" | "edm" | "lofi";

export type SectionKind = "intro" | "verse" | "pre" | "chorus" | "bridge" | "build" | "drop" | "breakdown" | "outro";

/** A part of the song's form: where it is in beats, and how much is going on in it, 0 … 1. */
export type Section = { id: string; kind: SectionKind; name: string; at: number; duration: number; energy: number };

/** A chord of the song, where it is in beats. */
export type Chord = ChordSymbol & { id: string; at: number; duration: number };

/** What a part plays. */
export type Role = "drums" | "bass" | "chords" | "arp" | "lead";

/** A note, in beats from the start of its section. */
export type PartNote = { at: number; duration: number; pitch: number; velocity: number };

export type PlanRequest = { style: Style; key: Key; seed: number };

/** A song's plan: its form, its chords, and the tempo its style likes. */
export type Plan = { sections: Section[]; chords: Chord[]; bpm?: number | undefined };

export type PartRequest = {
  role: Role;
  style: Style;
  key: Key;
  sections: readonly Section[];
  chords: readonly Chord[];
  seed: number;
};

/** A part's notes for each section it plays in, by the section's id. Sections it rests in are left out. */
export type Part = Record<string, PartNote[]>;

export interface Composer {
  /** Its name, to show. */
  readonly name: string;
  /** A song's sections and chords. */
  plan(request: PlanRequest): Promise<Plan>;
  /** The chords of the sections given, keeping the sections. */
  chords(request: PlanRequest & { sections: readonly Section[] }): Promise<Chord[]>;
  /** A part that follows the sections and chords. */
  part(request: PartRequest): Promise<Part>;
}

export const SECTION_NAMES: Record<SectionKind, string> = {
  intro: "Intro",
  verse: "Verse",
  pre: "Pre-Chorus",
  chorus: "Chorus",
  bridge: "Bridge",
  build: "Build",
  drop: "Drop",
  breakdown: "Breakdown",
  outro: "Outro",
};

export const ROLE_NAMES: Record<Role, string> = { drums: "Drums", bass: "Bass", chords: "Chords", arp: "Arp", lead: "Lead" };

export const STYLE_NAMES: Record<Style, string> = { pop: "Pop", edm: "EDM", lofi: "Lo-fi" };
