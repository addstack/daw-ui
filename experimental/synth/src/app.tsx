import { useCallback, useState } from "react";

import { Synth } from "../engine/synth.js";
import { Keyboard, useMusicalTyping } from "./keyboard.js";
import { SynthPanel } from "./panel.js";
import { loadPreset } from "./presets.js";

// An experimental wavetable synth in the spirit of Serum, built on daw-ui: two wavetable oscillators with unison,
// a sub and noise, a filter, three envelopes, two LFOs drawn as curves, a modulation matrix you fill by dragging
// sources onto knobs, and chorus, delay and reverb. On its own page here; as an instrument in the experimental DAW.

const synth = new Synth();
// Before the panels that show it render.
loadPreset(synth, 1);

export function App() {
  const [started, setStarted] = useState(false);

  const start = useCallback(async () => {
    if (synth.started) return;
    await synth.start();
    setStarted(true);
    listenToMidi();
  }, []);
  // Stable, so that the keyboard's listeners never change while a key is down.
  const play = useCallback(
    async (note: number, velocity: number) => {
      await start();
      synth.noteOn(note, velocity);
    },
    [start],
  );
  const stop = useCallback((note: number) => synth.noteOff(note), []);
  const octave = useMusicalTyping(play, stop);

  function listenToMidi() {
    navigator
      .requestMIDIAccess?.()
      .then((access) => {
        const listen = (input: MIDIInput) => {
          input.onmidimessage = ({ data }) => {
            if (!data) return;
            const [status = 0, note = 0, velocity = 0] = data;
            const command = status & 0xf0;
            if (command === 0x90 && velocity > 0) synth.noteOn(note, velocity / 127);
            else if (command === 0x80 || command === 0x90) synth.noteOff(note);
          };
        };
        access.inputs.forEach(listen);
        access.onstatechange = () => access.inputs.forEach(listen);
      })
      .catch(() => {});
  }

  return (
    <main className="synth-ui synth">
      <SynthPanel
        synth={synth}
        lead={
          <>
            <h1>
              daw-ui <span>experimental synth</span>
            </h1>
            <button type="button" className={started ? "power on" : "power"} onClick={start}>
              {started ? "Audio on" : "Start audio"}
            </button>
          </>
        }
      />
      <Keyboard play={play} stop={stop} read={() => synth.notes} octave={octave} />
    </main>
  );
}
