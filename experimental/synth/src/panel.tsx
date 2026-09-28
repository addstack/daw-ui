import { useRef, useState, type ReactNode } from "react";

import { Toggle, ToggleGroup } from "../../../src/react/index.js";
import { DESTINATIONS, FILTER_TYPES, SOURCES, TABLES, type Destination, type Routing, type Source } from "../engine/params.js";
import type { Synth } from "../engine/synth.js";
import { DESTINATION_LABELS, Panel, ParamKnob, ParamToggle, SOURCE_LABELS, SourceChip, SynthContext, useSynth, type SynthContextValue } from "./controls.js";
import { PRESETS, loadPreset } from "./presets.js";
import { EnvelopeGraph, LfoEditor, Output, WavetableView } from "./views.js";

// The synth's panel: its presets and output, and the rack of oscillators, filter, envelopes, LFOs, modulation and
// effects. It shows the synth it is given, on its own page or in a host's window.

function Oscillator({ osc }: { osc: "a" | "b" }) {
  const { synth } = useSynth();
  const [table, setTable] = useState(synth.params[`${osc}.table`]!);
  const name = osc.toUpperCase();
  return (
    <Panel
      title={`Osc ${name}`}
      className="oscillator"
      header={
        <>
          <select
            aria-label={`Oscillator ${name} wavetable`}
            value={table}
            onChange={(event) => {
              const index = Number(event.target.value);
              setTable(index);
              synth.setParam(`${osc}.table`, index);
            }}
          >
            {TABLES.map((tableName, index) => (
              <option key={tableName} value={index}>
                {tableName}
              </option>
            ))}
          </select>
          <ParamToggle id={`${osc}.on`} label={`Oscillator ${name} on`}>
            ON
          </ParamToggle>
        </>
      }
    >
      <WavetableView synth={synth} osc={osc} />
      <div className="knobs">
        <ParamKnob id={`${osc}.position`} label="WT Pos" />
        <ParamKnob id={`${osc}.unison`} label="Unison" />
        <ParamKnob id={`${osc}.detune`} label="Detune" />
        <ParamKnob id={`${osc}.blend`} label="Blend" />
        <ParamKnob id={`${osc}.pan`} label="Pan" />
        <ParamKnob id={`${osc}.level`} label="Level" />
      </div>
      <div className="knobs">
        <ParamKnob id={`${osc}.octave`} label="Oct" small />
        <ParamKnob id={`${osc}.semi`} label="Semi" small />
        <ParamKnob id={`${osc}.fine`} label="Fine" small />
      </div>
    </Panel>
  );
}

function SubAndNoise() {
  return (
    <div className="stack">
      <Panel title="Sub" header={<ParamToggle id="sub.on" label="Sub on">ON</ParamToggle>}>
        <div className="knobs">
          <ParamKnob id="sub.octave" label="Oct" small />
          <ParamKnob id="sub.level" label="Level" small />
          <ParamToggle id="sub.shape" label="Square wave">
            SQR
          </ParamToggle>
        </div>
      </Panel>
      <Panel title="Noise" header={<ParamToggle id="noise.on" label="Noise on">ON</ParamToggle>}>
        <div className="knobs">
          <ParamKnob id="noise.level" label="Level" small />
        </div>
      </Panel>
    </div>
  );
}

function Filter() {
  const { synth } = useSynth();
  return (
    <Panel title="Filter" className="filter" header={<ParamToggle id="filter.on" label="Filter on">ON</ParamToggle>}>
      <ToggleGroup
        aria-label="Filter type"
        defaultValue={[String(synth.params["filter.type"])]}
        onValueChange={(value) => value[0] !== undefined && synth.setParam("filter.type", Number(value[0]))}
        className="segmented"
      >
        {FILTER_TYPES.map((type, index) => (
          <Toggle key={type} value={String(index)} className="segment">
            {type}
          </Toggle>
        ))}
      </ToggleGroup>
      <div className="knobs">
        <ParamKnob id="filter.cutoff" label="Cutoff" />
        <ParamKnob id="filter.resonance" label="Res" />
        <ParamKnob id="filter.drive" label="Drive" />
        <ParamKnob id="filter.mix" label="Mix" />
      </div>
    </Panel>
  );
}

function Envelope({ id, title }: { id: "env1" | "env2" | "env3"; title: string }) {
  const { synth } = useSynth();
  const read = () => ({
    attack: synth.params[`${id}.attack`]!,
    decay: synth.params[`${id}.decay`]!,
    sustain: synth.params[`${id}.sustain`]!,
    release: synth.params[`${id}.release`]!,
  });
  const [shape, setShape] = useState(read);
  const update = () => setShape(read());
  return (
    <Panel title={title} className="envelope" header={id === "env1" ? undefined : <SourceChip source={id} />}>
      <EnvelopeGraph {...shape} />
      <div className="knobs">
        <ParamKnob id={`${id}.attack`} label="A" small onChange={update} />
        <ParamKnob id={`${id}.decay`} label="D" small onChange={update} />
        <ParamKnob id={`${id}.sustain`} label="S" small onChange={update} />
        <ParamKnob id={`${id}.release`} label="R" small onChange={update} />
      </div>
    </Panel>
  );
}

function Lfo({ index }: { index: 0 | 1 }) {
  const { synth } = useSynth();
  const id = index === 0 ? "lfo1" : "lfo2";
  return (
    <Panel title={`LFO ${index + 1}`} className="lfo-panel" header={<SourceChip source={id} />}>
      <LfoEditor synth={synth} index={index} initial={synth.lfoPoints[index]} />
      <div className="knobs">
        <ParamKnob id={`${id}.rate`} label="Rate" small />
        <ParamToggle id={`${id}.retrigger`} label={`LFO ${index + 1} restarts with each note`}>
          TRIG
        </ParamToggle>
      </div>
    </Panel>
  );
}

/** The routings as a list, to read, remove and add from the keyboard as well as by dragging. */
function Matrix() {
  const { routings, route, unroute } = useSynth();
  const [source, setSource] = useState<Source>("lfo1");
  const [destination, setDestination] = useState<Destination>("filter.cutoff");
  return (
    <Panel title="Matrix" className="matrix">
      <ul>
        {routings.map((routing) => (
          <li key={`${routing.source} ${routing.destination}`}>
            <span className={`source-chip static source-${routing.source}`}>{SOURCE_LABELS[routing.source]}</span>
            <span className="matrix-arrow">→</span>
            <span className="matrix-destination">{DESTINATION_LABELS[routing.destination]}</span>
            <span className="matrix-amount">{Math.round(routing.amount * 100)}%</span>
            <button type="button" aria-label="Remove" onClick={() => unroute(routing.source, routing.destination)}>
              ×
            </button>
          </li>
        ))}
        {routings.length === 0 && <li className="matrix-empty">Drag a source onto a knob, or add one here.</li>}
      </ul>
      <div className="matrix-add">
        <select aria-label="Source" value={source} onChange={(event) => setSource(event.target.value as Source)}>
          {SOURCES.map((one) => (
            <option key={one} value={one}>
              {SOURCE_LABELS[one]}
            </option>
          ))}
        </select>
        <select aria-label="Destination" value={destination} onChange={(event) => setDestination(event.target.value as Destination)}>
          {DESTINATIONS.map((one) => (
            <option key={one} value={one}>
              {DESTINATION_LABELS[one]}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => route(source, destination)}>
          Add
        </button>
      </div>
    </Panel>
  );
}

/** The whole synth: `lead` goes first in its top bar, such as a title and a button to start the audio. */
export function SynthPanel({ synth, lead }: { synth: Synth; lead?: ReactNode }) {
  const [presetIndex, setPresetIndex] = useState(synth.preset);
  const [routings, setRoutings] = useState<Routing[]>(synth.routings);
  const routingsRef = useRef(routings);
  routingsRef.current = routings;

  // A preset sets everything, and the panels start over from it (they are keyed by it).
  const choose = (index: number) => {
    loadPreset(synth, index);
    setRoutings(synth.routings);
    setPresetIndex(index);
  };

  const context: SynthContextValue = {
    synth,
    routings,
    route: (source, destination) => {
      if (routingsRef.current.some((one) => one.source === source && one.destination === destination)) return;
      const next = [...routingsRef.current, { source, destination, amount: 0.5 }];
      synth.setRoutings(next);
      setRoutings(next);
    },
    unroute: (source, destination) => {
      const next = routingsRef.current.filter((one) => one.source !== source || one.destination !== destination);
      synth.setRoutings(next);
      setRoutings(next);
    },
    setAmount: (source, destination, amount, keep) => {
      const next = routingsRef.current.map((one) => (one.source === source && one.destination === destination ? { ...one, amount } : one));
      routingsRef.current = next;
      synth.setRoutings(next);
      if (keep) setRoutings(next);
    },
  };

  return (
    <SynthContext.Provider value={context}>
      <header className="topbar">
        {lead}
        <label className="preset">
          Preset
          <select value={presetIndex} onChange={(event) => choose(Number(event.target.value))}>
            {PRESETS.map((one, index) => (
              <option key={one.name} value={index}>
                {one.name}
              </option>
            ))}
          </select>
        </label>
        <Output synth={synth} />
        <div key={presetIndex} className="knobs">
          <ParamKnob id="master.volume" label="Volume" small />
        </div>
      </header>

      <div key={presetIndex} className="rack">
        <div className="row">
          <Oscillator osc="a" />
          <Oscillator osc="b" />
          <SubAndNoise />
          <Filter />
        </div>
        <div className="row">
          <Envelope id="env1" title="Env 1 · Amp" />
          <Envelope id="env2" title="Env 2" />
          <Envelope id="env3" title="Env 3" />
          <Lfo index={0} />
          <Lfo index={1} />
        </div>
        <div className="row">
          <Panel title="Sources" className="sources">
            <p className="hint">Drag onto a knob with a ring slot to modulate it; drag its handle to set how far.</p>
            <div className="chips">
              {SOURCES.map((source) => (
                <SourceChip key={source} source={source} />
              ))}
            </div>
            <div className="knobs">
              <ParamKnob id="macro1" label="Macro 1" small />
              <ParamKnob id="macro2" label="Macro 2" small />
            </div>
          </Panel>
          <Matrix />
          <Panel title="Chorus">
            <div className="knobs">
              <ParamKnob id="chorus.mix" label="Mix" small />
              <ParamKnob id="chorus.rate" label="Rate" small />
              <ParamKnob id="chorus.depth" label="Depth" small />
            </div>
          </Panel>
          <Panel title="Delay">
            <div className="knobs">
              <ParamKnob id="delay.mix" label="Mix" small />
              <ParamKnob id="delay.time" label="Time" small />
              <ParamKnob id="delay.feedback" label="Feedback" small />
            </div>
          </Panel>
          <Panel title="Reverb">
            <div className="knobs">
              <ParamKnob id="reverb.mix" label="Mix" small />
              <ParamKnob id="reverb.size" label="Size" small />
            </div>
          </Panel>
        </div>
      </div>
    </SynthContext.Provider>
  );
}
