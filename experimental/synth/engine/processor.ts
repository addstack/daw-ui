import { Engine, type SynthState } from "./dsp.js";
import { LFO_SIZE, defaults, type FromProcessor, type NoteMessage, type ToProcessor } from "./params.js";

// The audio thread: the engine, fed by messages from the page, and a report back of where modulation is, about
// sixty times a second, for the rings around the knobs. Notes can come with a time, as a sequencer schedules them
// ahead: the block is then rendered in pieces, and each note starts on its own sample.

declare const sampleRate: number;
declare const currentTime: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void;

const REPORT_EVERY = 6;

// The wavetables, once for every synth of an audio context: its processors share this scope.
let sharedTables: Float32Array[] | null = null;

class SynthProcessor extends AudioWorkletProcessor {
  private readonly engine: Engine;
  private blocks = 0;
  private notes = "";
  /** Notes to play later, by time. */
  private readonly queue: (NoteMessage & { time: number })[] = [];

  constructor() {
    super();
    const flat = new Float32Array(LFO_SIZE).fill(0.5);
    const state: SynthState = { params: defaults(), routings: [], tables: sharedTables ?? [], lfos: [flat, flat.slice()], lfoPhases: [0, 0] };
    this.engine = new Engine(state, sampleRate);
    this.port.onmessage = ({ data }: MessageEvent<ToProcessor>) => this.receive(data);
  }

  private receive(message: ToProcessor): void {
    const { state } = this.engine;
    switch (message.type) {
      case "tables":
        sharedTables = state.tables = message.tables;
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
      default:
        if (message.time !== undefined && message.time > currentTime) {
          const at = this.queue.findIndex((queued) => queued.time > message.time!);
          this.queue.splice(at < 0 ? this.queue.length : at, 0, message as NoteMessage & { time: number });
        } else this.play(message);
    }
  }

  private play(message: NoteMessage): void {
    if (message.type === "noteOn") this.engine.noteOn(message.note, message.velocity);
    else if (message.type === "noteOff") this.engine.noteOff(message.note);
    else {
      this.engine.allNotesOff();
      // Notes scheduled after a stop do not play.
      if (message.time !== undefined) this.queue.length = 0;
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const [left, right] = outputs[0] ?? [];
    if (!left || !right) return true;
    const { engine, queue } = this;
    if (engine.state.tables.length === 0 && sharedTables) engine.state.tables = sharedTables;
    const length = left.length;
    const end = currentTime + length / sampleRate;
    let at = 0;
    while (queue.length > 0 && queue[0]!.time < end) {
      const message = queue.shift()!;
      const frame = Math.min(length, Math.max(at, Math.round((message.time - currentTime) * sampleRate)));
      if (frame > at) engine.render(left.subarray(at, frame), right.subarray(at, frame), frame - at);
      this.play(message);
      at = frame;
    }
    if (at < length) engine.render(at === 0 ? left : left.subarray(at), at === 0 ? right : right.subarray(at), length - at);
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
