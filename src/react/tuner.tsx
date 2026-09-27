"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties } from "react";

import { frequencyFormat, numberFormat } from "../core/format.js";
import type { ValueFormat } from "../core/index.js";
import { noteOf, targetOf } from "../core/tuner.js";
import { onEveryFrame } from "./frame-loop.js";
import { liveProps, writeLive, type Live } from "./live.js";
import { unselectable, useRenderPart, type PartProps } from "./render.js";
import { useIsomorphicLayoutEffect } from "./value-control.js";

export type TunerState = {
  /** Whether a pitch is heard. */
  active: boolean;
  /** Whether it is within `tolerance` of its note. */
  inTune: boolean;
};

/** What the tuner reads from a frequency. */
type Reading = {
  active: boolean;
  /** The last frequency heard, in hertz. */
  frequency: number;
  /** Its note, as a MIDI note number with a fraction. */
  note: number;
  /** The note it is tuned to: the nearest, the nearest of `targets`, or `target`. */
  target: number | null;
  cents: number;
  tune: "in" | "flat" | "sharp" | null;
  /** The cents, added up over time in seconds: how far a strobe has moved. */
  phase: number;
};

type Settings = {
  reference: number;
  tolerance: number;
  targets: readonly number[] | undefined;
  target: number | undefined;
  hysteresis: number;
  smoothing: number;
};

/** The reading, outside React: the parts write what they show of it straight to the DOM. */
class TunerStore {
  reading: Reading = { active: false, frequency: Number.NaN, note: Number.NaN, target: null, cents: 0, tune: null, phase: 0 };
  private last: number | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(public settings: Settings) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Reads a frequency, or its absence; `now` is the frame's time in milliseconds, or `null` outside the frame loop. */
  update(frequency: number | null | undefined, now: number | null): void {
    const { reference, tolerance, targets, target, hysteresis, smoothing } = this.settings;
    const before = this.reading;
    const elapsed = now !== null && this.last !== null ? Math.max(0, now - this.last) / 1000 : 0;
    this.last = now;
    if (!(typeof frequency === "number" && frequency > 0 && Number.isFinite(frequency))) {
      // Silence: the texts keep the last reading, and `data-active` goes.
      if (!before.active) return;
      this.reading = { ...before, active: false, tune: null };
      this.notify();
      return;
    }
    const heard = noteOf(frequency, reference);
    const note =
      before.active && smoothing > 0 && elapsed > 0 ? before.note + (heard - before.note) * (1 - Math.exp(-(elapsed * 1000) / smoothing)) : heard;
    const tuned = target ?? targetOf(note, before.target, targets, hysteresis);
    const cents = (note - tuned) * 100;
    const tune = Math.abs(cents) <= tolerance ? "in" : cents < 0 ? "flat" : "sharp";
    this.reading = { active: true, frequency, note, target: tuned, cents, tune, phase: before.phase + cents * elapsed };
    this.notify();
  }

  private notify() {
    for (const listener of this.listeners) listener();
  }
}

type TunerContextValue = { store: TunerStore; format: ValueFormat };

const TunerContext = createContext<TunerContextValue | null>(null);

function useTunerContext(part: string): TunerContextValue {
  const context = useContext(TunerContext);
  if (!context) throw new Error(`<Tuner.${part}> must be placed inside <Tuner.Root>.`);
  return context;
}

const stateOf = (reading: Reading): TunerState => ({ active: reading.active, inTune: reading.tune === "in" });

/** `data-active`, and `data-in-tune`, `data-flat` or `data-sharp` while a pitch is heard. */
const tuneAttributes = (reading: Reading): NonNullable<Live["attributes"]> => ({
  "data-active": reading.active ? "" : null,
  "data-in-tune": reading.tune === "in" ? "" : null,
  "data-flat": reading.tune === "flat" ? "" : null,
  "data-sharp": reading.tune === "sharp" ? "" : null,
});

/**
 * A part that shows something of the reading: rendered from it, and kept in
 * line with it without rendering as the pitch changes.
 */
function useTunerPart(store: TunerStore, describe: (reading: Reading) => Live) {
  const describeRef = useRef(describe);
  describeRef.current = describe;
  const follow = useCallback(
    (element: HTMLElement | null) => {
      if (!element) return;
      const write = () => {
        const { text, ...rest } = describeRef.current(store.reading);
        writeLive(element, rest);
        // Its only content, which may start empty: a part rendered before any pitch was heard has no text node yet.
        if (text !== undefined && element.textContent !== text) element.textContent = text;
      };
      write();
      return store.subscribe(write);
    },
    [store],
  );
  const live = describe(store.reading);
  return { ref: follow, ...liveProps(live), text: live.text };
}

const mod12 = (note: number) => ((note % 12) + 12) % 12;
const round = (value: number, digits: number) => String(Math.round(value * 10 ** digits) / 10 ** digits);

/**
 * A tuner: the note a pitch is nearest, or the note it is tuned to, and how
 * many cents it is off, from the frequency your application hears. It has
 * no shape: its parts show the reading as text, attributes and CSS
 * variables, and CSS makes it a needle, a dial, a row of lights, a strobe or
 * a wheel. It detects nothing: pitch detection is your audio code's.
 *
 * With `read`, it follows the frequency once per animation frame, and
 * nothing renders. Sets `data-active` while a pitch is heard, and
 * `data-in-tune`, `data-flat` or `data-sharp`. A `div` with no role, so that
 * it can hold controls of the application's, such as buttons for strings.
 */
export function TunerRoot({
  read,
  frequency,
  reference = 440,
  tolerance = 5,
  targets,
  target,
  hysteresis = 10,
  smoothing = 0,
  format,
  ...props
}: TunerRoot.Props) {
  const settings: Settings = { reference, tolerance, targets, target, hysteresis, smoothing };
  const reads = read !== undefined;
  const [store] = useState(() => {
    const created = new TunerStore(settings);
    if (!reads) created.update(frequency, null);
    return created;
  });
  useIsomorphicLayoutEffect(() => {
    store.settings = { reference, tolerance, targets, target, hysteresis, smoothing };
    if (!reads) store.update(frequency, null);
  });

  // A frequency that changes on its own is read once per frame.
  const readRef = useRef(read);
  readRef.current = read;
  useEffect(() => {
    if (!reads) return;
    return onEveryFrame((now) => store.update(readRef.current?.(), now));
  }, [reads, store]);

  const live = useTunerPart(store, (reading) => ({ attributes: tuneAttributes(reading) }));
  const context: TunerContextValue = { store, format: format ?? numberFormat({ digits: 0 }) };
  const rendered = useRenderPart("div", stateOf(store.reading), props, { ref: live.ref, ...live.attributes });
  return <TunerContext.Provider value={context}>{rendered}</TunerContext.Provider>;
}

export namespace TunerRoot {
  export type State = TunerState;
  export type Props = PartProps<"div", State> & {
    /** Returns the frequency heard, in hertz, or `null` in silence; called once per animation frame. */
    read?: (() => number | null) | undefined;
    /** The frequency heard, in hertz, when it changes rarely; ignored with `read`. */
    frequency?: number | null | undefined;
    /**
     * The frequency of A4, in hertz.
     * @default 440
     */
    reference?: number | undefined;
    /**
     * Cents from its note within which a pitch is in tune.
     * @default 5
     */
    tolerance?: number | undefined;
    /**
     * The notes a pitch is tuned to, as MIDI note numbers: the strings of an
     * instrument, or the notes of a key. The tuner shows the nearest.
     * @default every note
     */
    targets?: readonly number[] | undefined;
    /** The one note a pitch is tuned to, as a MIDI note number, whatever it is nearest. */
    target?: number | undefined;
    /**
     * Cents a pitch has to be nearer another note before the tuner shows
     * that note instead, so that a pitch between two does not flicker.
     * @default 10
     */
    hysteresis?: number | undefined;
    /**
     * Milliseconds over which the pitch shown follows the pitch heard: more
     * is steadier, less is quicker.
     * @default 0
     */
    smoothing?: number | undefined;
    /**
     * Text of a note, for `Tuner.Note`: `formats.pitch({ names })` for names in the application's language.
     * @default the MIDI note number
     */
    format?: ValueFormat | undefined;
  };
}

/**
 * The note the pitch is tuned to, as text: its name with `formats.pitch`, or
 * its MIDI note number. A polite live region: a screen reader says the note
 * when it changes. Keeps the last note in silence.
 */
export function TunerNote({ format, ...props }: TunerNote.Props) {
  const context = useTunerContext("Note");
  const shown = format ?? context.format;
  const live = useTunerPart(context.store, (reading) => ({
    attributes: tuneAttributes(reading),
    text: reading.target === null ? "" : shown.format(reading.target),
  }));
  return useRenderPart("output", stateOf(context.store.reading), props, {
    ref: live.ref,
    ...live.attributes,
    "aria-live": "polite",
    dir: "auto",
    children: live.text,
    style: unselectable,
  });
}

export namespace TunerNote {
  export type State = TunerState;
  export type Props = Omit<PartProps<"output", State>, "children"> & {
    /**
     * Text of the note, instead of the root's `format`: `formats.number({ digits: 0 })` for its MIDI number.
     * @default the root's format
     */
    format?: ValueFormat | undefined;
  };
}

const defaultFrequency = frequencyFormat();

/** The frequency heard, as text. Not a live region: it changes on every frame. */
export function TunerFrequency({ format = defaultFrequency, ...props }: TunerFrequency.Props) {
  const context = useTunerContext("Frequency");
  const live = useTunerPart(context.store, (reading) => ({
    attributes: tuneAttributes(reading),
    text: Number.isFinite(reading.frequency) ? format.format(reading.frequency) : "",
  }));
  return useRenderPart("output", stateOf(context.store.reading), props, {
    ref: live.ref,
    ...live.attributes,
    "aria-live": "off",
    dir: "auto",
    children: live.text,
    style: unselectable,
  });
}

export namespace TunerFrequency {
  export type State = TunerState;
  export type Props = Omit<PartProps<"output", State>, "children"> & {
    /** @default formats.frequency() */
    format?: ValueFormat | undefined;
  };
}

const signed = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0, signDisplay: "exceptZero" });
const defaultCents: ValueFormat = {
  format: (value) => signed.format(Math.round(value) || 0),
  parse: (text) => {
    const value = Number(text.trim().replace("−", "-"));
    return Number.isFinite(value) ? value : null;
  },
};

/** How many cents the pitch is off, as text, with its sign: "+12", "−3". Not a live region. */
export function TunerCents({ format = defaultCents, ...props }: TunerCents.Props) {
  const context = useTunerContext("Cents");
  const live = useTunerPart(context.store, (reading) => ({
    attributes: tuneAttributes(reading),
    text: reading.target === null ? "" : format.format(reading.cents),
  }));
  return useRenderPart("output", stateOf(context.store.reading), props, {
    ref: live.ref,
    ...live.attributes,
    "aria-live": "off",
    dir: "auto",
    children: live.text,
    style: unselectable,
  });
}

export namespace TunerCents {
  export type State = TunerState;
  export type Props = Omit<PartProps<"output", State>, "children"> & {
    /** @default whole cents, with a sign unless 0 */
    format?: ValueFormat | undefined;
  };
}

/**
 * What follows the pitch: a needle, a light, a beam. Sets, on itself only,
 * `--tuner-offset` (the cents from −50 to +50 as −1 … 1), `--tuner-cents`,
 * and `--tuner-class`, the pitch around an octave from C, 0 to 12 with a
 * fraction, for a wheel. Keeps the last reading in silence. Hidden from
 * assistive technology.
 */
export function TunerIndicator(props: TunerIndicator.Props) {
  const context = useTunerContext("Indicator");
  const live = useTunerPart(context.store, (reading) => ({
    attributes: tuneAttributes(reading),
    style:
      reading.target === null
        ? {}
        : {
            "--tuner-offset": round(Math.min(1, Math.max(-1, reading.cents / 50)), 4),
            "--tuner-cents": round(reading.cents, 1),
            "--tuner-class": round(mod12(reading.note), 4),
          },
  }));
  return useRenderPart("div", stateOf(context.store.reading), props, {
    ref: live.ref,
    ...live.attributes,
    "aria-hidden": true,
    style: live.style as CSSProperties,
  });
}

export namespace TunerIndicator {
  export type State = TunerState;
  export type Props = PartProps<"div", State>;
}

/**
 * A mark on the tuner's scale, with `data-active` while the reading is on
 * it: a note (`note`, a MIDI note number), a note in any octave
 * (`pitchClass`, 0 for C to 11 for B), or a stretch of cents off
 * (`cents={[from, to]}`), such as one light of a row. Hidden from assistive
 * technology.
 */
export function TunerMark({ note, pitchClass, cents, ...props }: TunerMark.Props) {
  const context = useTunerContext("Mark");
  const on = (reading: Reading) => {
    if (!reading.active || reading.target === null) return false;
    if (note !== undefined) return reading.target === note;
    if (pitchClass !== undefined) return mod12(reading.target) === mod12(pitchClass);
    if (cents) return cents[0] <= reading.cents && reading.cents < cents[1];
    return false;
  };
  const live = useTunerPart(context.store, (reading) => ({ attributes: { "data-active": on(reading) ? "" : null } }));
  return useRenderPart("div", stateOf(context.store.reading), props, {
    ref: live.ref,
    ...live.attributes,
    "aria-hidden": true,
    style: unselectable,
  });
}

export namespace TunerMark {
  export type State = TunerState;
  export type Props = PartProps<"div", State> & {
    /** Lit while the tuner is on this note, a MIDI note number. */
    note?: number | undefined;
    /** Lit while the tuner is on this note in any octave: 0 for C to 11 for B. */
    pitchClass?: number | undefined;
    /** Lit while the pitch is from `from` (included) to `to` (not) cents off. */
    cents?: readonly [from: number, to: number] | undefined;
  };
}

/**
 * A strobe: sets, on itself only, `--tuner-phase`, the cents off added up
 * over time in seconds, so that a pattern moved by it runs the way the pitch
 * is off, faster the further off it is, and stands still in tune. It moves
 * only while a pitch is heard. Hidden from assistive technology.
 */
export function TunerStrobe(props: TunerStrobe.Props) {
  const context = useTunerContext("Strobe");
  const live = useTunerPart(context.store, (reading) => ({
    attributes: tuneAttributes(reading),
    style: { "--tuner-phase": round(reading.phase, 2) },
  }));
  return useRenderPart("div", stateOf(context.store.reading), props, {
    ref: live.ref,
    ...live.attributes,
    "aria-hidden": true,
    style: live.style as CSSProperties,
  });
}

export namespace TunerStrobe {
  export type State = TunerState;
  export type Props = PartProps<"div", State>;
}
