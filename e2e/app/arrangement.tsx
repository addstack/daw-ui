import { useState } from "react";

import { createPeaks, formats, musicalGrid } from "../../src/core/index.js";
import { Timeline, Waveform } from "../../src/react/index.js";
import { log } from "./harness.js";

// Three tracks of editable regions at 120 BPM over 16 s, 1000 px wide: 62.5 px per second. Moves and
// trims snap to beats (0.5 s, 31 px), the finest step of the grid at least 12 px apart.

const grid = musicalGrid({ bpm: 120, locale: "en" });
const peaks = createPeaks([new Float32Array(48_000 * 8).map((_, index) => Math.sin(index / 20) * ((index % 24_000) / 24_000))], 48_000);

type Clip = { value: string; track: string; at: number; duration: number; offset: number };

const initial: Clip[] = [
  { value: "Kick", track: "drums", at: 1, duration: 4, offset: 0 },
  { value: "Bass", track: "bass", at: 6, duration: 3, offset: 0 },
];

export function Arrangement() {
  const [clips, setClips] = useState(initial);
  return (
    <main>
      <h1>daw-ui arrangement</h1>
      <Timeline.Root
        className="timeline arrangement"
        start={0}
        end={16}
        snap={grid}
        format={formats.number({ digits: 2, unit: "s", locale: "en" })}
        onRegionsChange={(changes, { edit }) => log({ source: "regions", type: "change", value: changes, reason: edit })}
        onGestureEnd={(changes) =>
          setClips((current) =>
            current.map((clip) => {
              const change = changes.find((one) => one.value === clip.value);
              return change ? { ...clip, at: change.at, duration: change.duration, offset: change.offset, track: change.track ?? clip.track } : clip;
            }),
          )
        }
        data-testid="arrangement"
      >
        {["drums", "bass", "keys"].map((track) => (
          <Timeline.Track key={track} value={track} className="track tall" aria-label={track}>
            {clips
              .filter((clip) => clip.track === track)
              .map((clip) => (
                <Timeline.Region key={clip.value} className="clip region" length={8} {...clip}>
                  <Timeline.RegionHeader className="region-header">
                    <Timeline.RegionLabel>{clip.value}</Timeline.RegionLabel>
                  </Timeline.RegionHeader>
                  <Timeline.RegionContent className="region-content">
                    <Waveform.Root peaks={peaks} className="clip-waveform">
                      <Waveform.Shape className="clip-shape" />
                    </Waveform.Root>
                  </Timeline.RegionContent>
                  <Timeline.RegionHandle side="start" className="region-handle" aria-label="Start" />
                  <Timeline.RegionHandle side="end" className="region-handle" aria-label="End" />
                </Timeline.Region>
              ))}
          </Timeline.Track>
        ))}
      </Timeline.Root>
    </main>
  );
}
