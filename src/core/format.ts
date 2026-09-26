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
};

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

function number({ digits = 2, unit, locale }: NumberFormatOptions = {}): ValueFormat {
  const print = createPrinter(locale);
  return {
    format: (value) => (unit ? `${print(value, digits)} ${unit}` : print(value, digits)),
    parse(text) {
      const parts = split(text);
      if (!parts) return null;
      if (parts.rest !== "" && parts.rest !== unit?.toLowerCase()) return null;
      return parts.number;
    },
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

export const formats = { number, decibel, frequency, percent, pan, time };
