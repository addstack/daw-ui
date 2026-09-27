import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Arrangement } from "./arrangement.js";
import { Automation } from "./automation.js";
import { Controls } from "./controls.js";
import { installHarness } from "./harness.js";
import { Stress } from "./stress.js";
import { Waveforms } from "./waveforms.js";

installHarness();

const view = new URLSearchParams(location.search).get("view");
const views = { stress: Stress, automation: Automation, waveforms: Waveforms, arrangement: Arrangement };
const View = views[view as keyof typeof views] ?? Controls;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <View />
  </StrictMode>,
);
