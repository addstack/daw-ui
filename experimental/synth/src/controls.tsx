import { createContext, useContext, type DragEvent, type ReactNode } from "react";

import { formats, scales, type ValueFormat } from "../../../src/core/index.js";
import { Knob, Toggle } from "../../../src/react/index.js";
import { DESTINATIONS, PARAMS, type Destination, type Routing, type Source } from "../engine/params.js";
import type { Synth } from "../engine/synth.js";

// The synth's own controls, on the library's parts: a knob for any parameter, which takes modulation dropped on it
// as Serum's do, and the modulation sources to drag.

export type SynthContextValue = {
  synth: Synth;
  routings: Routing[];
  route: (source: Source, destination: Destination) => void;
  unroute: (source: Source, destination: Destination) => void;
  /** Changes an amount on the audio thread at once; `keep` keeps it in the page's state too. */
  setAmount: (source: Source, destination: Destination, amount: number, keep: boolean) => void;
};

export const SynthContext = createContext<SynthContextValue | null>(null);

export function useSynth(): SynthContextValue {
  const context = useContext(SynthContext);
  if (!context) throw new Error("Place synth controls inside SynthContext.");
  return context;
}

export const SOURCE_LABELS: Record<Source, string> = {
  env2: "ENV 2",
  env3: "ENV 3",
  lfo1: "LFO 1",
  lfo2: "LFO 2",
  velocity: "VEL",
  note: "NOTE",
  macro1: "MACRO 1",
  macro2: "MACRO 2",
};

export const DESTINATION_LABELS: Record<Destination, string> = {
  "a.position": "A · WT Pos",
  "a.level": "A · Level",
  "a.pan": "A · Pan",
  "a.fine": "A · Fine",
  "a.detune": "A · Detune",
  "b.position": "B · WT Pos",
  "b.level": "B · Level",
  "b.pan": "B · Pan",
  "b.fine": "B · Fine",
  "b.detune": "B · Detune",
  "sub.level": "Sub · Level",
  "noise.level": "Noise · Level",
  "filter.cutoff": "Filter · Cutoff",
  "filter.resonance": "Filter · Res",
  "filter.drive": "Filter · Drive",
  "filter.mix": "Filter · Mix",
};

const percent = formats.percent();
const whole = formats.number({ digits: 0 });

/** How a parameter's value reads, by what it is. */
export function formatFor(id: string): ValueFormat {
  if (/\.(attack|decay|release)$/.test(id) || id === "delay.time") return formats.time();
  if (id === "filter.cutoff") return formats.frequency();
  if (id.endsWith(".pan")) return formats.pan({ left: "L", right: "R", center: "C" });
  if (id.endsWith(".fine")) return formats.number({ digits: 0, unit: "ct" });
  if (/\.(octave|semi|unison)$/.test(id)) return whole;
  if (id.endsWith(".rate")) return formats.number({ digits: 2, unit: "Hz" });
  if (id === "reverb.size") return formats.number({ digits: 1, unit: "s" });
  if (id === "master.volume") return formats.decibel();
  return percent;
}

const isDestination = (id: string): id is Destination => (DESTINATIONS as readonly string[]).includes(id);
const SOURCE_TYPE = "application/x-synth-source";

/**
 * A knob for the parameter `id`, on its range. Drop a modulation source on it and it is modulated: a ring shows the
 * range the source moves it over, a handle beside it sets how far, and an arc shows where it is now.
 */
export function ParamKnob({ id, label, small, onChange }: { id: string; label: string; small?: boolean; onChange?: (value: number) => void }) {
  const { synth, routings, route, setAmount } = useSynth();
  const spec = PARAMS[id]!;
  const modulatable = isDestination(id);
  const mine = modulatable ? routings.filter((routing) => routing.destination === id) : [];

  const accept = (event: DragEvent) => {
    if (modulatable && event.dataTransfer.types.includes(SOURCE_TYPE)) event.preventDefault();
  };
  const drop = (event: DragEvent) => {
    const source = event.dataTransfer.getData(SOURCE_TYPE) as Source;
    if (modulatable && source) route(source, id);
  };

  return (
    <Knob.Root
      min={spec.min}
      max={spec.max}
      step={spec.step}
      scale={spec.curve === "log" ? scales.log : scales.linear}
      origin={spec.min < 0 && spec.max > 0 ? 0 : undefined}
      defaultValue={synth.params[id]}
      format={formatFor(id)}
      onValueChange={(value) => {
        synth.setParam(id, value);
        onChange?.(value);
      }}
      className={small ? "knob small" : "knob"}
      data-modulatable={modulatable || undefined}
      onDragOver={accept}
      onDrop={drop}
    >
      <Knob.Control className="knob-control">
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <Knob.Track radius={34} className="knob-track" />
          {mine.map((routing) => (
            <Knob.ModulationRange key={routing.source} source={routing.source} radius={45} className={`modulation-range source-${routing.source}`} />
          ))}
          {mine.length > 0 && <Knob.Modulation read={() => synth.modulated(id)} radius={45} className="modulation-now" />}
          <Knob.Range radius={34} className="knob-range" />
          <Knob.Pointer from={8} to={26} className="knob-pointer" />
        </svg>
      </Knob.Control>
      {mine.map((routing, index) => (
        <Knob.ModulationDepth
          key={routing.source}
          source={routing.source}
          defaultValue={routing.amount}
          onValueChange={(amount) => setAmount(routing.source, id as Destination, amount, false)}
          onGestureEnd={(amount) => setAmount(routing.source, id as Destination, amount, true)}
          aria-label={`${SOURCE_LABELS[routing.source]} to ${label}`}
          className={`modulation-depth source-${routing.source}`}
          style={{ insetInlineStart: `${index * 12 - 4}px` }}
        />
      ))}
      <Knob.Label className="knob-label">{label}</Knob.Label>
      <Knob.Value className="knob-value" />
    </Knob.Root>
  );
}

/** A modulation source to drag onto a knob. */
export function SourceChip({ source }: { source: Source }) {
  return (
    <span
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(SOURCE_TYPE, source);
        event.dataTransfer.effectAllowed = "link";
        document.body.dataset.dragging = "source";
      }}
      onDragEnd={() => delete document.body.dataset.dragging}
      className={`source-chip source-${source}`}
      title="Drag onto a knob to modulate it"
    >
      {SOURCE_LABELS[source]}
    </span>
  );
}

/** An on/off switch for the parameter `id`. */
export function ParamToggle({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  const { synth } = useSynth();
  return (
    <Toggle defaultPressed={synth.params[id] === 1} onPressedChange={(on) => synth.setParam(id, on ? 1 : 0)} aria-label={label} className="switch">
      {children}
    </Toggle>
  );
}

/** A panel with a title bar. */
export function Panel({ title, header, className, children }: { title: string; header?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={className ? `panel ${className}` : "panel"} aria-label={title}>
      <header className="panel-header">
        <h2>{title}</h2>
        {header}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}
