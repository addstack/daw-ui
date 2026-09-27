import { Engine, type SynthState } from "./dsp.js";
import { LFO_SIZE, defaults, type FromProcessor, type ToProcessor } from "./params.js";

// The audio thread: the engine, fed by messages from the page, and a report back of where modulation is, about
// sixty times a second, for the rings around the knobs.

declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void;

const REPORT_EVERY = 6;

class SynthProcessor extends AudioWorkletProcessor {
  private readonly engine: Engine;
  private blocks = 0;
  private notes = "";

  constructor() {
    super();
    const flat = new Float32Array(LFO_SIZE).fill(0.5);
    const state: SynthState = { params: defaults(), routings: [], tables: [], lfos: [flat, flat.slice()], lfoPhases: [0, 0] };
    this.engine = new Engine(state, sampleRate);
    this.port.onmessage = ({ data }: MessageEvent<ToProcessor>) => this.receive(data);
  }

  private receive(message: ToProcessor): void {
    const { state } = this.engine;
    switch (message.type) {
      case "tables":
        state.tables = message.tables;
        break;
      case "params":
        Object.assign(state.params, message.values);
        break;
      case "routings":
        state.routings = message.routings;
        break;
      case "lfo":
        state.lfos[message.index] = message.shape;
        break;
      case "noteOn":
        this.engine.noteOn(message.note, message.velocity);
        break;
      case "noteOff":
        this.engine.noteOff(message.note);
        break;
      case "allNotesOff":
        this.engine.allNotesOff();
        break;
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const [left, right] = outputs[0] ?? [];
    if (!left || !right) return true;
    this.engine.render(left, right, left.length);
    if (++this.blocks % REPORT_EVERY === 0) this.report();
    return true;
  }

  private report(): void {
    const newest = this.engine.newest();
    const notes = this.engine.voices.filter((voice) => voice.active && voice.held).map((voice) => voice.note);
    const key = notes.join(",");
    if (!newest && key === this.notes) return;
    this.notes = key;
    const message: FromProcessor = {
      type: "state",
      travel: newest ? Object.fromEntries(newest.travel) : {},
      lfo: this.engine.state.lfoPhases,
      notes,
    };
    this.port.postMessage(message);
  }
}

registerProcessor("synth", SynthProcessor);
