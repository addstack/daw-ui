import { useEffect, useRef, useSyncExternalStore } from "react";

import { formats, musicalGrid } from "../../../src/core/index.js";
import { Host } from "../engine/host.js";
import type { Project } from "../engine/project.js";

// The DAW's one host, and how the page reads it: the project renders when it changes; the playhead and meters are
// read once per frame, without rendering.

export const host = new Host();

// In development, the host is in the console as `host`, to look into.
if (import.meta.env.DEV) Object.assign(window, { host });

export function useProject(): Project {
  return useSyncExternalStore(host.subscribe, () => host.project);
}

/** Whether the transport plays, and the metronome: they render the transport's buttons. */
export function useTransport(): { playing: boolean; metronome: boolean } {
  const playing = useSyncExternalStore(host.subscribe, () => host.playing);
  const metronome = useSyncExternalStore(host.subscribe, () => host.metronome);
  return { playing, metronome };
}

/** Runs `draw` once per animation frame while mounted. */
export function useFrame(draw: () => void) {
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
 * The timelines count beats as their seconds: at 60 BPM a beat is a second, so a musical grid there labels bars and
 * beats, whatever the song's tempo.
 */
export const beatGrid = musicalGrid({ bpm: 60 });

export const pitch = formats.pitch({ names: ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"] });
export const position = formats.position();
export const decibels = formats.decibel();
export const pan = formats.pan({ left: "L", right: "R", center: "C" });

/** A selection in the arrangement: a track, and one of its clips. */
export type Selection = { track: string; clip: string | null };

const within = (target: EventTarget | null, selector: string) => target instanceof HTMLElement && target.closest(selector) !== null;

/**
 * Whether a key press types into a field. Nothing else counts for Space: it plays even when a button or a knob
 * has the focus, as in a DAW (Enter presses a button).
 */
export const typing = (target: EventTarget | null) => within(target, "input, select, textarea, [contenteditable], [role=spinbutton]");

/** Whether a key press is in a plug-in's window, whose plug-in has its own undo. */
export const inWindow = (target: EventTarget | null) => within(target, ".daw-window");
