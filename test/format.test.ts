import { describe, expect, test } from "vitest";

import { formats } from "../src/core/index.js";

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
