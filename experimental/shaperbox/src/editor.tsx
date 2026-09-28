import { useRef, useState, type CSSProperties, type KeyboardEvent } from "react";

import { formats, scales, type CurvePoint, type TimeGrid, type ValueFormat } from "../../../src/core/index.js";
import { Curve, Slider, Spectrum, Toggle, ToggleGroup, useCurveEditing } from "../../../src/react/index.js";
import { SLICES, type Kind } from "../engine/params.js";
import { BAND_NAMES, COLORS, NAMES, ParamToggle, useBox, useFrame } from "./controls.js";
import type { Box } from "../engine/box.js";
import { double, invert, reverse, wavesFor } from "./waves.js";

// The wave editor, as ShaperBox's: the wave over one cycle, on the audio that went through it in its last cycle
// (grey before the shaper, in colour after it), where the wave is now, and what to do to it.

export const GRIDS = [4, 8, 16, 32] as const;

/** Lines every `1 / grid` of the cycle, and coarser ones when those are too close to snap to. */
function gridOf(grid: number): TimeGrid {
  const steps: number[] = [];
  for (let step = 1 / grid; step <= 1; step *= 2) steps.push(step);
  return { steps, label: () => "" };
}

const cycle = formats.percent();
const percent = formats.percent();

/** What the top and the bottom of each wave mean. */
const AXES: Record<Kind, [string, string]> = {
  volume: ["100%", "0%"],
  filter: ["", ""],
  time: ["Cycle end", "Cycle start"],
  pan: ["Left", "Right"],
  width: ["Wide", "Mono"],
  noise: ["Loud", "None"],
  crush: ["Crushed", "Clean"],
  drive: ["Driven", "Clean"],
  liquid: ["High", "Low"],
};

/** The lowest and highest cutoff the filter's wave moves between, beside the wave. */
function CutoffRange() {
  const box = useBox();
  return (
    <Slider.Root
      orientation="vertical"
      min={20}
      max={20_000}
      scale={scales.log}
      format={formats.frequency()}
      defaultValue={[box.params["filter.low"]!, box.params["filter.high"]!]}
      onValueChange={([low, high]) => {
        box.setParam("filter.low", low!);
        box.setParam("filter.high", high!);
      }}
      className="cutoff"
    >
      <Slider.Label className="sr-only">Cutoff range</Slider.Label>
      <Slider.Control className="cutoff-control">
        <Slider.Track className="cutoff-track">
          <Slider.Range className="cutoff-range" />
          {[0, 1].map((index) => (
            <Slider.Thumb key={index} index={index} aria-label={index === 0 ? "Lowest cutoff" : "Highest cutoff"} className="cutoff-thumb">
              <Slider.Value index={index} className="cutoff-value" />
            </Slider.Thumb>
          ))}
        </Slider.Track>
      </Slider.Control>
    </Slider.Root>
  );
}

/** The grid, and the audio of the wave's last cycle, as a peak per slice: before the shaper, and after it. */
function drawAudio(canvas: HTMLCanvasElement, box: Box, grid: number, color: string, time: boolean) {
  const ratio = window.devicePixelRatio || 1;
  const [width, height] = [canvas.clientWidth, canvas.clientHeight];
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  const context = canvas.getContext("2d")!;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  const line = (x1: number, y1: number, x2: number, y2: number, style: string) => {
    context.strokeStyle = style;
    context.beginPath();
    context.moveTo(x1, y1);
    context.lineTo(x2, y2);
    context.stroke();
  };
  context.lineWidth = 1;
  for (let i = 1; i < grid; i++) {
    const x = Math.round((i / grid) * width) + 0.5;
    line(x, 0, x, height, i % Math.max(1, grid / 4) === 0 ? "rgb(255 255 255 / 0.13)" : "rgb(255 255 255 / 0.05)");
  }
  for (const level of [0.25, 0.5, 0.75]) {
    const y = Math.round(level * height) + 0.5;
    line(0, y, width, y, "rgb(255 255 255 / 0.05)");
  }

  const report = box.report;
  if (report) {
    const slice = width / SLICES;
    const bar = (peak: number, s: number) => {
      const size = Math.min(1, peak) * height * 0.92;
      context.fillRect(s * slice, (height - size) / 2, slice + 0.6, size);
    };
    context.fillStyle = "rgb(255 255 255 / 0.11)";
    report.input.forEach(bar);
    context.fillStyle = color;
    context.globalAlpha = 0.32;
    report.output.forEach(bar);
    context.globalAlpha = 1;
  }

  if (time) {
    // Where the audio plays as it is.
    context.setLineDash([4, 4]);
    line(0, height, width, 0, "rgb(255 255 255 / 0.25)");
    context.setLineDash([]);
  }
}

export function WaveEditor({ kind, band, grid, onGrid }: { kind: Kind; band: number; grid: number; onGrid: (grid: number) => void }) {
  const box = useBox();
  const [points, setPoints] = useState(() => box.waves[kind][band]!);
  const canvas = useRef<HTMLCanvasElement>(null);
  const playhead = useRef<HTMLDivElement>(null);
  const now = useRef<HTMLDivElement>(null);
  const drawn = useRef<{ report: unknown; width: number; grid: number }>({ report: null, width: 0, grid: 0 });
  const color = COLORS[kind];
  const name = band === 0 ? NAMES[kind] : `${NAMES[kind]}, ${BAND_NAMES[band - 1]!.toLowerCase()} band`;

  const keep = (next: CurvePoint[]) => {
    box.keepWave(kind, band, next);
    setPoints(next);
  };
  const step = (back: boolean) => {
    const to = box.step(kind, band, back);
    if (to) setPoints(to);
  };

  const editing = useCurveEditing({
    snap: { time: gridOf(grid) },
    // The ends of the cycle stay at its ends.
    lock: (_index, point) => (point.at === 0 || point.at === 1 ? "time" : undefined),
    format: { time: cycle as ValueFormat, value: percent },
    onPointsChange: (moved) => box.preview(kind, band, moved),
    onGestureEnd: keep,
  });

  useFrame(() => {
    const element = canvas.current;
    if (element) {
      const { report } = box;
      const last = drawn.current;
      if (report !== last.report || element.clientWidth !== last.width || grid !== last.grid) {
        drawAudio(element, box, grid, color, kind === "time");
        drawn.current = { report, width: element.clientWidth, grid };
      }
    }
    const phase = box.phase(kind);
    const value = box.report?.value ?? 0;
    playhead.current?.style.setProperty("left", `${phase * 100}%`);
    now.current?.style.setProperty("left", `${phase * 100}%`);
    now.current?.style.setProperty("top", `${(1 - value) * 100}%`);
  });

  const onKeyDown = (event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey)) return;
    const key = event.key.toLowerCase();
    if (key === "z" || key === "y") {
      event.preventDefault();
      step(key === "z" && !event.shiftKey);
    }
  };

  const [top, bottom] = AXES[kind];
  return (
    <div className="editor" style={{ "--color": color } as CSSProperties} onKeyDown={onKeyDown}>
      <div className="toolbar" role="toolbar" aria-label={`${name} wave`}>
        <div className="presets">
          {Object.entries(wavesFor(kind)).map(([label, wave]) => (
            <button key={label} type="button" onClick={() => keep(wave)}>
              {label}
            </button>
          ))}
        </div>
        <div className="tools">
          <button type="button" onClick={() => keep(invert(points))} title="Upside down">
            Invert
          </button>
          <button type="button" onClick={() => keep(reverse(points))} title="Back to front">
            Reverse
          </button>
          <button type="button" onClick={() => keep(double(points, kind))} title="Twice in a cycle">
            ×2
          </button>
          <button type="button" onClick={() => step(true)} aria-label="Undo" title="Undo (Ctrl+Z)">
            ↶
          </button>
          <button type="button" onClick={() => step(false)} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">
            ↷
          </button>
          <ToggleGroup aria-label="Grid" value={[String(grid)]} onValueChange={(value) => value[0] && onGrid(Number(value[0]))} className="segmented">
            {GRIDS.map((one) => (
              <Toggle key={one} value={String(one)} aria-label={`Grid of 1/${one} cycle`} className="segment">
                {`1/${one}`}
              </Toggle>
            ))}
          </ToggleGroup>
        </div>
      </div>
      <div className="graph">
        {kind === "filter" && <CutoffRange />}
        <div className="graph-area">
          <canvas ref={canvas} className="graph-audio" aria-hidden="true" />
          <Curve.Root points={points} editing={editing} duration={1} aria-label={`${name} wave`} className="wave">
            <Curve.Fill className="wave-fill" />
            <Curve.Line thickness={2} className="wave-line" />
            <Curve.Dots size={4} className="wave-dots" />
            <Curve.Bend className="wave-bend" />
            <Curve.Handle aria-label={`${name} point`} className="wave-handle" />
          </Curve.Root>
          <div ref={playhead} className="playhead" aria-hidden="true" />
          <div ref={now} className="now" aria-hidden="true" />
          {top && <span className="axis top">{top}</span>}
          {bottom && <span className="axis bottom">{bottom}</span>}
        </div>
      </div>
      <p className="hint">Drag the points; double-click to add or remove one; drag between two to bend. Shift moves off the grid.</p>
    </div>
  );
}

/** The bands a multiband shaper splits the audio into, over the spectrum of what comes in; a band picks its wave. */
export function Crossover({ kind, band, onBand }: { kind: Kind; band: number; onBand: (band: number) => void }) {
  const box = useBox();
  return (
    <Slider.Root
      min={20}
      max={20_000}
      scale={scales.log}
      format={formats.frequency()}
      defaultValue={[box.params[`${kind}.split1`]!, box.params[`${kind}.split2`]!]}
      onValueChange={([low, high]) => {
        box.setParam(`${kind}.split1`, low!);
        box.setParam(`${kind}.split2`, high!);
      }}
      className="crossover"
    >
      <Slider.Label className="sr-only">{`${NAMES[kind]} crossover`}</Slider.Label>
      <div className="crossover-view">
        <Spectrum.Root
          read={() => box.spectrum("input")}
          sampleRate={box.sampleRate}
          floor={-100}
          ceiling={-10}
          tilt={3}
          aria-label="Input spectrum"
          style={{ position: "absolute", inset: 0 }}
        >
          <Spectrum.Fill className="crossover-fill" />
          <Spectrum.Line thickness={1} className="crossover-line" />
        </Spectrum.Root>
        {BAND_NAMES.map((bandName, index) => (
          <Slider.Band
            key={bandName}
            index={index}
            className={index === 0 ? "crossover-band first" : "crossover-band"}
            data-selected={band === index + 1 || undefined}
            onClick={() => onBand(index + 1)}
          >
            <span className="crossover-name">{bandName}</span>
            <ParamToggle id={`${kind}.band${index + 1}`} label={`Shape the ${bandName.toLowerCase()} band`} className="band-power">
              ON
            </ParamToggle>
          </Slider.Band>
        ))}
      </div>
      <Slider.Control className="crossover-control">
        <Slider.Track className="crossover-track">
          {[0, 1].map((index) => (
            <Slider.Thumb key={index} index={index} aria-label={index === 0 ? "Low to mid" : "Mid to high"} className="crossover-thumb">
              <Slider.Value index={index} className="crossover-value" />
            </Slider.Thumb>
          ))}
        </Slider.Track>
      </Slider.Control>
    </Slider.Root>
  );
}
