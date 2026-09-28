# Experimental DAW

A small DAW, to see daw-ui's parts together in one app: an arrangement, a piano roll, a mixer, and plug-ins with
windows of their own. The instruments are the [experimental synth](../synth) (a wavetable synth in the spirit of
Serum) and a drum machine made here; the effect is the [experimental ShaperBox](../shaperbox). It is an
experiment, not part of the package: nothing here is published, and it may change or go.

```sh
npm install
npm run daw
```

Open the address Vite prints and press **Play** or Space: an eight-bar song in A minor plays in a loop: drums, a
bass and chords (both pumped by a ShaperBox), and a plucked arpeggio.

## What you can do

- **Transport**: play, pause and stop (again: back to the start), loop, a metronome. The position counts in bars,
  beats and sixteenths, and takes one dragged or typed; the tempo too.
- **Arrangement**: drag a clip to move it by beats (Alt: by sixteenths), its edges to trim it; arrows move the
  selected clip and Shift with them changes its length, Delete removes it, Ctrl or Cmd+D duplicates it.
  Double-click an empty place of an instrument track for a new clip. Click the ruler to move the playhead. Drag
  the loop over the ruler, or its ends; double-click it to turn it on or off. Ctrl or Cmd with the wheel zooms;
  Shift with the wheel scrolls.
- **Tracks**: add a synth, a drum machine, or audio (from a file, or by dropping files on the arrangement); mute,
  solo, rename (double-click the name) and remove them.
- **Piano roll**: double-click a MIDI clip. Press an empty place to draw a note, drag a note to move it, drag its
  right end to lengthen it; the secondary button or a double-click removes one. Velocities are bars to paint
  below. The keys at its side play the track's instrument.
- **Mixer**: a strip for each track and the master, with its devices, pan, mute and solo, and a fader beside the
  level of each side.
- **Devices**: the track's chain as cards: the instrument with its presets, then its ShaperBoxes, which can be
  added, moved along the chain, switched off and removed. **Open** shows the plug-in's own panel in a window: the
  synth's whole panel with its modulation, ShaperBox's chain and wave editor, the drum machine's pads.
- **Playing by hand**: the computer's keys (A W S E D F T G Y H U J K, Z and X for octaves) and a MIDI keyboard
  play the selected track's instrument.
- **Undo and redo** (Ctrl or Cmd+Z, with Shift to redo) for everything in the song: clips, notes, tracks,
  devices. Plug-ins keep their own settings, as in a DAW.

## How it is made

| Part | Where |
| --- | --- |
| The song as data: tempo, loop, tracks, clips and notes in beats, devices; the demo song | [`engine/project.ts`](engine/project.ts) |
| The host: the plug-ins, the audio graph (each track's instrument or audio, its effects, volume, pan, mute, meters, into the master), undo, and the transport | [`engine/host.ts`](engine/host.ts) |
| The drum machine: eight sounds made from textbook parts, played by the Web Audio API's buffer sources | [`engine/drums.ts`](engine/drums.ts) |
| The interface: `Timeline`, `Region`, `Notes` and `Waveform` for the arrangement; `Keys`, `Notes` and `BarGraph` for the piano roll; `Fader`, `Meter`, `Knob` and `Toggle` for the mixer; `NumberBox` with segments for the position and tempo | [`src/`](src/) |

The transport schedules notes and audio a little ahead of the audio context's clock, from a worker, so that it
keeps time in a tab in the background. Notes reach the synth with the time they start at, and its audio thread
renders each block in pieces, so that every note starts on its own sample; the drum machine and audio clips start
their buffer sources at the same times. Each ShaperBox is told the song's beat at a moment, and when the loop comes
round, so its waves follow the bars as a plug-in's do in a host.

A plug-in here is a class that plays into a node the host gives it: `Synth.connect(context, destination)`,
`Box.connect(context, destination)` with `Box.input` to send audio into, and `DrumMachine.connect`. The same
classes and panels run the synth and ShaperBox on their own pages.

Not in it: recording, saving a song, automation, audio that follows the tempo (an audio clip keeps its seconds;
its length in beats changes with the tempo).
