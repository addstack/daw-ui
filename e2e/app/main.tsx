import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Controls } from "./controls.js";
import { installHarness } from "./harness.js";
import { Stress } from "./stress.js";

installHarness();

const view = new URLSearchParams(location.search).get("view");

createRoot(document.getElementById("root")!).render(
  <StrictMode>{view === "stress" ? <Stress /> : <Controls />}</StrictMode>,
);
