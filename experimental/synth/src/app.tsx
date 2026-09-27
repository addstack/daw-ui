import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { formats } from "../../../src/core/index.js";
import { Keys, Toggle, ToggleGroup } from "../../../src/react/index.js";
import { DESTINATIONS, FILTER_TYPES, SOURCES, TABLES, type Destination, type Routing, type Source } from "../engine/params.js";
import { Synth } from "../engine/synth.js";
import { DESTINATION_LABELS, Panel, ParamKnob, ParamToggle, SOURCE_LABELS, SourceChip, SynthContext, useSynth, type SynthContextValue } from "./controls.js";
import { PRESETS } from "./presets.js";
import { EnvelopeGraph, LfoEditor, Output, WavetableView } from "./views.js";

// An experimental wavetable synth in the spirit of Serum, built on daw-ui: two wavetable oscillators with unison,
// a sub and noise, a filter, three envelopes, two LFOs drawn as curves, a modulation matrix you fill by dragging
// sources onto knobs, and chorus, delay and reverb.

const synth = new Synth();

/** Sets everything a preset holds, before the panels that show it render. */
function load(index: number) {
  const preset = PRESETS[index]!;
  synth.allNotesOff();
  synth.setParams(preset.params);
  synth.setRoutings(preset.routings);
  synth.setShape(0, preset.lfos[0]);
  synth.setShape(1, preset.lfos[1]);
}

const FIRST_PRESET = 1;
load(FIRST_PRESET);

const pitch = formats.pitch({ names: ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"] });

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

function Lfo({ index, shape }: { index: 0 | 1; shape: Parameters<typeof LfoEditor>[0]["initial"] }) {
  const { synth } = useSynth();
  const id = index === 0 ? "lfo1" : "lfo2";
  return (
    <Panel title={`LFO ${index + 1}`} className="lfo-panel" header={<SourceChip source={id} />}>
      <LfoEditor synth={synth} index={index} initial={shape} />
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

// Musical typing: the middle row of a QWERTY keyboard plays white keys, the row above black ones; Z and X shift octaves.
const TYPING: Record<string, number> = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15, ";": 16 };

function Keyboard({ play, stop }: { play: (note: number, velocity: number) => void; stop: (note: number) => void }) {
  const [octave, setOctave] = useState(4);
  const octaveRef = useRef(octave);
  octaveRef.current = octave;
  const range = [36, 84] as const;
  const notes = useMemo(() => Array.from({ length: range[1] - range[0] + 1 }, (_, index) => range[0] + index), [range[0], range[1]]);

  useEffect(() => {
    const down = new Map<string, number>();
    const typing = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      return !(event.metaKey || event.ctrlKey || event.altKey || target.closest("input, select, textarea, [role=slider], [role=spinbutton]"));
    };
    const onDown = (event: KeyboardEvent) => {
      if (!typing(event) || event.repeat) return;
      const key = event.key.toLowerCase();
      if (key === "z" || key === "x") {
        setOctave((current) => Math.min(7, Math.max(1, current + (key === "x" ? 1 : -1))));
        return;
      }
      const offset = TYPING[key];
      if (offset === undefined || down.has(key)) return;
      const note = (octaveRef.current + 1) * 12 + offset;
      down.set(key, note);
      play(note, 0.8);
    };
    const onUp = (event: KeyboardEvent) => {
      const note = down.get(event.key.toLowerCase());
      if (note === undefined) return;
      down.delete(event.key.toLowerCase());
      stop(note);
    };
    const release = () => {
      for (const note of down.values()) stop(note);
      down.clear();
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", release);
    };
  }, [play, stop]);

  return (
    <section className="keyboard" aria-label="Keyboard">
      <p className="hint">
        Play with the mouse, a MIDI keyboard, or your computer's keys: A W S E D F T G Y H U J K, Z and X for octaves
        (now {pitch.format((octave + 1) * 12)}).
      </p>
      <Keys.Root range={range} format={pitch} onPress={(note, { velocity }) => play(note, velocity)} onRelease={stop} read={() => synth.notes} aria-label="Keys" className="keys">
        {notes.map((note) => (
          <Keys.Key key={note} note={note} className="key">
            {note % 12 === 0 && <span className="key-label">{pitch.format(note)}</span>}
          </Keys.Key>
        ))}
      </Keys.Root>
    </section>
  );
}

export function App() {
  const [presetIndex, setPresetIndex] = useState(FIRST_PRESET);
  const preset = PRESETS[presetIndex]!;
  const [routings, setRoutings] = useState<Routing[]>(preset.routings);
  const routingsRef = useRef(routings);
  routingsRef.current = routings;
  const [started, setStarted] = useState(false);

  // A preset sets everything, and the panels start over from it (they are keyed by it).
  const choose = (index: number) => {
    load(index);
    setRoutings(PRESETS[index]!.routings);
    setPresetIndex(index);
  };

  const start = useCallback(async () => {
    if (synth.started) return;
    await synth.start();
    setStarted(true);
    listenToMidi();
  }, []);
  // Stable, so that the keyboard's listeners never change while a key is down.
  const play = useCallback(
    async (note: number, velocity: number) => {
      await start();
      synth.noteOn(note, velocity);
    },
    [start],
  );
  const stop = useCallback((note: number) => synth.noteOff(note), []);

  function listenToMidi() {
    navigator
      .requestMIDIAccess?.()
      .then((access) => {
        const listen = (input: MIDIInput) => {
          input.onmidimessage = ({ data }) => {
            if (!data) return;
            const [status = 0, note = 0, velocity = 0] = data;
            const command = status & 0xf0;
            if (command === 0x90 && velocity > 0) synth.noteOn(note, velocity / 127);
            else if (command === 0x80 || command === 0x90) synth.noteOff(note);
          };
        };
        access.inputs.forEach(listen);
        access.onstatechange = () => access.inputs.forEach(listen);
      })
      .catch(() => {});
  }

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
      <main className="synth">
        <header className="topbar">
          <h1>
            daw-ui <span>experimental synth</span>
          </h1>
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
          <button type="button" className={started ? "power on" : "power"} onClick={start}>
            {started ? "Audio on" : "Start audio"}
          </button>
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
            <Lfo index={0} shape={preset.lfos[0]} />
            <Lfo index={1} shape={preset.lfos[1]} />
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

        <Keyboard play={play} stop={stop} />
      </main>
    </SynthContext.Provider>
  );
}
