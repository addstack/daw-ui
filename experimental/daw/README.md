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
- **Composing**: two rows at the top of the arrangement hold the song's chords and its structure (sections such as
  Verse, Chorus, Drop). **Compose** (the tab below, or ⋮ beside either row) generates both from a style (Pop, EDM,
  Lo-fi), a key and a seed, at a tempo the style likes. Click a chord to hear it on the selected track,
  double-click it to put another in its place; double-click a section to loop it. Then generate the notes of any
  instrument track as drums, bass, chords, an arpeggio or a lead (✦ in its header), or add a track for a role:
  each gets a clip for every section it plays in, following the chords. The same seed gives the same song;
  **Another take** gives a part other notes and leaves the rest as it was.

## How it is made

| Part | Where |
| --- | --- |
| The song as data: tempo, loop, tracks, clips and notes in beats, devices; the demo song | [`engine/project.ts`](engine/project.ts) |
| The host: the plug-ins, the audio graph (each track's instrument or audio, its effects, volume, pan, mute, meters, into the master), undo, and the transport | [`engine/host.ts`](engine/host.ts) |
| The drum machine: eight sounds made from textbook parts, played by the Web Audio API's buffer sources | [`engine/drums.ts`](engine/drums.ts) |
| Composing: the `Composer` interface, and the composer of rules behind it (form, harmony, parts, seeded randomness, theory) | [`engine/compose/`](engine/compose/) |
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

## Composing: how it works, and where a model fits

What the tools this follows do: Logic's Session Players and Cubase's chord track take the chords from a global
chord track that every player follows ([Logic](https://support.apple.com/guide/logicpro/chords-and-session-players-lgcp70dd5af3/mac),
[Cubase's Chord Assistant](https://www.steinberg.help/r/cubase-pro/14.0/en/cubase_nuendo/topics/chord_pads/chord_pads_chord_assistant_c.html));
Ableton Live 12 generates notes into a clip from a few parameters, aware of the clip's scale
([MIDI Tools](https://www.ableton.com/en/live-manual/12/midi-tools/)). Here the chord track and the structure are
the song's, and a part is written for a track from them.

The composer of rules ([`engine/compose/`](engine/compose/)):

- **Form** ([`form.ts`](engine/compose/form.ts)): the forms each style is usually in (verse–chorus with a bridge
  for pop; intro, build, drop, breakdown in eight- and sixteen-bar phrases for EDM; a two-part loop for lo-fi),
  each section with an energy that decides how much its parts play.
- **Harmony** ([`harmony.ts`](engine/compose/harmony.ts)): each kind of section gets its own loop of four chords,
  repeated by every section of that kind. A loop is a pattern the style is known for (I–V–vi–IV and its
  rotations, i–VI–III–VII, ii–V–I in lo-fi) or the likeliest of a few walks of a Markov chain over the scale's
  degrees. The chain's weights follow what counts of pop songs report: after V comes I, vi or IV about equally
  (32%, 29%, 25% in [Hooktheory's data](https://www.hooktheory.com/blog/statistical-study-inversions-slash-chords-popular-music/));
  after iii nearly always vi or IV ([93%](https://www.hooktheory.com/blog/i-analyzed-the-chords-of-1300-popular-songs-for-patterns-this-is-what-i-found/));
  IV most often follows I and comes before it, beside authentic (ii–V–I), plagal (IV–I) and modal (♭VII–I) habits
  ([a cluster analysis of the McGill Billboard corpus](https://emusicology.org/article/id/4539/)). The other
  weights are estimates in that spirit, not measurements. A section before a chorus or a drop ends on the
  dominant, and the song on the tonic.
- **Parts** ([`parts.ts`](engine/compose/parts.ts)): drums from each style's patterns, busier with energy, with a
  fill where a section turns and a layer of [Euclidean rhythm](https://cgm.cs.mcgill.ca/~godfried/publications/banff.pdf);
  a bass on the roots with fifths, octaves and approach notes into the next chord; chords voiced to move as little
  as they can from one to the next; arpeggios of those voicings; a melody from a two-bar motif, chord tones on
  the strong beats and steps between, asking and answering in four-bar halves.
- **Seeds** ([`random.ts`](engine/compose/random.ts)): every choice draws from a stream named for what it is for
  (the chorus's chords, the verse's bass), so the same seed gives the same song, and another seed for one part
  leaves the others alone.

A model can take the composer's place: [`composer.ts`](engine/compose/composer.ts) is the whole of what the DAW
asks for (a plan of sections and chords; a part as notes per section), asynchronous, as plain data. Two ways it
could be filled later:

- a language model asked for exactly that data as JSON, with the song's key, sections and chords in the prompt
  (language models write usable chord progressions and multi-track MIDI this way, as in
  [JAMMIN-GPT](https://arxiv.org/pdf/2312.03479)); the rules could then check and fix what comes back (the key,
  the ranges, the lengths);
- a model of symbolic music run in the page, such as [Magenta.js](https://github.com/magenta/magenta-js/blob/master/music/README.md)'s
  ImprovRNN (melodies conditioned on chords), DrumsRNN or MusicVAE, for one role at a time.
