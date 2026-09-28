import { formats } from "../../../src/core/index.js";
import { Meter, NumberBox, Toggle } from "../../../src/react/index.js";
import { MASTER_ID } from "../engine/host.js";
import type { Project } from "../engine/project.js";
import { host, position, useTransport } from "./state.js";

// The transport: play, stop, loop and metronome, where the song is in bars, beats and sixteenths (it counts on
// its own while it plays, and takes a position typed or dragged), the tempo, undo, and the master's level.

const bpm = formats.number({ digits: 2, unit: "BPM" });

export function Transport({ project }: { project: Project }) {
  const { playing, metronome } = useTransport();
  return (
    <header className="transport">
      <h1>
        daw-ui <span>experimental DAW</span>
      </h1>
      <div className="transport-buttons">
        <Toggle pressed={playing} onPressedChange={(pressed) => (pressed ? void host.play() : host.stop())} aria-label="Play" className="play" title="Play or stop (Space)">
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d={playing ? "M2 1.5h2v7H2zM6 1.5h2v7H6z" : "M2.5 1.5l6 3.5-6 3.5z"} />
          </svg>
        </Toggle>
        <button type="button" className="stop" aria-label="Stop" title="Stop; again, back to the start" onClick={() => host.stop()}>
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2 2h6v6H2z" />
          </svg>
        </button>
        <Toggle pressed={project.loop.on} onPressedChange={(on) => host.setLoop({ ...project.loop, on })} aria-label="Loop" className="switch" title="Loop between the braces over the ruler">
          Loop
        </Toggle>
        <Toggle pressed={metronome} onPressedChange={(on) => host.setMetronome(on)} aria-label="Metronome" className="switch">
          Click
        </Toggle>
      </div>
      <NumberBox.Root min={0} max={999 * 4} read={() => host.position()} format={position} onValueChange={(beat) => host.seek(beat)} className="number">
        <NumberBox.Label className="field-label">Position</NumberBox.Label>
        <NumberBox.Segments labels={{ bars: "Bar", beats: "Beat", divisions: "Sixteenth" }} className="field-box segments">
          {(part) => <NumberBox.Segment segment={part} className="segment-field" />}
        </NumberBox.Segments>
      </NumberBox.Root>
      <NumberBox.Root key={project.bpm} min={40} max={240} step={0.01} defaultValue={project.bpm} format={bpm} onGestureEnd={(value) => host.setBpm(value)} className="number">
        <NumberBox.Label className="field-label">Tempo</NumberBox.Label>
        <NumberBox.Segments labels={{ integer: "Beats per minute", fraction: "Hundredths" }} className="field-box segments">
          {(part) => <NumberBox.Segment segment={part} className="segment-field" />}
        </NumberBox.Segments>
      </NumberBox.Root>
      <div className="transport-buttons">
        <button type="button" onClick={() => host.undo()} disabled={!host.canUndo} title="Undo (Ctrl or Cmd+Z)">
          Undo
        </button>
        <button type="button" onClick={() => host.redo()} disabled={!host.canRedo} title="Redo (Ctrl or Cmd+Shift+Z)">
          Redo
        </button>
      </div>
      <div className="master-meter">
        <span className="field-label">Master</span>
        {(["left", "right"] as const).map((side, index) => (
          <Meter.Root key={side} read={() => host.levels(MASTER_ID)[index]!} min={-60} max={6} orientation="horizontal">
            <Meter.Track aria-label={`Master, ${side}`} className="meter-track horizontal">
              <Meter.Bar className="meter-bar horizontal" />
              <Meter.Peak className="meter-peak horizontal" />
            </Meter.Track>
          </Meter.Root>
        ))}
      </div>
    </header>
  );
}
