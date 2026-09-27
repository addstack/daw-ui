import { useEffect, useRef, useState } from "react";

import { type CurvePoint, type TimeGrid } from "../../../src/core/index.js";
import { Curve, Meter, Spectrum, useCurveEditing } from "../../../src/react/index.js";
import { FRAMES, TABLE_SIZE } from "../engine/params.js";
import type { Synth } from "../engine/synth.js";
import { frameOf } from "../engine/wavetables.js";
import { SHAPES } from "./presets.js";

// What the synth draws: the wavetable of an oscillator, an LFO's shape to edit, an envelope, and the output.

/** Runs `draw` once per animation frame while mounted. */
function useFrame(draw: () => void) {
  const latest = useRef(draw);
  latest.current = draw;
  useEffect(() => {
    let frame = requestAnimationFrame(function tick() {
      latest.current();
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, []);
}

/**
 * An oscillator's wavetable, as Serum draws it: the frames stacked in depth, and the frame the position (as
 * modulation moves it) reads, in front. Drawn again only when what it shows changes.
 */
export function WavetableView({ synth, osc }: { synth: Synth; osc: "a" | "b" }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const shown = useRef("");
  useFrame(() => {
    const element = canvas.current;
    if (!element) return;
    const table = synth.tables[synth.params[`${osc}.table`]!];
    const position = synth.modulated(`${osc}.position`);
    const on = synth.params[`${osc}.on`] === 1;
    const key = `${synth.params[`${osc}.table`]} ${position.toFixed(3)} ${on} ${element.clientWidth}`;
    if (!table || key === shown.current) return;
    shown.current = key;
    const ratio = window.devicePixelRatio || 1;
    const [width, height] = [element.clientWidth, element.clientHeight];
    element.width = width * ratio;
    element.height = height * ratio;
    const context = element.getContext("2d")!;
    context.scale(ratio, ratio);
    const depth = 36;
    const trace = (samples: Float32Array, shift: number, style: string, thickness: number) => {
      context.beginPath();
      for (let x = 0; x <= width - depth; x += 2) {
        const sample = samples[Math.floor((x / (width - depth)) * (TABLE_SIZE - 1))]!;
        const y = height / 2 - shift * 0.45 - sample * (height * 0.32);
        if (x === 0) context.moveTo(x + shift, y);
        else context.lineTo(x + shift, y);
      }
      context.strokeStyle = style;
      context.lineWidth = thickness;
      context.stroke();
    };
    for (let frame = 0; frame < FRAMES; frame += 3) trace(frameOf(table, frame), (frame / (FRAMES - 1)) * depth, "rgb(255 255 255 / 0.08)", 1);
    const at = position * (FRAMES - 1);
    trace(frameOf(table, Math.round(at)), (at / (FRAMES - 1)) * depth, on ? "rgb(88 196 255)" : "rgb(255 255 255 / 0.3)", 2);
  });
  return <canvas ref={canvas} className="wavetable" aria-hidden="true" />;
}

// Moves snap to sixteenths of the cycle, eighths when zoomed out.
const CYCLE_GRID: TimeGrid = { steps: [1 / 16, 1 / 8, 1 / 4, 1 / 2, 1], label: () => "" };

/** An LFO's shape over one cycle, to draw and bend as Serum's; the line shows where the LFO runs. */
export function LfoEditor({ synth, index, initial }: { synth: Synth; index: 0 | 1; initial: CurvePoint[] }) {
  const [points, setPoints] = useState(initial);
  const playhead = useRef<HTMLDivElement>(null);
  const editing = useCurveEditing({
    snap: { time: CYCLE_GRID },
    // The ends of the cycle stay at its ends.
    lock: (_index, point) => (point.at === 0 || point.at === 1 ? "time" : undefined),
    onPointsChange: (moved) => synth.setShape(index, moved),
    onGestureEnd: (kept) => {
      setPoints(kept);
      synth.setShape(index, kept);
    },
  });
  useFrame(() => playhead.current?.style.setProperty("--phase", String(synth.lfoPhase(index))));
  const choose = (shape: CurvePoint[]) => {
    setPoints(shape);
    synth.setShape(index, shape);
  };
  return (
    <div className="lfo">
      <div className="lfo-graph">
        <Curve.Root points={points} editing={editing} duration={1} aria-label={`LFO ${index + 1} shape`} className="lfo-curve">
          <Curve.Fill className="lfo-fill" />
          <Curve.Line thickness={1.5} className="lfo-line" />
          <Curve.Dots size={3} className="lfo-dots" />
          <Curve.Bend className="lfo-bend" />
          <Curve.Handle aria-label={`LFO ${index + 1} point`} className="lfo-handle" />
        </Curve.Root>
        <div ref={playhead} className="lfo-playhead" aria-hidden="true" />
      </div>
      <div className="lfo-shapes" role="group" aria-label={`LFO ${index + 1} shapes`}>
        {(Object.keys(SHAPES) as (keyof typeof SHAPES)[]).map((name) => (
          <button key={name} type="button" onClick={() => choose(SHAPES[name])}>
            {name}
          </button>
        ))}
      </div>
    </div>
  );
}

/** An envelope's shape from its four numbers: the times drawn on a log scale, so that short and long both show. */
export function EnvelopeGraph({ attack, decay, sustain, release }: { attack: number; decay: number; sustain: number; release: number }) {
  const span = (ms: number) => 8 + 42 * (Math.log10(ms + 1) / Math.log10(8001));
  const [a, d, r] = [span(attack), span(decay), span(release)];
  const hold = 30;
  const total = a + d + hold + r;
  const x = (value: number) => (value / total) * 100;
  const y = (level: number) => 38 - level * 34;
  const path = `M 0 ${y(0)} L ${x(a)} ${y(1)} L ${x(a + d)} ${y(sustain)} L ${x(a + d + hold)} ${y(sustain)} L 100 ${y(0)}`;
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="envelope-graph" aria-hidden="true">
      <path d={`${path} Z`} className="envelope-fill" />
      <path d={path} className="envelope-line" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** The output: its spectrum and its level. */
export function Output({ synth }: { synth: Synth }) {
  return (
    <div className="output">
      <Spectrum.Root read={() => synth.spectrum()} sampleRate={synth.sampleRate} floor={-100} ceiling={-10} tilt={3} aria-label="Output spectrum" className="spectrum">
        <Spectrum.Fill className="spectrum-fill" />
        <Spectrum.Line thickness={1} className="spectrum-line" />
      </Spectrum.Root>
      <Meter.Root read={() => synth.level()} min={-60} max={6} className="meter">
        <Meter.Track className="meter-track" aria-label="Output level">
          <Meter.Bar className="meter-bar" />
          <Meter.Peak className="meter-peak" />
        </Meter.Track>
      </Meter.Root>
    </div>
  );
}
