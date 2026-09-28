import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type PointerEvent } from "react";

import { Meter, Notes, Region, Timeline, Toggle, Waveform } from "../../../src/react/index.js";
import { emptyClip } from "../engine/host.js";
import { BEATS_PER_BAR, type Clip, type Project, type Track } from "../engine/project.js";
import { beatGrid, host, type Selection } from "./state.js";

// The arrangement, as the arrangement block does it: a column of track headers beside a timeline, whose rows hold
// the tracks' clips as regions, MIDI drawn as notes and audio as a waveform. Drag a clip to move it, its edges to
// trim it; double-click an empty place of an instrument track for a new clip. The ruler moves the playhead, and
// the loop above it is a region too: drag it, or its ends. Ctrl or Cmd with the wheel zooms, Shift scrolls.

const MIN_BEATS = 4;
const MAX_BEATS = 512;

type Edit = (clip: Clip, beats: number) => Clip;

const move: Edit = (clip, beats) => ({ ...clip, at: Math.max(0, clip.at + beats) });

/** Audio's content ends where its file does; MIDI's goes on. */
const contentEnd = (clip: Clip) => (clip.kind === "audio" ? audioBeats(clip.audio) : Infinity);
const audioBeats = (audio: string) => {
  const found = host.audio.get(audio);
  return found ? (found.buffer.duration * host.project.bpm) / 60 : Infinity;
};

const trimEnd =
  (step: number): Edit =>
  (clip, beats) => ({ ...clip, duration: Math.min(contentEnd(clip) - clip.offset, Math.max(step, clip.duration + beats)) });

/** The start moves the content with it: what plays stays where it is in the song. */
const trimStart =
  (step: number): Edit =>
  (clip, beats) => {
    const by = Math.min(clip.duration - step, Math.max(-Math.min(clip.offset, clip.at), beats));
    return { ...clip, at: clip.at + by, offset: clip.offset + by, duration: clip.duration - by };
  };

function TrackHeader({ track, selected, onSelect }: { track: Track; selected: boolean; onSelect: () => void }) {
  const [renaming, setRenaming] = useState(false);
  return (
    <div className="track-header" data-selected={selected || undefined} style={{ "--track": track.color } as CSSProperties} onPointerDown={onSelect}>
      <span className="track-color" />
      <div className="track-title">
        {renaming ? (
          <input
            autoFocus
            defaultValue={track.name}
            aria-label="Track name"
            onBlur={(event) => {
              setRenaming(false);
              const name = event.target.value.trim();
              if (name && name !== track.name) host.updateTrack(track.id, (one) => ({ ...one, name }));
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") setRenaming(false);
            }}
          />
        ) : (
          <span className="track-name" onDoubleClick={() => setRenaming(true)} title="Double-click to rename">
            {track.name}
          </span>
        )}
        <span className="track-kind">{track.instrument === "synth" ? "Synth" : track.instrument === "drums" ? "Drum Machine" : "Audio"}</span>
      </div>
      <Toggle pressed={track.mute} onPressedChange={(pressed) => host.setMute(track.id, pressed)} aria-label={`Mute ${track.name}`} className="track-toggle mute">
        M
      </Toggle>
      <Toggle pressed={track.solo} onPressedChange={(pressed) => host.setSolo(track.id, pressed)} aria-label={`Solo ${track.name}`} className="track-toggle solo">
        S
      </Toggle>
      <button type="button" className="track-remove" aria-label={`Remove ${track.name}`} title="Remove the track" onClick={() => host.removeTrack(track.id)}>
        ×
      </button>
      <Meter.Root read={() => Math.max(...host.levels(track.id))} min={-60} max={6} orientation="horizontal" className="track-meter">
        <Meter.Track aria-label={`${track.name} level`} className="meter-track horizontal">
          <Meter.Bar className="meter-bar horizontal" />
        </Meter.Track>
      </Meter.Root>
    </div>
  );
}

function ClipContent({ clip }: { clip: Clip }) {
  if (clip.kind === "midi") {
    if (clip.notes.length === 0) return null;
    return (
      <Notes.Root notes={clip.notes} className="clip-notes">
        <Notes.Shape className="clip-shape" />
        <Notes.Progress className="clip-played" />
      </Notes.Root>
    );
  }
  const peaks = host.peaksOf(clip.audio);
  if (!peaks) return null;
  return (
    <Waveform.Root peaks={peaks} className="clip-wave">
      <Waveform.Shape className="clip-shape" />
      <Waveform.Progress className="clip-played" />
    </Waveform.Root>
  );
}

export function Arrangement({
  project,
  selection,
  onSelect,
  onOpen,
}: {
  project: Project;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  /** Shows a clip in the editor below. */
  onOpen: (selection: Selection) => void;
}) {
  const view = useRef({ start: 0, end: 10 * BEATS_PER_BAR });
  const lanes = useRef<HTMLDivElement>(null);
  const timeline = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // The clip a drag is changing, drawn from here until it is dropped.
  const [draft, setDraft] = useState<Clip | null>(null);
  const [loopDraft, setLoopDraft] = useState<Project["loop"] | null>(null);
  const loop = loopDraft ?? project.loop;

  /** The beat under a pointer, and beats per CSS pixel. */
  const beatAt = (clientX: number) => {
    const box = lanes.current!.getBoundingClientRect();
    const { start, end } = view.current;
    return start + ((clientX - box.left) / box.width) * (end - start);
  };
  const beatsPerPixel = () => (view.current.end - view.current.start) / lanes.current!.clientWidth;

  // Ctrl or Cmd with the wheel zooms about the pointer; Shift, or a sideways swipe, scrolls.
  useEffect(() => {
    const element = timeline.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      const { start, end } = view.current;
      const span = end - start;
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const pivot = beatAt(event.clientX);
        const next = Math.min(MAX_BEATS, Math.max(MIN_BEATS, span * Math.exp(event.deltaY * 0.002)));
        const from = Math.max(0, pivot - ((pivot - start) / span) * next);
        view.current = { start: from, end: from + next };
      } else if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        event.preventDefault();
        const delta = ((event.shiftKey ? event.deltaY : event.deltaX) / element.clientWidth) * span;
        const from = Math.max(0, start + delta);
        view.current = { start: from, end: from + span };
      }
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  const zoom = (factor: number) => {
    const { start, end } = view.current;
    const span = Math.min(MAX_BEATS, Math.max(MIN_BEATS, (end - start) * factor));
    view.current = { start, end: start + span };
  };

  /** Follows a drag of a clip, snapped to beats (Alt: sixteenths), and keeps the result when it ends. */
  const drag = (event: PointerEvent<HTMLElement>, track: Track, clip: Clip, edit: (step: number) => Edit) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect({ track: track.id, clip: clip.id });
    const element = event.currentTarget;
    // Pressed, a clip takes the keys: arrows, Delete, Enter.
    element.closest<HTMLElement>(".clip")?.focus({ preventScroll: true });
    element.setPointerCapture(event.pointerId);
    const scale = beatsPerPixel();
    const from = event.clientX;
    let latest = clip;
    const follow = (moved: globalThis.PointerEvent) => {
      const step = moved.altKey ? 0.25 : 1;
      const next = edit(step)(clip, Math.round(((moved.clientX - from) * scale) / step) * step);
      if (next.at === latest.at && next.duration === latest.duration && next.offset === latest.offset) return;
      latest = next;
      setDraft(next);
    };
    const release = () => {
      element.removeEventListener("pointermove", follow);
      element.removeEventListener("pointerup", release);
      if (latest !== clip) host.updateClip(track.id, clip.id, () => latest);
      setDraft(null);
    };
    element.addEventListener("pointermove", follow);
    element.addEventListener("pointerup", release);
  };

  // Arrows move a clip by a beat, with Shift they change its length; Enter opens it; Delete removes it.
  const clipKeys = (event: KeyboardEvent, track: Track, clip: Clip) => {
    const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (direction) host.updateClip(track.id, clip.id, (one) => (event.shiftKey ? trimEnd(1)(one, direction) : move(one, direction)));
    else if (event.key === "Enter") onOpen({ track: track.id, clip: clip.id });
    else if (event.key === "Delete" || event.key === "Backspace") {
      host.removeClip(track.id, clip.id);
      onSelect({ track: track.id, clip: null });
    } else return;
    event.preventDefault();
    event.stopPropagation();
  };

  /** Follows a drag of the loop, or of one of its ends, in bars. */
  const dragLoop = (event: PointerEvent<HTMLElement>, part: "body" | "start" | "end") => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const element = event.currentTarget;
    element.setPointerCapture(event.pointerId);
    const scale = beatsPerPixel();
    const from = event.clientX;
    const original = project.loop;
    let latest = original;
    const follow = (moved: globalThis.PointerEvent) => {
      const beats = Math.round(((moved.clientX - from) * scale) / BEATS_PER_BAR) * BEATS_PER_BAR;
      const length = original.end - original.start;
      latest =
        part === "body"
          ? { ...original, start: Math.max(0, original.start + beats), end: Math.max(0, original.start + beats) + length }
          : part === "start"
            ? { ...original, start: Math.min(original.end - BEATS_PER_BAR, Math.max(0, original.start + beats)) }
            : { ...original, end: Math.max(original.start + BEATS_PER_BAR, original.end + beats) };
      setLoopDraft(latest);
    };
    const release = () => {
      element.removeEventListener("pointermove", follow);
      element.removeEventListener("pointerup", release);
      if (latest !== original) host.setLoop({ ...latest, on: true });
      setLoopDraft(null);
    };
    element.addEventListener("pointermove", follow);
    element.addEventListener("pointerup", release);
  };

  const dropFiles = (event: DragEvent, track?: Track) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.stopPropagation();
    const at = Math.max(0, Math.round(beatAt(event.clientX)));
    for (const file of event.dataTransfer.files) void host.addAudio(file, at, track?.instrument === null ? track.id : undefined).then((id) => onSelect({ track: id, clip: null }));
  };

  return (
    <section className="arrangement" aria-label="Arrangement">
      <div className="arrangement-scroll">
        <div className="arrangement-headers">
          <div className="corner">
            <button type="button" aria-label="Zoom out" title="Zoom out (Ctrl or Cmd with the wheel)" onClick={() => zoom(1.5)}>
              −
            </button>
            <button type="button" aria-label="Zoom in" title="Zoom in (Ctrl or Cmd with the wheel)" onClick={() => zoom(1 / 1.5)}>
              +
            </button>
          </div>
          {project.tracks.map((track) => (
            <TrackHeader key={track.id} track={track} selected={selection.track === track.id} onSelect={() => onSelect({ track: track.id, clip: selection.track === track.id ? selection.clip : null })} />
          ))}
          <div className="add-track">
            <button type="button" onClick={() => onSelect({ track: host.addTrack("synth"), clip: null })}>
              + Synth
            </button>
            <button type="button" onClick={() => onSelect({ track: host.addTrack("drums"), clip: null })}>
              + Drums
            </button>
            <button type="button" onClick={() => fileInput.current?.click()}>
              + Audio…
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="audio/*"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void host.addAudio(file).then((id) => onSelect({ track: id, clip: null }));
                event.target.value = "";
              }}
            />
          </div>
        </div>

        <Timeline.Root
          ref={timeline}
          start={view.current.start}
          end={view.current.end}
          readView={() => [view.current.start, view.current.end]}
          read={() => host.position()}
          className="arrangement-timeline"
          onDragOver={(event) => event.dataTransfer.types.includes("Files") && event.preventDefault()}
          onDrop={(event) => dropFiles(event)}
        >
          <div className="ruler-row">
          <Timeline.Ruler
            grid={beatGrid}
            className="ruler"
            onPointerDown={(event) => {
              if (event.button === 0) host.seek(Math.max(0, Math.round(beatAt(event.clientX) * 4) / 4));
            }}
          >
            <Region.Root
              at={loop.start}
              duration={loop.end - loop.start}
              className="loop"
              data-on={loop.on || undefined}
              onPointerDown={(event) => dragLoop(event, "body")}
              onDoubleClick={() => host.setLoop({ ...project.loop, on: !project.loop.on })}
              title="Drag to move the loop; double-click to turn it on or off"
            >
              <Region.Label className="sr-only">Loop</Region.Label>
              <span className="loop-edge start" onPointerDown={(event) => dragLoop(event, "start")} />
              <span className="loop-edge end" onPointerDown={(event) => dragLoop(event, "end")} />
            </Region.Root>
          </Timeline.Ruler>
          </div>
          <div ref={lanes} className="lanes">
            <Timeline.Grid grid={beatGrid} className="grid-fine" />
            <Timeline.Grid grid={beatGrid} spacing={64} className="grid-coarse" />
            {project.tracks.map((track) => (
              <div
                key={track.id}
                role="group"
                aria-label={track.name}
                className="lane"
                data-selected={selection.track === track.id || undefined}
                style={{ "--track": track.color } as CSSProperties}
                onPointerDown={(event) => event.button === 0 && onSelect({ track: track.id, clip: null })}
                onDoubleClick={(event) => {
                  if (track.instrument === null) return;
                  const clip = emptyClip(Math.floor(beatAt(event.clientX) / BEATS_PER_BAR) * BEATS_PER_BAR);
                  host.addClip(track.id, clip);
                  onOpen({ track: track.id, clip: clip.id });
                }}
                onDragOver={(event) => event.dataTransfer.types.includes("Files") && event.preventDefault()}
                onDrop={(event) => dropFiles(event, track)}
              >
                {track.clips.map((original) => {
                  const clip = draft?.id === original.id ? draft : original;
                  const selected = selection.clip === clip.id;
                  return (
                    <Region.Root
                      key={clip.id}
                      at={clip.at}
                      duration={clip.duration}
                      offset={clip.offset}
                      tabIndex={0}
                      className="clip"
                      data-selected={selected || undefined}
                      data-kind={clip.kind}
                      onPointerDown={(event) => drag(event, track, original, () => move)}
                      onDoubleClick={(event) => {
                        event.stopPropagation();
                        onOpen({ track: track.id, clip: clip.id });
                      }}
                      onFocus={() => selection.clip !== clip.id && onSelect({ track: track.id, clip: clip.id })}
                      onKeyDown={(event) => clipKeys(event, track, original)}
                    >
                      <Region.Header className="clip-header">
                        <Region.Label className="clip-name">{clip.name}</Region.Label>
                      </Region.Header>
                      <Region.Content className="clip-content">
                        <ClipContent clip={clip} />
                      </Region.Content>
                      <span className="clip-edge start" onPointerDown={(event) => drag(event, track, original, trimStart)} />
                      <span className="clip-edge end" onPointerDown={(event) => drag(event, track, original, trimEnd)} />
                    </Region.Root>
                  );
                })}
              </div>
            ))}
            <div className="lane spare" onDragOver={(event) => event.dataTransfer.types.includes("Files") && event.preventDefault()} onDrop={(event) => dropFiles(event)}>
              <span className="lane-hint">Drop audio files here, or double-click an instrument track for a clip.</span>
            </div>
          </div>
          <Timeline.Playhead className="playhead" />
        </Timeline.Root>
      </div>
    </section>
  );
}
