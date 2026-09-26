// Runs in Node, without a DOM: importing and server-rendering must not touch `window`.
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";

import { formats } from "../src/core/index.js";
import { Fader, Knob, Meter, NumberBox, Toggle, ToggleGroup } from "../src/react/index.js";

test("every component renders on the server", () => {
  const html = renderToString(
    <>
      <Knob.Root defaultValue={0.5} format={formats.percent({ locale: "en" })}>
        <Knob.Label>Mix</Knob.Label>
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
            <Fader.Thumb />
            <Fader.Tick value={0} />
          </Fader.Track>
        </Fader.Control>
      </Fader.Root>
      <NumberBox.Root min={20} max={999} defaultValue={120}>
        <NumberBox.Field />
      </NumberBox.Root>
      <Meter.Root>
        <Meter.Track>
          <Meter.Bar />
        </Meter.Track>
      </Meter.Root>
      <ToggleGroup multiple defaultValue={["a"]}>
        <Toggle value="a">A</Toggle>
        <Toggle value="b">B</Toggle>
      </ToggleGroup>
    </>,
  );
  expect(html).toContain('role="slider"');
  expect(html).toContain("50%");
  expect(html).toContain('role="spinbutton"');
  expect(html).toContain('role="meter"');
  expect(html).toContain('aria-pressed="true"');
});
