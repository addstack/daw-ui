/**
 * Turns a value into the text a control shows (and screen readers announce),
 * and text a user typed back into a value. `parse` returns `null` for text it
 * does not understand; the control then keeps its value. Parsed values are
 * constrained by the range afterwards, so `parse` does not clamp.
 *
 * The built-in formats print numbers with `Intl.NumberFormat` in `locale`
 * (the runtime's default locale when left out) and add only unit symbols that
 * read the same in every language. Words come from the application.
 */
export type ValueFormat = {
  format(value: number): string;
  parse(text: string): number | null;
  /**
   * The value as fields a user can change one at a time, and the text
   * between them: the bars, beats and sixteenths of a song position. Every
   * field is a view of the one value, so stepping a field past its end
   * carries over into the next.
   */
  segments?: readonly ValueSegment[] | undefined;
};

/** A field of a value, such as the bar of a song position or the frames of a timecode. */
export type ValueField = {
  type: "field";
  /** Names the field, e.g. `"bars"`: for `data-segment`, and to look up the label the application gives it. */
  name: string;
  /** How much one step of the field changes the value, in the value's units. */
  step: number;
  /** The field's number in a value: the bar (1, 2, …) of a position. */
  get(value: number): number;
  /** The field's text in a value, e.g. `"03"`. */
  format(value: number): string;
  /** The field's lowest number, when it has one: 1 for the beat of a bar. */
  min?: number | undefined;
  /** The field's highest number, when it has one: 4 for the beat of a bar in 4/4. */
  max?: number | undefined;
};

/** Text between fields, such as the `.` of `12.3.2`. */
export type ValueLiteral = { type: "literal"; text: string };

export type ValueSegment = ValueField | ValueLiteral;

export type LocaleOptions = {
  /**
   * Locale for digits and the decimal separator.
   * @default the runtime's locale
   */
  locale?: Intl.LocalesArgument | undefined;
};

/** Prints numbers with a fixed number of decimals. Formatters are created once, not per call. */
function createPrinter(locale: Intl.LocalesArgument | undefined) {
  const cache = new Map<number, Intl.NumberFormat>();
  return (value: number, digits: number): string => {
    let formatter = cache.get(digits);
    if (!formatter) {
      formatter = new Intl.NumberFormat(locale, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
        useGrouping: false,
      });
      cache.set(digits, formatter);
    }
    // Round first, so that -0.04 prints as "0.0" rather than "-0.0".
    const rounded = Number(value.toFixed(digits));
    return formatter.format(rounded === 0 ? 0 : rounded);
  };
}

/** Prints whole numbers with at least `width` digits: "03". */
function createPadder(locale: Intl.LocalesArgument | undefined) {
  const cache = new Map<number, Intl.NumberFormat>();
  return (value: number, width = 1): string => {
    let formatter = cache.get(width);
    if (!formatter) {
      formatter = new Intl.NumberFormat(locale, { minimumIntegerDigits: width, useGrouping: false });
      cache.set(width, formatter);
    }
    return formatter.format(value);
  };
}

/** A symbol of the locale, such as its decimal separator or minus sign. */
function symbol(locale: Intl.LocalesArgument | undefined, type: Intl.NumberFormatPartTypes, fallback: string): string {
  const parts = new Intl.NumberFormat(locale, { minimumFractionDigits: 1 }).formatToParts(-1.5);
  return parts.find((part) => part.type === type)?.value ?? fallback;
}

const mod = (value: number, divisor: number) => ((value % divisor) + divisor) % divisor;

function field(
  name: string,
  step: number,
  get: (value: number) => number,
  format: (value: number) => string,
  min?: number,
  max?: number,
): ValueField {
  return { type: "field", name, step, get, format, min, max };
}

/** The text of a value from its segments, so that the whole and its fields always agree. */
const joined = (segments: readonly ValueSegment[]) => (value: number) =>
  segments.map((segment) => (segment.type === "field" ? segment.format(value) : segment.text)).join("");

/** The whole numbers of text such as "12.3.2" or "01:02:03:12", or `null` when there are none or others. */
function wholeNumbers(text: string): number[] | null {
  const tokens = text.trim().replace("−", "-").split(/[.:;,\s]+/).filter(Boolean);
  if (tokens.length === 0 || tokens.some((token, index) => !(index === 0 ? /^-?\d+$/ : /^\d+$/).test(token))) return null;
  return tokens.map(Number);
}

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i;

/** Splits "1,5 kHz" into 1.5 and "khz". Accepts either decimal separator and the Unicode minus sign. */
function split(text: string): { number: number; rest: string } | null {
  const trimmed = text.trim().replace("−", "-").replace(",", ".");
  const match = NUMBER.exec(trimmed);
  if (!match) return null;
  return { number: Number(match[0]), rest: trimmed.slice(match[0].length).trim().toLowerCase() };
}

export type NumberFormatOptions = LocaleOptions & {
  /**
   * Digits after the decimal separator.
   * @default 2
   */
  digits?: number | undefined;
  /** Appended after a space, and accepted (optionally) when parsing. */
  unit?: string | undefined;
};

/**
 * A number with a fixed number of decimals and an optional unit: "120.00 BPM".
 * Its segments are the whole part and the decimals, which a number box
 * changes one at a time, as the tempo field of Ableton Live does.
 */
function number({ digits = 2, unit, locale }: NumberFormatOptions = {}): ValueFormat {
  const print = createPrinter(locale);
  const pad = createPadder(locale);
  const scale = 10 ** digits;
  // The value in its smallest step, rounded as it is printed.
  const units = (value: number) => Math.round(Number(value.toFixed(digits)) * scale);
  const whole = (value: number) => Math.trunc(units(value) / scale);
  const fraction = (value: number) => Math.abs(units(value)) % scale;
  const minus = symbol(locale, "minusSign", "-");
  const segments: ValueSegment[] = [
    // The sign belongs to the whole part, "-0" included: "-0.25".
    field("integer", 1, whole, (value) => (units(value) < 0 ? minus : "") + pad(Math.abs(whole(value)))),
  ];
  if (digits > 0) {
    segments.push(
      { type: "literal", text: symbol(locale, "decimal", ".") },
      field("fraction", 1 / scale, fraction, (value) => pad(fraction(value), digits), 0, scale - 1),
    );
  }
  if (unit) segments.push({ type: "literal", text: ` ${unit}` });
  return {
    format: (value) => (unit ? `${print(value, digits)} ${unit}` : print(value, digits)),
    parse(text) {
      const parts = split(text);
      if (!parts) return null;
      if (parts.rest !== "" && parts.rest !== unit?.toLowerCase()) return null;
      return parts.number;
    },
    segments,
  };
}

/** dB: "-6.0 dB"; `-Infinity` prints as "-∞ dB", and "-∞" or "-inf" parse back. */
function decibel({ digits = 1, locale }: LocaleOptions & { digits?: number | undefined } = {}): ValueFormat {
  const print = createPrinter(locale);
  return {
    format: (value) => (value === -Infinity ? "-∞ dB" : `${print(value, digits)} dB`),
    parse(text) {
      const trimmed = text.trim().replace("−", "-").toLowerCase();
      if (trimmed.startsWith("-inf") || trimmed.startsWith("-∞")) return -Infinity;
      const parts = split(trimmed);
      if (!parts || (parts.rest !== "" && parts.rest !== "db")) return null;
      return parts.number;
    },
  };
}

/** Hz below 1 kHz, kHz above: "440 Hz", "1.50 kHz". Parses "440", "440 Hz", "1k", "1.5 kHz". */
function frequency({ locale }: LocaleOptions = {}): ValueFormat {
  const print = createPrinter(locale);
  return {
    format(value) {
      if (value < 1000) return `${print(value, value < 100 ? 1 : 0)} Hz`;
      return `${print(value / 1000, value < 10_000 ? 2 : 1)} kHz`;
    },
    parse(text) {
      const parts = split(text);
      if (!parts) return null;
      if (parts.rest === "" || parts.rest === "hz") return parts.number;
      if (parts.rest === "k" || parts.rest === "khz") return parts.number * 1000;
      return null;
    },
  };
}

/** A fraction as a percentage in the locale's style ("50%", "50 %"); "50" parses back to 0.5. */
function percent({ digits = 0, locale }: LocaleOptions & { digits?: number | undefined } = {}): ValueFormat {
  const formatter = new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: false,
  });
  return {
    format: (value) => formatter.format(value),
    parse(text) {
      const parts = split(text);
      if (!parts || (parts.rest !== "" && parts.rest !== "%")) return null;
      return parts.number / 100;
    },
  };
}

export type PanFormatOptions = LocaleOptions & {
  /** Suffix for left, e.g. "L" ("50L"). */
  left: string;
  /** Suffix for right, e.g. "R" in English, "P" in Polish. */
  right: string;
  /** Text for the center, e.g. "C". */
  center: string;
};

/**
 * Pan in [-1, 1] the way mixers show it: "50L", "C", "50R", with the letters
 * the application passes. Also parses "-50" and "50".
 */
function pan({ left, right, center }: PanFormatOptions): ValueFormat {
  return {
    format(value) {
      const amount = Math.round(Math.abs(value) * 100);
      if (amount === 0) return center;
      return `${amount}${value < 0 ? left : right}`;
    },
    parse(text) {
      const trimmed = text.trim().toLowerCase();
      if (trimmed === center.toLowerCase()) return 0;
      const parts = split(trimmed);
      if (!parts) return null;
      if (parts.rest === "") return parts.number / 100;
      if (parts.rest === left.toLowerCase()) return -Math.abs(parts.number) / 100;
      if (parts.rest === right.toLowerCase()) return Math.abs(parts.number) / 100;
      return null;
    },
  };
}

/** Milliseconds: "4.00 ms", "250 ms", "1.50 s". Parses "250", "250 ms", "1.5 s". */
function time({ locale }: LocaleOptions = {}): ValueFormat {
  const print = createPrinter(locale);
  return {
    format(value) {
      if (value >= 1000) return `${print(value / 1000, 2)} s`;
      return `${print(value, value < 10 ? 2 : value < 100 ? 1 : 0)} ms`;
    },
    parse(text) {
      const parts = split(text);
      if (!parts) return null;
      if (parts.rest === "" || parts.rest === "ms") return parts.number;
      if (parts.rest === "s") return parts.number * 1000;
      return null;
    },
  };
}

export type PositionFormatOptions = LocaleOptions & {
  /**
   * Beats in a bar: 4 in 4/4, 3 in 3/4.
   * @default 4
   */
  beatsPerBar?: number | undefined;
  /**
   * Parts of a beat: 4 makes them sixteenths when the beat is a quarter note.
   * @default 4
   */
  divisions?: number | undefined;
};

/**
 * A song position in beats, as bars, beats and divisions counted from 1:
 * 0 is "1.1.1", and 5.25 is "2.2.2" in 4/4. A position between divisions
 * shows the division it is in, as DAWs do. Parses "12.3.2", and "12" as
 * the start of bar 12.
 */
function position({ beatsPerBar = 4, divisions = 4, locale }: PositionFormatOptions = {}): ValueFormat {
  const pad = createPadder(locale);
  // Whole divisions from the start; the epsilon keeps 2.9999999 from showing as the division before 3.
  const count = (value: number) => Math.floor(value * divisions + 1e-9);
  const bar = (value: number) => Math.floor(count(value) / (beatsPerBar * divisions)) + 1;
  const beat = (value: number) => Math.floor(mod(count(value), beatsPerBar * divisions) / divisions) + 1;
  const division = (value: number) => mod(count(value), divisions) + 1;
  const dot: ValueLiteral = { type: "literal", text: "." };
  const segments = [
    field("bars", beatsPerBar, bar, (value) => pad(bar(value))),
    dot,
    field("beats", 1, beat, (value) => pad(beat(value)), 1, beatsPerBar),
    dot,
    field("divisions", 1 / divisions, division, (value) => pad(division(value)), 1, divisions),
  ];
  return {
    format: joined(segments),
    parse(text) {
      const numbers = wholeNumbers(text);
      if (!numbers || numbers.length > 3) return null;
      const [bars = 1, beats = 1, parts = 1] = numbers;
      return (bars - 1) * beatsPerBar + (beats - 1) + (parts - 1) / divisions;
    },
    segments,
  };
}

export type TimecodeFormatOptions = LocaleOptions & {
  /** Frames per second, a whole number: 24 for film, 25 for PAL video, 30 for NTSC without dropped frames. */
  fps: number;
};

/**
 * Seconds as SMPTE timecode, hours:minutes:seconds:frames: 3723.5 is
 * "01:02:03:12" at 25 fps. Parses the same, and digits alone from the right,
 * as editing systems do: "1500" is 15 seconds. Drop-frame timecode is not
 * supported.
 */
function timecode({ fps, locale }: TimecodeFormatOptions): ValueFormat {
  if (!Number.isInteger(fps) || fps <= 0) throw new RangeError(`fps (${fps}) must be a whole number greater than 0.`);
  const pad = createPadder(locale);
  const minus = symbol(locale, "minusSign", "-");
  const frames = (value: number) => Math.floor(Math.abs(value) * fps + 1e-9);
  const sign = (value: number) => (value < 0 && frames(value) > 0 ? minus : "");
  const hours = (value: number) => Math.floor(frames(value) / (3600 * fps));
  const minutes = (value: number) => Math.floor(frames(value) / (60 * fps)) % 60;
  const seconds = (value: number) => Math.floor(frames(value) / fps) % 60;
  const frame = (value: number) => frames(value) % fps;
  const two = (get: (value: number) => number) => (value: number) => pad(get(value), 2);
  const colon: ValueLiteral = { type: "literal", text: ":" };
  const segments = [
    field("hours", 3600, hours, (value) => sign(value) + pad(hours(value), 2), 0),
    colon,
    field("minutes", 60, minutes, two(minutes), 0, 59),
    colon,
    field("seconds", 1, seconds, two(seconds), 0, 59),
    colon,
    field("frames", 1 / fps, frame, two(frame), 0, fps - 1),
  ];
  return {
    format: joined(segments),
    parse(text) {
      let numbers = wholeNumbers(text);
      const digits = text.trim();
      // Digits alone fill the fields from the right, two at a time.
      if (numbers?.length === 1 && /^\d{3,8}$/.test(digits)) numbers = digits.padStart(8, "0").match(/../g)!.map(Number);
      if (!numbers || numbers.length > 4) return null;
      const negative = numbers[0]! < 0 || Object.is(numbers[0], -0);
      const [f = 0, s = 0, m = 0, h = 0] = numbers.map(Math.abs).reverse();
      const total = h * 3600 + m * 60 + s + f / fps;
      return negative ? -total : total;
    },
    segments,
  };
}

export const formats = { number, decibel, frequency, percent, pan, time, position, timecode };
