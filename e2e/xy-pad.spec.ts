import { expect, test, type Page } from "@playwright/test";

import type { XYValue } from "../src/react/index.js";

async function open(page: Page, name: string) {
  await page.goto("/?view=xy-pad");
  await expect(page.getByRole("heading", { name: "daw-ui xy-pad" })).toBeVisible();
  const box = (await page.getByTestId(`${name} control`).boundingBox())!;
  const values = async () => JSON.parse((await page.getByTestId(`${name} values`).textContent()) ?? "[]") as XYValue[];
  return { box, values };
}

const center = async (page: Page, name: string) => {
  const box = (await page.getByRole("slider", { name, exact: true }).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

test("a thumb sits at its value and follows a drag", async ({ page }) => {
  const { box, values } = await open(page, "Pad");
  const from = await center(page, "Pad 1");
  // 0.25 across 200 px, halfway up 100 px.
  expect(from.x - box.x).toBeCloseTo(50, 0);
  expect(from.y - box.y).toBeCloseTo(50, 0);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y - 30, { steps: 4 });
  await page.mouse.up();
  const [moved] = await values();
  expect(moved![0]).toBeCloseTo(0.35, 2);
  expect(moved![1]).toBeCloseTo(0.8, 2);
});

test("a press on the pad brings the nearest thumb there", async ({ page }) => {
  const { box, values } = await open(page, "Pad");
  await page.mouse.click(box.x + 180, box.y + 10);
  const [first, second] = await values();
  expect(first).toEqual([0.25, 0.5]);
  // Within a pixel: WebKit presses at whole pixels.
  expect(second![0]).toBeCloseTo(0.9, 1);
  expect(second![1]).toBeCloseTo(0.9, 1);
  await expect(page.getByRole("slider", { name: "Pad 2", exact: true })).toBeFocused();
});

test("right to left, across runs along the reading direction: for the thumbs, the drags and the arrows", async ({ page }) => {
  const { box, values } = await open(page, "RTL pad");
  const from = await center(page, "RTL pad 1");
  // 0.25 from the right edge.
  expect(box.x + box.width - from.x).toBeCloseTo(50, 0);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x - 20, from.y, { steps: 4 });
  await page.mouse.up();
  expect((await values())[0]![0]).toBeCloseTo(0.35, 2);
  await page.getByRole("slider", { name: "RTL pad 1", exact: true }).press("ArrowLeft");
  expect((await values())[0]![0]).toBeCloseTo(0.36, 2);
});
