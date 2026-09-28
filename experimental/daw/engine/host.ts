import { createPeaks, decibelsToGain, gainToDecibels, type Peaks } from "../../../src/core/index.js";
import { Box } from "../../shaperbox/engine/box.js";
import { PRESETS as BOX_PRESETS, loadPreset as loadBoxPreset } from "../../shaperbox/src/presets.js";
import { Synth } from "../../synth/engine/synth.js";
import { PRESETS as SYNTH_PRESETS, loadPreset as loadSynthPreset } from "../../synth/src/presets.js";
import type { Composer, PlanRequest, Role } from "./compose/composer.js";
import { ROLE_NAMES } from "./compose/composer.js";
import { rules } from "./compose/rules.js";
import { voice, type ChordSymbol } from "./compose/theory.js";
import { DrumMachine } from "./drums.js";
import { BEATS_PER_BAR, TRACK_COLORS, demoProject, newId, type AudioClip, type Clip, type Device, type InstrumentKind, type MidiClip, type Project, type Track } from "./project.js";

// The host: the song, the plug-ins that play it (a synth or a drum machine on each instrument track, ShaperBoxes on
// tracks and on the master), and the audio graph they play in: each track's instrument or clips, then its effects,
// volume, pan and mute, into the master. The transport schedules notes and audio a little ahead of time, as the
// Web Audio API's clock allows, so that each starts on its own sample; and tells each ShaperBox where the song is,
// so that its waves follow the bars. Nothing here renders: the page subscribes to the project, and reads the
// playhead and the meters once per frame.

export type Instrument = Synth | DrumMachine;

/** A channel: what plays into it, its effects, and then its volume, pan and mute, with a meter for each side. */
type Channel = {
  input: GainNode;
  volume: GainNode;
  pan: StereoPannerNode;
  mute: GainNode;
  meters: [AnalyserNode, AnalyserNode];
  /** The effects wired between `input` and `volume`, by id. */
  wired: string[];
};

/** An effect in the graph: its box between an input and an output of its own, which the channel wires. */
type Rack = { input: GainNode; output: GainNode; box: Box };

/** Where the song is: from the audio context's second `time`, at beat `beat`. */
type Anchor = { time: number; beat: number };

/** The synth preset a role sounds best with. */
const ROLE_PRESETS: Record<Role, string> = { drums: "", bass: "Deep Bass", chords: "Supersaw Pad", arp: "Pluck", lead: "Vowel Lead" };

const LOOKAHEAD = 0.12;
const TICK = 25;
const MASTER = "master";

/**
 * Calls `tick` every `TICK` milliseconds from a worker: a page's own timers slow to once a second when its tab is
 * in the background, and the music would stop; a worker's keep time. Returns what stops it.
 */
function every(tick: () => void): () => void {
  if (typeof Worker === "undefined") {
    const timer = setInterval(tick, TICK);
    return () => clearInterval(timer);
  }
  const url = URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${TICK});`], { type: "text/javascript" }));
  const worker = new Worker(url);
  worker.onmessage = tick;
  return () => {
    worker.terminate();
    URL.revokeObjectURL(url);
  };
}

export class Host {
  project: Project;
  playing = false;
  metronome = false;
  /** The instrument of each instrument track, by the track's id; kept after a track goes, for undo. */
  readonly instruments = new Map<string, Instrument>();
  /** The ShaperBox of each effect, by the device's id; kept after it goes, for undo. */
  readonly boxes = new Map<string, Box>();
  /** Audio of the audio clips, by id. */
  readonly audio = new Map<string, { name: string; buffer: AudioBuffer }>();
  private context: AudioContext | null = null;
  private starting: Promise<void> | null = null;
  private readonly channels = new Map<string, Channel>();
  private readonly racks = new Map<string, Rack>();
  private readonly listeners = new Set<() => void>();
  private past: Project[] = [];
  private future: Project[] = [];
  private stopped = 0;
  private anchors: Anchor[] = [{ time: 0, beat: 0 }];
  private cursor: Anchor = { time: 0, beat: 0 };
  /** Whether the next range scheduled starts playback, or a loop: clips under way there start part way in. */
  private fresh = true;
  private stopTicking: (() => void) | null = null;
  private readonly sources = new Set<AudioBufferSourceNode>();
  private readonly peaks = new Map<string, { bpm: number; peaks: Peaks }>();
  private readonly samples = new Float32Array(1024);

  constructor() {
    const { project, presets } = demoProject();
    this.project = project;
    for (const track of project.tracks) this.instruments.set(track.id, this.createInstrument(track.instrument!, presets.synths[track.id]));
    for (const device of this.devices()) this.boxes.set(device.id, this.createBox(presets.effects[device.id]));
  }

  // --- the project ---

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  /** Makes `next` the project, as one step to undo. */
  commit(next: Project): void {
    if (next === this.project) return;
    this.past.push(this.project);
    if (this.past.length > 200) this.past.shift();
    this.future = [];
    this.project = next;
    this.sync();
    this.emit();
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  undo(): void {
    const previous = this.past.pop();
    if (!previous) return;
    this.future.push(this.project);
    this.project = previous;
    this.sync();
    this.emit();
  }

  redo(): void {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.project);
    this.project = next;
    this.sync();
    this.emit();
  }

  track(id: string): Track | undefined {
    return this.project.tracks.find((track) => track.id === id);
  }

  /** Changes the track `id` by `change`, as one step to undo. */
  updateTrack(id: string, change: (track: Track) => Track): void {
    this.commit({ ...this.project, tracks: this.project.tracks.map((track) => (track.id === id ? change(track) : track)) });
  }

  /** Changes a clip, as one step to undo. */
  updateClip(trackId: string, clipId: string, change: (clip: Clip) => Clip): void {
    this.updateTrack(trackId, (track) => ({ ...track, clips: track.clips.map((clip) => (clip.id === clipId ? change(clip) : clip)) }));
  }

  addClip(trackId: string, clip: Clip): void {
    this.updateTrack(trackId, (track) => ({ ...track, clips: [...track.clips, clip] }));
  }

  removeClip(trackId: string, clipId: string): void {
    this.updateTrack(trackId, (track) => ({ ...track, clips: track.clips.filter((clip) => clip.id !== clipId) }));
  }

  /** A copy of the clip right after it; returns the copy's id. */
  duplicateClip(trackId: string, clipId: string): string | null {
    const clip = this.track(trackId)?.clips.find((one) => one.id === clipId);
    if (!clip) return null;
    const copy = { ...clip, id: newId("clip"), at: clip.at + clip.duration };
    this.addClip(trackId, copy);
    return copy.id;
  }

  /** A new instrument track, with an empty clip of four bars; returns its id. */
  addTrack(instrument: InstrumentKind, name?: string, preset = "Init"): string {
    const track: Track = {
      id: newId("track"),
      name: name ?? (instrument === "drums" ? "Drums" : "Synth"),
      color: TRACK_COLORS[this.project.tracks.length % TRACK_COLORS.length]!,
      instrument,
      volume: -6,
      pan: 0,
      mute: false,
      solo: false,
      clips: [{ id: newId("clip"), kind: "midi", name: "Clip", at: 0, duration: 4 * BEATS_PER_BAR, offset: 0, notes: [] }],
      effects: [],
    };
    this.instruments.set(track.id, this.createInstrument(instrument, instrument === "synth" ? preset : undefined));
    this.commit({ ...this.project, tracks: [...this.project.tracks, track] });
    return track.id;
  }

  removeTrack(id: string): void {
    this.commit({ ...this.project, tracks: this.project.tracks.filter((track) => track.id !== id) });
  }

  setMute(id: string, mute: boolean): void {
    this.updateTrack(id, (track) => ({ ...track, mute }));
  }

  setSolo(id: string, solo: boolean): void {
    this.updateTrack(id, (track) => ({ ...track, solo }));
  }

  /** A track's volume in decibels, or the master's: kept at once, not as a step to undo, as a fader moves it. */
  setVolume(id: string, volume: number): void {
    if (id === MASTER) this.project.master.volume = volume;
    else {
      const track = this.track(id);
      if (track) track.volume = volume;
    }
    this.channels.get(id)?.volume.gain.setTargetAtTime(decibelsToGain(volume), this.context?.currentTime ?? 0, 0.01);
  }

  /** A track's pan, −1 to 1: kept at once, as a knob moves it. */
  setPan(id: string, pan: number): void {
    const track = this.track(id);
    if (track) track.pan = pan;
    this.channels.get(id)?.pan.pan.setTargetAtTime(pan, this.context?.currentTime ?? 0, 0.01);
  }

  /** The effects of a track, or of the master. */
  effects(id: string): Device[] {
    return id === MASTER ? this.project.master.effects : (this.track(id)?.effects ?? []);
  }

  private setEffects(id: string, effects: Device[]): void {
    if (id === MASTER) this.commit({ ...this.project, master: { ...this.project.master, effects } });
    else this.updateTrack(id, (track) => ({ ...track, effects }));
  }

  /** A ShaperBox at the end of a track's effects, or of the master's; returns its id. */
  addEffect(id: string, preset = "Pump"): string {
    const device: Device = { id: newId("device"), kind: "shaperbox" };
    this.boxes.set(device.id, this.createBox(preset));
    this.setEffects(id, [...this.effects(id), device]);
    return device.id;
  }

  removeEffect(id: string, deviceId: string): void {
    this.setEffects(
      id,
      this.effects(id).filter((device) => device.id !== deviceId),
    );
  }

  /** Moves an effect `by` places along its chain. */
  moveEffect(id: string, deviceId: string, by: number): void {
    const effects = [...this.effects(id)];
    const from = effects.findIndex((device) => device.id === deviceId);
    const to = Math.max(0, Math.min(effects.length - 1, from + by));
    if (from < 0 || from === to) return;
    effects.splice(to, 0, ...effects.splice(from, 1));
    this.setEffects(id, effects);
  }

  setLoop(loop: Project["loop"]): void {
    this.commit({ ...this.project, loop });
  }

  /** Sets the tempo: audio clips keep their seconds, so their beats change; the transport keeps its place. */
  setBpm(bpm: number): void {
    if (bpm === this.project.bpm) return;
    this.commit(this.withBpm(this.project, bpm));
  }

  /** `project` at `bpm`, with the transport moved on to it. */
  private withBpm(project: Project, bpm: number): Project {
    const ratio = bpm / project.bpm;
    if (ratio === 1) return project;
    if (this.playing && this.context) {
      // From where the scheduling has reached, at the new tempo.
      this.anchors.push({ ...this.cursor });
      this.clock(this.cursor.time, this.cursor.beat, bpm);
    }
    return {
      ...project,
      bpm,
      tracks: project.tracks.map((track) =>
        track.clips.some((clip) => clip.kind === "audio")
          ? { ...track, clips: track.clips.map((clip) => (clip.kind === "audio" ? { ...clip, duration: clip.duration * ratio, offset: clip.offset * ratio } : clip)) }
          : track,
      ),
    };
  }

  // --- composing ---

  /** What writes the song's plan and parts: rules and a seed, for now. */
  composer: Composer = rules;

  /** A new form and chords, in a style and key, at the style's tempo; one step to undo. */
  async compose(request: PlanRequest): Promise<void> {
    const plan = await this.composer.plan(request);
    const end = Math.max(...plan.sections.map((section) => section.at + section.duration));
    this.commit({
      ...this.withBpm(this.project, plan.bpm ?? this.project.bpm),
      style: request.style,
      key: request.key,
      seed: request.seed,
      sections: plan.sections,
      chords: plan.chords,
      loop: { on: false, start: 0, end },
    });
  }

  /** New chords for the form there is. */
  async recompose(seed: number): Promise<void> {
    const { style, key, sections } = this.project;
    const chords = await this.composer.chords({ style, key, seed, sections });
    this.commit({ ...this.project, seed, chords });
  }

  /** Changes a chord of the chord track. */
  setChord(id: string, symbol: ChordSymbol): void {
    this.commit({ ...this.project, chords: this.project.chords.map((chord) => (chord.id === id ? { ...chord, ...symbol } : chord)) });
  }

  /**
   * Writes a track's notes for `role`, following the form and chords: a clip for each section it plays in, in
   * place of its clips. A synth still on its first preset takes one that suits the role.
   */
  async generate(trackId: string, role: Role, seed: number): Promise<void> {
    const { style, key, sections, chords } = this.project;
    if (sections.length === 0) return;
    const part = await this.composer.part({ role, style, key, sections, chords, seed });
    const instrument = this.instruments.get(trackId);
    if (instrument instanceof Synth && instrument.preset === 0) loadSynthPreset(instrument, Math.max(0, SYNTH_PRESETS.findIndex((one) => one.name === ROLE_PRESETS[role])));
    this.updateTrack(trackId, (track) => ({
      ...track,
      role,
      seed,
      clips: sections
        .filter((section) => part[section.id])
        .map<MidiClip>((section) => ({
          id: newId("clip"),
          kind: "midi",
          name: section.name,
          at: section.at,
          duration: section.duration,
          offset: 0,
          notes: part[section.id]!.map((note, index) => ({ id: index, ...note })),
        })),
    }));
  }

  /** A new track that plays `role`, with an instrument and preset for it, its notes generated; returns its id. */
  async addPart(role: Role, seed: number): Promise<string> {
    const id = this.addTrack(role === "drums" ? "drums" : "synth", ROLE_NAMES[role], ROLE_PRESETS[role]);
    await this.generate(id, role, seed);
    // The two steps are one to undo.
    this.past.splice(this.past.length - 1, 1);
    return id;
  }

  /** Plays a chord on a track's instrument, voiced in the middle of the keyboard, as a chord is chosen. */
  async previewChord(trackId: string, chord: ChordSymbol): Promise<void> {
    await this.start();
    const instrument = this.instruments.get(trackId);
    if (!instrument) return;
    const notes = voice(chord, null, 52, 72, 62);
    for (const note of notes) instrument.noteOn(note, 0.7);
    for (const note of notes) instrument.noteOff(note, this.context!.currentTime + 0.6);
  }

  // --- plug-ins ---

  private createInstrument(kind: InstrumentKind, preset?: string): Instrument {
    if (kind === "drums") return new DrumMachine();
    const synth = new Synth();
    loadSynthPreset(synth, Math.max(0, SYNTH_PRESETS.findIndex((one) => one.name === preset)));
    return synth;
  }

  private createBox(preset?: string): Box {
    const box = new Box();
    loadBoxPreset(box, Math.max(0, BOX_PRESETS.findIndex((one) => one.name === preset)));
    return box;
  }

  /** Every effect of the song: on its tracks and on the master. */
  private devices(project = this.project): Device[] {
    return [...project.tracks.flatMap((track) => track.effects), ...project.master.effects];
  }

  // --- the audio graph ---

  get sampleRate(): number {
    return this.context?.sampleRate ?? 48_000;
  }

  get started(): boolean {
    return this.context !== null && this.channels.has(MASTER);
  }

  /** The audio context, made on first use; it plays after `start`. */
  private audioContext(): AudioContext {
    return (this.context ??= new AudioContext({ latencyHint: "interactive" }));
  }

  /** Starts the audio and builds the graph. Call it from a user action: browsers only start audio after one. */
  async start(): Promise<void> {
    this.starting ??= (async () => {
      const context = this.audioContext();
      this.channels.set(MASTER, this.channel(context, context.destination));
      await this.sync();
    })();
    await this.starting;
    await this.context!.resume();
  }

  private channel(context: AudioContext, destination: AudioNode): Channel {
    const input = new GainNode(context);
    const volume = new GainNode(context);
    const pan = new StereoPannerNode(context);
    const mute = new GainNode(context);
    const splitter = new ChannelSplitterNode(context, { numberOfOutputs: 2 });
    const meters: [AnalyserNode, AnalyserNode] = [new AnalyserNode(context, { fftSize: 1024 }), new AnalyserNode(context, { fftSize: 1024 })];
    input.connect(volume);
    volume.connect(pan).connect(mute).connect(destination);
    mute.connect(splitter);
    splitter.connect(meters[0], 0);
    splitter.connect(meters[1], 1);
    return { input, volume, pan, mute, meters, wired: [] };
  }

  private rack(context: AudioContext, device: Device): { rack: Rack; ready: Promise<void> | null } {
    const existing = this.racks.get(device.id);
    if (existing) return { rack: existing, ready: null };
    const box = this.boxes.get(device.id)!;
    const rack: Rack = { input: new GainNode(context), output: new GainNode(context), box };
    this.racks.set(device.id, rack);
    const ready = box.connect(context, rack.output).then(() => {
      rack.input.connect(box.input!);
      const anchor = this.anchorAt(context.currentTime);
      box.clock(anchor.time, anchor.beat, this.project.bpm);
    });
    return { rack, ready };
  }

  /** Wires `effects` between a channel's input and its volume, when they changed. */
  private wire(context: AudioContext, channel: Channel, effects: Device[], waiting: Promise<void>[]): void {
    const ids = effects.map((device) => device.id);
    if (ids.join() === channel.wired.join()) return;
    channel.input.disconnect();
    for (const id of channel.wired) this.racks.get(id)?.output.disconnect();
    let from: AudioNode = channel.input;
    for (const device of effects) {
      const { rack, ready } = this.rack(context, device);
      if (ready) waiting.push(ready);
      from.connect(rack.input);
      from = rack.output;
    }
    from.connect(channel.volume);
    channel.wired = ids;
  }

  /** Makes the graph what the project says: channels for new tracks, none for removed ones, levels, effects. */
  private async sync(): Promise<void> {
    const context = this.context;
    const master = this.channels.get(MASTER);
    if (!context || !master) return;
    const { project } = this;
    const now = context.currentTime;
    const waiting: Promise<void>[] = [];
    const soloing = project.tracks.some((track) => track.solo);

    for (const track of project.tracks) {
      let channel = this.channels.get(track.id);
      if (!channel) {
        channel = this.channel(context, master.input);
        this.channels.set(track.id, channel);
        const instrument = this.instruments.get(track.id);
        if (instrument) waiting.push(Promise.resolve(instrument.connect(context, channel.input)));
      }
      channel.volume.gain.setTargetAtTime(decibelsToGain(track.volume), now, 0.01);
      channel.pan.pan.setTargetAtTime(track.pan, now, 0.01);
      channel.mute.gain.setTargetAtTime(track.mute || (soloing && !track.solo) ? 0 : 1, now, 0.01);
      this.wire(context, channel, track.effects, waiting);
    }
    master.volume.gain.setTargetAtTime(decibelsToGain(project.master.volume), now, 0.01);
    this.wire(context, master, project.master.effects, waiting);

    // Channels of tracks that went, and racks of effects that went.
    for (const [id, channel] of this.channels) {
      if (id === MASTER || project.tracks.some((track) => track.id === id)) continue;
      this.instruments.get(id)?.disconnect();
      channel.input.disconnect();
      channel.mute.disconnect();
      for (const effect of channel.wired) this.racks.get(effect)?.output.disconnect();
      this.channels.delete(id);
    }
    const kept = new Set(this.devices().map((device) => device.id));
    for (const [id, rack] of this.racks) {
      if (kept.has(id)) continue;
      rack.box.disconnect();
      rack.input.disconnect();
      rack.output.disconnect();
      this.racks.delete(id);
    }
    await Promise.all(waiting);
  }

  /** The peak of the last 1024 samples of each side of a track, or of the master, in dBFS. */
  levels(id: string): [number, number] {
    const channel = this.channels.get(id);
    if (!channel) return [-Infinity, -Infinity];
    return channel.meters.map((meter) => {
      meter.getFloatTimeDomainData(this.samples);
      let peak = 0;
      for (const sample of this.samples) peak = Math.max(peak, Math.abs(sample));
      return gainToDecibels(peak);
    }) as [number, number];
  }

  // --- audio files ---

  /** Adds an audio file as a clip at `at`, on the audio track `trackId`, or on a new one; returns the track's id. */
  async addAudio(file: File, at = 0, trackId?: string): Promise<string> {
    const buffer = await this.audioContext().decodeAudioData(await file.arrayBuffer());
    const audio = newId("audio");
    this.audio.set(audio, { name: file.name, buffer });
    const clip: AudioClip = {
      id: newId("clip"),
      kind: "audio",
      name: file.name.replace(/\.[^.]+$/, ""),
      at,
      duration: (buffer.duration * this.project.bpm) / 60,
      offset: 0,
      audio,
    };
    const target = trackId ? this.track(trackId) : undefined;
    if (target && target.instrument === null) {
      this.addClip(target.id, clip);
      return target.id;
    }
    const track: Track = {
      id: newId("track"),
      name: clip.name,
      color: TRACK_COLORS[this.project.tracks.length % TRACK_COLORS.length]!,
      instrument: null,
      volume: -3,
      pan: 0,
      mute: false,
      solo: false,
      clips: [clip],
      effects: [],
    };
    this.commit({ ...this.project, tracks: [...this.project.tracks, track] });
    return track.id;
  }

  /** The peaks of audio `id` for drawing, in beats at the current tempo: one second of it lasts bpm / 60 beats. */
  peaksOf(id: string): Peaks | null {
    const audio = this.audio.get(id);
    if (!audio) return null;
    const { bpm } = this.project;
    const cached = this.peaks.get(id);
    if (cached?.bpm === bpm) return cached.peaks;
    const channels = Array.from({ length: audio.buffer.numberOfChannels }, (_, channel) => audio.buffer.getChannelData(channel));
    const peaks = createPeaks(channels, (audio.buffer.sampleRate * 60) / bpm);
    this.peaks.set(id, { bpm, peaks });
    return peaks;
  }

  // --- playing notes by hand ---

  /** Plays a note on a track's instrument now, as a key is pressed. */
  async noteOn(trackId: string, note: number, velocity: number): Promise<void> {
    await this.start();
    this.instruments.get(trackId)?.noteOn(note, velocity);
  }

  noteOff(trackId: string, note: number): void {
    this.instruments.get(trackId)?.noteOff(note);
  }

  /** Plays a short note, as a piano roll does when a note is drawn or moved. */
  async preview(trackId: string, note: number, velocity = 0.8): Promise<void> {
    await this.start();
    const instrument = this.instruments.get(trackId);
    if (!instrument) return;
    instrument.noteOn(note, velocity);
    instrument.noteOff(note, this.context!.currentTime + 0.25);
  }

  // --- the transport ---

  /** The context's time of the audio being heard now, smoothly between the blocks the context renders. */
  private heard(): number {
    const context = this.context!;
    const stamp = context.getOutputTimestamp();
    if (stamp.contextTime === undefined || stamp.performanceTime === undefined || stamp.contextTime === 0) return context.currentTime;
    return stamp.contextTime + (performance.now() - stamp.performanceTime) / 1000;
  }

  /** The newest anchor at or before `time`. */
  private anchorAt(time: number): Anchor {
    let found = this.anchors[0]!;
    for (const anchor of this.anchors) if (anchor.time <= time) found = anchor;
    return this.playing ? found : { time, beat: this.stopped };
  }

  /** The playhead, in beats. */
  position(): number {
    if (!this.playing || !this.context) return this.stopped;
    const now = this.heard();
    const anchor = this.anchorAt(now);
    return anchor.beat + (Math.max(0, now - anchor.time) * this.project.bpm) / 60;
  }

  /** Tells every ShaperBox where the song is. */
  private clock(time: number, beat: number, bpm = this.project.bpm): void {
    for (const rack of this.racks.values()) rack.box.clock(time, beat, bpm);
  }

  async play(): Promise<void> {
    await this.start();
    if (this.playing) return;
    const context = this.context!;
    const time = context.currentTime + 0.05;
    this.playing = true;
    this.anchors = [{ time, beat: this.stopped }];
    this.cursor = { time, beat: this.stopped };
    this.fresh = true;
    this.clock(time, this.stopped);
    this.tick();
    this.stopTicking = every(() => this.tick());
    this.emit();
  }

  /** Stops where the playhead is; stopped already, goes back to the start of the loop, or of the song. */
  stop(): void {
    if (!this.playing) {
      this.stopped = this.project.loop.on ? this.project.loop.start : 0;
      this.emit();
      return;
    }
    const position = this.position();
    this.stopTicking?.();
    this.stopTicking = null;
    this.playing = false;
    this.stopped = position;
    const now = this.context!.currentTime;
    for (const instrument of this.instruments.values()) instrument.allNotesOff(now);
    for (const source of this.sources) source.stop();
    this.sources.clear();
    this.clock(now, position);
    this.emit();
  }

  toggle(): void {
    if (this.playing) this.stop();
    else void this.play();
  }

  /** Moves the playhead to `beat`, playing on from there if it plays. */
  seek(beat: number): void {
    const playing = this.playing;
    if (playing) this.stop();
    this.stopped = Math.max(0, beat);
    if (playing) void this.play();
    else this.emit();
  }

  setMetronome(on: boolean): void {
    this.metronome = on;
    this.emit();
  }

  /** Schedules what plays from the cursor to a little ahead of now, looping as the loop says. */
  private tick(): void {
    const context = this.context;
    if (!context || !this.playing) return;
    const horizon = context.currentTime + LOOKAHEAD;
    while (this.cursor.time < horizon) {
      const { loop, bpm } = this.project;
      const secondsPerBeat = 60 / bpm;
      let end = this.cursor.beat + (horizon - this.cursor.time) / secondsPerBeat;
      const wraps = loop.on && loop.end > loop.start && this.cursor.beat < loop.end && end >= loop.end;
      if (wraps) end = loop.end;
      this.schedule(this.cursor.beat, end, this.cursor.time);
      const time = this.cursor.time + (end - this.cursor.beat) * secondsPerBeat;
      this.fresh = wraps;
      this.cursor = { time, beat: wraps ? loop.start : end };
      if (!wraps) break;
      this.anchors.push({ ...this.cursor });
      this.clock(this.cursor.time, this.cursor.beat);
    }
    // Anchors long past are no longer needed.
    while (this.anchors.length > 2 && this.anchors[1]!.time < context.currentTime - 1) this.anchors.shift();
  }

  /** Schedules what starts from beat `from` to `to`, where `from` plays at the context's second `time`. */
  private schedule(from: number, to: number, time: number): void {
    const context = this.context!;
    const { project } = this;
    const secondsPerBeat = 60 / project.bpm;
    const at = (beat: number) => time + (beat - from) * secondsPerBeat;
    // Nothing plays past the loop's end while it loops.
    const limit = project.loop.on && from < project.loop.end ? project.loop.end : Infinity;
    const master = this.channels.get(MASTER);

    for (const track of project.tracks) {
      const channel = this.channels.get(track.id);
      if (!channel) continue;
      const instrument = this.instruments.get(track.id);
      for (const clip of track.clips) {
        const end = Math.min(clip.at + clip.duration, limit);
        if (end <= from || clip.at >= to) continue;
        if (clip.kind === "midi") {
          if (!instrument) continue;
          for (const note of clip.notes) {
            if (note.at < clip.offset || note.at >= clip.offset + clip.duration) continue;
            const start = clip.at + note.at - clip.offset;
            if (start < from || start >= to || start >= end) continue;
            instrument.noteOn(note.pitch, note.velocity / 127, at(start));
            instrument.noteOff(note.pitch, at(Math.min(start + note.duration, end)) - 0.0005);
          }
        } else {
          const audio = this.audio.get(clip.audio);
          if (!audio) continue;
          // A clip under way where playback or a loop starts plays from where it is.
          const start = clip.at >= from ? clip.at : this.fresh ? from : null;
          if (start === null) continue;
          const source = new AudioBufferSourceNode(context, { buffer: audio.buffer });
          source.connect(channel.input);
          source.start(at(start), (clip.offset + start - clip.at) * secondsPerBeat, (end - start) * secondsPerBeat);
          this.sources.add(source);
          source.onended = () => {
            this.sources.delete(source);
            source.disconnect();
          };
        }
      }
    }

    if (this.metronome && master) {
      for (let beat = Math.ceil(from - 1e-9); beat < to; beat++) this.click(at(beat), beat % BEATS_PER_BAR === 0, context);
    }
  }

  private click(time: number, accent: boolean, context: AudioContext): void {
    const oscillator = new OscillatorNode(context, { frequency: accent ? 1760 : 1320 });
    const gain = new GainNode(context, { gain: 0 });
    gain.gain.setValueAtTime(accent ? 0.35 : 0.2, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.04);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(time);
    oscillator.stop(time + 0.05);
  }
}

export const MASTER_ID = MASTER;

/** A MIDI clip of `bars` bars at `at`, empty. */
export const emptyClip = (at: number, bars = 1): MidiClip => ({
  id: newId("clip"),
  kind: "midi",
  name: "Clip",
  at,
  duration: bars * BEATS_PER_BAR,
  offset: 0,
  notes: [],
});
