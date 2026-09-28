import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Box } from "../engine/box.js";
import { App } from "./app.js";
import { loadPreset } from "./presets.js";
import "./styles.css";

const box = new Box();
// Before the panels that show it render.
loadPreset(box, 0);

// In development, the box is in the console as `box`, to look into.
if (import.meta.env.DEV) Object.assign(window, { box });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App box={box} />
  </StrictMode>,
);
