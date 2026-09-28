// Audio to shape without bringing any: a two-bar house loop made here, at the tempo set, so that it lines up with
// the waves. Its parts are textbook ones: a kick of a falling sine, a clap and hats of filtered noise, a plucked
// saw bass on the off-beats, and chords of detuned saws, in A minor.

export const LOOPS = ["Beat", "Drums", "Chords", "Bass"] as const;
export type Loop = (typeof LOOPS)[number];

/** Beats a loop lasts: two bars of 4/4. */
export const LOOP_BEATS = 8;

type Stereo = [Float32Array, Float32Array];

/** A band-limited sawtooth's correction at its jump (PolyBLEP). */
function blep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

const hertz = (note: number) => 440 * 2 ** ((note - 69) / 12);

/** A low-pass state-variable filter, one sample at a time. */
function lowpass() {
  let [ic1, ic2] = [0, 0];
  return (x: number, cutoff: number, resonance: number, sampleRate: number) => {
    const g = Math.tan((Math.PI * Math.min(cutoff, sampleRate * 0.45)) / sampleRate);
    const k = 2 - 1.9 * resonance;
    const a1 = 1 / (1 + g * (g + k));
    const a2 = g * a1;
    const a3 = g * a2;
    const v3 = x - ic2;
    const v1 = a1 * ic1 + a2 * v3;
    const v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1;
    ic2 = 2 * v2 - ic2;
    return v2;
  };
}

function random(seed: number) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 2_147_483_648 - 1;
  };
}

/** Adds `length` samples of `voice` at `start`, wrapping round the end, so that tails carry into the next loop. */
function add(out: Stereo, start: number, length: number, voice: (i: number) => [number, number]) {
  const size = out[0].length;
  for (let i = 0; i < length; i++) {
    const [left, right] = voice(i);
    const at = (start + i) % size;
    out[0][at]! += left;
    out[1][at]! += right;
  }
}

function drums(out: Stereo, beat: number, sampleRate: number) {
  const noise = random(7);
  for (let b = 0; b < LOOP_BEATS; b++) {
    // Kick: a sine falling from 155 Hz to 45 Hz, on every beat.
    let phase = 0;
    add(out, Math.round(b * beat), Math.round(0.45 * sampleRate), (i) => {
      const t = i / sampleRate;
      phase += (2 * Math.PI * (45 + 110 * Math.exp(-t / 0.03))) / sampleRate;
      const value = Math.sin(phase) * Math.exp(-t / 0.22) * Math.min(1, i / 16) * 0.95;
      return [value, value];
    });
    // Clap on two and four: three quick bursts of band-passed noise, then a tail.
    if (b % 2 === 1) {
      const [left, right] = [lowpass(), lowpass()];
      const [highLeft, highRight] = [lowpass(), lowpass()];
      add(out, Math.round(b * beat), Math.round(0.3 * sampleRate), (i) => {
        const t = i / sampleRate;
        const burst = t < 0.03 ? Math.exp(-((t % 0.01) / 0.003)) : Math.exp(-(t - 0.03) / 0.09);
        const [n1, n2] = [noise(), noise()];
        const l = left(n1, 2400, 0.3, sampleRate) - highLeft(n1, 700, 0, sampleRate);
        const r = right(n2, 2400, 0.3, sampleRate) - highRight(n2, 700, 0, sampleRate);
        return [l * burst * 0.9, r * burst * 0.9];
      });
    }
    // Hats: open-ish on the off-beat, closed and quieter on the sixteenths between, a little to each side.
    for (const [offset, level, decay, pan] of [
      [0.5, 0.35, 0.06, 0.8],
      [0.25, 0.14, 0.02, 1],
      [0.75, 0.18, 0.02, 0.6],
    ] as const) {
      const low = lowpass();
      add(out, Math.round((b + offset) * beat), Math.round(decay * 6 * sampleRate), (i) => {
        const n = noise();
        const value = (n - low(n, 7000, 0, sampleRate)) * Math.exp(-i / (decay * sampleRate)) * level;
        return [value * pan, value * (1.6 - pan)];
      });
    }
  }
}

// The chords, two beats each: Am7, Fmaj7, C, G; and the bass plays their roots.
const CHORDS = [
  [57, 60, 64, 67],
  [53, 57, 60, 64],
  [55, 60, 64, 67],
  [55, 59, 62, 67],
];
const ROOTS = [33, 29, 36, 31];

function bass(out: Stereo, beat: number, sampleRate: number) {
  for (let b = 0; b < LOOP_BEATS; b++) {
    const frequency = hertz(ROOTS[Math.floor(b / 2) % ROOTS.length]!);
    const filter = lowpass();
    let phase = 0;
    add(out, Math.round((b + 0.5) * beat), Math.round(0.45 * beat), (i) => {
      const t = i / sampleRate;
      const dt = frequency / sampleRate;
      phase = (phase + dt) % 1;
      const saw = 2 * phase - 1 - blep(phase, dt);
      const envelope = Math.exp(-t / 0.12);
      const end = Math.min(1, (0.45 * beat - i) / 200);
      const value = filter(saw, 160 + 1400 * envelope, 0.35, sampleRate) * Math.min(1, i / 40) * end * 0.55;
      return [value, value];
    });
  }
}

function chords(out: Stereo, beat: number, sampleRate: number) {
  const length = Math.round(2 * beat);
  // Each note is two saws a little out of tune on each side, tuned differently left and right, for width.
  const detunes = [
    [-7, 5],
    [-4, 8],
  ];
  const [left, right] = [lowpass(), lowpass()];
  const pad: Stereo = [new Float32Array(out[0].length), new Float32Array(out[0].length)];
  CHORDS.forEach((chord, index) => {
    for (const note of chord) {
      const phases = [Math.random(), Math.random(), Math.random(), Math.random()];
      add(pad, index * length, length, (i) => {
        const envelope = Math.min(1, i / (0.03 * sampleRate)) * Math.min(1, (length - i) / (0.04 * sampleRate));
        const sides: number[] = [0, 0];
        for (let side = 0; side < 2; side++) {
          for (let voice = 0; voice < 2; voice++) {
            const dt = (hertz(note) * 2 ** (detunes[side]![voice]! / 1200)) / sampleRate;
            const slot = side * 2 + voice;
            phases[slot] = (phases[slot]! + dt) % 1;
            sides[side]! += 2 * phases[slot]! - 1 - blep(phases[slot]!, dt);
          }
        }
        return [sides[0]! * envelope * 0.045, sides[1]! * envelope * 0.045];
      });
    }
  });
  for (let i = 0; i < pad[0].length; i++) {
    out[0][i]! += left(pad[0][i]!, 2600, 0.1, sampleRate);
    out[1][i]! += right(pad[1][i]!, 2600, 0.1, sampleRate);
  }
}

/** The loop `loop` at `bpm`, two bars long, its peak at −3 dBFS. */
export function renderLoop(loop: Loop, bpm: number, sampleRate: number): { left: Float32Array; right: Float32Array; beats: number } {
  const beat = (60 / bpm) * sampleRate;
  const length = Math.round(LOOP_BEATS * beat);
  const out: Stereo = [new Float32Array(length), new Float32Array(length)];
  if (loop === "Beat" || loop === "Drums") drums(out, beat, sampleRate);
  if (loop === "Beat" || loop === "Bass") bass(out, beat, sampleRate);
  if (loop === "Beat" || loop === "Chords") chords(out, beat, sampleRate);
  let peak = 0;
  for (const channel of out) for (const sample of channel) peak = Math.max(peak, Math.abs(sample));
  const gain = peak > 0 ? 0.708 / peak : 1;
  for (const channel of out) for (let i = 0; i < length; i++) channel[i]! *= gain;
  return { left: out[0], right: out[1], beats: LOOP_BEATS };
}

/** The tempo of a file that lasts whole bars of 4/4, if some number of bars puts it between 80 and 170 BPM. */
export function guessTempo(seconds: number): { bpm: number; beats: number } | null {
  for (const bars of [1, 2, 4, 8, 16, 32]) {
    const bpm = (240 * bars) / seconds;
    if (bpm >= 80 && bpm <= 170) return { bpm: Math.round(bpm * 100) / 100, beats: bars * 4 };
  }
  return null;
}
