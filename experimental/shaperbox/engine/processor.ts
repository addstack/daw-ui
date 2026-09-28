import { Engine } from "./dsp.js";
import { KINDS, type Report, type ToProcessor } from "./params.js";

// The audio thread: the engine, fed by messages from the page. On its own it plays its source; as an effect in a
// host (`processorOptions.effect`) it shapes its input, and its waves follow the host's song from the clock the
// host sends. Its first output is the shaped audio, its second the audio before the shapers, for the crossover's
// spectrum. About sixty times a second it reports where the waves are and the audio of the watched one.

declare const sampleRate: number;
declare const currentTime: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: { processorOptions?: unknown });
}
declare function registerProcessor(name: string, processor: new (options: { processorOptions?: { effect?: boolean } }) => AudioWorkletProcessor): void;

const REPORT_EVERY = 6;

type Clock = { at: number; beats: number; bpm: number };

class ShaperBoxProcessor extends AudioWorkletProcessor {
  private readonly engine = new Engine(sampleRate);
  private readonly effect: boolean;
  /** The host's clock, from each time it was sent: the newest that has come is where the song is. */
  private readonly clocks: Clock[] = [{ at: 0, beats: 0, bpm: 120 }];
  private blocks = 0;

  constructor(options: { processorOptions?: { effect?: boolean } }) {
    super(options);
    this.effect = options.processorOptions?.effect === true;
    this.port.onmessage = ({ data }: MessageEvent<ToProcessor>) => this.receive(data);
  }

  private receive(message: ToProcessor): void {
    const { engine } = this;
    switch (message.type) {
      case "params":
        Object.assign(engine.params, message.values);
        break;
      case "wave":
        engine.shapers[message.kind].waves[message.band] = message.wave;
        break;
      case "order":
        engine.order = message.order;
        break;
      case "source":
        engine.setSource({ left: message.left, right: message.right, beats: message.beats });
        break;
      case "transport":
        engine.setTransport(message.playing, message.bpm);
        break;
      case "clock": {
        // Kept in time order; those already past but the newest are dropped when the block reaches them.
        const at = this.clocks.findIndex((clock) => clock.at > message.at);
        this.clocks.splice(at < 0 ? this.clocks.length : at, 0, { at: message.at, beats: message.beats, bpm: message.bpm });
        break;
      }
      case "watch":
        engine.watch.set(message.kind, message.band);
        break;
    }
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const [left, right] = outputs[0] ?? [];
    if (!left || !right) return true;
    const [dryLeft, dryRight] = outputs[1] ?? [];
    if (this.effect) {
      const { clocks } = this;
      while (clocks.length > 1 && clocks[1]!.at <= currentTime) clocks.shift();
      const clock = clocks[0]!;
      this.engine.sync(clock.beats + (Math.max(0, currentTime - clock.at) * clock.bpm) / 60, clock.bpm);
      this.engine.render(left, right, left.length, dryLeft, dryRight, inputs[0] ?? []);
    } else this.engine.render(left, right, left.length, dryLeft, dryRight);
    if (++this.blocks % REPORT_EVERY === 0) this.report();
    return true;
  }

  private report(): void {
    const { engine } = this;
    const message: Report = {
      type: "report",
      phases: KINDS.map((kind) => engine.shapers[kind].phase),
      value: engine.watch.value,
      input: engine.watch.input.slice(),
      output: engine.watch.output.slice(),
      beats: engine.beats,
    };
    this.port.postMessage(message);
  }
}

registerProcessor("shaperbox", ShaperBoxProcessor);
