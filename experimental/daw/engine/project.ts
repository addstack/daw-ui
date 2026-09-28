import type { Chord, Role, Section, Style } from "./compose/composer.js";
import type { Key } from "./compose/theory.js";

// A song, as data: its tempo and loop, its key, form and chords, its tracks, their clips and the devices on them.
// Time is in beats (quarter notes), so that a song keeps its shape when its tempo changes. It holds no audio and no
// plug-in's settings: the host keeps those, by the ids here. Every change makes a new project, so that undo keeps
// the old ones.

/** A note of a MIDI clip: beats from the start of the clip's content, and a velocity from 1 to 127. */
export type Note = { id: number; at: number; duration: number; pitch: number; velocity: number };

type ClipBase = {
  id: string;
  name: string;
  /** The beat of the song it starts at. */
  at: number;
  /** Beats it lasts. */
  duration: number;
  /** Beats into its content where it starts. */
  offset: number;
};

export type MidiClip = ClipBase & { kind: "midi"; notes: Note[] };
/** Audio from the host's buffer `audio`; its beats follow the tempo, and its seconds do not. */
export type AudioClip = ClipBase & { kind: "audio"; audio: string };
export type Clip = MidiClip | AudioClip;

export type InstrumentKind = "synth" | "drums";

/** An effect on a track or on the master: its settings are the plug-in's, in the host, by `id`. */
export type Device = { id: string; kind: "shaperbox" };

export type Track = {
  id: string;
  name: string;
  color: string;
  /** What plays its clips: an instrument for MIDI, or nothing for audio. */
  instrument: InstrumentKind | null;
  /** Decibels. */
  volume: number;
  /** −1 (left) to 1 (right). */
  pan: number;
  mute: boolean;
  solo: boolean;
  clips: Clip[];
  effects: Device[];
  /** What its generated notes play, and the seed they came from, to make them again. */
  role?: Role | undefined;
  seed?: number | undefined;
};

export type Project = {
  bpm: number;
  loop: { on: boolean; start: number; end: number };
  key: Key;
  style: Style;
  /** The seed the form and chords came from. */
  seed: number;
  /** The form: sections one after another, in beats. */
  sections: Section[];
  /** The chords, in beats: the chord track. */
  chords: Chord[];
  tracks: Track[];
  master: { volume: number; effects: Device[] };
};

let count = 0;
/** A new id, never given before in this page. */
export const newId = (prefix: string) => `${prefix}${++count}`;

export const TRACK_COLORS = ["#ff9a3c", "#ff5a7a", "#5ab4ff", "#7ee07e", "#c792ff", "#ffd84a", "#3de0c0", "#ff7ad9"];

export const BEATS_PER_BAR = 4;

/** Notes from rows of [beat, beats, pitch, velocity]. */
const notes = (rows: readonly (readonly [number, number, number, number])[]): Note[] =>
  rows.map(([at, duration, pitch, velocity], id) => ({ id, at, duration, pitch, velocity }));

// The song: A minor, a chord a bar: Am7, Fmaj7, C, G, twice.
const CHORDS = [
  [57, 60, 64, 67],
  [53, 57, 60, 64],
  [55, 60, 64, 67],
  [55, 59, 62, 67],
];
const ROOTS = [33, 29, 36, 31];

/** General MIDI's drum notes, as the drum machine plays them. */
export const KICK = 36;
export const RIM = 37;
export const SNARE = 38;
export const CLAP = 39;
export const CLOSED_HAT = 42;
export const TOM = 45;
export const OPEN_HAT = 46;
export const CRASH = 49;

function beat(bars: number, full: boolean): Note[] {
  const rows: [number, number, number, number][] = [];
  for (let bar = 0; bar < bars; bar++) {
    for (let step = 0; step < 16; step++) {
      const at = bar * 4 + step / 4;
      if (step % 4 === 0) rows.push([at, 0.25, KICK, 120]);
      if (full && (step === 4 || step === 12)) rows.push([at, 0.25, CLAP, 110]);
      if (step % 4 === 2) rows.push([at, 0.25, step === 14 && bar % 2 === 1 ? OPEN_HAT : CLOSED_HAT, full ? 100 : 80]);
      else if (full && step % 2 === 1) rows.push([at, 0.25, CLOSED_HAT, 45]);
      if (full && bar % 4 === 3 && step >= 13) rows.push([at, 0.25, RIM, 70 + step * 3]);
    }
  }
  if (full) rows.push([0, 0.25, CRASH, 100]);
  return notes(rows);
}

function bassline(bars: number): Note[] {
  const rows: [number, number, number, number][] = [];
  for (let bar = 0; bar < bars; bar++) {
    const root = ROOTS[bar % 4]!;
    for (let step = 0; step < 4; step++) {
      // Off-beats, and an octave up on the last of the bar.
      rows.push([bar * 4 + step + 0.5, 0.45, step === 3 ? root + 12 : root, step === 0 ? 110 : 95]);
    }
  }
  return notes(rows);
}

function chords(bars: number): Note[] {
  const rows: [number, number, number, number][] = [];
  for (let bar = 0; bar < bars; bar++) for (const pitch of CHORDS[bar % 4]!) rows.push([bar * 4, 4, pitch, 90]);
  return notes(rows);
}

function arpeggio(bars: number): Note[] {
  const rows: [number, number, number, number][] = [];
  for (let bar = 0; bar < bars; bar++) {
    const chord = CHORDS[bar % 4]!;
    // Up the chord an octave higher and back down, in eighths.
    const line = [0, 1, 2, 3, 2, 1, 2, 3].map((index) => chord[index]! + 12);
    line.forEach((pitch, step) => rows.push([bar * 4 + step / 2, 0.4, pitch, step % 2 === 0 ? 105 : 80]));
  }
  return notes(rows);
}

const midi = (name: string, at: number, bars: number, content: Note[]): MidiClip => ({
  id: newId("clip"),
  kind: "midi",
  name,
  at,
  duration: bars * BEATS_PER_BAR,
  offset: 0,
  notes: content,
});

/** What the host sets up for the demo song besides the project: each instrument's preset and each effect's. */
export type DemoPlugins = { synths: Record<string, string>; effects: Record<string, string> };

/** The song the DAW opens with: eight bars of drums, bass, chords and a lead. */
export function demoProject(): { project: Project; presets: DemoPlugins } {
  const drums: Track = {
    id: newId("track"),
    name: "Drums",
    role: "drums",
    color: TRACK_COLORS[0]!,
    instrument: "drums",
    volume: -3,
    pan: 0,
    mute: false,
    solo: false,
    clips: [midi("Intro beat", 0, 4, beat(4, false)), midi("Beat", 16, 4, beat(4, true))],
    effects: [],
  };
  const bassPump = newId("device");
  const bass: Track = {
    id: newId("track"),
    name: "Bass",
    role: "bass",
    color: TRACK_COLORS[1]!,
    instrument: "synth",
    volume: -2,
    pan: 0,
    mute: false,
    solo: false,
    clips: [midi("Bassline", 16, 4, bassline(4))],
    effects: [{ id: bassPump, kind: "shaperbox" }],
  };
  const chordPump = newId("device");
  const pad: Track = {
    id: newId("track"),
    name: "Chords",
    role: "chords",
    color: TRACK_COLORS[2]!,
    instrument: "synth",
    volume: -9,
    pan: 0,
    mute: false,
    solo: false,
    clips: [midi("Chords", 0, 8, chords(8))],
    effects: [{ id: chordPump, kind: "shaperbox" }],
  };
  const lead: Track = {
    id: newId("track"),
    name: "Lead",
    role: "arp",
    color: TRACK_COLORS[3]!,
    instrument: "synth",
    volume: -12,
    pan: 0.15,
    mute: false,
    solo: false,
    clips: [midi("Arpeggio", 16, 4, arpeggio(4))],
    effects: [],
  };
  const qualities = ["m7", "maj7", "maj", "maj"] as const;
  return {
    project: {
      bpm: 124,
      loop: { on: true, start: 0, end: 32 },
      key: { tonic: 9, mode: "minor" },
      style: "edm",
      seed: 1,
      sections: [
        { id: newId("section"), kind: "intro", name: "Intro", at: 0, duration: 16, energy: 0.4 },
        { id: newId("section"), kind: "drop", name: "Drop", at: 16, duration: 16, energy: 1 },
      ],
      chords: Array.from({ length: 8 }, (_, bar) => ({
        id: newId("chord"),
        at: bar * BEATS_PER_BAR,
        duration: BEATS_PER_BAR,
        root: ROOTS[bar % 4]! % 12,
        quality: qualities[bar % 4]!,
      })),
      tracks: [drums, bass, pad, lead],
      master: { volume: 0, effects: [] },
    },
    presets: {
      synths: { [bass.id]: "Deep Bass", [pad.id]: "Supersaw Pad", [lead.id]: "Pluck" },
      effects: { [bassPump]: "Pump", [chordPump]: "Pump" },
    },
  };
}

/** The beat just after the last clip of the song. */
export const songEnd = (project: Project) => Math.max(0, ...project.tracks.flatMap((track) => track.clips.map((clip) => clip.at + clip.duration)));
