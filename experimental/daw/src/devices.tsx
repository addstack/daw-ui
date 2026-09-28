import { useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { formats } from "../../../src/core/index.js";
import { Knob, Toggle } from "../../../src/react/index.js";
import type { Box } from "../../shaperbox/engine/box.js";
import { ShaperBoxPanel } from "../../shaperbox/src/panel.js";
import { PRESETS as BOX_PRESETS, loadPreset as loadBoxPreset } from "../../shaperbox/src/presets.js";
import { Synth } from "../../synth/engine/synth.js";
import { Keyboard } from "../../synth/src/keyboard.js";
import { SynthPanel } from "../../synth/src/panel.js";
import { PRESETS as SYNTH_PRESETS, loadPreset as loadSynthPreset } from "../../synth/src/presets.js";
import { DrumMachine, PADS } from "../engine/drums.js";
import { MASTER_ID } from "../engine/host.js";
import type { Project } from "../engine/project.js";
import type { PluginRef } from "./mixer.js";
import { host, type Selection } from "./state.js";

// The devices of a track, as a chain of cards: its instrument, then its effects, each with its presets, and a
// window to open with the plug-in's own panel, the same the plug-in shows on its own page.

const semitones = formats.number({ digits: 1, unit: "st" });
const decibels = formats.decibel();

/** The drum machine's panel: a pad to play each sound, with its level and tuning. */
function DrumsPanel({ drums, track }: { drums: DrumMachine; track: string }) {
  return (
    <div className="drums">
      {PADS.map((pad) => (
        <div key={pad.note} className="pad">
          <button type="button" className="pad-button" onPointerDown={() => void host.noteOn(track, pad.note, 0.9)}>
            {pad.name}
          </button>
          <div className="pad-knobs">
            {(["level", "tune"] as const).map((setting) => (
              <Knob.Root
                key={setting}
                min={setting === "level" ? -24 : -12}
                max={setting === "level" ? 6 : 12}
                origin={0}
                defaultValue={drums.settings[pad.note]![setting]}
                resetValue={0}
                format={setting === "level" ? decibels : semitones}
                onValueChange={(value) => (drums.settings[pad.note]![setting] = value)}
                className="pad-knob"
              >
                <Knob.Control className="pad-knob-control">
                  <svg viewBox="0 0 100 100" aria-hidden="true">
                    <Knob.Track radius={38} className="knob-track" />
                    <Knob.Range radius={38} className="knob-range" />
                    <Knob.Pointer from={8} to={28} className="knob-pointer" />
                  </svg>
                </Knob.Control>
                <Knob.Label className="pad-knob-label">{setting === "level" ? "Level" : "Tune"}</Knob.Label>
                <Knob.Value className="pad-knob-value" />
              </Knob.Root>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** A plug-in's window: over the DAW, moved by its title bar. */
function PluginWindow({ title, color, index, onClose, children }: { title: string; color: string; index: number; onClose: () => void; children: ReactNode }) {
  const [place, setPlace] = useState({ x: 60 + index * 32, y: 70 + index * 32 });
  const [front, setFront] = useState(0);
  const element = useRef<HTMLDivElement>(null);
  const drag = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const [startX, startY, from] = [event.clientX, event.clientY, place];
    const follow = (moved: globalThis.PointerEvent) =>
      setPlace({ x: Math.max(0, from.x + moved.clientX - startX), y: Math.max(0, Math.min(window.innerHeight - 40, from.y + moved.clientY - startY)) });
    const release = () => {
      handle.removeEventListener("pointermove", follow);
      handle.removeEventListener("pointerup", release);
    };
    handle.addEventListener("pointermove", follow);
    handle.addEventListener("pointerup", release);
  };
  return createPortal(
    <div
      ref={element}
      role="dialog"
      aria-label={title}
      className="daw-window"
      style={{ left: place.x, top: place.y, zIndex: 100 + front, "--track": color } as CSSProperties}
      onPointerDownCapture={() => setFront(Date.now() % 1_000_000)}
    >
      <header className="daw-window-title" onPointerDown={drag}>
        <span>{title}</span>
        <button type="button" aria-label={`Close ${title}`} onClick={onClose}>
          ×
        </button>
      </header>
      <div className="daw-window-body">{children}</div>
    </div>,
    document.body,
  );
}

/** What a window shows, and its title. */
function describe(plugin: PluginRef, project: Project): { title: string; color: string; content: ReactNode } | null {
  if (plugin.kind === "instrument") {
    const track = project.tracks.find((one) => one.id === plugin.track);
    const instrument = host.instruments.get(plugin.track);
    if (!track || !instrument) return null;
    if (instrument instanceof Synth)
      return {
        title: `${track.name} · Synth`,
        color: track.color,
        content: (
          <div className="synth-ui synth plugin">
            <SynthPanel synth={instrument} />
            <Keyboard play={(note, velocity) => void host.noteOn(track.id, note, velocity)} stop={(note) => host.noteOff(track.id, note)} read={() => instrument.notes} />
          </div>
        ),
      };
    return { title: `${track.name} · Drum Machine`, color: track.color, content: <DrumsPanel drums={instrument} track={track.id} /> };
  }
  const box = host.boxes.get(plugin.device);
  const owner = plugin.owner === MASTER_ID ? "Master" : project.tracks.find((one) => one.id === plugin.owner)?.name;
  if (!box || !owner || !host.effects(plugin.owner).some((device) => device.id === plugin.device)) return null;
  const color = project.tracks.find((one) => one.id === plugin.owner)?.color ?? "#d6dde4";
  return {
    title: `${owner} · ShaperBox`,
    color,
    content: (
      <div className="shaperbox-ui box plugin">
        <ShaperBoxPanel box={box} />
      </div>
    ),
  };
}

/** The open windows; `versions` starts a window over when its plug-in's preset changes from outside it. */
export function PluginWindows({ open, versions, project, onClose }: { open: PluginRef[]; versions: Record<string, number>; project: Project; onClose: (plugin: PluginRef) => void }) {
  return (
    <>
      {open.map((plugin, index) => {
        const described = describe(plugin, project);
        if (!described) return null;
        const key = pluginKey(plugin);
        return (
          <PluginWindow key={`${key} ${versions[key] ?? 0}`} title={described.title} color={described.color} index={index} onClose={() => onClose(plugin)}>
            {described.content}
          </PluginWindow>
        );
      })}
    </>
  );
}

export const pluginKey = (plugin: PluginRef) => (plugin.kind === "instrument" ? `instrument ${plugin.track}` : `effect ${plugin.device}`);

function Card({ name, color, children, onOpen }: { name: string; color: string; children?: ReactNode; onOpen: () => void }) {
  return (
    <div className="card" style={{ "--track": color } as CSSProperties}>
      <div className="card-title">
        <span>{name}</span>
        <button type="button" onClick={onOpen}>
          Open
        </button>
      </div>
      {children}
    </div>
  );
}

/** The chain of the selected track, or of the master: instrument, effects, and a place to add one. */
export function Devices({
  project,
  selection,
  onOpen,
  onPresetChange,
}: {
  project: Project;
  selection: Selection;
  onOpen: (plugin: PluginRef) => void;
  /** A card changed a plug-in's preset: its window, if open, starts over. */
  onPresetChange: (plugin: PluginRef) => void;
}) {
  const [showMaster, setShowMaster] = useState(false);
  const track = project.tracks.find((one) => one.id === selection.track);
  const owner = showMaster || !track ? MASTER_ID : track.id;
  const instrument = track && !showMaster ? host.instruments.get(track.id) : undefined;
  const color = owner === MASTER_ID ? "#d6dde4" : track!.color;
  const effects = host.effects(owner);

  return (
    <div className="devices">
      <div className="devices-owner">
        <Toggle pressed={!showMaster} onPressedChange={(pressed) => setShowMaster(!pressed)} className="segment" disabled={!track}>
          {track ? track.name : "Track"}
        </Toggle>
        <Toggle pressed={showMaster} onPressedChange={setShowMaster} className="segment">
          Master
        </Toggle>
      </div>
      <div className="chain-cards">
        {instrument instanceof Synth && track && (
          <Card name="Synth" color={color} onOpen={() => onOpen({ kind: "instrument", track: track.id })}>
            <select
              aria-label="Synth preset"
              value={instrument.preset}
              onChange={(event) => {
                loadSynthPreset(instrument, Number(event.target.value));
                onPresetChange({ kind: "instrument", track: track.id });
              }}
            >
              {SYNTH_PRESETS.map((preset, index) => (
                <option key={preset.name} value={index}>
                  {preset.name}
                </option>
              ))}
            </select>
            <p className="card-hint">Wavetable synth: two oscillators, a filter, envelopes, LFOs and modulation.</p>
          </Card>
        )}
        {instrument instanceof DrumMachine && track && (
          <Card name="Drum Machine" color={color} onOpen={() => onOpen({ kind: "instrument", track: track.id })}>
            <p className="card-hint">Eight sounds on General MIDI notes: kick, snare, clap, rim, hats, tom, crash.</p>
          </Card>
        )}
        {effects.map((device, index) => (
          <EffectCard
            key={device.id}
            box={host.boxes.get(device.id)!}
            color={color}
            first={index === 0}
            last={index === effects.length - 1}
            onOpen={() => onOpen({ kind: "effect", owner, device: device.id })}
            onPresetChange={() => onPresetChange({ kind: "effect", owner, device: device.id })}
            onMove={(by) => host.moveEffect(owner, device.id, by)}
            onRemove={() => host.removeEffect(owner, device.id)}
          />
        ))}
        <button type="button" className="card add" onClick={() => onOpen({ kind: "effect", owner, device: host.addEffect(owner) })}>
          + ShaperBox
        </button>
      </div>
    </div>
  );
}

function EffectCard({
  box,
  color,
  first,
  last,
  onOpen,
  onPresetChange,
  onMove,
  onRemove,
}: {
  box: Box;
  color: string;
  first: boolean;
  last: boolean;
  onOpen: () => void;
  onPresetChange: () => void;
  onMove: (by: number) => void;
  onRemove: () => void;
}) {
  const [preset, setPreset] = useState(box.preset);
  const [on, setOn] = useState(box.params["global.bypass"] !== 1);
  return (
    <Card name="ShaperBox" color={color} onOpen={onOpen}>
      <select
        aria-label="ShaperBox preset"
        value={preset}
        onChange={(event) => {
          loadBoxPreset(box, Number(event.target.value));
          setPreset(Number(event.target.value));
          onPresetChange();
        }}
      >
        {BOX_PRESETS.map((one, index) => (
          <option key={one.name} value={index}>
            {one.name}
          </option>
        ))}
      </select>
      <div className="card-tools">
        <Toggle
          pressed={on}
          onPressedChange={(pressed) => {
            box.setParam("global.bypass", pressed ? 0 : 1);
            setOn(pressed);
            onPresetChange();
          }}
          aria-label="ShaperBox on"
          className="segment"
        >
          On
        </Toggle>
        <button type="button" aria-label="Move earlier" disabled={first} onClick={() => onMove(-1)}>
          ←
        </button>
        <button type="button" aria-label="Move later" disabled={last} onClick={() => onMove(1)}>
          →
        </button>
        <button type="button" aria-label="Remove ShaperBox" onClick={onRemove}>
          ×
        </button>
      </div>
    </Card>
  );
}
