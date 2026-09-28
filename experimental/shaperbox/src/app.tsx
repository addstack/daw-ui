import { useCallback, useEffect, useRef, useState, type CSSProperties, type DragEvent } from "react";

import { formats } from "../../../src/core/index.js";
import { Meter, NumberBox, Spectrum, Toggle, ToggleGroup } from "../../../src/react/index.js";
import type { SourceName } from "../engine/box.js";
import { LOOPS } from "../engine/loops.js";
import { DRIVE_TYPES, FILTER_TYPES, KINDS, LIQUID_MODES, RATES, type Kind } from "../engine/params.js";
import { BAND_NAMES, COLORS, NAMES, ParamKnob, box, rateFormat, useFrame } from "./controls.js";
import { Crossover, WaveEditor } from "./editor.js";
import { PRESETS, presetWaves } from "./presets.js";

// An experimental take on Cableguys' ShaperBox 3, built on daw-ui: nine shapers in a chain, each moving one thing
// (volume, a filter, time, pan, width, noise, crush, drive, a flanger or phaser) by a wave drawn over a cycle that
// follows the tempo or starts on a transient, over the whole signal or over three bands, each with its own wave.

/** Sets everything a preset holds, before the panels that show it render. */
function load(index: number) {
  const preset = PRESETS[index]!;
  box.load(preset.params, presetWaves(preset), preset.order ?? [...KINDS]);
}

const FIRST_PRESET = 0;
load(FIRST_PRESET);

const bpmFormat = formats.number({ digits: 2, unit: "BPM" });

const powered = () => Object.fromEntries(KINDS.map((kind) => [kind, box.params[`${kind}.on`] === 1])) as Record<Kind, boolean>;

/** A choice among a parameter's named values, as segments. */
function ParamChoice({ id, label, options }: { id: string; label: string; options: readonly string[] }) {
  const [value, setValue] = useState(box.params[id]!);
  return (
    <ToggleGroup
      aria-label={label}
      value={[String(value)]}
      onValueChange={(next) => {
        if (next[0] === undefined) return;
        setValue(Number(next[0]));
        box.setParam(id, Number(next[0]));
      }}
      className="segmented"
    >
      {options.map((option, index) => (
        <Toggle key={option} value={String(index)} className="segment">
          {option}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}

/** The knobs of what a shaper does, beside its mix. */
function EffectControls({ kind }: { kind: Kind }) {
  switch (kind) {
    case "filter":
      return (
        <>
          <ParamChoice id="filter.type" label="Filter type" options={FILTER_TYPES} />
          <ParamKnob id="filter.resonance" label="Res" />
        </>
      );
    case "time":
      return <ParamKnob id="time.smooth" label="Smooth" />;
    case "noise":
      return (
        <>
          <ParamKnob id="noise.level" label="Level" />
          <ParamKnob id="noise.color" label="Color" />
          <ParamKnob id="noise.follow" label="Follow" />
        </>
      );
    case "crush":
      return (
        <>
          <ParamKnob id="crush.bits" label="Bits" />
          <ParamKnob id="crush.downsample" label="Rate ÷" />
        </>
      );
    case "drive":
      return (
        <>
          <ParamChoice id="drive.type" label="Drive type" options={DRIVE_TYPES} />
          <ParamKnob id="drive.amount" label="Drive" />
        </>
      );
    case "liquid":
      return (
        <>
          <ParamChoice id="liquid.mode" label="Liquid mode" options={LIQUID_MODES} />
          <ParamKnob id="liquid.feedback" label="Feedback" />
          <ParamKnob id="liquid.stereo" label="Stereo" />
        </>
      );
    default:
      return null;
  }
}

function Power({ kind, on, onChange }: { kind: Kind; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <Toggle pressed={on} onPressedChange={onChange} aria-label={`${NAMES[kind]} on`} className="power">
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 1.5v6M4.4 3.6a5.5 5.5 0 1 0 7.2 0" />
      </svg>
    </Toggle>
  );
}

/** The chain of shapers, in the order they process the audio: drag one to move it, or use its arrows. */
function Chain({
  order,
  selected,
  on,
  onSelect,
  onPower,
  onOrder,
}: {
  order: Kind[];
  selected: Kind;
  on: Record<Kind, boolean>;
  onSelect: (kind: Kind) => void;
  onPower: (kind: Kind, on: boolean) => void;
  onOrder: (order: Kind[]) => void;
}) {
  const bars = useRef(new Map<Kind, HTMLElement>());
  const dragged = useRef<Kind | null>(null);
  useFrame(() => {
    for (const [kind, element] of bars.current) element.style.setProperty("--phase", String(box.phase(kind)));
  });
  const move = (kind: Kind, to: number) => {
    const next = order.filter((one) => one !== kind);
    next.splice(Math.max(0, Math.min(next.length, to)), 0, kind);
    onOrder(next);
  };
  return (
    <nav className="chain" aria-label="Shapers">
      <h2>Chain</h2>
      <ol>
        {order.map((kind, index) => (
          <li
            key={kind}
            draggable
            onDragStart={(event: DragEvent) => {
              dragged.current = kind;
              event.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(event) => dragged.current && event.preventDefault()}
            onDrop={() => dragged.current && move(dragged.current, index)}
            onDragEnd={() => (dragged.current = null)}
            data-selected={selected === kind || undefined}
            data-on={on[kind] || undefined}
            style={{ "--color": COLORS[kind] } as CSSProperties}
          >
            <Power kind={kind} on={on[kind]} onChange={(pressed) => onPower(kind, pressed)} />
            <button type="button" className="chain-name" aria-pressed={selected === kind} onClick={() => onSelect(kind)}>
              {NAMES[kind]}
            </button>
            <span className="chain-move">
              <button type="button" aria-label={`Move ${NAMES[kind]} up`} disabled={index === 0} onClick={() => move(kind, index - 1)}>
                ▴
              </button>
              <button type="button" aria-label={`Move ${NAMES[kind]} down`} disabled={index === order.length - 1} onClick={() => move(kind, index + 1)}>
                ▾
              </button>
            </span>
            <span
              className="chain-phase"
              aria-hidden="true"
              ref={(element) => {
                if (element) bars.current.set(kind, element);
                else bars.current.delete(kind);
              }}
            />
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** A shaper: its rate and trigger, its bands, its wave, and its knobs. */
function Shaper({ kind, on, onPower }: { kind: Kind; on: boolean; onPower: (on: boolean) => void }) {
  const [trigger, setTrigger] = useState(box.params[`${kind}.trigger`]!);
  const [multiband, setMultiband] = useState(box.params[`${kind}.multiband`] === 1);
  const [band, setBand] = useState(1);
  const [grid, setGrid] = useState(16);
  const edited = multiband ? band : 0;

  useEffect(() => box.watch(kind, edited), [kind, edited]);

  const split = (pressed: boolean) => {
    // Bands start from the wave over the whole signal, until they are changed.
    if (pressed) for (const one of [1, 2, 3]) if (!box.edited(kind, one)) box.waves[kind][one] = box.waves[kind][0]!;
    if (pressed) for (const one of [1, 2, 3]) box.preview(kind, one, box.waves[kind][one]!);
    box.setParam(`${kind}.multiband`, pressed ? 1 : 0);
    setMultiband(pressed);
  };

  return (
    <section className="shaper" aria-label={NAMES[kind]} data-off={!on || undefined} style={{ "--color": COLORS[kind] } as CSSProperties}>
      <header className="shaper-header">
        <Power kind={kind} on={on} onChange={onPower} />
        <h2>{NAMES[kind]}</h2>
        <NumberBox.Root
          min={0}
          max={RATES.length - 1}
          step={1}
          defaultValue={box.params[`${kind}.rate`]}
          format={rateFormat}
          onValueChange={(value) => box.setParam(`${kind}.rate`, value)}
          className="number"
        >
          <NumberBox.Label className="field-label">{trigger === 1 ? "Length" : "Rate"}</NumberBox.Label>
          <NumberBox.Field className="field-box rate" />
        </NumberBox.Root>
        <ToggleGroup
          aria-label="Trigger"
          value={[String(trigger)]}
          onValueChange={(value) => {
            if (value[0] === undefined) return;
            setTrigger(Number(value[0]));
            box.setParam(`${kind}.trigger`, Number(value[0]));
          }}
          className="segmented"
        >
          <Toggle value="0" className="segment" title="The wave follows the tempo">
            Sync
          </Toggle>
          <Toggle value="1" className="segment" title="A transient in the audio starts the wave, and it runs once">
            Audio
          </Toggle>
        </ToggleGroup>
        {trigger === 1 && <ParamKnob key="threshold" id={`${kind}.threshold`} label="Threshold" />}
        <span className="spacer" />
        <Toggle pressed={multiband} onPressedChange={split} className="switch">
          Multiband
        </Toggle>
        {multiband && (
          <ToggleGroup aria-label="Band to edit" value={[String(band)]} onValueChange={(value) => value[0] && setBand(Number(value[0]))} className="segmented">
            {BAND_NAMES.map((name, index) => (
              <Toggle key={name} value={String(index + 1)} className="segment">
                {name}
              </Toggle>
            ))}
          </ToggleGroup>
        )}
      </header>
      <WaveEditor key={edited} kind={kind} band={edited} grid={grid} onGrid={setGrid} />
      <div className="shaper-controls">
        <ParamKnob id={`${kind}.mix`} label="Mix" />
        <EffectControls kind={kind} />
      </div>
      {multiband && <Crossover kind={kind} band={band} onBand={setBand} />}
    </section>
  );
}

function Output() {
  return (
    <div className="output">
      <Spectrum.Root read={() => box.spectrum("output")} sampleRate={box.sampleRate} floor={-100} ceiling={-10} tilt={3} aria-label="Output spectrum" className="spectrum">
        <Spectrum.Fill className="spectrum-fill" />
        <Spectrum.Line thickness={1} className="spectrum-line" />
      </Spectrum.Root>
      <Meter.Root read={() => box.level()} min={-60} max={6} className="meter">
        <Meter.Track className="meter-track" aria-label="Output level">
          <Meter.Bar className="meter-bar" />
          <Meter.Peak className="meter-peak" />
        </Meter.Track>
      </Meter.Root>
    </div>
  );
}

const interactive = (target: EventTarget | null) =>
  target instanceof HTMLElement && target.closest("input, select, textarea, button, [role=slider], [role=spinbutton], [role=button], [contenteditable]") !== null;

export function App() {
  const [presetIndex, setPresetIndex] = useState(FIRST_PRESET);
  const [selected, setSelected] = useState<Kind>("volume");
  const [on, setOn] = useState(powered);
  const [order, setOrder] = useState<Kind[]>(box.order);
  const [playing, setPlaying] = useState(false);
  const [source, setSource] = useState<SourceName>(box.source);
  const [tempoKey, setTempoKey] = useState(0);
  const [status, setStatus] = useState("");
  const [dropping, setDropping] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const choose = (index: number) => {
    load(index);
    setPresetIndex(index);
    setOn(powered());
    setOrder(box.order);
    // Show a shaper the preset uses.
    const first = box.order.find((kind) => box.params[`${kind}.on`] === 1);
    if (first) setSelected(first);
  };

  const power = (kind: Kind, pressed: boolean) => {
    box.setParam(`${kind}.on`, pressed ? 1 : 0);
    setOn((current) => ({ ...current, [kind]: pressed }));
  };

  const play = useCallback(async (next: boolean) => {
    setPlaying(next);
    await box.start();
    box.play(next);
  }, []);

  const open = async (file: File) => {
    try {
      setStatus(`Opening ${file.name}…`);
      const bpm = await box.loadFile(file);
      setSource("File");
      setTempoKey((key) => key + 1);
      setStatus(
        bpm === null
          ? `${file.name} plays in a loop. Set the tempo to its own, so that the waves line up with it.`
          : `${file.name} plays in a loop, at ${bpm} BPM: the tempo whole bars of 4/4 give its length.`,
      );
    } catch {
      setStatus(`${file.name} could not be read as audio.`);
    }
  };

  // Space plays and stops, as in a DAW, unless a control has the key.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== " " || event.repeat || interactive(event.target)) return;
      event.preventDefault();
      void play(!box.playing);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [play]);

  const files = (event: DragEvent) => event.dataTransfer.types.includes("Files");

  return (
    <main
      className="box"
      data-dropping={dropping || undefined}
      onDragOver={(event) => {
        if (!files(event)) return;
        event.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(event) => event.currentTarget === event.target && setDropping(false)}
      onDrop={(event) => {
        if (!files(event)) return;
        event.preventDefault();
        setDropping(false);
        const file = event.dataTransfer.files[0];
        if (file) void open(file);
      }}
    >
      <header className="topbar">
        <h1>
          daw-ui <span>experimental shaperbox</span>
        </h1>
        <label className="field">
          <span className="field-label">Preset</span>
          <select value={presetIndex} onChange={(event) => choose(Number(event.target.value))}>
            {PRESETS.map((preset, index) => (
              <option key={preset.name} value={index}>
                {preset.name}
              </option>
            ))}
          </select>
        </label>
        <div className="transport">
          <Toggle pressed={playing} onPressedChange={(pressed) => void play(pressed)} aria-label="Play" className="play" title="Play or stop (Space)">
            {playing ? "■" : "▶"}
          </Toggle>
          <NumberBox.Root
            key={tempoKey}
            min={40}
            max={240}
            step={0.01}
            defaultValue={box.bpm}
            format={bpmFormat}
            onValueChange={(bpm) => box.setBpm(bpm)}
            className="number"
          >
            <NumberBox.Label className="field-label">Tempo</NumberBox.Label>
            <NumberBox.Field className="field-box tempo" />
          </NumberBox.Root>
          <label className="field">
            <span className="field-label">Audio</span>
            <select
              value={source}
              onChange={(event) => {
                const next = event.target.value as SourceName;
                box.useSource(next);
                setSource(next);
              }}
            >
              {LOOPS.map((loop) => (
                <option key={loop} value={loop}>
                  {loop} loop
                </option>
              ))}
              {box.file && <option value="File">{box.file.name}</option>}
            </select>
          </label>
          <button type="button" onClick={() => fileInput.current?.click()}>
            Open file…
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="audio/*"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void open(file);
              event.target.value = "";
            }}
          />
        </div>
        <Output />
        <div key={presetIndex} className="globals">
          <ParamKnob id="global.mix" label="Mix" />
          <ParamKnob id="global.output" label="Output" />
          <Toggle
            defaultPressed={box.params["global.bypass"] === 1}
            onPressedChange={(pressed) => box.setParam("global.bypass", pressed ? 1 : 0)}
            className="switch bypass"
            title="Hear the audio without the shapers"
          >
            Bypass
          </Toggle>
        </div>
      </header>

      <div key={presetIndex} className="workspace">
        <Chain order={order} selected={selected} on={on} onSelect={setSelected} onPower={power} onOrder={(next) => (box.setOrder(next), setOrder(next))} />
        <Shaper key={selected} kind={selected} on={on[selected]} onPower={(pressed) => power(selected, pressed)} />
      </div>

      <p className="status" role="status">
        {status || "Press ▶ or Space to play the loop. Drop an audio file anywhere to shape your own."}
      </p>
    </main>
  );
}
