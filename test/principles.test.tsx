// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { clockGrid, createPeaks, formats } from "../src/core/index.js";
import { Fader, Knob, Meter, NumberBox, Timeline, Toggle, ToggleGroup, Waveform } from "../src/react/index.js";

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
      <Timeline.Root start={0} end={1} position={0.5}>
        <Timeline.Track>
          <Timeline.Region at={0.25} duration={0.5} />
        </Timeline.Track>
        <Waveform.Root peaks={createPeaks([new Float32Array(8)], 8)}>
          <Waveform.Shape />
          <Waveform.Progress />
        </Waveform.Root>
        <Timeline.Playhead />
      </Timeline.Root>
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

test("text the components show is not selectable, except a value being typed (section 5)", () => {
  render(
    <>
      <Knob.Root>
        <Knob.Label data-testid="knob label">a</Knob.Label>
        <Knob.Control />
        <Knob.Value data-testid="knob value" />
      </Knob.Root>
      <Fader.Root>
        <Fader.Label data-testid="fader label">b</Fader.Label>
        <Fader.Control>
          <Fader.Track>
            <Fader.Tick value={0.5} data-testid="fader tick">
              c
            </Fader.Tick>
          </Fader.Track>
        </Fader.Control>
        <Fader.Value data-testid="fader value" />
      </Fader.Root>
      <NumberBox.Root>
        <NumberBox.Label data-testid="number box label">d</NumberBox.Label>
        <NumberBox.Field data-testid="number box field" />
      </NumberBox.Root>
      <NumberBox.Root>
        <NumberBox.Segments labels={{}} data-testid="number box segments" />
      </NumberBox.Root>
      <Meter.Root>
        <Meter.Label data-testid="meter label">e</Meter.Label>
        <Meter.Clip data-testid="meter clip">f</Meter.Clip>
      </Meter.Root>
      <Toggle data-testid="toggle">g</Toggle>
      <Timeline.Root start={0} end={1}>
        <Timeline.Ruler grid={clockGrid()} data-testid="ruler" />
      </Timeline.Root>
    </>,
  );
  const parts = [
    "knob label",
    "knob value",
    "fader label",
    "fader tick",
    "fader value",
    "number box label",
    "number box field",
    "number box segments",
    "meter label",
    "meter clip",
    "toggle",
    "ruler",
  ];
  expect(parts.filter((part) => screen.getByTestId(part).style.userSelect !== "none")).toEqual([]);

  // The text a user types stays theirs to select.
  fireEvent.doubleClick(screen.getByTestId("number box field"));
  expect(screen.getByRole("textbox").style.userSelect).toBe("");
});
