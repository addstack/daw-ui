import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Automation } from "./automation.js";
import { Controls } from "./controls.js";
import { CurveView } from "./curve.js";
import { installHarness } from "./harness.js";
import { KeysView } from "./keys.js";
import { MultiSliderView } from "./multi-slider.js";
import { SliderView } from "./slider.js";
import { SpectrumView } from "./spectrum.js";
import { Stress } from "./stress.js";
import { Waveforms } from "./waveforms.js";
import { XYPadView } from "./xy-pad.js";

installHarness();

const view = new URLSearchParams(location.search).get("view");
const views = { stress: Stress, automation: Automation, waveforms: Waveforms, curve: CurveView, "xy-pad": XYPadView, keys: KeysView, "multi-slider": MultiSliderView, slider: SliderView, spectrum: SpectrumView };
const View = views[view as keyof typeof views] ?? Controls;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <View />
  </StrictMode>,
);
