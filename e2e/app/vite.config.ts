import { defineConfig } from "vite";

export default defineConfig({
  // Tests drive the page through `window.e2e`; a reload in the middle of a test would lose its state.
  server: { hmr: false },
  build: {
    rollupOptions: {
      onwarn(warning, warn) {
        // The library's "use client" directives mean nothing in a single-page app.
        if (warning.code === "MODULE_LEVEL_DIRECTIVE") return;
        warn(warning);
      },
    },
  },
});
