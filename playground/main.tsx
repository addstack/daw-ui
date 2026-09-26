import { StrictMode, useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { formats, scales, type ValueFormat } from "../src/core/index.js";
import {
  Fader as FaderPrimitive,
  Knob as KnobPrimitive,
  Meter as MeterPrimitive,
  NumberBox as NumberBoxPrimitive,
  Toggle,
  ToggleGroup,
} from "../src/react/index.js";
import { DrumMachine, INSTRUMENTS, STEPS, type Instrument } from "./audio.js";
import { strings, type Language } from "./i18n.js";

// The playground is written the way an application uses the library: the
// sections marked "components/ui" are what a shadcn registry would ship
// (headless parts plus this page's CSS classes); the rest is the app.

const cx = (...classes: (string | false | undefined)[]) => classes.filter(Boolean).join(" ");

// --- components/ui/knob.tsx -------------------------------------------------

function Knob({
  label,
  className,
  ...props
}: Omit<KnobPrimitive.Root.Props, "className"> & { label: string; className?: string }) {
  return (
    <KnobPrimitive.Root data-slot="knob" className={cx("knob", className)} {...props}>
      <KnobPrimitive.Label className="control-label">{label}</KnobPrimitive.Label>
      <KnobPrimitive.Control data-slot="knob-control" className="knob-control">
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <KnobPrimitive.Track className="knob-track" radius={38} />
          <KnobPrimitive.Range className="knob-range" radius={38} />
          <KnobPrimitive.Pointer className="knob-pointer" from={10} to={28} />
        </svg>
      </KnobPrimitive.Control>
      <KnobPrimitive.Value className="control-value" />
    </KnobPrimitive.Root>
  );
}

// --- components/ui/fader.tsx ------------------------------------------------

const FADER_TICKS = [6, 0, -6, -12, -24, -48];

function Fader({
  label,
  className,
  ...props
}: Omit<FaderPrimitive.Root.Props, "className"> & { label: string; className?: string }) {
  return (
    <FaderPrimitive.Root data-slot="fader" className={cx("fader", className)} {...props}>
      <FaderPrimitive.Label className="sr-only">{label}</FaderPrimitive.Label>
      <FaderPrimitive.Control data-slot="fader-control" className="fader-control">
        <FaderPrimitive.Track className="fader-track">
          <FaderPrimitive.Range className="fader-range" />
          {FADER_TICKS.map((tick) => (
            <FaderPrimitive.Tick key={tick} value={tick} className="fader-tick" dir="ltr">
              {tick > 0 ? `+${tick}` : tick}
            </FaderPrimitive.Tick>
          ))}
          <FaderPrimitive.Thumb className="fader-thumb" />
        </FaderPrimitive.Track>
      </FaderPrimitive.Control>
      <FaderPrimitive.Value className="control-value" />
    </FaderPrimitive.Root>
  );
}

// --- components/ui/meter.tsx ------------------------------------------------

function Meter({ label, resetLabel, ...props }: MeterPrimitive.Root.Props & { label: string; resetLabel: string }) {
  return (
    <MeterPrimitive.Root data-slot="meter" className="meter" min={-60} max={6} {...props}>
      <MeterPrimitive.Label className="sr-only">{label}</MeterPrimitive.Label>
      <MeterPrimitive.Clip className="meter-clip" aria-label={resetLabel} />
      <MeterPrimitive.Track className="meter-track">
        <MeterPrimitive.Bar className="meter-bar" />
        <MeterPrimitive.Peak className="meter-peak" />
      </MeterPrimitive.Track>
    </MeterPrimitive.Root>
  );
}

// --- components/ui/number-box.tsx -------------------------------------------

function NumberBox({ label, ...props }: NumberBoxPrimitive.Root.Props & { label: string }) {
  return (
    <NumberBoxPrimitive.Root data-slot="number-box" className="number-box" {...props}>
      <NumberBoxPrimitive.Label className="control-label">{label}</NumberBoxPrimitive.Label>
      <NumberBoxPrimitive.Field className="number-box-field" />
    </NumberBoxPrimitive.Root>
  );
}

// --- the app ------------------------------------------------------------------

const engine = new DrumMachine();

const DEFAULT_PATTERN = [
  ...[0, 4, 8, 12].map((step) => `kick:${step}`),
  ...[4, 12].map((step) => `snare:${step}`),
  ...[0, 2, 4, 6, 8, 10, 12, 14].map((step) => `hat:${step}`),
  ...[12, 15].map((step) => `clap:${step}`),
];
engine.pattern = new Set(DEFAULT_PATTERN);

function Section({ title, children, className }: { title: string; children: ReactNode; className: string }) {
  return (
    <section className={cx("panel", className)} aria-label={title}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function App() {
  const [language, setLanguage] = useState<Language>(() => (navigator.language.startsWith("pl") ? "pl" : "en"));
  const [direction, setDirection] = useState<"ltr" | "rtl">("ltr");
  const [playing, setPlaying] = useState(false);
  const t = strings[language];
  const decibel = formats.decibel({ locale: t.locale });
  const sequencer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.documentElement.lang = language;
    document.title = t.title;
  }, [language, t.title]);

  // The playhead is drawn straight into the DOM once per frame, like the meters.
  useEffect(() => {
    let frame = 0;
    let shown = -1;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const step = engine.playhead();
      if (step === shown || !sequencer.current) return;
      for (const element of sequencer.current.querySelectorAll("[data-current]")) element.removeAttribute("data-current");
      for (const element of sequencer.current.querySelectorAll(`[data-step="${step}"]`)) element.setAttribute("data-current", "");
      shown = step;
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, []);

  const setPlayback = (play: boolean) => {
    setPlaying(play);
    if (play) void engine.start();
    else engine.stop();
  };

  // Space plays and stops, as in every DAW, unless a control has focus.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== " " || event.target !== document.body) return;
      event.preventDefault();
      setPlayback(!engine.playing);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="app" dir={direction}>
      <header className="header">
        <div>
          <h1>{t.title}</h1>
          <p dir="auto">{t.description}</p>
          {/* Published at /daw-ui/playground/, next to the docs at /daw-ui/docs/. */}
          <a className="docs-link" href="../docs/">
            {t.documentation}
          </a>
        </div>
        <div className="settings">
          <label>
            {t.language}
            <select value={language} onChange={(event) => setLanguage(event.target.value as Language)}>
              <option value="en">English</option>
              <option value="pl">Polski</option>
            </select>
          </label>
          <label>
            {t.direction}
            <select value={direction} onChange={(event) => setDirection(event.target.value as "ltr" | "rtl")}>
              <option value="ltr">LTR</option>
              <option value="rtl">RTL</option>
            </select>
          </label>
        </div>
      </header>

      <div className="transport">
        <Toggle className="play" aria-label={t.play} pressed={playing} onPressedChange={setPlayback}>
          <span aria-hidden="true">{playing ? "■" : "▶"}</span>
        </Toggle>
        <NumberBox
          label={t.tempo}
          min={40}
          max={240}
          step={0.1}
          defaultValue={engine.tempo}
          format={formats.number({ locale: t.locale, digits: 1, unit: "BPM" })}
          onValueChange={(tempo) => (engine.tempo = tempo)}
        />
      </div>

      <Section title={t.sequencer} className="sequencer-panel">
        <ToggleGroup
          ref={sequencer}
          className="sequencer"
          paint
          erase="secondary"
          multiple
          defaultValue={DEFAULT_PATTERN}
          onValueChange={(pattern) => (engine.pattern = new Set(pattern))}
        >
          {INSTRUMENTS.map((instrument) => (
            <div key={instrument} className="sequencer-row">
              <span className="sequencer-name">{t.instruments[instrument]}</span>
              {Array.from({ length: STEPS }, (_, step) => (
                <Toggle
                  key={step}
                  lane={instrument}
                  value={`${instrument}:${step}`}
                  data-step={step}
                  data-beat={step % 4 === 0 || undefined}
                  className="step"
                  aria-label={t.step(t.instruments[instrument], step + 1)}
                />
              ))}
            </div>
          ))}
        </ToggleGroup>
      </Section>

      <Section title={t.mixer} className="mixer-panel">
        <ToggleGroup className="mixer" paint exclusive={{ solo: "click" }}>
          {INSTRUMENTS.map((instrument) => (
            <ChannelStrip key={instrument} instrument={instrument} language={language} decibel={decibel} />
          ))}
          <div className="strip master">
            <span className="strip-name">{t.master}</span>
            <Knob
              label={t.cutoff}
              min={20}
              max={20_000}
              defaultValue={20_000}
              scale={scales.log}
              format={formats.frequency({ locale: t.locale })}
              onValueChange={(cutoff) => engine.setMaster({ cutoff })}
            />
            <Knob
              label={t.resonance}
              min={0.1}
              max={20}
              defaultValue={0.7}
              scale={scales.log}
              format={formats.number({ locale: t.locale, digits: 1 })}
              onValueChange={(resonance) => engine.setMaster({ resonance })}
            />
            <div className="strip-levels">
              <Meter label={`${t.master}: ${t.volume}`} resetLabel={t.resetClip} read={() => engine.masterLevel()} format={decibel} />
              <Fader
                label={`${t.master}: ${t.volume}`}
                min={-Infinity}
                max={6}
                defaultValue={0}
                zones={{ hot: 0 }}
                scale={scales.decibel}
                format={decibel}
                onValueChange={(volume) => engine.setMaster({ volume })}
              />
            </div>
          </div>
        </ToggleGroup>
      </Section>

      <aside className="panel hints">
        <ul>
          {t.hints.map((hint) => (
            <li key={hint} dir="auto">
              {hint}
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

function ChannelStrip({ instrument, language, decibel }: { instrument: Instrument; language: Language; decibel: ValueFormat }) {
  const t = strings[language];
  const name = t.instruments[instrument];
  return (
    <div className="strip">
      <span className="strip-name">{name}</span>
      <Knob
        label={t.pan}
        min={-1}
        max={1}
        origin={0}
        format={t.panFormat}
        onValueChange={(pan) => engine.setChannel(instrument, { pan })}
      />
      <div className="strip-buttons">
        <Toggle
          lane="mute"
          className="strip-toggle mute"
          aria-label={`${t.mute}: ${name}`}
          onPressedChange={(muted) => engine.setChannel(instrument, { muted })}
        >
          {t.muteShort}
        </Toggle>
        <Toggle
          lane="solo"
          className="strip-toggle solo"
          aria-label={`${t.solo}: ${name}`}
          onPressedChange={(soloed) => engine.setChannel(instrument, { soloed })}
        >
          {t.soloShort}
        </Toggle>
      </div>
      <div className="strip-levels">
        <Meter label={`${name}: ${t.volume}`} resetLabel={t.resetClip} read={() => engine.level(instrument)} format={decibel} />
        <Fader
          label={`${name}: ${t.volume}`}
          min={-Infinity}
          max={6}
          defaultValue={0}
          zones={{ hot: 0 }}
          scale={scales.decibel}
          format={decibel}
          onValueChange={(volume) => engine.setChannel(instrument, { volume })}
        />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
