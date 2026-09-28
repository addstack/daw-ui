import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app.js";
import { box } from "./controls.js";
import "./styles.css";

// In development, the box is in the console as `box`, to look into.
if (import.meta.env.DEV) Object.assign(window, { box });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
