# Experimental synth

A wavetable synth in the spirit of Serum, to see how far daw-ui's parts go in a real instrument. It is an experiment,
not part of the package: nothing here is published, and it may change or go.

```sh
npm install
npm run synth
```

Open the address Vite prints, press **Start audio** (browsers start audio only after a click), and play:

- with the mouse on the keys, softer towards the back of a key and harder towards its front;
- with the computer's keys: A W S E D F T G Y H U J K play a scale from C, Z and X move an octave;
- with a MIDI keyboard, which is found when the audio starts (Chrome and Edge; Firefox asks first).

## What is in it

- **Two wavetable oscillators**, each with four wavetables of 32 frames (Basic: sine to triangle to saw to square;
  Harmonics; Pulse; Formant), unison of up to 7 voices with detune and blend, octave, semitone and fine tuning, pan
  and level. The view above the knobs draws the frames in depth, and the frame the position reads in front.
- **A sub oscillator** (sine or square) and **noise**.
- **A filter**: low-pass 12 and 24 dB, high-pass, band-pass and notch, with drive, cutoff, resonance and mix.
- **Three envelopes**: the first shapes the volume, the other two are modulation sources.
- **Two LFOs**, whose shape is a curve to draw and bend, as Serum's are: drag the points, bend the segments,
  double-click to add a point. TRIG restarts the LFO with each note.
- **Modulation, as in Serum**: drag a source (ENV 2, ENV 3, LFO 1, LFO 2, velocity, note, two macros) onto a knob
  with a ring. The ring shows the range the source moves the knob over, the small handle beside the knob sets the
  depth (drag it up or down; double-click for 0), and a white arc shows where the knob is now. The matrix lists the
  routings, removes them and adds them from the keyboard too.
- **Chorus, delay and reverb**, and the output's spectrum and level.
- **Presets**: Init, Supersaw Pad, Wobble Bass, Pluck, Vowel Lead.

## How it is made

| Part | Where |
| --- | --- |
| Parameters, sources and destinations, shared by both threads | [`engine/params.ts`](engine/params.ts) |
| Wavetables: frames made in the time domain, then band-limited copies per octave through an FFT, so that high notes do not alias (mipmaps) | [`engine/wavetables.ts`](engine/wavetables.ts) |
| The sound: unison wavetable oscillators, Andrew Simper's state-variable filter, ADSR envelopes, the modulation matrix, eight voices | [`engine/dsp.ts`](engine/dsp.ts) |
| The audio thread: an `AudioWorkletProcessor` around the engine, which reports where modulation is about sixty times a second | [`engine/processor.ts`](engine/processor.ts) |
| The page's side: the audio context, the effects on the Web Audio API's own nodes, and the messages | [`engine/synth.ts`](engine/synth.ts) |
| The interface: daw-ui's `Knob` (with `ModulationRange`, `ModulationDepth` and `Modulation`), `Curve` with `useCurveEditing`, `Keys`, `Spectrum`, `Meter`, `Toggle` and `ToggleGroup` | [`src/`](src/) |

The algorithms are the textbook ones (wavetable mipmaps, the trapezoidal SVF, exponential envelopes); open-source
synths such as Vital and Surge XT were an inspiration for what to build, but no code comes from them (both are GPL).

Nothing renders while you play: the knobs, the rings, the keys, the spectrum and the meter write to the page
themselves, as daw-ui's parts do, and the audio thread does the rest.
