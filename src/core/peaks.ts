/**
 * The shape of audio for drawing: the lowest and highest sample of each
 * bucket of samples, at several resolutions. Level 0 has buckets of
 * `samplesPerPeak` samples, and each next level merges pairs of buckets, as
 * the mipmaps of a texture do. Drawing reads the level closest to its zoom,
 * so its cost follows the pixels drawn, not the length of the audio.
 *
 * Values are whole numbers from −127 to 127 for samples from −1 to 1: eight
 * bits are finer than any waveform is tall, and keep an hour of stereo audio
 * under 6 MB.
 */
export type Peaks = {
  readonly sampleRate: number;
  readonly channels: number;
  /** Samples per channel. */
  readonly length: number;
  /** Seconds of audio. */
  readonly duration: number;
  /** From the finest to a single bucket. */
  readonly levels: readonly PeakLevel[];
  /**
   * For peaks that grow, as while recording: calls `listener` with the
   * second from which the audio changed, after each change.
   */
  subscribe?(listener: (from: number) => void): () => void;
};

export type PeakLevel = {
  readonly samplesPerPeak: number;
  /**
   * Per channel: the minimum and maximum of each bucket, in turn. The array
   * may be longer than the audio, when it grows: the buckets in use are
   * `⌈length / samplesPerPeak⌉`.
   */
  readonly data: readonly Int8Array[];
};

export type PeaksOptions = {
  /**
   * Samples per bucket of the finest level. Zoomed in further than one
   * bucket per pixel, a waveform shows buckets as steps, unless it has the
   * samples themselves.
   * @default 256
   */
  samplesPerPeak?: number | undefined;
};

/** Peaks that grow as audio is added, for a waveform that follows a recording. */
export type PeaksRecorder = Peaks & {
  /**
   * Adds the next samples, one array per channel, e.g. each block of an
   * `AudioWorklet`. Waveforms of these peaks draw again from where they
   * changed, in the next animation frame, however often this is called.
   */
  append(channels: readonly Float32Array[]): void;
  subscribe(listener: (from: number) => void): () => void;
};

const quantize = (sample: number) => Math.max(-127, Math.min(127, Math.round(sample * 127)));

type Level = { samplesPerPeak: number; data: Int8Array[] };

/** Room for at least `buckets` buckets, doubling what there is: appending stays linear. */
function reserve(level: Level, buckets: number): void {
  const capacity = level.data[0]!.length / 2;
  if (capacity >= buckets) return;
  const size = Math.max(buckets, capacity * 2);
  level.data = level.data.map((values) => {
    const grown = new Int8Array(size * 2);
    grown.set(values);
    return grown;
  });
}

/** Builds peaks from samples as they come, all at once or block by block. */
class PeaksBuilder implements PeaksRecorder {
  length = 0;
  readonly levels: Level[];
  private readonly minimum: Float32Array;
  private readonly maximum: Float32Array;
  private readonly listeners = new Set<(from: number) => void>();

  constructor(
    readonly sampleRate: number,
    readonly channels: number,
    private readonly samplesPerPeak: number,
    /** Buckets of level 0 to make room for at once. */
    capacity: number,
  ) {
    if (!(channels >= 1)) throw new RangeError("Peaks need at least one channel.");
    if (!Number.isInteger(samplesPerPeak) || samplesPerPeak < 1) {
      throw new RangeError(`samplesPerPeak (${samplesPerPeak}) must be a whole number of 1 or more.`);
    }
    const data = Array.from({ length: channels }, () => new Int8Array(Math.max(1, capacity) * 2));
    this.levels = [{ samplesPerPeak, data }];
    this.minimum = new Float32Array(channels);
    this.maximum = new Float32Array(channels);
  }

  get duration(): number {
    return this.length / this.sampleRate;
  }

  subscribe = (listener: (from: number) => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  append(channels: readonly Float32Array[]): void {
    const count = Math.max(0, ...channels.map((samples) => samples.length));
    if (count === 0) return;
    const spp = this.samplesPerPeak;
    const first = Math.floor(this.length / spp);
    let index = 0;
    if (this.length % spp === 0) index = this.appendWhole(channels, Math.floor(count / spp));
    while (index < count) {
      if (this.length % spp === 0) {
        this.minimum.fill(Infinity);
        this.maximum.fill(-Infinity);
      }
      const take = Math.min(spp - (this.length % spp), count - index);
      for (let channel = 0; channel < this.channels; channel++) {
        const samples = channels[channel];
        if (!samples) continue;
        const end = Math.min(index + take, samples.length);
        let at = index;
        let min = this.minimum[channel]!;
        let max = this.maximum[channel]!;
        // A bucket starts at its first sample, so that one comparison per sample is enough after it.
        if (min === Infinity && at < end) min = max = samples[at++]!;
        for (; at < end; at++) {
          const sample = samples[at]!;
          if (sample < min) min = sample;
          else if (sample > max) max = sample;
        }
        this.minimum[channel] = min;
        this.maximum[channel] = max;
      }
      index += take;
      this.length += take;
      // A full bucket, or the last one so far, which the next block may still fill.
      if (this.length % spp === 0 || index === count) this.write(Math.ceil(this.length / spp) - 1);
    }
    this.propagate(first, Math.ceil(this.length / spp) - 1);
    const from = (first * spp) / this.sampleRate;
    for (const listener of this.listeners) listener(from);
  }

  /**
   * `buckets` whole buckets from the start of `channels`, channel by channel
   * in one tight loop: the path of `createPeaks` and of long blocks.
   * Returns the samples taken.
   */
  private appendWhole(channels: readonly Float32Array[], buckets: number): number {
    if (buckets === 0) return 0;
    const spp = this.samplesPerPeak;
    const level = this.levels[0]!;
    const start = this.length / spp;
    reserve(level, start + buckets);
    for (let channel = 0; channel < this.channels; channel++) {
      const samples = channels[channel] ?? new Float32Array(0);
      const data = level.data[channel]!;
      let index = 0;
      for (let bucket = start; bucket < start + buckets; bucket++) {
        const end = Math.min(index + spp, samples.length);
        let min = 0;
        let max = 0;
        if (index < end) {
          min = max = samples[index]!;
          for (index++; index < end; index++) {
            const sample = samples[index]!;
            if (sample < min) min = sample;
            else if (sample > max) max = sample;
          }
        }
        index = (bucket - start + 1) * spp;
        data[bucket * 2] = quantize(min);
        data[bucket * 2 + 1] = quantize(max);
      }
    }
    this.length += buckets * spp;
    return buckets * spp;
  }

  /** Level 0 as given, e.g. by audiowaveform: `buckets` buckets of `samplesPerPeak` samples. */
  load(data: readonly Int8Array[], buckets: number): void {
    this.levels[0]!.data = [...data];
    this.length = buckets * this.samplesPerPeak;
    this.propagate(0, buckets - 1);
  }

  private write(bucket: number): void {
    const level = this.levels[0]!;
    reserve(level, bucket + 1);
    for (let channel = 0; channel < this.channels; channel++) {
      const min = this.minimum[channel]!;
      const max = this.maximum[channel]!;
      // A channel shorter than the others is silent where it has ended.
      level.data[channel]![bucket * 2] = min === Infinity ? 0 : quantize(min);
      level.data[channel]![bucket * 2 + 1] = max === -Infinity ? 0 : quantize(max);
    }
  }

  /** Brings the coarser levels in line with buckets `from` … `to` of level 0, adding levels down to a single bucket. */
  private propagate(from: number, to: number): void {
    for (let depth = 0; ; depth++) {
      const level = this.levels[depth]!;
      const buckets = Math.ceil(this.length / level.samplesPerPeak);
      if (buckets <= 1) return;
      const parents = Math.ceil(buckets / 2);
      let next = this.levels[depth + 1];
      if (!next) {
        next = {
          samplesPerPeak: level.samplesPerPeak * 2,
          data: Array.from({ length: this.channels }, () => new Int8Array(Math.ceil(level.data[0]!.length / 4) * 2)),
        };
        this.levels.push(next);
        // A new level needs every bucket, not only the ones that changed.
        from = 0;
        to = buckets - 1;
      }
      reserve(next, parents);
      from >>= 1;
      to = Math.min(to >> 1, parents - 1);
      for (let channel = 0; channel < this.channels; channel++) {
        const values = level.data[channel]!;
        const merged = next.data[channel]!;
        for (let parent = from; parent <= to; parent++) {
          const left = parent * 2;
          const right = Math.min(left + 1, buckets - 1);
          merged[parent * 2] = Math.min(values[left * 2]!, values[right * 2]!);
          merged[parent * 2 + 1] = Math.max(values[left * 2 + 1]!, values[right * 2 + 1]!);
        }
      }
    }
  }
}

/**
 * The peaks of audio, e.g. of an `AudioBuffer`:
 * `createPeaks([buffer.getChannelData(0), buffer.getChannelData(1)], buffer.sampleRate)`.
 * One pass over the samples; for long files, run it in a worker and pass
 * the result back, since its data are transferable typed arrays.
 */
export function createPeaks(channels: readonly Float32Array[], sampleRate: number, options: PeaksOptions = {}): Peaks {
  const { samplesPerPeak = 256 } = options;
  const length = Math.max(0, ...channels.map((samples) => samples.length));
  const builder = new PeaksBuilder(sampleRate, channels.length, samplesPerPeak, Math.ceil(length / samplesPerPeak));
  builder.append(channels);
  return builder;
}

/**
 * Empty peaks that grow with `append`: a waveform of them follows a
 * recording, drawing only what changed.
 */
export function createPeaksRecorder(options: PeaksOptions & { sampleRate: number; channels: number }): PeaksRecorder {
  const { sampleRate, channels, samplesPerPeak = 256 } = options;
  // Ten seconds to start with; the buffers double as needed.
  return new PeaksBuilder(sampleRate, channels, samplesPerPeak, Math.ceil((10 * sampleRate) / samplesPerPeak));
}

/** The JSON of the `audiowaveform` tool (BBC), version 1 or 2, as peaks.js reads it. */
export type AudiowaveformData = {
  sample_rate: number;
  samples_per_pixel: number;
  /** 8 or 16. */
  bits: number;
  /** @default 1 */
  channels?: number | undefined;
  /** The minimum and maximum of each bucket, channel after channel. */
  data: readonly number[];
};

/**
 * Peaks computed ahead of time by `audiowaveform`, so that a long file is
 * never decoded in the browser. 16-bit data is reduced to 8 bits.
 */
export function peaksFromAudiowaveform(json: AudiowaveformData): Peaks {
  const channels = json.channels ?? 1;
  const divisor = json.bits === 16 ? 256 : 1;
  const buckets = Math.floor(json.data.length / (2 * channels));
  const data = Array.from({ length: channels }, (_, channel) => {
    const values = new Int8Array(Math.max(1, buckets) * 2);
    for (let bucket = 0; bucket < buckets; bucket++) {
      const at = (bucket * channels + channel) * 2;
      values[bucket * 2] = Math.max(-127, Math.round(json.data[at]! / divisor));
      values[bucket * 2 + 1] = Math.min(127, Math.round(json.data[at + 1]! / divisor));
    }
    return values;
  });
  const builder = new PeaksBuilder(json.sample_rate, channels, json.samples_per_pixel, buckets);
  builder.load(data, buckets);
  return builder;
}

export type ReadPeaksOptions = {
  /** Seconds into the audio where the first column starts. */
  time: number;
  /** Seconds each column covers. */
  secondsPerColumn: number;
  /**
   * The channel to read; without it, all channels together.
   * @default all channels
   */
  channel?: number | undefined;
  /**
   * The samples themselves, one array per channel, e.g. from the
   * `AudioBuffer` the peaks came from. Columns narrower than a bucket of
   * the finest level are then read from them, and a waveform zoomed in to
   * single samples draws them as a line.
   */
  samples?: readonly Float32Array[] | undefined;
};

/**
 * Fills `out` with the lowest and highest sample, from −1 to 1, of
 * `out.length / 2` columns in turn, reading the level whose buckets are
 * closest to a column without being wider. Columns outside the audio are
 * silent. The work per column is a few buckets, at any zoom.
 */
export function readPeaks(peaks: Peaks, out: Float32Array, options: ReadPeaksOptions): void {
  const { time, secondsPerColumn, channel, samples } = options;
  const samplesPerColumn = secondsPerColumn * peaks.sampleRate;
  if (samples && samplesPerColumn < peaks.levels[0]!.samplesPerPeak) return readSamples(samples, out, options, peaks.sampleRate);
  let level = peaks.levels[0]!;
  for (const candidate of peaks.levels) {
    if (candidate.samplesPerPeak > samplesPerColumn) break;
    level = candidate;
  }
  const data = channel === undefined ? level.data : [level.data[channel]!];
  const buckets = Math.min(data[0]!.length / 2, Math.ceil(peaks.length / level.samplesPerPeak));
  const first = time * peaks.sampleRate;
  for (let column = 0; column < out.length / 2; column++) {
    const start = first + column * samplesPerColumn;
    // Every bucket the column overlaps, so that no peak falls between two columns.
    let from = Math.floor(start / level.samplesPerPeak);
    const to = Math.min(buckets, Math.max(from + 1, Math.ceil((start + samplesPerColumn) / level.samplesPerPeak)));
    from = Math.max(0, from);
    let min = 0;
    let max = 0;
    if (from < to && start < peaks.length) {
      min = 127;
      max = -127;
      for (const values of data) {
        for (let bucket = from; bucket < to; bucket++) {
          if (values[bucket * 2]! < min) min = values[bucket * 2]!;
          if (values[bucket * 2 + 1]! > max) max = values[bucket * 2 + 1]!;
        }
      }
    }
    out[column * 2] = min / 127;
    out[column * 2 + 1] = max / 127;
  }
}

/**
 * Columns from the samples: the range of the signal over each column, its
 * ends interpolated between samples, so that columns narrower than a
 * sample join into a line.
 */
function readSamples(all: readonly Float32Array[], out: Float32Array, options: ReadPeaksOptions, sampleRate: number): void {
  const samples = options.channel === undefined ? all : [all[options.channel]!];
  const length = Math.min(...samples.map((values) => values.length));
  const samplesPerColumn = options.secondsPerColumn * sampleRate;
  const first = options.time * sampleRate;
  const at = (values: Float32Array, position: number) => {
    const index = Math.floor(position);
    const next = Math.min(index + 1, length - 1);
    return values[index]! + (values[next]! - values[index]!) * (position - index);
  };
  for (let column = 0; column < out.length / 2; column++) {
    const start = first + column * samplesPerColumn;
    const end = Math.min(start + samplesPerColumn, length - 1);
    let min = 0;
    let max = 0;
    if (start >= 0 && start < length - 1) {
      min = Infinity;
      max = -Infinity;
      for (const values of samples) {
        for (const value of [at(values, start), at(values, end)]) {
          if (value < min) min = value;
          if (value > max) max = value;
        }
        for (let index = Math.floor(start) + 1; index <= end; index++) {
          const value = values[index]!;
          if (value < min) min = value;
          if (value > max) max = value;
        }
      }
    }
    out[column * 2] = Math.max(-1, min);
    out[column * 2 + 1] = Math.min(1, max);
  }
}
