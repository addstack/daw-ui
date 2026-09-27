import { MultiSlider } from "../../src/react/index.js";
import { log } from "./harness.js";

// Multi-sliders for the e2e and perf tests; changes go to the harness, without rendering.
// - "Velocity": 16 steps of 0 … 127 on a control 320 × 100 px, 20 px each; again right to left.
// - "Chord velocity": the velocities of notes placed by the application: a chord of three at 40 px, a note at 200 px.
// - "Steps": 64 steps across 640 px, for the perf test.

function Steps({ name, count, className }: { name: string; count: number; className: string }) {
  return (
    <MultiSlider.Root
      min={0}
      max={127}
      step={1}
      defaultValue={Array.from({ length: count }, () => 0)}
      onValueChange={(values, { reason, indexes }) => log({ source: name, type: "change", value: values, reason, delta: indexes.length })}
      onGestureStart={() => log({ source: name, type: "start" })}
      onGestureEnd={() => log({ source: name, type: "end" })}
    >
      <MultiSlider.Label>{name}</MultiSlider.Label>
      <MultiSlider.Control className={className} data-testid={`${name} control`}>
        {Array.from({ length: count }, (_, index) => (
          <MultiSlider.Item key={index} index={index} aria-label={`${name} ${index + 1}`}>
            <MultiSlider.Range className="multi-slider-range" />
          </MultiSlider.Item>
        ))}
      </MultiSlider.Control>
    </MultiSlider.Root>
  );
}

// Seconds of the notes, on a lane 4 s across 320 px.
const notes = [0.5, 0.5, 0.5, 2.5];

export function MultiSliderView() {
  return (
    <main>
      <h1>daw-ui multi-slider</h1>
      <Steps name="Velocity" count={16} className="multi-slider" />
      <div dir="rtl">
        <Steps name="RTL velocity" count={16} className="multi-slider" />
      </div>
      <MultiSlider.Root
        min={0}
        max={127}
        step={1}
        defaultValue={[100, 100, 100, 100]}
        onValueChange={(values) => log({ source: "chord", type: "change", value: values })}
      >
        <MultiSlider.Label>Chord velocity</MultiSlider.Label>
        <MultiSlider.Control className="multi-slider" data-testid="chord control">
          {notes.map((at, index) => (
            // Placed at the note's time, 4 px wide, instead of side by side.
            <MultiSlider.Item key={index} index={index} aria-label={`Note ${index + 1}`} style={{ insetInlineStart: `${(at / 4) * 100}%`, width: 4 }}>
              <MultiSlider.Range className="multi-slider-range" />
            </MultiSlider.Item>
          ))}
        </MultiSlider.Control>
      </MultiSlider.Root>
      <Steps name="Steps" count={64} className="multi-slider wide" />
    </main>
  );
}
