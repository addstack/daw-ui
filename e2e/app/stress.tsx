import { memo } from "react";

import { formats, scales } from "../../src/core/index.js";
import { Fader, Knob, Meter, Toggle, ToggleGroup } from "../../src/react/index.js";

// A worst case for a browser DAW: 64 channel strips with running meters, and a
// 16 × 64 step sequencer. The perf tests count React commits with
// `window.reactCommits` (see index.html).

const CHANNELS = 64;
const STEPS = 64;
const ROWS = 16;

const pan = formats.pan({ left: "L", right: "R", center: "C" });
const decibel = formats.decibel({ locale: "en" });

/** A signal that moves like music: a slow swell with fast peaks, different per channel. */
function level(channel: number): number {
  const now = performance.now() / 1000;
  const swell = 0.5 + 0.5 * Math.sin(now * 0.7 + channel);
  const beat = Math.pow(0.5 + 0.5 * Math.sin(now * 12 + channel * 0.37), 8);
  return -48 + 44 * swell * (0.6 + 0.4 * beat);
}

const Strip = memo(function Strip({ channel }: { channel: number }) {
  return (
    <div className="strip" data-channel={channel}>
      <Meter.Root className="meter" read={() => level(channel)}>
        <Meter.Track className="meter-track" aria-label={`Level ${channel}`}>
          <Meter.Bar className="meter-bar" />
          <Meter.Peak className="meter-peak" />
        </Meter.Track>
      </Meter.Root>
      <Knob.Root className="knob small" min={-1} max={1} origin={0} format={pan}>
        <Knob.Control className="knob-control" aria-label={`Pan ${channel}`}>
          <svg viewBox="0 0 100 100">
            <Knob.Track className="knob-track" />
            <Knob.Range className="knob-range" />
          </svg>
        </Knob.Control>
      </Knob.Root>
      <Fader.Root className="fader small" min={-70} max={6} defaultValue={0} scale={scales.decibel} format={decibel}>
        <Fader.Control className="fader-control" aria-label={`Volume ${channel}`}>
          <Fader.Track className="fader-track">
            <Fader.Range className="fader-range" />
            <Fader.Thumb className="fader-thumb" />
          </Fader.Track>
        </Fader.Control>
      </Fader.Root>
      <Toggle lane="mute" className="step" aria-label={`Mute ${channel}`} />
      <Toggle lane="solo" className="step" aria-label={`Solo ${channel}`} />
    </div>
  );
});

const Step = memo(function Step({ row, step }: { row: number; step: number }) {
  return <Toggle value={`${row}:${step}`} lane={String(row)} className="step" aria-label={`Row ${row} step ${step}`} />;
});

export function Stress() {
  return (
    <main className="stress">
      <h1>daw-ui stress</h1>
      <ToggleGroup paint exclusive={{ solo: "click" }} className="mixer" aria-label="Mixer">
        {Array.from({ length: CHANNELS }, (_, channel) => (
          <Strip key={channel} channel={channel + 1} />
        ))}
      </ToggleGroup>
      <ToggleGroup paint erase="secondary" multiple defaultValue={[]} className="sequencer" aria-label="Sequencer">
        {Array.from({ length: ROWS }, (_, row) => (
          <div key={row} className="sequencer-row">
            {Array.from({ length: STEPS }, (_, step) => (
              <Step key={step} row={row + 1} step={step + 1} />
            ))}
          </div>
        ))}
      </ToggleGroup>
    </main>
  );
}
