import { expect, test, type Page } from "@playwright/test";

import { eventsOf } from "./fixture.js";

async function open(page: Page) {
  await page.goto("/?view=slider");
  await expect(page.getByRole("heading", { name: "daw-ui slider" })).toBeVisible();
}

const values = async (page: Page, source: string) => (await eventsOf(page, source)).filter((event) => event.type === "change").at(-1)?.value as number[];

const centreOf = async (page: Page, name: string) => {
  const box = (await page.getByRole("slider", { name, exact: true }).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

test("thumbs sit on a logarithmic track; a drag moves one up to its neighbour, and the bands above follow", async ({ page }) => {
  await open(page);
  const track = (await page.getByTestId("Crossover track").boundingBox())!;
  const first = await centreOf(page, "Crossover 1");
  // 200 Hz is a third of the way from 20 Hz to 20 kHz on a logarithmic scale: 100 px of 300.
  expect(first.x - track.x).toBeCloseTo(100, 0);
  await expect(page.getByRole("slider", { name: "Crossover 1", exact: true })).toHaveAttribute("aria-valuetext", "200 Hz");

  // Right, far past the second thumb, which stops it.
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  await page.mouse.move(first.x + 50, first.y, { steps: 5 });
  expect((await values(page, "Crossover"))[0]).toBeCloseTo(20 * 1000 ** (150 / 300), -1);
  await page.mouse.move(first.x + 200, first.y, { steps: 5 });
  await page.mouse.up();
  expect(await values(page, "Crossover")).toEqual([2000, 2000]);
  expect((await eventsOf(page, "Crossover")).filter((event) => event.type === "start")).toHaveLength(1);

  // The middle band is now empty; the low band ends where the thumbs are.
  const low = (await page.getByTestId("Crossover Low").boundingBox())!;
  const second = await centreOf(page, "Crossover 2");
  expect(low.x + low.width).toBeCloseTo(second.x, 0);
  // Nothing but its dashed edge.
  expect((await page.getByTestId("Crossover Mid").boundingBox())!.width).toBeLessThanOrEqual(1);
});

test("a press on the track brings the nearest thumb there", async ({ page }) => {
  await open(page);
  const track = (await page.getByTestId("Crossover track").boundingBox())!;
  await page.mouse.click(track.x + 280, track.y + 2);
  const [low, high] = await values(page, "Crossover");
  expect(low).toBe(200);
  // Within a pixel: WebKit presses at whole pixels.
  expect(Math.log10(high! / 20) / 3).toBeCloseTo(280 / 300, 1);
  await expect(page.getByRole("slider", { name: "Crossover 2", exact: true })).toBeFocused();
});

test("right to left, the track runs from the right, and so do drags and arrows", async ({ page }) => {
  await open(page);
  const track = (await page.getByTestId("RTL crossover track").boundingBox())!;
  const first = await centreOf(page, "RTL crossover 1");
  expect(track.x + track.width - first.x).toBeCloseTo(100, 0);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  await page.mouse.move(first.x - 30, first.y, { steps: 3 });
  await page.mouse.up();
  const [moved] = await values(page, "RTL crossover");
  expect(moved!).toBeGreaterThan(200);
  await page.getByRole("slider", { name: "RTL crossover 1", exact: true }).press("ArrowLeft");
  expect((await values(page, "RTL crossover"))[0]!).toBeGreaterThan(moved!);
});

test("vertical, thumbs rise from the bottom and a drag up raises them", async ({ page }) => {
  await open(page);
  const track = (await page.getByTestId("vertical track").boundingBox())!;
  const upper = await centreOf(page, "Vertical 2");
  expect(track.y + track.height - upper.y).toBeCloseTo(150, 0);
  await page.mouse.move(upper.x, upper.y);
  await page.mouse.down();
  await page.mouse.move(upper.x, upper.y - 20, { steps: 2 });
  await page.mouse.up();
  expect((await values(page, "vertical"))[1]).toBeCloseTo(0.85, 2);
});
