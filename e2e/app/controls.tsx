import { formats, scales } from "../../src/core/index.js";
import { Fader, Knob, Meter, NumberBox, Toggle, ToggleGroup } from "../../src/react/index.js";
import { log } from "./harness.js";

/** Logs a control's gestures and changes to `window.e2e.events`. */
function logged(source: string) {
  return {
    onGestureStart: () => log({ source, type: "start" }),
    onValueChange: (value: number, { reason, delta }: { reason: string; delta: number }) =>
      log({ source, type: "change", value, reason, delta }),
    onGestureEnd: (value: number) => log({ source, type: "end", value }),
  };
}

export function Controls() {
  return (
    <main>
      <h1>daw-ui fixture</h1>

      <section>
        <Knob.Root className="knob" data-testid="knob" sensitivity={200} {...logged("knob")}>
          <Knob.Label>Cutoff</Knob.Label>
          <Knob.Control className="knob-control">
            <svg viewBox="0 0 100 100">
              <Knob.Track className="knob-track" />
              <Knob.Range className="knob-range" />
              <Knob.Pointer className="knob-pointer" />
            </svg>
          </Knob.Control>
          <Knob.Value />
        </Knob.Root>

        <Knob.Root className="knob" data-testid="encoder" endless max={24} step={1} sensitivity={240} {...logged("encoder")}>
          <Knob.Label>Browse</Knob.Label>
          <Knob.Control className="knob-control">
            <svg viewBox="0 0 100 100">
              <Knob.Track className="knob-track" />
              <Knob.Pointer className="knob-pointer" />
            </svg>
          </Knob.Control>
        </Knob.Root>

        {/* A modulated knob, as in Serum: the range of an LFO around it, and a handle beside it for its depth. */}
        <Knob.Root className="knob modulated" defaultValue={0.5} {...logged("level")}>
          <Knob.Label>Level</Knob.Label>
          <Knob.Control className="knob-control">
            <svg viewBox="0 0 100 100">
              <Knob.Track className="knob-track" />
              <Knob.ModulationRange className="knob-modulation-range" data-testid="modulation range" />
              <Knob.Pointer className="knob-pointer" />
            </svg>
          </Knob.Control>
          <Knob.ModulationDepth className="knob-depth" aria-label="LFO depth" defaultValue={0.25} {...logged("depth")} />
        </Knob.Root>
      </section>

      <section>
        <Fader.Root
          className="fader"
          data-testid="volume"
          min={-70}
          max={6}
          defaultValue={0}
          scale={scales.decibel}
          format={formats.decibel({ locale: "en" })}
          {...logged("volume")}
        >
          <Fader.Label>Volume</Fader.Label>
          <Fader.Control className="fader-control">
            <Fader.Track className="fader-track">
              <Fader.Range className="fader-range" />
              <Fader.Thumb className="fader-thumb" data-testid="volume-thumb" />
            </Fader.Track>
          </Fader.Control>
          <Fader.Value />
        </Fader.Root>
      </section>

      {(["ltr", "rtl"] as const).map((direction) => (
        <section key={direction} dir={direction}>
          <Fader.Root className="fader" orientation="horizontal" defaultValue={0.5} data-testid={`balance-${direction}`}>
            <Fader.Label>{`Balance ${direction}`}</Fader.Label>
            <Fader.Control className="fader-control">
              <Fader.Track className="fader-track">
                <Fader.Range className="fader-range" />
                <Fader.Thumb className="fader-thumb" data-testid={`balance-${direction}-thumb`} />
              </Fader.Track>
            </Fader.Control>
          </Fader.Root>
        </section>
      ))}

      <section>
        <NumberBox.Root min={20} max={999} step={0.01} defaultValue={120} format={formats.number({ locale: "pl" })}>
          <NumberBox.Label>Tempo</NumberBox.Label>
          <NumberBox.Field className="number-box" />
        </NumberBox.Root>

        <NumberBox.Root min={0} max={400} defaultValue={0} format={formats.position({ locale: "en" })}>
          <NumberBox.Label>Position</NumberBox.Label>
          <NumberBox.Segments className="number-box" labels={{ bars: "Bar", beats: "Beat", divisions: "Sixteenth" }} />
        </NumberBox.Root>
      </section>

      <section>
        <Meter.Root className="meter" data-testid="meter" min={-60} max={0} read={() => window.e2e.level}>
          <Meter.Label>Master</Meter.Label>
          <Meter.Track className="meter-track">
            <Meter.Bar className="meter-bar" data-testid="meter-bar" />
            <Meter.Peak className="meter-peak" />
          </Meter.Track>
          <Meter.Clip className="meter-clip" aria-label="Reset clip" />
        </Meter.Root>
      </section>

      {(["ltr", "rtl"] as const).map((direction) => (
        <section key={direction} dir={direction}>
          <ToggleGroup
            paint
            erase="secondary"
            className="steps"
            aria-label={`Steps ${direction}`}
            onGestureStart={() => log({ source: `steps-${direction}`, type: "start" })}
            onGestureEnd={() => log({ source: `steps-${direction}`, type: "end" })}
          >
            {Array.from({ length: 16 }, (_, index) => (
              <Toggle key={index} className="step" aria-label={`${direction} step ${index + 1}`} />
            ))}
          </ToggleGroup>
        </section>
      ))}

      {/* A text field: WebKit on macOS skips plain buttons on Tab. */}
      <input aria-label="After the steps" />

      <div className="spacer" />
    </main>
  );
}
