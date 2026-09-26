import { mkdirSync, writeFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

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
  reactCommits: number;
};

const results: Result[] = [];

test.describe.configure({ mode: "serial" });

test.afterAll(() => {
  mkdirSync("perf-results", { recursive: true });
  writeFileSync("perf-results/browser.json", JSON.stringify(results, null, 2));
  const ms = (value: number | undefined) => (value === undefined ? "–" : value.toFixed(1));
  const rows = results.map(
    (result) =>
      `| ${result.scenario} | ${ms(result.p50)} | ${ms(result.p95)} | ${ms(result.p99)} | ${result.dropped} / ${result.frames} | ${result.longAnimationFrames} | ${ms(result.inputLatencyP50)} / ${ms(result.inputLatencyP95)} | ${result.reactCommits} |`,
  );
  writeFileSync(
    "perf-results/browser.md",
    [
      `### Browser (Chromium, production build, CPU ${CPU_SLOWDOWN}× slower)`,
      "",
      "| Scenario | Frame p50 (ms) | p95 | p99 | Dropped frames | Long animation frames | Input → frame p50 / p95 (ms) | React commits |",
      "| --- | --: | --: | --: | --: | --: | --: | --: |",
      ...rows,
      "",
    ].join("\n"),
  );
});

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))] ?? Number.NaN;
}

async function openStress(page: Page): Promise<void> {
  await page.goto("/?view=stress");
  await expect(page.getByRole("heading", { name: "daw-ui stress" })).toBeVisible();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_SLOWDOWN });
  // Let the page settle (fonts, first meter frames) before measuring.
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    window.reactCommits = 0;
    window.e2e.inputLatencies = [];
  });
}

/** Runs `interaction` while frames are measured for `durationMs`, and records the result. */
async function measure(
  page: Page,
  scenario: string,
  durationMs: number,
  interaction?: () => Promise<void>,
): Promise<Result> {
  const frames = page.evaluate((duration) => window.e2e.measureFrames(duration), durationMs);
  await interaction?.();
  const stats = await frames;
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
    reactCommits: await page.evaluate(() => window.reactCommits),
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
  // The counter works: the fader itself renders as it moves.
  expect(result.reactCommits).toBeGreaterThan(0);
  // Budget: at most one commit per pointer event (60 moves), plus the start and end of the drag.
  expect(result.reactCommits).toBeLessThanOrEqual(62);
});

test("painting a row of a 16 × 64 step sequencer while meters run", async ({ page }) => {
  await openStress(page);
  const from = await centerOf(page, "Row 1 step 1", "button");
  const to = await centerOf(page, "Row 1 step 64", "button");
  const result = await measure(page, "Paint 64 steps, meters running", 1500, () => glide(page, from, to, 30));
  await expect(page.getByRole("button", { name: "Row 1 step 64", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Row 2 step 1", exact: true })).toHaveAttribute("aria-pressed", "false");
  expect(result.reactCommits).toBeGreaterThan(0);
  // Budget: at most one commit per pointer event (30 moves), plus the press and the stroke's start and end.
  expect(result.reactCommits).toBeLessThanOrEqual(33);
});
