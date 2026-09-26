import { decibelsToGain, gainToDecibels } from "../src/core/index.js";

// A small drum machine on the Web Audio API: four synthesized voices, a
// channel per voice (volume, pan, mute, solo, level), and a master bus with a
// low-pass filter. The UI never re-renders for audio: meters call `level()`
// on every animation frame.

export const INSTRUMENTS = ["kick", "snare", "hat", "clap"] as const;
export type Instrument = (typeof INSTRUMENTS)[number];

export const STEPS = 16;
const LOOKAHEAD_S = 0.1;
const TIMER_MS = 25;

type Channel = {
  volume: GainNode;
  pan: StereoPannerNode;
  analyser: AnalyserNode;
};

type ChannelSettings = { volume: number; pan: number; muted: boolean; soloed: boolean };

/** Peak level of an analyser's latest block, in dBFS. */
function peak(analyser: AnalyserNode, buffer: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(buffer);
  let max = 0;
  for (const sample of buffer) max = Math.max(max, Math.abs(sample));
  return gainToDecibels(max);
}

export class DrumMachine {
  tempo = 120;
  pattern = new Set<string>();

  private context: AudioContext | null = null;
  private channels = new Map<Instrument, Channel>();
  private settings = new Map<Instrument, ChannelSettings>(
    INSTRUMENTS.map((instrument) => [instrument, { volume: 0, pan: 0, muted: false, soloed: false }]),
  );
  private master: { volume: GainNode; filter: BiquadFilterNode; analyser: AnalyserNode } | null = null;
  private masterSettings = { volume: 0, cutoff: 20_000, resonance: 0.7 };
  private noise: AudioBuffer | null = null;
  private buffer = new Float32Array(256);
  private timer: ReturnType<typeof setInterval> | undefined;
  private nextStep = 0;
  private nextTime = 0;
  private scheduled: { step: number; time: number }[] = [];

  get playing(): boolean {
    return this.timer !== undefined;
  }

  /** Starts playback. Call it from a user action: browsers only start audio after one. */
  async start(): Promise<void> {
    const context = this.ensureContext();
    await context.resume();
    if (this.timer !== undefined) return;
    this.nextStep = 0;
    this.nextTime = context.currentTime + 0.05;
    this.timer = setInterval(() => this.schedule(), TIMER_MS);
    this.schedule();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    this.scheduled = [];
  }

  /** The step being heard now, or -1 when stopped. */
  playhead(): number {
    if (!this.context || this.timer === undefined) return -1;
    const now = this.context.currentTime;
    let current = -1;
    for (const entry of this.scheduled) if (entry.time <= now) current = entry.step;
    return current;
  }

  level(instrument: Instrument): number {
    const channel = this.channels.get(instrument);
    return channel ? peak(channel.analyser, this.buffer) : -Infinity;
  }

  masterLevel(): number {
    return this.master ? peak(this.master.analyser, this.buffer) : -Infinity;
  }

  setChannel(instrument: Instrument, change: Partial<ChannelSettings>): void {
    Object.assign(this.settings.get(instrument)!, change);
    this.applyChannels();
  }

  setMaster(change: Partial<typeof this.masterSettings>): void {
    Object.assign(this.masterSettings, change);
    if (!this.master || !this.context) return;
    const now = this.context.currentTime;
    this.master.volume.gain.setTargetAtTime(decibelsToGain(this.masterSettings.volume), now, 0.01);
    this.master.filter.frequency.setTargetAtTime(this.masterSettings.cutoff, now, 0.01);
    this.master.filter.Q.setTargetAtTime(this.masterSettings.resonance, now, 0.01);
  }

  private ensureContext(): AudioContext {
    if (this.context) return this.context;
    const context = new AudioContext();
    this.context = context;

    const volume = context.createGain();
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    volume.connect(filter).connect(analyser).connect(context.destination);
    this.master = { volume, filter, analyser };

    for (const instrument of INSTRUMENTS) {
      const channelVolume = context.createGain();
      const pan = context.createStereoPanner();
      const channelAnalyser = context.createAnalyser();
      channelAnalyser.fftSize = 256;
      channelVolume.connect(pan).connect(channelAnalyser).connect(volume);
      this.channels.set(instrument, { volume: channelVolume, pan, analyser: channelAnalyser });
    }

    this.noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const samples = this.noise.getChannelData(0);
    for (let index = 0; index < samples.length; index++) samples[index] = Math.random() * 2 - 1;

    this.applyChannels();
    this.setMaster({});
    return context;
  }

  private applyChannels(): void {
    if (!this.context) return;
    const anySolo = [...this.settings.values()].some((settings) => settings.soloed);
    const now = this.context.currentTime;
    for (const [instrument, settings] of this.settings) {
      const channel = this.channels.get(instrument)!;
      const audible = !settings.muted && (!anySolo || settings.soloed);
      channel.volume.gain.setTargetAtTime(audible ? decibelsToGain(settings.volume) : 0, now, 0.01);
      channel.pan.pan.setTargetAtTime(settings.pan, now, 0.01);
    }
  }

  private schedule(): void {
    const context = this.context!;
    while (this.nextTime < context.currentTime + LOOKAHEAD_S) {
      for (const instrument of INSTRUMENTS) {
        if (this.pattern.has(`${instrument}:${this.nextStep}`)) this.play(instrument, this.nextTime);
      }
      this.scheduled.push({ step: this.nextStep, time: this.nextTime });
      this.nextTime += 60 / this.tempo / 4;
      this.nextStep = (this.nextStep + 1) % STEPS;
    }
    // Keep only what the playhead still needs.
    const now = context.currentTime;
    while (this.scheduled.length > 1 && this.scheduled[1]!.time <= now) this.scheduled.shift();
  }

  private play(instrument: Instrument, time: number): void {
    const context = this.context!;
    const output = this.channels.get(instrument)!.volume;
    const envelope = (peakGain: number, decay: number, at = time) => {
      const gain = context.createGain();
      gain.gain.setValueAtTime(peakGain, at);
      gain.gain.exponentialRampToValueAtTime(0.001, at + decay);
      gain.connect(output);
      return gain;
    };
    const noise = (filterType: BiquadFilterType, frequency: number, gain: GainNode, at = time, duration = 0.3) => {
      const source = context.createBufferSource();
      source.buffer = this.noise;
      const filter = context.createBiquadFilter();
      filter.type = filterType;
      filter.frequency.value = frequency;
      source.connect(filter).connect(gain);
      source.start(at);
      source.stop(at + duration);
    };

    if (instrument === "kick") {
      const oscillator = context.createOscillator();
      oscillator.frequency.setValueAtTime(150, time);
      oscillator.frequency.exponentialRampToValueAtTime(45, time + 0.12);
      oscillator.connect(envelope(1, 0.45));
      oscillator.start(time);
      oscillator.stop(time + 0.5);
    } else if (instrument === "snare") {
      noise("highpass", 1200, envelope(0.7, 0.18));
      const tone = context.createOscillator();
      tone.type = "triangle";
      tone.frequency.value = 185;
      tone.connect(envelope(0.5, 0.1));
      tone.start(time);
      tone.stop(time + 0.12);
    } else if (instrument === "hat") {
      noise("highpass", 7000, envelope(0.35, 0.05), time, 0.08);
    } else {
      // A clap: three quick bursts, then a short tail.
      for (const offset of [0, 0.012, 0.024]) noise("bandpass", 1500, envelope(0.6, 0.02, time + offset), time + offset, 0.03);
      noise("bandpass", 1500, envelope(0.5, 0.2, time + 0.036), time + 0.036, 0.25);
    }
  }
}
