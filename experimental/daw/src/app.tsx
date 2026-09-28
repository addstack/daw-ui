import { useCallback, useEffect, useRef, useState } from "react";

import { Toggle, ToggleGroup } from "../../../src/react/index.js";
import { useMusicalTyping } from "../../synth/src/keyboard.js";
import { Arrangement } from "./arrangement.js";
import { Devices, PluginWindows, pluginKey } from "./devices.js";
import { Mixer, type PluginRef } from "./mixer.js";
import { PianoRoll } from "./pianoroll.js";
import { host, inWindow, typing, useProject, type Selection } from "./state.js";
import { Transport } from "./transport.js";

// An experimental DAW, built on daw-ui: an arrangement of instrument and audio tracks, a piano roll, a mixer, and
// three plug-ins: the experimental wavetable synth and a drum machine as instruments, and the experimental
// ShaperBox as an effect, on any track and on the master, each with its own panel in a window.

type Tab = "editor" | "mixer" | "devices";

export function App() {
  const project = useProject();
  const [selection, setSelection] = useState<Selection>(() => {
    const track = project.tracks[2] ?? project.tracks[0]!;
    return { track: track.id, clip: track.clips[0]?.id ?? null };
  });
  const [tab, setTab] = useState<Tab>("editor");
  const [windows, setWindows] = useState<PluginRef[]>([]);
  const [versions, setVersions] = useState<Record<string, number>>({});
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  const track = project.tracks.find((one) => one.id === selection.track);
  const clip = track?.clips.find((one) => one.id === selection.clip);

  const open = (plugin: PluginRef) => setWindows((current) => (current.some((one) => pluginKey(one) === pluginKey(plugin)) ? current : [...current, plugin]));
  const close = (plugin: PluginRef) => setWindows((current) => current.filter((one) => pluginKey(one) !== pluginKey(plugin)));
  const restart = (plugin: PluginRef) => setVersions((current) => ({ ...current, [pluginKey(plugin)]: (current[pluginKey(plugin)] ?? 0) + 1 }));

  // The computer's keys play the selected track's instrument; stable, so that a key held is released.
  const play = useCallback((note: number, velocity: number) => void host.noteOn(selectionRef.current.track, note, velocity), []);
  const stop = useCallback((note: number) => host.noteOff(selectionRef.current.track, note), []);
  useMusicalTyping(play, stop);

  // A MIDI keyboard plays it too, once the audio has started.
  useEffect(() => {
    let access: MIDIAccess | null = null;
    const listen = (input: MIDIInput) => {
      input.onmidimessage = ({ data }) => {
        if (!data) return;
        const [status = 0, note = 0, velocity = 0] = data;
        const command = status & 0xf0;
        if (command === 0x90 && velocity > 0) void host.noteOn(selectionRef.current.track, note, velocity / 127);
        else if (command === 0x80 || command === 0x90) host.noteOff(selectionRef.current.track, note);
      };
    };
    navigator
      .requestMIDIAccess?.()
      .then((granted) => {
        access = granted;
        access.inputs.forEach(listen);
        access.onstatechange = () => access?.inputs.forEach(listen);
      })
      .catch(() => {});
    return () => access?.inputs.forEach((input) => (input.onmidimessage = null));
  }, []);

  // Space plays and stops; Ctrl or Cmd with Z undoes, with Shift (or Y) redoes; with D, duplicates the clip.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const command = event.metaKey || event.ctrlKey;
      if (typing(event.target)) return;
      if (event.key === " ") {
        event.preventDefault();
        if (!event.repeat) host.toggle();
      } else if (command && !inWindow(event.target) && (event.key.toLowerCase() === "z" || event.key.toLowerCase() === "y")) {
        event.preventDefault();
        if (event.key.toLowerCase() === "y" || event.shiftKey) host.redo();
        else host.undo();
      } else if (command && event.key.toLowerCase() === "d" && !inWindow(event.target)) {
        const { track: trackId, clip: clipId } = selectionRef.current;
        if (!clipId) return;
        event.preventDefault();
        const copy = host.duplicateClip(trackId, clipId);
        if (copy) setSelection({ track: trackId, clip: copy });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const showClip = (next: Selection) => {
    setSelection(next);
    setTab("editor");
  };

  return (
    <div className="daw">
      <Transport project={project} />
      <Arrangement project={project} selection={selection} onSelect={setSelection} onOpen={showClip} />
      <section className="bottom" aria-label="Editor">
        <nav className="tabs">
          <ToggleGroup aria-label="Panel" value={[tab]} onValueChange={(value) => value[0] && setTab(value[0] as Tab)} className="segmented">
            <Toggle value="editor" className="segment">
              Clip
            </Toggle>
            <Toggle value="mixer" className="segment">
              Mixer
            </Toggle>
            <Toggle value="devices" className="segment">
              Devices
            </Toggle>
          </ToggleGroup>
          <span className="tabs-hint">
            {track?.instrument ? `Keys A–K play ${track.name}; Z and X change the octave. ` : ""}Space plays. Double-click a clip to edit it.
          </span>
        </nav>
        <div className="bottom-body">
          {tab === "editor" &&
            (track && clip?.kind === "midi" ? (
              <PianoRoll key={clip.id} track={track} clip={clip} />
            ) : (
              <p className="empty">{clip ? "An audio clip: drag its edges in the arrangement to trim it." : "Select a MIDI clip to edit its notes, or double-click an empty place of an instrument track for a new one."}</p>
            ))}
          {tab === "mixer" && <Mixer project={project} selection={selection} onSelect={setSelection} onOpen={open} />}
          {tab === "devices" && <Devices project={project} selection={selection} onOpen={open} onPresetChange={restart} />}
        </div>
      </section>
      <PluginWindows open={windows} versions={versions} project={project} onClose={close} />
    </div>
  );
}
