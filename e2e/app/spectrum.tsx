import { Spectrum } from "../../src/react/index.js";

// Spectra for the e2e and perf tests.
// - "Tone": a spectrum that does not change, 600 × 120 px, 20 Hz … 20 kHz, −90 … 0 dB: quiet everywhere (−80 dB)
//   but for a tone at 1 kHz (−6 dB).
// - "Live 1" … "Live 8": 2048 bins each, read every frame, moving like music.

const RATE = 48_000;
const PER_BIN = RATE / 2 / 1024;
const tone = Float32Array.from({ length: 1024 }, (_, index) => (Math.abs(index * PER_BIN - 1000) < PER_BIN ? -6 : -80));

function live(channel: number) {
  const bins = new Float32Array(2048);
  return () => {
    const now = performance.now() / 1000;
    for (let index = 0; index < bins.length; index++) {
      // Falling with frequency, with a swell that moves across it.
      bins[index] = -20 - 25 * Math.log10(1 + index) + 12 * Math.sin(index / 40 - now * 3 + channel);
    }
    return bins;
  };
}

export function SpectrumView() {
  return (
    <main>
      <h1>daw-ui spectrum</h1>
      <Spectrum.Root bins={tone} sampleRate={RATE} aria-label="Tone" className="spectrum" data-testid="tone">
        <Spectrum.Fill className="spectrum-fill" />
        <Spectrum.Line className="spectrum-line" data-testid="tone line" thickness={2} />
      </Spectrum.Root>
      <div className="spectra">
        {Array.from({ length: 8 }, (_, channel) => (
          <Spectrum.Root key={channel} read={live(channel)} sampleRate={RATE} fall={48} aria-label={`Live ${channel + 1}`} className="spectrum small">
            <Spectrum.Fill className="spectrum-fill" />
            <Spectrum.Line className="spectrum-line" />
            <Spectrum.Peak className="spectrum-peak" />
          </Spectrum.Root>
        ))}
      </div>
    </main>
  );
}
