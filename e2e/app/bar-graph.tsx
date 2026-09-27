import { BarGraph } from "../../src/react/index.js";
import { log } from "./harness.js";

// Bar graphs for the e2e and perf tests; changes go to the harness, without rendering.
// - "Velocity": 16 steps of 0 … 127 on a control 320 × 100 px, 20 px each; again right to left.
// - "Chord velocity": the velocities of notes placed by the application: a chord of three at 40 px, a note at 200 px.
// - "Steps": 64 steps across 640 px, for the perf test.

function Steps({ name, count, className }: { name: string; count: number; className: string }) {
  return (
    <BarGraph.Root
      min={0}
      max={127}
      step={1}
      defaultValue={Array.from({ length: count }, () => 0)}
      onValueChange={(values, { reason, indexes }) => log({ source: name, type: "change", value: values, reason, delta: indexes.length })}
      onGestureStart={() => log({ source: name, type: "start" })}
      onGestureEnd={() => log({ source: name, type: "end" })}
    >
      <BarGraph.Label>{name}</BarGraph.Label>
      <BarGraph.Control className={className} data-testid={`${name} control`}>
        {Array.from({ length: count }, (_, index) => (
          <BarGraph.Item key={index} index={index} aria-label={`${name} ${index + 1}`}>
            <BarGraph.Range className="bar-graph-range" />
          </BarGraph.Item>
        ))}
      </BarGraph.Control>
    </BarGraph.Root>
  );
}

// Seconds of the notes, on a lane 4 s across 320 px.
const notes = [0.5, 0.5, 0.5, 2.5];

export function BarGraphView() {
  return (
    <main>
      <h1>daw-ui bar-graph</h1>
      <Steps name="Velocity" count={16} className="bar-graph" />
      <div dir="rtl">
        <Steps name="RTL velocity" count={16} className="bar-graph" />
      </div>
      <BarGraph.Root
        min={0}
        max={127}
        step={1}
        defaultValue={[100, 100, 100, 100]}
        onValueChange={(values) => log({ source: "chord", type: "change", value: values })}
      >
        <BarGraph.Label>Chord velocity</BarGraph.Label>
        <BarGraph.Control className="bar-graph" data-testid="chord control">
          {notes.map((at, index) => (
            // Placed at the note's time, 4 px wide, instead of side by side.
            <BarGraph.Item key={index} index={index} aria-label={`Note ${index + 1}`} style={{ insetInlineStart: `${(at / 4) * 100}%`, width: 4 }}>
              <BarGraph.Range className="bar-graph-range" />
            </BarGraph.Item>
          ))}
        </BarGraph.Control>
      </BarGraph.Root>
      <Steps name="Steps" count={64} className="bar-graph wide" />
    </main>
  );
}
