// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { formats } from "../src/core/index.js";
import { Fader, Knob, Meter, NumberBox, Toggle, ToggleGroup } from "../src/react/index.js";

afterEach(cleanup);

// docs/principles.md: the library hard-codes no English. Everything it shows or
// announces on its own is numbers, unit symbols that read the same in every
// language, and signs.

const ALLOWED_SYMBOLS = /\b(kHz|Hz|dB|ms|s)\b|[−∞%+\-.,\d\s ]/g;
const ANNOUNCED_ATTRIBUTES = [
  "aria-label",
  "aria-valuetext",
  "aria-roledescription",
  "aria-description",
  "title",
  "placeholder",
  "alt",
];

function wordsIn(container: HTMLElement): string[] {
  const texts = [container.textContent ?? ""];
  for (const element of container.querySelectorAll("*")) {
    for (const name of ANNOUNCED_ATTRIBUTES) {
      const value = element.getAttribute(name);
      if (value) texts.push(value);
    }
  }
  return texts.map((text) => text.replace(ALLOWED_SYMBOLS, "")).filter((rest) => /\p{L}/u.test(rest));
}

function EveryComponent() {
  return (
    <>
      <Knob.Root>
        <Knob.Control>
          <svg viewBox="0 0 100 100">
            <Knob.Track />
            <Knob.Range />
            <Knob.Pointer />
          </svg>
        </Knob.Control>
        <Knob.Value />
      </Knob.Root>
      <Fader.Root min={-60} max={6}>
        <Fader.Control>
          <Fader.Track>
            <Fader.Range />
            <Fader.Thumb />
          </Fader.Track>
        </Fader.Control>
        <Fader.Value />
      </Fader.Root>
      <NumberBox.Root min={20} max={999}>
        <NumberBox.Field />
      </NumberBox.Root>
      {/* Only the application names the fields; with no labels, nothing is named. */}
      <NumberBox.Root min={0} max={3600} format={formats.timecode({ fps: 25 })}>
        <NumberBox.Segments labels={{}} />
      </NumberBox.Root>
      <NumberBox.Root min={20} max={999} format={formats.number({ unit: "%" })}>
        <NumberBox.Segments labels={{}} />
      </NumberBox.Root>
      <Meter.Root>
        <Meter.Track>
          <Meter.Bar />
          <Meter.Peak />
        </Meter.Track>
        <Meter.Clip />
      </Meter.Root>
      <ToggleGroup paint exclusive="click">
        <Toggle />
        <Toggle behavior="momentary" />
        <Toggle behavior="hybrid" />
      </ToggleGroup>
    </>
  );
}

test("no component adds words of its own, in any state", () => {
  const { container } = render(<EveryComponent />);
  expect(wordsIn(container)).toEqual([]);

  // Editing a number box shows an input; it has no placeholder or label of its own either.
  fireEvent.doubleClick(container.querySelector("[role='spinbutton']")!);
  expect(wordsIn(container)).toEqual([]);
});

test("the built-in unit symbols are the only letters, e.g. in a decibel readout", () => {
  const { container } = render(
    <Fader.Root min={-Infinity} max={6} defaultValue={-Infinity} format={formats.decibel()}>
      <Fader.Control />
      <Fader.Value />
    </Fader.Root>,
  );
  expect(container.textContent).toMatch(/dB$/);
  expect(wordsIn(container)).toEqual([]);
});
