import { formats, scales } from "../../src/core/index.js";
import { Slider } from "../../src/react/index.js";
import { log } from "./harness.js";

// Sliders for the e2e tests; changes go to the harness, without rendering.
// - "Crossover": 20 Hz … 20 kHz on a logarithmic track 300 px long, splits at 200 Hz and 2 kHz, with its three
//   bands over a 60 px graph above the track; again right to left.
// - "Vertical": 0 … 1 on a track 200 px tall, thumbs at 0.25 and 0.75.

function Crossover({ name }: { name: string }) {
  return (
    <Slider.Root
      min={20}
      max={20_000}
      scale={scales.log}
      format={formats.frequency({ locale: "en" })}
      defaultValue={[200, 2000]}
      onValueChange={(values, { reason, thumb }) => log({ source: name, type: "change", value: values, reason, delta: thumb })}
      onGestureStart={() => log({ source: name, type: "start" })}
      onGestureEnd={() => log({ source: name, type: "end" })}
    >
      <Slider.Label>{name}</Slider.Label>
      <div className="slider-graph" data-testid={`${name} graph`}>
        {["Low", "Mid", "High"].map((band, index) => (
          <Slider.Band key={band} index={index} className="slider-band" data-testid={`${name} ${band}`}>
            {band}
          </Slider.Band>
        ))}
      </div>
      <Slider.Control className="slider-control" data-testid={`${name} control`}>
        <Slider.Track className="slider-track" data-testid={`${name} track`}>
          <Slider.Range className="slider-range" />
          {[0, 1].map((index) => (
            <Slider.Thumb key={index} index={index} aria-label={`${name} ${index + 1}`} className="slider-thumb">
              <Slider.Value index={index} className="slider-value" />
            </Slider.Thumb>
          ))}
        </Slider.Track>
      </Slider.Control>
    </Slider.Root>
  );
}

export function SliderView() {
  return (
    <main>
      <h1>daw-ui slider</h1>
      <Crossover name="Crossover" />
      <div dir="rtl">
        <Crossover name="RTL crossover" />
      </div>
      <Slider.Root orientation="vertical" defaultValue={[0.25, 0.75]} onValueChange={(values) => log({ source: "vertical", type: "change", value: values })}>
        <Slider.Control className="slider-control vertical">
          <Slider.Track className="slider-track vertical" data-testid="vertical track">
            <Slider.Thumb index={0} aria-label="Vertical 1" className="slider-thumb" />
            <Slider.Thumb index={1} aria-label="Vertical 2" className="slider-thumb" />
          </Slider.Track>
        </Slider.Control>
      </Slider.Root>
    </main>
  );
}
