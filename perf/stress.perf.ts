import { mkdirSync, writeFileSync } from "node:fs";

import { expect, test, type CDPSession, type Page } from "@playwright/test";

// Measures the stress page (e2e/app/stress.tsx) in a production build with the
// CPU slowed down 4×. Deterministic budgets (React commits) fail the run;
// timings are recorded in perf-results/ and in the CI job summary, because CI
// machines are too noisy to fail on them. See docs/principles.md, section 7.

const CPU_SLOWDOWN = 4;
// At 60 Hz a frame is 16.7 ms; an interval above this missed at least one frame.
const DROPPED_FRAME_MS = 25;

type Result = {
  scenario: string;
  frames: number;
  p50: number;
  p95: number;
  p99: number;
  dropped: number;
  longAnimationFrames: number;
  inputLatencyP50?: number | undefined;
  inputLatencyP95?: number | undefined;
  /** Main-thread time per frame (script, style, layout, paint), from Chrome's performance metrics. */
  mainThreadPerFrame: number;
  /** Of which JavaScript. */
  scriptPerFrame: number;
  reactCommits: number;
  /** Canvas tiles drawn by waveforms. */
  canvasDraws: number;
};

const results: Result[] = [];

test.describe.configure({ mode: "serial" });

test.afterAll(() => {
  mkdirSync("perf-results", { recursive: true });
  writeFileSync("perf-results/browser.json", JSON.stringify(results, null, 2));
  const ms = (value: number | undefined) => (value === undefined ? "–" : value.toFixed(1));
  const rows = results.map(
    (result) =>
      `| ${result.scenario} | ${ms(result.mainThreadPerFrame)} | ${ms(result.scriptPerFrame)} | ${ms(result.p50)} / ${ms(result.p99)} | ${result.dropped} / ${result.frames} | ${result.longAnimationFrames} | ${ms(result.inputLatencyP50)} / ${ms(result.inputLatencyP95)} | ${result.reactCommits} | ${result.canvasDraws} |`,
  );
  writeFileSync(
    "perf-results/browser.md",
    [
      `### Browser (Chromium, production build, CPU ${CPU_SLOWDOWN}× slower)`,
      "",
      "| Scenario | Main thread per frame (ms) | Script per frame (ms) | Frame p50 / p99 (ms) | Dropped frames | Long animation frames | Input → frame p50 / p95 (ms) | React commits | Canvas tiles drawn |",
      "| --- | --: | --: | --: | --: | --: | --: | --: | --: |",
      ...rows,
      "",
    ].join("\n"),
  );
});

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))] ?? Number.NaN;
}

const sessions = new WeakMap<Page, CDPSession>();

async function openStress(page: Page, view = "stress", query = ""): Promise<void> {
  await page.goto(`/?view=${view}${query}`);
  await expect(page.getByRole("heading", { name: `daw-ui ${view}` })).toBeVisible();
  const cdp = await page.context().newCDPSession(page);
  sessions.set(page, cdp);
  await cdp.send("Performance.enable");
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_SLOWDOWN });
  // Let the page settle (fonts, first meter frames) before measuring.
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    window.reactCommits = 0;
    window.e2e.inputLatencies = [];
    window.e2e.canvasDraws = 0;
  });
}

/** Runs `interaction` while frames are measured for `durationMs`, and records the result. */
async function measure(
  page: Page,
  scenario: string,
  durationMs: number,
  interaction?: () => Promise<void>,
): Promise<Result> {
  const cdp = sessions.get(page)!;
  const metrics = async () => {
    const { metrics } = await cdp.send("Performance.getMetrics");
    const value = (name: string) => (metrics.find((metric) => metric.name === name)?.value ?? 0) * 1000;
    return { task: value("TaskDuration"), script: value("ScriptDuration") };
  };
  const before = await metrics();
  const frames = page.evaluate((duration) => window.e2e.measureFrames(duration), durationMs);
  await interaction?.();
  const stats = await frames;
  const after = await metrics();
  const latencies = await page.evaluate(() => window.e2e.inputLatencies);
  const result: Result = {
    scenario,
    frames: stats.frames,
    p50: percentile(stats.intervals, 0.5),
    p95: percentile(stats.intervals, 0.95),
    p99: percentile(stats.intervals, 0.99),
    dropped: stats.intervals.filter((interval) => interval > DROPPED_FRAME_MS).length,
    longAnimationFrames: stats.longAnimationFrames,
    inputLatencyP50: latencies.length ? percentile(latencies, 0.5) : undefined,
    inputLatencyP95: latencies.length ? percentile(latencies, 0.95) : undefined,
    // Measured under the slowdown, like the frame times: the budget of a 60 Hz frame is 16.7 ms.
    mainThreadPerFrame: (after.task - before.task) / stats.frames,
    scriptPerFrame: (after.script - before.script) / stats.frames,
    reactCommits: await page.evaluate(() => window.reactCommits),
    canvasDraws: await page.evaluate(() => window.e2e.canvasDraws),
  };
  results.push(result);
  return result;
}

/** Moves the mouse like a hand does: one event per frame, not as fast as the test can send them. */
async function glide(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, events: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let index = 1; index <= events; index++) {
    const t = index / events;
    await page.mouse.move(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
}

async function centerOf(page: Page, name: string, role: "slider" | "button") {
  const box = await page.getByRole(role, { name, exact: true }).boundingBox();
  if (!box) throw new Error(`${name} is not rendered.`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test("64 running meters", async ({ page }) => {
  await openStress(page);
  const result = await measure(page, "64 meters running", 3000);
  // Budget: meters write to the DOM directly and never render through React.
  expect(result.reactCommits).toBe(0);
});

test("dragging a fader while 64 meters run", async ({ page }) => {
  await openStress(page);
  const start = await centerOf(page, "Volume 1", "slider");
  const result = await measure(page, "Fader drag, meters running", 1500, () =>
    glide(page, start, { x: start.x, y: start.y + 60 }, 60),
  );
  // Budget: the fader writes its value to the DOM itself; nothing renders.
  expect(result.reactCommits).toBe(0);
});

test("painting a row of a 16 × 64 step sequencer while meters run", async ({ page }) => {
  await openStress(page);
  const from = await centerOf(page, "Row 1 step 1", "button");
  const to = await centerOf(page, "Row 1 step 64", "button");
  const result = await measure(page, "Paint 64 steps, meters running", 1500, () => glide(page, from, to, 30));
  await expect(page.getByRole("button", { name: "Row 1 step 64", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Row 2 step 1", exact: true })).toHaveAttribute("aria-pressed", "false");
  // Budget: at most one commit per pointer event (30 moves), plus the press and the stroke's start and end.
  expect(result.reactCommits).toBeLessThanOrEqual(33);
});

test("automation: 64 knobs and 64 faders, driven through React state", async ({ page }) => {
  await openStress(page, "automation", "&mode=state");
  const result = await measure(page, "Automation, 128 controls, React state", 3000);
  // The commit counter works: this way renders on every frame it gets. How many frames that is depends on the machine.
  expect(result.reactCommits).toBeGreaterThan(0);
});

test("automation: 64 knobs and 64 faders, driven with read", async ({ page }) => {
  await openStress(page, "automation", "&mode=read");
  const result = await measure(page, "Automation, 128 controls, read", 3000);
  // Budget: read values reach the DOM without rendering.
  expect(result.reactCommits).toBe(0);
});

test("32 waveforms on one timeline: playback", async ({ page }) => {
  await openStress(page, "waveforms", "&mode=play");
  const result = await measure(page, "32 waveforms, playback", 3000);
  // Budget: the playhead and the played parts move in CSS; nothing renders or draws.
  expect(result.reactCommits).toBe(0);
  expect(result.canvasDraws).toBe(0);
});

test("32 waveforms on one timeline: the view pages along", async ({ page }) => {
  await openStress(page, "waveforms", "&mode=scroll");
  const result = await measure(page, "32 waveforms, scrolling with playback", 3000);
  // Budget: scrolling moves the tiles in CSS and draws only those that come into view,
  // at most once each: 64 layers crossing no more than two tiles in 12 seconds of timeline.
  expect(result.reactCommits).toBe(0);
  expect(result.canvasDraws).toBeLessThanOrEqual(128);
});

test("32 waveforms on one timeline: recording a take", async ({ page }) => {
  await openStress(page, "waveforms", "&mode=record");
  const result = await measure(page, "32 waveforms, recording one more", 3000);
  // Budget: nothing renders; the recording draws the tile it grows into, at most once per frame.
  expect(result.reactCommits).toBe(0);
  expect(result.canvasDraws).toBeLessThanOrEqual(result.frames + 2);
});

test("32 waveforms on one timeline: zooming", async ({ page }) => {
  await openStress(page, "waveforms", "&mode=zoom");
  const result = await measure(page, "32 waveforms, zooming", 3000);
  // Budget: nothing renders; tiles are stretched in CSS and redrawn only past twice or half their scale.
  expect(result.reactCommits).toBe(0);
});
