# Experimental ShaperBox

A multi-effect in the spirit of Cableguys' ShaperBox 3, to see how far daw-ui's parts go in a real plug-in's
interface. It plays on its own page here, with a loop or a file to shape, and as an effect in the
[experimental DAW](../daw), where its waves follow the song. It is an experiment, not part of the package: nothing
here is published, and it may change or go.

```sh
npm install
npm run shaperbox
```

Open the address Vite prints and press **▶** (or Space). A two-bar house loop plays through the shapers; the
**Audio** menu plays only its drums, chords or bass. To shape your own audio, drop a file anywhere on the page or
use **Open file…**: it plays in a loop, and when its length is a whole number of 4/4 bars, the tempo is set to match
it. **Bypass** plays the audio without the shapers, to compare.

## What is in it

- **Nine shapers in a chain**, each moving one thing by a wave drawn over a cycle:
  - **Volume**: the wave is the gain, for a sidechain pump, a gate or a tremolo;
  - **Filter**: the cutoff, between the range set beside the wave, low-pass, high-pass, band-pass or notch;
  - **Time**: where in the cycle the audio plays from, as in TimeShaper: the diagonal plays it as it is, a flatter
    line slower and lower, a falling one backwards, a step repeats (tape stop, stutter, reverse, scratch);
  - **Pan** and **Width**: left and right, and mono to twice as wide;
  - **Noise**: noise mixed in, coloured and following the audio's loudness;
  - **Crush**: fewer bits and a lower sample rate;
  - **Drive**: soft or hard clipping, or a fold;
  - **Liquid**: a flanger, a phaser or a chorus, swept by the wave.
- **Order**: drag a shaper in the chain, or use its arrows; its power button turns it on, and a line under it shows
  where its wave is.
- **The wave editor**: drag the points, double-click to add or remove one, drag between two to bend the segment; moves
  snap to the grid chosen (Shift moves freely). Waves to start from, invert, reverse, twice as fast, undo and redo
  (Ctrl or Cmd+Z). Behind the wave, the audio of its last cycle: in grey before the shaper, in colour after it.
- **Rate**: from 1/32 to 8 bars, with triplets and dotted notes, following the tempo; or **Audio**: a transient over
  the threshold starts the wave, and it runs once (a duck on each kick).
- **Multiband**: any shaper can split the audio into three bands, with Linkwitz–Riley crossovers set over the
  spectrum of what comes in; each band has its own wave and can be left as it is.
- **Presets**: Pump, Multiband Pump, Filter Sweep, Tape Stop, Stutter, Autopan Wide, Lo-fi Wobble, Liquid Flange,
  Transient Duck, Noise Riser, Init.

## How it is made

| Part | Where |
| --- | --- |
| Shapers, their parameters and rates, and the messages between the page and the audio thread | [`engine/params.ts`](engine/params.ts) |
| The sound: each shaper's effect, its wave's phase (by the beat, or since a transient), the three-band crossover, the chain, the transport | [`engine/dsp.ts`](engine/dsp.ts) |
| The loop to shape: a kick, a clap, hats, a bass and chords, made at the tempo | [`engine/loops.ts`](engine/loops.ts) |
| The audio thread: an `AudioWorkletProcessor` around the engine, which plays its source, or as an effect shapes its input by the host's clock, and reports where the waves are and the audio of the one shown about sixty times a second | [`engine/processor.ts`](engine/processor.ts) |
| The page's side: the processor in a context of its own, or in a host's (`connect`, `input`, `clock`), files, the waves as curves and their undo | [`engine/box.ts`](engine/box.ts) |
| The interface: daw-ui's `Curve` with `useCurveEditing` for the waves, `Slider` for the cutoff range and the crossover (its `Band`s over a `Spectrum`), `NumberBox` for the tempo and rates, `Knob`, `Toggle`, `ToggleGroup` and `Meter`; `ShaperBoxPanel` shows a box, here or in the DAW's window | [`src/`](src/) |

The algorithms are the textbook ones (Robert Bristow-Johnson's biquads for the crossovers, Andrew Simper's
state-variable filter, a cubic-interpolated delay line for Time and Liquid); ShaperBox was the inspiration for what
to build, but nothing comes from it.

Nothing renders while the audio plays: the playheads, the audio behind the wave, the spectrum and the meter write to
the page themselves, as daw-ui's parts do, and the audio thread does the rest.
