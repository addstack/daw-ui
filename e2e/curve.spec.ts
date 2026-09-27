import { expect, test, type Page } from "@playwright/test";

import type { CurvePoint } from "../src/core/index.js";

async function open(page: Page) {
  await page.goto("/?view=curve");
  await expect(page.getByRole("heading", { name: "daw-ui curve" })).toBeVisible();
  const box = (await page.getByRole("group", { name: "Volume" }).boundingBox())!;
  // Where a time (s) and a value (0 … 1) are on screen: 100 px per second, 100 px from 0 to 1.
  const at = (time: number, value: number) => ({ x: box.x + time * 100, y: box.y + (1 - value) * 100 });
  const points = async () => JSON.parse((await page.getByTestId("points").textContent()) ?? "[]") as CurvePoint[];
  return { at, points };
}

test("a drag moves a point, snapped to the grid in time, and the application keeps it", async ({ page }) => {
  const { at, points } = await open(page);
  const from = at(1, 0.5);
  await page.mouse.move(from.x, from.y);
  await expect(page.getByRole("slider", { name: "Point" })).toHaveCount(2);
  await page.mouse.down();
  await page.mouse.move(from.x + 15, from.y - 10, { steps: 3 });
  await page.mouse.move(from.x + 30, from.y - 20, { steps: 3 });
  await page.mouse.up();
  // 0.3 s snaps to 0.25 s (sixteenths at 120 BPM); 20 px up is 0.2.
  const [, moved] = await points();
  expect(moved!.at).toBe(1.25);
  expect(moved!.value).toBeCloseTo(0.7, 2);
});

test("a double-click on the curve adds a point there", async ({ page }) => {
  const { at, points } = await open(page);
  const where = at(3, 0.2);
  await page.mouse.dblclick(where.x, where.y);
  const added = await points();
  expect(added).toHaveLength(5);
  expect(added[3]!.at).toBe(3);
  expect(added[3]!.value).toBeCloseTo(0.2, 2);
});

test("dragging the middle of a segment bends it", async ({ page }) => {
  const { at, points } = await open(page);
  // The middle of 1 s … 2 s, from 0.5 to 1: at 1.5 s, 0.75.
  const middle = at(1.5, 0.75);
  await page.mouse.move(middle.x, middle.y);
  await expect(page.getByTestId("bend")).toBeVisible();
  await page.mouse.down();
  await page.mouse.move(middle.x, middle.y + 15, { steps: 4 });
  await page.mouse.up();
  const [, bent] = await points();
  expect(typeof bent!.shape).toBe("number");
});

test("keys: Tab into the curve, arrows go from point to point, Up raises a point", async ({ page }) => {
  const { points } = await open(page);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("slider", { name: "Point" })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(":focus")).toHaveAttribute("aria-valuetext", "1.00 s, 0.50");
  await page.keyboard.press("ArrowUp");
  await expect.poll(async () => (await points())[1]!.value).toBeCloseTo(0.51, 3);
});
