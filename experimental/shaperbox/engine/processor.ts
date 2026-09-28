import { Engine } from "./dsp.js";
import { KINDS, type Report, type ToProcessor } from "./params.js";

// The audio thread: the engine, fed by messages from the page. Its first output is the shaped audio, its second the
// audio before the shapers, for the crossover's spectrum. About sixty times a second it reports where the waves
// are and the audio of the watched one.

declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void;

const REPORT_EVERY = 6;

class ShaperBoxProcessor extends AudioWorkletProcessor {
  private readonly engine = new Engine(sampleRate);
  private blocks = 0;

  constructor() {
    super();
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
      case "watch":
        engine.watch.set(message.kind, message.band);
        break;
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const [left, right] = outputs[0] ?? [];
    if (!left || !right) return true;
    const [dryLeft, dryRight] = outputs[1] ?? [];
    this.engine.render(left, right, left.length, dryLeft, dryRight);
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
