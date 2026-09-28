import { gainToDecibels, type CurvePoint } from "../../../src/core/index.js";
import { guessTempo, renderLoop, type Loop } from "./loops.js";
import { BANDS, KINDS, defaults, type Kind, type Report, type ToProcessor } from "./params.js";
import processorUrl from "./processor.ts?worker&url";
import { restingWave, sampleWave } from "./waves.js";

// The page's side of the box: the processor, the audio it plays on its own, and the waves as curves. On its own it
// plays in an audio context of its own; as an effect it shapes what a host sends into it, in the host's context.
// Nothing here renders: the page calls these methods, and reads the processor's latest report once per frame.

const modules = new WeakMap<BaseAudioContext, Promise<void>>();

/** Loads the processor into `context`, once. */
function loadModule(context: BaseAudioContext): Promise<void> {
  let loading = modules.get(context);
  if (!loading) modules.set(context, (loading = context.audioWorklet.addModule(processorUrl)));
  return loading;
}

export type SourceName = Loop | "File";

type History = { past: CurvePoint[][]; future: CurvePoint[][] };

export class Box {
  params = defaults();
  /** Each shaper's waves: over the whole signal, then the low, mid and high bands'. */
  waves = Object.fromEntries(KINDS.map((kind) => [kind, Array.from({ length: BANDS }, () => restingWave(kind))])) as Record<Kind, CurvePoint[][]>;
  order: Kind[] = [...KINDS];
  bpm = 124;
  playing = false;
  source: SourceName = "Beat";
  file: { name: string; left: Float32Array; right: Float32Array; beats: number | null } | null = null;
  /** The newest report from the audio thread: a new object each time. */
  report: Report | null = null;
  /** The preset loaded last, by its index; the page keeps it here, so that its panel shows it when it opens again. */
  preset = 0;
  private audio: BaseAudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private starting: Promise<void> | null = null;
  private analysers: { output: AnalyserNode; input: AnalyserNode } | null = null;
  private watching: { kind: Kind; band: number } = { kind: "volume", band: 0 };
  private rendering: ReturnType<typeof setTimeout> | undefined;
  private readonly histories = new Map<string, History>();
  private readonly samples = new Float32Array(4096);
  private readonly bins = { output: new Float32Array(2048).fill(-Infinity), input: new Float32Array(2048).fill(-Infinity) };

  /** The audio context: on its own, made on first use, and playing after `start`; as an effect, the host's. */
  get context(): BaseAudioContext {
    return (this.audio ??= new AudioContext({ latencyHint: "interactive" }));
  }

  get sampleRate(): number {
    return this.audio?.sampleRate ?? 48_000;
  }

  get started(): boolean {
    return this.node !== null;
  }

  /** Where a host sends the audio to shape, once connected as an effect. */
  get input(): AudioNode | null {
    return this.node;
  }

  /** Starts the audio on its own. Call it from a user action: browsers only start audio after one. */
  async start(): Promise<void> {
    this.starting ??= this.connect(this.context, this.context.destination, false);
    await this.starting;
    await (this.context as AudioContext).resume();
  }

  /**
   * Plays into `destination`, in `context`. As an `effect`, it shapes what comes into `input`, and follows the
   * host's song from `clock`; otherwise it plays its own source.
   */
  async connect(context: BaseAudioContext, destination: AudioNode, effect = true): Promise<void> {
    this.audio = context;
    await loadModule(context);
    const node = new AudioWorkletNode(context, "shaperbox", {
      numberOfInputs: effect ? 1 : 0,
      numberOfOutputs: 2,
      outputChannelCount: [2, 2],
      processorOptions: { effect },
    });
    node.port.onmessage = ({ data }: MessageEvent<Report>) => (this.report = data);
    this.node = node;
    this.send({ type: "params", values: this.params });
    this.sendWaves();
    this.send({ type: "order", order: this.order });
    this.send({ type: "watch", ...this.watching });
    if (!effect) {
      this.send({ type: "transport", playing: this.playing, bpm: this.bpm });
      this.sendSource();
    }
    const output = new AnalyserNode(context, { fftSize: 4096, smoothingTimeConstant: 0.75 });
    const input = new AnalyserNode(context, { fftSize: 4096, smoothingTimeConstant: 0.8 });
    node.connect(output, 0);
    node.connect(destination, 0);
    node.connect(input, 1);
    this.analysers = { output, input };
  }

  /** Lets go of the audio nodes. */
  disconnect(): void {
    this.node?.disconnect();
    this.node = this.analysers = null;
  }

  /** As an effect: from the audio context's second `at`, the host's song is at beat `beats`, at `bpm`. */
  clock(at: number, beats: number, bpm: number): void {
    this.send({ type: "clock", at, beats, bpm });
  }

  private send(message: ToProcessor): void {
    this.node?.port.postMessage(message);
  }

  private sendWaves(): void {
    for (const kind of KINDS) this.waves[kind].forEach((points, band) => this.send({ type: "wave", kind, band, wave: sampleWave(points) }));
  }

  private sendSource(): void {
    if (!this.node) return;
    if (this.source === "File") {
      if (this.file) this.send({ type: "source", left: this.file.left, right: this.file.right, beats: this.file.beats });
      return;
    }
    const loop = renderLoop(this.source, this.bpm, this.sampleRate);
    this.send({ type: "source", ...loop });
  }

  play(playing: boolean): void {
    this.playing = playing;
    this.send({ type: "transport", playing, bpm: this.bpm });
  }

  /** Sets the tempo; the loop is made again at it once the tempo rests a moment. */
  setBpm(bpm: number): void {
    this.bpm = bpm;
    this.send({ type: "transport", playing: this.playing, bpm });
    if (this.source === "File") return;
    clearTimeout(this.rendering);
    this.rendering = setTimeout(() => this.sendSource(), 150);
  }

  useSource(source: SourceName): void {
    this.source = source;
    this.sendSource();
  }

  /** Plays an audio file in a loop; returns the tempo it guessed from its length, if it could. */
  async loadFile(file: File): Promise<number | null> {
    const buffer = await this.context.decodeAudioData(await file.arrayBuffer());
    const left = buffer.getChannelData(0).slice();
    const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1).slice() : left;
    const tempo = guessTempo(buffer.duration);
    this.file = { name: file.name, left, right, beats: tempo?.beats ?? null };
    if (tempo) this.bpm = tempo.bpm;
    this.source = "File";
    this.send({ type: "transport", playing: this.playing, bpm: this.bpm });
    this.sendSource();
    return tempo?.bpm ?? null;
  }

  setParam(id: string, value: number): void {
    this.params[id] = value;
    this.send({ type: "params", values: { [id]: value } });
  }

  /** Everything a preset holds. Parameters and waves it does not name go back to where they rest. */
  load(params: Record<string, number>, waves: Partial<Record<Kind, CurvePoint[][]>>, order: Kind[]): void {
    this.params = { ...defaults(), ...params, "global.bypass": this.params["global.bypass"]! };
    for (const kind of KINDS) this.waves[kind] = waves[kind] ?? Array.from({ length: BANDS }, () => restingWave(kind));
    this.order = order;
    this.histories.clear();
    this.send({ type: "params", values: this.params });
    this.sendWaves();
    this.send({ type: "order", order });
  }

  setOrder(order: Kind[]): void {
    this.order = order;
    this.send({ type: "order", order });
  }

  /** Which wave's audio the report carries. */
  watch(kind: Kind, band: number): void {
    this.watching = { kind, band };
    this.send({ type: "watch", kind, band });
  }

  /** Plays `points` as the wave, without keeping them: while a gesture moves them. */
  preview(kind: Kind, band: number, points: readonly CurvePoint[]): void {
    this.send({ type: "wave", kind, band, wave: sampleWave(points) });
  }

  private history(kind: Kind, band: number): History {
    const key = `${kind} ${band}`;
    let history = this.histories.get(key);
    if (!history) this.histories.set(key, (history = { past: [], future: [] }));
    return history;
  }

  /** Keeps `points` as the wave: one step to undo. */
  keepWave(kind: Kind, band: number, points: CurvePoint[]): void {
    const history = this.history(kind, band);
    history.past.push(this.waves[kind][band]!);
    if (history.past.length > 100) history.past.shift();
    history.future = [];
    this.waves[kind][band] = points;
    this.preview(kind, band, points);
  }

  /** Whether the wave was ever changed, since the preset. */
  edited(kind: Kind, band: number): boolean {
    return this.history(kind, band).past.length > 0;
  }

  /** Steps back through the wave's changes, or forward again; returns the wave it comes to, if any. */
  step(kind: Kind, band: number, back: boolean): CurvePoint[] | null {
    const history = this.history(kind, band);
    const to = (back ? history.past : history.future).pop();
    if (!to) return null;
    (back ? history.future : history.past).push(this.waves[kind][band]!);
    this.waves[kind][band] = to;
    this.preview(kind, band, to);
    return to;
  }

  /** Where the shaper `kind` is in its cycle, 0 … 1. */
  phase(kind: Kind): number {
    return this.report?.phases[KINDS.indexOf(kind)] ?? 0;
  }

  /** The output's peak level of the last 4096 samples, in dBFS. */
  level(): number {
    const analyser = this.analysers?.output;
    if (!analyser) return -Infinity;
    analyser.getFloatTimeDomainData(this.samples);
    let peak = 0;
    for (const sample of this.samples) peak = Math.max(peak, Math.abs(sample));
    return gainToDecibels(peak);
  }

  /** The spectrum of the output, or of the input before the shapers, in dB per bin. */
  spectrum(which: "output" | "input"): Float32Array {
    this.analysers?.[which].getFloatFrequencyData(this.bins[which]);
    return this.bins[which];
  }
}
