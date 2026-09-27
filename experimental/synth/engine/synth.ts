import { decibelsToGain, gainToDecibels, type CurvePoint } from "../../../src/core/index.js";
import { LFO_SIZE, PARAMS, defaults, denormalize, type FromProcessor, type Routing, type ToProcessor } from "./params.js";
import processorUrl from "./processor.ts?worker&url";
import { sampleShape } from "./shapes.js";
import { createWavetables } from "./wavetables.js";

// The page's side of the synth: the audio context, the processor, and effects on the Web Audio API's own nodes
// after it (chorus, delay, reverb, volume). Nothing here renders: the page calls these methods, and reads the
// processor's latest report once per frame.

/** A stereo impulse response: noise dying away over `seconds`, for the reverb. */
function impulse(context: BaseAudioContext, seconds: number): AudioBuffer {
  const length = Math.max(1, Math.round(context.sampleRate * seconds));
  const buffer = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
  }
  return buffer;
}

type Effects = {
  input: GainNode;
  chorus: { wet: GainNode; left: DelayNode; right: DelayNode; lfo: OscillatorNode; depth: GainNode };
  delay: { wet: GainNode; node: DelayNode; feedback: GainNode };
  reverb: { wet: GainNode; node: ConvolverNode };
  master: GainNode;
  analyser: AnalyserNode;
};

export class Synth {
  readonly tables = createWavetables();
  params = defaults();
  routings: Routing[] = [];
  private shapes: [Float32Array, Float32Array] = [new Float32Array(LFO_SIZE).fill(0.5), new Float32Array(LFO_SIZE).fill(0.5)];
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private effects: Effects | null = null;
  private latest: FromProcessor | null = null;
  private reverbSize = 0;
  private readonly samples = new Float32Array(2048);
  readonly bins = new Float32Array(2048).fill(-Infinity);

  get started(): boolean {
    return this.node !== null;
  }

  get sampleRate(): number {
    return this.context?.sampleRate ?? 48_000;
  }

  /** Starts the audio. Call it from a user action: browsers only start audio after one. */
  async start(): Promise<void> {
    if (this.context) {
      await this.context.resume();
      return;
    }
    const context = new AudioContext({ latencyHint: "interactive" });
    this.context = context;
    await context.audioWorklet.addModule(processorUrl);
    const node = new AudioWorkletNode(context, "synth", { numberOfInputs: 0, outputChannelCount: [2] });
    node.port.onmessage = ({ data }: MessageEvent<FromProcessor>) => (this.latest = data);
    this.node = node;
    this.send({ type: "tables", tables: this.tables.map((table) => table.slice()) });
    this.send({ type: "params", values: this.params });
    this.send({ type: "routings", routings: this.routings });
    this.send({ type: "lfo", index: 0, shape: this.shapes[0] });
    this.send({ type: "lfo", index: 1, shape: this.shapes[1] });
    this.effects = this.connect(context, node);
    this.applyEffects();
    await context.resume();
  }

  private connect(context: AudioContext, node: AudioWorkletNode): Effects {
    const input = new GainNode(context);
    node.connect(input);

    // Chorus: two short delays, swung by a slow LFO in opposite directions, one for each side.
    const chorusOut = new GainNode(context);
    const chorusWet = new GainNode(context, { gain: 0 });
    const left = new DelayNode(context, { delayTime: 0.012, maxDelayTime: 0.05 });
    const right = new DelayNode(context, { delayTime: 0.015, maxDelayTime: 0.05 });
    const lfo = new OscillatorNode(context, { frequency: 0.6 });
    const depth = new GainNode(context, { gain: 0.002 });
    const inverted = new GainNode(context, { gain: -1 });
    lfo.connect(depth);
    depth.connect(left.delayTime);
    depth.connect(inverted).connect(right.delayTime);
    lfo.start();
    const merger = new ChannelMergerNode(context, { numberOfInputs: 2 });
    input.connect(left).connect(merger, 0, 0);
    input.connect(right).connect(merger, 0, 1);
    merger.connect(chorusWet).connect(chorusOut);
    input.connect(chorusOut);

    // Delay: a stereo echo feeding back into itself.
    const delayOut = new GainNode(context);
    const delayWet = new GainNode(context, { gain: 0 });
    const delay = new DelayNode(context, { maxDelayTime: 2 });
    const feedback = new GainNode(context);
    chorusOut.connect(delay).connect(feedback).connect(delay);
    delay.connect(delayWet).connect(delayOut);
    chorusOut.connect(delayOut);

    // Reverb: a convolution with decaying noise.
    const master = new GainNode(context);
    const reverbWet = new GainNode(context, { gain: 0 });
    const convolver = new ConvolverNode(context);
    delayOut.connect(convolver).connect(reverbWet).connect(master);
    delayOut.connect(master);

    const analyser = new AnalyserNode(context, { fftSize: 4096, smoothingTimeConstant: 0.75 });
    master.connect(analyser);
    master.connect(context.destination);
    return {
      input,
      chorus: { wet: chorusWet, left, right, lfo, depth },
      delay: { wet: delayWet, node: delay, feedback },
      reverb: { wet: reverbWet, node: convolver },
      master,
      analyser,
    };
  }

  private applyEffects(): void {
    const { effects, context, params } = this;
    if (!effects || !context) return;
    const now = context.currentTime;
    const glide = (param: AudioParam, value: number) => param.setTargetAtTime(value, now, 0.02);
    glide(effects.chorus.wet.gain, params["chorus.mix"]!);
    glide(effects.chorus.lfo.frequency, params["chorus.rate"]!);
    glide(effects.chorus.depth.gain, 0.0005 + params["chorus.depth"]! * 0.004);
    glide(effects.delay.wet.gain, params["delay.mix"]!);
    glide(effects.delay.node.delayTime, params["delay.time"]! / 1000);
    glide(effects.delay.feedback.gain, params["delay.feedback"]!);
    glide(effects.reverb.wet.gain, params["reverb.mix"]! * 1.5);
    glide(effects.master.gain, decibelsToGain(params["master.volume"]!));
    if (params["reverb.size"] !== this.reverbSize) {
      this.reverbSize = params["reverb.size"]!;
      effects.reverb.node.buffer = impulse(context, this.reverbSize);
    }
  }

  private send(message: ToProcessor): void {
    this.node?.port.postMessage(message);
  }

  setParam(id: string, value: number): void {
    this.params[id] = value;
    if (/^(chorus|delay|reverb|master)\./.test(id)) this.applyEffects();
    else this.send({ type: "params", values: { [id]: value } });
  }

  /** Every parameter at once, as a preset sets them. */
  setParams(values: Record<string, number>): void {
    this.params = { ...defaults(), ...values };
    this.send({ type: "params", values: this.params });
    this.applyEffects();
  }

  setRoutings(routings: Routing[]): void {
    this.routings = routings;
    this.send({ type: "routings", routings });
  }

  setShape(index: 0 | 1, points: readonly CurvePoint[]): void {
    this.shapes[index] = sampleShape(points);
    this.send({ type: "lfo", index, shape: this.shapes[index] });
  }

  noteOn(note: number, velocity: number): void {
    this.send({ type: "noteOn", note, velocity });
  }

  noteOff(note: number): void {
    this.send({ type: "noteOff", note });
  }

  allNotesOff(): void {
    this.send({ type: "allNotesOff" });
  }

  /** A parameter as modulation has moved it for the newest note, or as it is set without one. */
  modulated(id: string): number {
    const travel = this.latest?.travel[id];
    return travel === undefined ? this.params[id]! : denormalize(PARAMS[id]!, travel);
  }

  /** The notes held now. */
  get notes(): number[] {
    return this.latest?.notes ?? [];
  }

  lfoPhase(index: 0 | 1): number {
    return this.latest?.lfo[index] ?? 0;
  }

  /** The output's peak level of the last block, in dBFS. */
  level(): number {
    const analyser = this.effects?.analyser;
    if (!analyser) return -Infinity;
    analyser.getFloatTimeDomainData(this.samples);
    let peak = 0;
    for (const sample of this.samples) peak = Math.max(peak, Math.abs(sample));
    return gainToDecibels(peak);
  }

  /** The output's spectrum, in dB per bin. */
  spectrum(): Float32Array {
    this.effects?.analyser.getFloatFrequencyData(this.bins);
    return this.bins;
  }
}
