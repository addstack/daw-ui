import { formats, type ValueFormat } from "../src/core/index.js";
import type { Instrument } from "./audio.js";

// The application owns every word. The library only formats numbers in the
// locale it is given and takes the pan letters from here.

export type Language = "en" | "pl";

type Strings = {
  locale: string;
  title: string;
  documentation: string;
  description: string;
  play: string;
  tempo: string;
  sequencer: string;
  mixer: string;
  instruments: Record<Instrument, string>;
  master: string;
  volume: string;
  pan: string;
  mute: string;
  solo: string;
  muteShort: string;
  soloShort: string;
  cutoff: string;
  resonance: string;
  resetClip: string;
  step: (instrument: string, step: number) => string;
  language: string;
  direction: string;
  hints: string[];
  panFormat: ValueFormat;
};

export const strings: Record<Language, Strings> = {
  en: {
    locale: "en",
    title: "daw-ui playground",
    documentation: "Documentation",
    description: "Headless React components for audio apps. Everything here is built from them, styled in this page's CSS.",
    play: "Play",
    tempo: "Tempo",
    sequencer: "Step sequencer",
    mixer: "Mixer",
    instruments: { kick: "Kick", snare: "Snare", hat: "Hi-hat", clap: "Clap" },
    master: "Master",
    volume: "Volume",
    pan: "Pan",
    mute: "Mute",
    solo: "Solo",
    muteShort: "M",
    soloShort: "S",
    cutoff: "Cutoff",
    resonance: "Resonance",
    resetClip: "Reset clip",
    step: (instrument, step) => `${instrument}, step ${step}`,
    language: "Language",
    direction: "Direction",
    hints: [
      "Drag across steps to paint them; drag with the right button to erase.",
      "Knobs and faders: drag up and down, Shift for fine steps, double-click to reset, or use the wheel.",
      "Solo is exclusive; Cmd/Ctrl-click to solo more than one channel.",
      "Double-click the tempo, or focus it and type.",
      "Every control works from the keyboard: Tab to a control, then arrows. Shift+Arrow paints steps.",
    ],
    panFormat: formats.pan({ left: "L", right: "R", center: "C" }),
  },
  pl: {
    locale: "pl",
    title: "daw-ui – plac zabaw",
    documentation: "Dokumentacja",
    description:
      "Komponenty React bez stylów dla aplikacji audio. Wszystko tutaj jest z nich zbudowane i ostylowane CSS-em tej strony.",
    play: "Odtwarzaj",
    tempo: "Tempo",
    sequencer: "Sekwencer krokowy",
    mixer: "Mikser",
    instruments: { kick: "Stopa", snare: "Werbel", hat: "Hi-hat", clap: "Klaśnięcie" },
    master: "Master",
    volume: "Głośność",
    pan: "Panorama",
    mute: "Wycisz",
    solo: "Solo",
    muteShort: "M",
    soloShort: "S",
    cutoff: "Odcięcie",
    resonance: "Rezonans",
    resetClip: "Wyzeruj przester",
    step: (instrument, step) => `${instrument}, krok ${step}`,
    language: "Język",
    direction: "Kierunek",
    hints: [
      "Przeciągnij po krokach, żeby je zaznaczyć; prawym przyciskiem – żeby wymazać.",
      "Gałki i suwaki: przeciągaj w górę i w dół, Shift – precyzyjnie, dwuklik – reset, albo kółko myszy.",
      "Solo działa na wyłączność; Cmd/Ctrl+klik dodaje kolejny kanał.",
      "Kliknij dwukrotnie tempo albo ustaw na nim fokus i wpisz wartość.",
      "Wszystko działa z klawiatury: Tab do kontrolki, potem strzałki. Shift+strzałka zaznacza kroki.",
    ],
    panFormat: formats.pan({ left: "L", right: "P", center: "Ś" }),
  },
};
