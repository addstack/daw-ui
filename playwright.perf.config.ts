import { defineConfig, devices } from "@playwright/test";

const port = 5190;

// Browser performance measurements (npm run test:perf), in Chromium: it is the
// engine that can throttle the CPU and report long animation frames.
export default defineConfig({
  testDir: "perf",
  testMatch: "*.perf.ts",
  workers: 1,
  timeout: 120_000,
  reporter: "list",
  use: { baseURL: `http://localhost:${port}` },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // A production build: development React is several times slower, and not what users run.
    command: `vite build e2e/app && vite preview e2e/app --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
