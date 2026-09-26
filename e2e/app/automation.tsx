import { memo, useEffect, useState } from "react";

import { formats, scales } from "../../src/core/index.js";
import { Fader, Knob } from "../../src/react/index.js";

// 64 channels whose pan knob and volume fader are driven by automation on
// every frame, two ways, which the perf tests compare:
// - ?mode=state: the React way, a time in state and a controlled `value`;
// - ?mode=read: `read`, which the controls call once per frame, without rendering.

const CHANNELS = 64;

const panFormat = formats.pan({ left: "L", right: "R", center: "C" });
const decibel = formats.decibel({ locale: "en" });

const pan = (channel: number, time: number) => Math.sin(time * 0.9 + channel);
const volume = (channel: number, time: number) => -30 + 30 * (0.5 + 0.5 * Math.sin(time * 0.6 + channel * 0.2));

const now = () => performance.now() / 1000;

/** The props that drive a control: a value from React state, or `read`. */
function driven(mode: Mode, value: (channel: number, time: number) => number, channel: number, time: number) {
  return mode === "state" ? { value: value(channel, time) } : { read: () => value(channel, now()) };
}

type Mode = "state" | "read";

const Strip = memo(function Strip({ channel, time, mode }: { channel: number; time: number; mode: Mode }) {
  return (
    <div className="strip">
      <Knob.Root className="knob small" min={-1} max={1} origin={0} format={panFormat} {...driven(mode, pan, channel, time)}>
        <Knob.Control className="knob-control" aria-label={`Pan ${channel}`}>
          <svg viewBox="0 0 100 100">
            <Knob.Track className="knob-track" />
            <Knob.Range className="knob-range" />
            <Knob.Pointer className="knob-pointer" from={0} to={30} />
          </svg>
        </Knob.Control>
        <Knob.Value className="value" />
      </Knob.Root>
      <Fader.Root
        className="fader small"
        min={-70}
        max={6}
        scale={scales.decibel}
        format={decibel}
        zones={{ hot: 0 }}
        {...driven(mode, volume, channel, time)}
      >
        <Fader.Control className="fader-control" aria-label={`Volume ${channel}`}>
          <Fader.Track className="fader-track">
            <Fader.Range className="fader-range" />
            <Fader.Thumb className="fader-thumb" />
          </Fader.Track>
        </Fader.Control>
        <Fader.Value className="value" />
      </Fader.Root>
    </div>
  );
});

export function Automation() {
  const mode: Mode = new URLSearchParams(location.search).get("mode") === "read" ? "read" : "state";
  const [time, setTime] = useState(0);
  useEffect(() => {
    if (mode !== "state") return;
    let frame = requestAnimationFrame(function tick(now) {
      setTime(now / 1000);
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [mode]);
  return (
    <main className="stress">
      <h1>daw-ui automation</h1>
      <div className="mixer">
        {Array.from({ length: CHANNELS }, (_, channel) => (
          <Strip key={channel} channel={channel + 1} time={time} mode={mode} />
        ))}
      </div>
    </main>
  );
}
