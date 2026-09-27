import { useEffect, useState } from "react";

import { createPeaks, createPeaksRecorder, musicalGrid, type Peaks } from "../../src/core/index.js";
import type { CurvePoint } from "../../src/core/index.js";
import { Curve, Notes, Region, Timeline, useCurveEditing, Waveform, type Note } from "../../src/react/index.js";

// 16 tracks with two 4-minute clips each on one timeline, with one playhead
// over all of them, driven once per frame:
// - ?mode=play: playback, the view stands still;
// - ?mode=scroll: the view pages along at 4 seconds per second;
// - ?mode=zoom: the view zooms in and out without pause;
// - ?mode=record: playback, and a 17th track records a take in blocks of 128 samples, as an AudioWorklet delivers them.
// A ruler and a grid of bars and beats run over all of it. The tracks are the page's own rows: the timeline
// knows nothing of them. With ?notes, one more track holds two MIDI clips of sixteenth notes; with ?curve, an
// automation lane of 2000 bent points lies on the timeline itself, outside any region; with ?curve&edit, its
// points can be edited, and the application keeps what each gesture leaves.

const TRACKS = 16;
const SAMPLE_RATE = 48_000;
const SECONDS = 300;

/** Five minutes of a drum-like pattern: decaying bursts on every beat at 120 BPM, louder on the one. */
function take(): Peaks {
  const samples = new Float32Array(SECONDS * SAMPLE_RATE);
  for (let index = 0; index < samples.length; index++) {
    const t = index / SAMPLE_RATE;
    const beat = t % 0.5;
    const accent = Math.floor(t / 0.5) % 4 === 0 ? 1 : 0.6;
    samples[index] = accent * Math.exp(-beat * 9) * Math.sin(index * 0.07 + Math.sin(index * 0.013) * 3);
  }
  return createPeaks([samples], SAMPLE_RATE);
}

const peaks = take();

/** Seven minutes of automation, a bent point every 0.21 seconds, up and down. */
const automation: CurvePoint[] = Array.from({ length: 2000 }, (_, index) => ({ at: index * 0.21, value: 0.5 + 0.4 * Math.sin(index / 3), shape: 0.4 }));

/** 235 seconds of sixteenths at 120 BPM, climbing and falling over two octaves: 1880 notes. */
const melody: Note[] = Array.from({ length: 1880 }, (_, index) => ({ at: index * 0.125, duration: 0.1, pitch: 48 + ((index * 7) % 24) }));
const grid = musicalGrid({ bpm: 120, locale: "en" });
const recording = createPeaksRecorder({ sampleRate: SAMPLE_RATE, channels: 1 });
// With ?start=manual, time stands at 0 until window.e2e.start(): the perf tests let the first tiles be drawn,
// then start playback, scrolling, zooming or recording when they start measuring.
let started: number | null = new URLSearchParams(location.search).get("start") === "manual" ? null : performance.now() / 1000;
const start = () => {
  started = performance.now() / 1000;
};
const elapsed = () => (started === null ? 0 : performance.now() / 1000 - started);

const views = {
  play: () => [0, 60] as const,
  scroll: () => {
    const start = (elapsed() * 4) % 420;
    return [start, start + 60] as const;
  },
  zoom: () => [0, 35 + 25 * Math.sin(elapsed() * 2)] as const,
  record: () => [0, 60] as const,
};

/** Appends what a microphone would have delivered since the last frame. */
function useRecording(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const block = new Float32Array(128);
    let frame = requestAnimationFrame(function tick() {
      while (recording.length < elapsed() * SAMPLE_RATE) {
        for (let index = 0; index < block.length; index++) {
          const t = (recording.length + index) / SAMPLE_RATE;
          block[index] = Math.exp(-(t % 0.5) * 6) * Math.sin(t * 900);
        }
        recording.append([block]);
      }
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [active]);
}

export function Waveforms() {
  const mode = (new URLSearchParams(location.search).get("mode") ?? "play") as keyof typeof views;
  const view = views[mode] ?? views.play;
  useRecording(mode === "record");
  useEffect(() => {
    window.e2e.start = start;
  }, []);
  // For comparing costs: ?ruler=0 and ?grid=0 leave them out.
  const search = new URLSearchParams(location.search);
  const showRuler = search.get("ruler") !== "0";
  const showGrid = search.get("grid") !== "0";
  const showNotes = search.has("notes");
  const showCurve = search.has("curve");
  const [points, setPoints] = useState(automation);
  const editing = useCurveEditing({ snap: { time: grid }, onGestureEnd: setPoints });
  return (
    <main>
      <h1>daw-ui waveforms</h1>
      <Timeline.Root
        className="timeline"
        start={0}
        end={60}
        readView={mode === "play" ? undefined : view}
        read={elapsed}
      >
        {showRuler && (
          <Timeline.Ruler className="ruler" grid={grid} data-testid="ruler">
            <Timeline.Grid className="ruler-marks" grid={grid} style={{ top: "60%" }} />
          </Timeline.Ruler>
        )}
        <div className="tracks">
          {showGrid && <Timeline.Grid className="grid" grid={grid} />}
          {showGrid && <Timeline.Grid className="grid-bars" grid={grid} spacing={64} />}
          {Array.from({ length: TRACKS }, (_, track) => (
            <div key={track} className="track" role="group" aria-label={`Track ${track + 1}`}>
              {[0, 240].map((at) => (
                <Region.Root key={at} className="clip" at={at} duration={235} offset={(track * 7) % 60}>
                  <Waveform.Root className="clip-waveform" peaks={peaks} aria-label={`Track ${track + 1} at ${at}`}>
                    <Waveform.Shape className="clip-shape" />
                    <Waveform.Progress className="clip-progress" />
                  </Waveform.Root>
                </Region.Root>
              ))}
            </div>
          ))}
          {showNotes && (
            <div className="track" role="group" aria-label="Keys">
              {[0, 240].map((at) => (
                <Region.Root key={at} className="clip" at={at} duration={235}>
                  <Notes.Root className="clip-waveform" notes={melody} aria-label={`Keys at ${at}`}>
                    <Notes.Shape className="clip-notes" />
                    <Notes.Progress className="clip-progress" />
                  </Notes.Root>
                </Region.Root>
              ))}
            </div>
          )}
          {showCurve && (
            <div className="track" role="group" aria-label="Volume">
              <Curve.Root className="clip-waveform" points={points} editing={search.has("edit") ? editing : undefined} aria-label="Volume automation">
                <Curve.Fill className="clip-curve-fill" />
                <Curve.Line className="clip-curve" thickness={1.5} />
                <Curve.Dots className="clip-curve" size={4} />
                <Curve.Bend className="curve-bend" />
                <Curve.Handle className="curve-handle" aria-label="Point" />
              </Curve.Root>
            </div>
          )}
          {mode === "record" && (
            <div className="track" role="group" aria-label="Recording">
              <Region.Root className="clip" at={0} read={() => ({ duration: recording.duration })}>
                <Waveform.Root className="clip-waveform" peaks={recording} aria-label="Recording">
                  <Waveform.Shape className="clip-shape" />
                </Waveform.Root>
              </Region.Root>
            </div>
          )}
        </div>
        <Timeline.Playhead className="playhead" data-testid="playhead" />
      </Timeline.Root>
    </main>
  );
}
