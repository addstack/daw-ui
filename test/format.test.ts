import { describe, expect, test } from "vitest";

import { formats, type ValueFormat, type ValueSegment } from "../src/core/index.js";

/** The text of every segment of a value, fields and literals, as a number box shows them. */
const segmentsOf = (format: ValueFormat, value: number) =>
  format.segments!.map((segment: ValueSegment) => (segment.type === "field" ? segment.format(value) : segment.text));

describe("number formats follow the locale", () => {
  test("decimal separator", () => {
    expect(formats.number({ locale: "en" }).format(1.5)).toBe("1.50");
    expect(formats.number({ locale: "pl" }).format(1.5)).toBe("1,50");
    expect(formats.frequency({ locale: "de" }).format(1500)).toBe("1,50 kHz");
  });

  test("no digit grouping, so a typed value parses back", () => {
    const format = formats.number({ locale: "en", digits: 0 });
    expect(format.format(12_000)).toBe("12000");
    expect(format.parse(format.format(12_000))).toBe(12_000);
  });

  test("percent uses the locale's style", () => {
    expect(formats.percent({ locale: "en" }).format(0.5)).toBe("50%");
    expect(formats.percent({ locale: "de" }).format(0.5)).toBe("50 %");
  });

  test("parsing accepts either decimal separator and the Unicode minus sign", () => {
    const format = formats.decibel({ locale: "en" });
    expect(format.parse("-6,5")).toBe(-6.5);
    expect(format.parse("−6.5 dB")).toBe(-6.5);
  });

  test("values that round to zero print without a sign", () => {
    expect(formats.decibel({ locale: "en" }).format(-0.04)).toBe("0.0 dB");
  });
});

describe("formats", () => {
  test("decibel prints and parses silence as -∞", () => {
    const format = formats.decibel({ locale: "en" });
    expect(format.format(-6)).toBe("-6.0 dB");
    expect(format.format(-Infinity)).toBe("-∞ dB");
    expect(format.parse("-inf")).toBe(-Infinity);
    expect(format.parse("-∞ dB")).toBe(-Infinity);
    expect(format.parse("loud")).toBeNull();
  });

  test("frequency switches to kHz and parses the k suffix", () => {
    const format = formats.frequency({ locale: "en" });
    expect(format.format(55.25)).toBe("55.3 Hz");
    expect(format.format(440)).toBe("440 Hz");
    expect(format.format(1000)).toBe("1.00 kHz");
    expect(format.format(12_500)).toBe("12.5 kHz");
    expect(format.parse("1k")).toBe(1000);
    expect(format.parse("1.5 kHz")).toBe(1500);
    expect(format.parse("440hz")).toBe(440);
    expect(format.parse("3 ms")).toBeNull();
  });

  test("pan takes its letters from the application", () => {
    const english = formats.pan({ left: "L", right: "R", center: "C" });
    expect(english.format(-0.5)).toBe("50L");
    expect(english.format(0.004)).toBe("C");
    expect(english.format(1)).toBe("100R");
    expect(english.parse("25r")).toBe(0.25);
    expect(english.parse("-40")).toBe(-0.4);
    expect(english.parse("c")).toBe(0);

    const polish = formats.pan({ left: "L", right: "P", center: "Ś" });
    expect(polish.format(0.3)).toBe("30P");
    expect(polish.parse("30P")).toBe(0.3);
    expect(polish.parse("ś")).toBe(0);
  });

  test("time switches to seconds", () => {
    const format = formats.time({ locale: "en" });
    expect(format.format(4)).toBe("4.00 ms");
    expect(format.format(25)).toBe("25.0 ms");
    expect(format.format(250)).toBe("250 ms");
    expect(format.format(1500)).toBe("1.50 s");
    expect(format.parse("1.5 s")).toBe(1500);
    expect(format.parse("20")).toBe(20);
  });

  test("number with a unit accepts the value with or without it", () => {
    const format = formats.number({ locale: "en", digits: 2, unit: "BPM" });
    expect(format.format(120)).toBe("120.00 BPM");
    expect(format.parse("128 bpm")).toBe(128);
    expect(format.parse("128")).toBe(128);
    expect(format.parse("128 Hz")).toBeNull();
  });
});

describe("segments", () => {
  test("a number is its whole part and its decimals, with the locale's separator", () => {
    expect(segmentsOf(formats.number({ locale: "en", unit: "BPM" }), 120.5)).toEqual(["120", ".", "50", " BPM"]);
    expect(segmentsOf(formats.number({ locale: "pl" }), 1.5)).toEqual(["1", ",", "50"]);
    expect(segmentsOf(formats.number({ locale: "en", digits: 0 }), 7)).toEqual(["7"]);
  });

  test("a number's segments round as the number prints, and keep its sign", () => {
    expect(segmentsOf(formats.number({ locale: "en" }), 120.999)).toEqual(["121", ".", "00"]);
    expect(segmentsOf(formats.number({ locale: "en" }), -0.25)).toEqual(["-0", ".", "25"]);
  });

  test("a step of a field is the change of the value it stands for", () => {
    const [integer, , fraction] = formats.number({ digits: 2 }).segments!;
    expect(integer).toMatchObject({ name: "integer", step: 1 });
    expect(fraction).toMatchObject({ name: "fraction", step: 0.01, min: 0, max: 99 });
  });
});

describe("position", () => {
  const position = formats.position({ locale: "en" });

  test("shows beats as bars, beats and sixteenths, counted from 1", () => {
    expect(position.format(0)).toBe("1.1.1");
    expect(position.format(5.25)).toBe("2.2.2");
    expect(position.format(15.75)).toBe("4.4.4");
    expect(segmentsOf(position, 5.25)).toEqual(["2", ".", "2", ".", "2"]);
  });

  test("shows the division a position is in, as DAWs do", () => {
    expect(position.format(0.99)).toBe("1.1.4");
    // Floating-point noise just under a division counts as that division.
    expect(position.format(2.9999999999)).toBe("1.4.1");
  });

  test("follows the time signature", () => {
    const waltz = formats.position({ beatsPerBar: 3, divisions: 2 });
    expect(waltz.format(3.5)).toBe("2.1.2");
    expect(waltz.segments!.filter((segment) => segment.type === "field").map((field) => field.step)).toEqual([3, 1, 0.5]);
  });

  test("parses what it shows, and a bar alone as its start", () => {
    expect(position.parse("2.2.2")).toBe(5.25);
    expect(position.parse("12")).toBe(44);
    expect(position.parse("3 2")).toBe(9);
    expect(position.parse("1.x")).toBeNull();
    expect(position.parse(position.format(-5))).toBe(-5);
  });
});

describe("timecode", () => {
  const timecode = formats.timecode({ fps: 25, locale: "en" });

  test("shows seconds as hours, minutes, seconds and frames", () => {
    expect(timecode.format(3723.5)).toBe("01:02:03:12");
    expect(timecode.format(0.04)).toBe("00:00:00:01");
    expect(segmentsOf(timecode, 61)).toEqual(["00", ":", "01", ":", "01", ":", "00"]);
    expect(timecode.format(-1)).toBe("-00:00:01:00");
  });

  test("parses fields from the right, and digits alone two at a time", () => {
    expect(timecode.parse("01:02:03:12")).toBe(3723.48);
    expect(timecode.parse("3:12")).toBe(3.48);
    expect(timecode.parse("1500")).toBe(15);
    expect(timecode.parse("-00:00:01:00")).toBe(-1);
    expect(timecode.parse("1:2:3:4:5")).toBeNull();
  });

  test("needs a whole frame rate", () => {
    expect(() => formats.timecode({ fps: 29.97 })).toThrow(RangeError);
  });
});
