import type { CSSProperties } from "react";

import { scales } from "../../../src/core/index.js";
import { Fader, Knob, Meter, Toggle } from "../../../src/react/index.js";
import { MASTER_ID } from "../engine/host.js";
import type { Project, Track } from "../engine/project.js";
import { decibels, host, pan, type Selection } from "./state.js";

// The mixer, as the mixer block does it: a strip for each track and one for the master, with the devices on it,
// pan, mute and solo, and a fader beside a meter for each side. Faders and knobs change the sound as they move,
// without rendering; the meters read the levels after the fader once per frame.

/** A window to open: a track's instrument, or an effect. */
export type PluginRef = { kind: "instrument"; track: string } | { kind: "effect"; owner: string; device: string };

function Slots({ owner, track, onOpen }: { owner: string; track?: Track; onOpen: (plugin: PluginRef) => void }) {
  const effects = host.effects(owner);
  return (
    <div className="slots">
      {track?.instrument && (
        <button type="button" className="slot instrument" onClick={() => onOpen({ kind: "instrument", track: track.id })}>
          {track.instrument === "synth" ? "Synth" : "Drums"}
        </button>
      )}
      {effects.map((device) => (
        <button key={device.id} type="button" className="slot" onClick={() => onOpen({ kind: "effect", owner, device: device.id })}>
          ShaperBox
        </button>
      ))}
      <button type="button" className="slot add" aria-label="Add a ShaperBox" title="Add a ShaperBox" onClick={() => host.addEffect(owner)}>
        + FX
      </button>
    </div>
  );
}

function Levels({ id, name }: { id: string; name: string }) {
  return (
    <div className="strip-meters">
      {(["left", "right"] as const).map((side, index) => (
        <Meter.Root key={side} read={() => host.levels(id)[index]!} min={-60} max={6}>
          <Meter.Track aria-label={`${name}, ${side}`} className="meter-track vertical">
            <Meter.Bar className="meter-bar" />
            <Meter.Peak className="meter-peak" />
          </Meter.Track>
        </Meter.Root>
      ))}
    </div>
  );
}

function Volume({ id, name, value }: { id: string; name: string; value: number }) {
  return (
    <Fader.Root
      min={-Infinity}
      max={6}
      defaultValue={value}
      resetValue={0}
      scale={scales.decibel}
      format={decibels}
      zones={{ hot: 0 }}
      onValueChange={(volume) => host.setVolume(id, volume)}
      className="fader"
    >
      <Fader.Label className="sr-only">{`${name} volume`}</Fader.Label>
      <div className="fader-body">
        <Fader.Control className="fader-control">
          <Fader.Track className="fader-track">
            <Fader.Range className="fader-range" />
            <Fader.Thumb className="fader-thumb" />
          </Fader.Track>
        </Fader.Control>
        <Levels id={id} name={name} />
      </div>
      <Fader.Value className="fader-value" />
    </Fader.Root>
  );
}

export function Mixer({ project, selection, onSelect, onOpen }: { project: Project; selection: Selection; onSelect: (selection: Selection) => void; onOpen: (plugin: PluginRef) => void }) {
  return (
    <div className="mixer" role="group" aria-label="Mixer">
      {project.tracks.map((track) => (
        <div
          key={track.id}
          role="group"
          aria-label={track.name}
          className="strip"
          data-selected={selection.track === track.id || undefined}
          style={{ "--track": track.color } as CSSProperties}
          onPointerDown={() => selection.track !== track.id && onSelect({ track: track.id, clip: null })}
        >
          <span className="strip-name">{track.name}</span>
          <Slots owner={track.id} track={track} onOpen={onOpen} />
          <Knob.Root min={-1} max={1} origin={0} defaultValue={track.pan} resetValue={0} format={pan} onValueChange={(value) => host.setPan(track.id, value)} className="pan">
            <Knob.Label className="sr-only">{`${track.name} pan`}</Knob.Label>
            <Knob.Control className="pan-control">
              <svg viewBox="0 0 100 100" aria-hidden="true">
                <Knob.Track radius={38} className="knob-track" />
                <Knob.Range radius={38} className="knob-range" />
                <Knob.Pointer from={8} to={28} className="knob-pointer" />
              </svg>
            </Knob.Control>
            <Knob.Value className="pan-value" />
          </Knob.Root>
          <div className="strip-toggles">
            <Toggle pressed={track.mute} onPressedChange={(pressed) => host.setMute(track.id, pressed)} aria-label={`Mute ${track.name}`} className="track-toggle mute">
              M
            </Toggle>
            <Toggle pressed={track.solo} onPressedChange={(pressed) => host.setSolo(track.id, pressed)} aria-label={`Solo ${track.name}`} className="track-toggle solo">
              S
            </Toggle>
          </div>
          <Volume id={track.id} name={track.name} value={track.volume} />
        </div>
      ))}
      <div role="group" aria-label="Master" className="strip master" style={{ "--track": "#d6dde4" } as CSSProperties}>
        <span className="strip-name">Master</span>
        <Slots owner={MASTER_ID} onOpen={onOpen} />
        <Volume id={MASTER_ID} name="Master" value={project.master.volume} />
      </div>
    </div>
  );
}
