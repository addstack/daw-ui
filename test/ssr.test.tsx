// Runs in Node, without a DOM: importing and server-rendering must not touch `window`.
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";

import { createPeaks, formats } from "../src/core/index.js";
import { Curve, Fader, Keys, Knob, Meter, BarGraph, Notes, NumberBox, Region, Slider, Spectrum, Timeline, Toggle, ToggleGroup, Tuner, Waveform, XYPad } from "../src/react/index.js";

test("every component renders on the server", () => {
  const html = renderToString(
    <>
      <Knob.Root defaultValue={0.5} format={formats.percent({ locale: "en" })}>
        <Knob.Label>Mix</Knob.Label>
        <Knob.Control>
          <svg viewBox="0 0 100 100">
            <Knob.Track />
            <Knob.Range />
            <Knob.ModulationRange depth={0.25} />
            <Knob.Pointer />
          </svg>
        </Knob.Control>
        <Knob.ModulationDepth defaultValue={0.25} aria-label="LFO" />
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
      <NumberBox.Root min={0} max={400} defaultValue={5.25} format={formats.position({ locale: "en" })}>
        <NumberBox.Segments labels={{}} />
      </NumberBox.Root>
      <Meter.Root>
        <Meter.Track>
          <Meter.Bar />
        </Meter.Track>
      </Meter.Root>
      <Timeline.Root start={0} end={1} position={0.5}>
        <div>
          <Region.Root at={0.25} duration={0.5}>
            <Region.Header>
              <Region.Label>1</Region.Label>
            </Region.Header>
            <Region.Content>
              <Notes.Root notes={[{ at: 0, duration: 0.25, pitch: 60 }]}>
                <Notes.Shape />
                <Notes.Progress />
              </Notes.Root>
              <Curve.Root points={[{ at: 0, value: 0 }, { at: 0.5, value: 1, shape: 0.5 }]}>
                <Curve.Fill />
                <Curve.Line />
              </Curve.Root>
            </Region.Content>
          </Region.Root>
        </div>
        <Waveform.Root peaks={createPeaks([new Float32Array(8)], 8)}>
          <Waveform.Shape />
          <Waveform.Progress />
        </Waveform.Root>
        <Timeline.Playhead />
      </Timeline.Root>
      <XYPad.Root defaultValue={[[0.5, 0.5], [0.2, 0.8]]}>
        <XYPad.Control>
          <XYPad.Thumb index={0} />
          <XYPad.Thumb index={1} />
        </XYPad.Control>
        <XYPad.Value />
      </XYPad.Root>
      <Slider.Root defaultValue={[0.25, 0.75]}>
        <Slider.Track>
          <Slider.Range />
          <Slider.Thumb index={0} aria-label="Low" />
          <Slider.Thumb index={1} aria-label="High" />
        </Slider.Track>
      </Slider.Root>
      <Spectrum.Root bins={new Float32Array(16).fill(-40)} sampleRate={48_000} aria-label="Spectrum">
        <Spectrum.Line />
      </Spectrum.Root>
      <Tuner.Root frequency={440} format={formats.pitch({ names: ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"] })}>
        <Tuner.Note />
        <Tuner.Indicator />
      </Tuner.Root>
      <BarGraph.Root defaultValue={[0.25, 1]}>
        <BarGraph.Control>
          <BarGraph.Item index={0}>
            <BarGraph.Range />
          </BarGraph.Item>
          <BarGraph.Item index={1} />
        </BarGraph.Control>
      </BarGraph.Root>
      <Keys.Root range={[60, 62]} held={[61]} format={formats.pitch({ names: ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"] })}>
        <Keys.Key note={60} />
        <Keys.Key note={61} />
        <Keys.Key note={62} />
      </Keys.Root>
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
  expect(html).toContain('role="group"');
  expect(html).toContain('data-segment="beats"');
  expect(html).toContain('aria-pressed="true"');
  expect(html).toContain('role="img"');
  // A modulation range with its depth given is drawn before any script runs; so is its handle's value.
  expect(html).toMatch(/<path d="M 50 4 A 46 46 0 0 1 [^"]+" fill="none"/);
  expect(html).toContain('aria-valuetext="25%"');
  // A tuner given a frequency shows its reading before any script runs.
  expect(html).toMatch(/data-in-tune=""[^>]*>.*A4<\/output>/);
  expect(html).toContain("--tuner-class:9");
  // A spectrum renders its canvas on the server and draws in the browser.
  expect(html).toMatch(/<div role="img"[^>]*aria-label="Spectrum"><canvas aria-hidden="true"/);
  // A slider's thumbs and range are placed, and its values set as variables, before any script runs.
  expect(html).toContain("inset-inline-start:25%;width:50%");
  expect(html).toContain("--slider-value-1:0.75");
  // The bars of a bar graph are placed and filled before any script runs.
  expect(html).toContain("inset-inline-start:50%;width:50%");
  expect(html).toContain("bottom:0%;height:25%");
  // Keys are placed, named and held down before any script runs.
  expect(html).toContain('aria-label="C♯4"');
  expect(html).toMatch(/aria-label="C♯4"[^>]*data-held=""/);
  // The playhead is rendered where it is, before any script runs.
  expect(html).toContain("translate:calc((0.5 - var(--timeline-start)) * var(--timeline-scale)) 0");
});
