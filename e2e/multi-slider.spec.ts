import { expect, test, type Page } from "@playwright/test";

import { eventsOf } from "./fixture.js";

async function open(page: Page) {
  await page.goto("/?view=multi-slider");
  await expect(page.getByRole("heading", { name: "daw-ui multi-slider" })).toBeVisible();
}

/** The values a multi-slider last reported. */
const values = async (page: Page, source: string) => (await eventsOf(page, source)).filter((event) => event.type === "change").at(-1)?.value as number[];

test("a fast stroke sets every step it crosses, along its path, as one gesture", async ({ page }) => {
  await open(page);
  const box = (await page.getByTestId("Velocity control").boundingBox())!;
  // From the bottom of step 1 to the top of step 16, in three moves: steps are 20 px wide, the moves 100 px apart.
  await page.mouse.move(box.x + 10, box.y + 99);
  await page.mouse.down();
  await page.mouse.move(box.x + 310, box.y + 1, { steps: 3 });
  await page.mouse.up();
  const velocities = await values(page, "Velocity");
  // Rising along the stroke, every step set, none skipped.
  for (let index = 1; index < 16; index++) expect(velocities[index]!).toBeGreaterThan(velocities[index - 1]!);
  expect(velocities[15]).toBeGreaterThan(120);
  const events = await eventsOf(page, "Velocity");
  expect(events.filter((event) => event.type === "start")).toHaveLength(1);
  await expect(page.getByRole("slider", { name: "Velocity 16", exact: true })).toHaveAttribute("aria-valuetext", String(velocities[15]));
});

test("right to left, the steps run from the right, and so do the arrows", async ({ page }) => {
  await open(page);
  const box = (await page.getByTestId("RTL velocity control").boundingBox())!;
  const first = (await page.getByRole("slider", { name: "RTL velocity 1", exact: true }).boundingBox())!;
  expect(box.x + box.width - (first.x + first.width)).toBeCloseTo(0, 0);
  await page.mouse.click(first.x + 10, box.y + 50);
  // Halfway up, within a step: WebKit presses at whole pixels.
  const [velocity] = await values(page, "RTL velocity");
  expect(Math.abs(velocity! - 64)).toBeLessThanOrEqual(1);
  await page.keyboard.press("Shift+ArrowLeft");
  expect((await values(page, "RTL velocity"))[1]).toBe(velocity);
  await expect(page.getByRole("slider", { name: "RTL velocity 2", exact: true })).toBeFocused();
});

test("items placed by the application, as under a piano roll: a stroke over a chord sets all its notes", async ({ page }) => {
  await open(page);
  const box = (await page.getByTestId("chord control").boundingBox())!;
  // The chord is at 40 px, the fourth note at 200 px; a stroke from 30 px to 60 px crosses only the chord.
  await page.mouse.move(box.x + 30, box.y + 50);
  await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + 50, { steps: 2 });
  await page.mouse.up();
  const [first, second, third, fourth] = await values(page, "chord");
  expect(Math.abs(first! - 64)).toBeLessThanOrEqual(1);
  expect([second, third, fourth]).toEqual([first, first, 100]);
});
