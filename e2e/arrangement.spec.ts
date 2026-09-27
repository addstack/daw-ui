import { expect, test, type Locator, type Page } from "@playwright/test";

// 62.5 px per second; moves and trims snap to beats (0.5 s).
const SCALE = 62.5;

test.beforeEach(async ({ page }) => {
  await page.goto("/?view=arrangement");
  await expect(page.getByRole("heading", { name: "daw-ui arrangement" })).toBeVisible();
});

/** A region's place, in seconds, from where it is drawn. */
async function placeOf(page: Page, region: Locator) {
  const timeline = (await page.getByTestId("arrangement").boundingBox())!;
  const box = (await region.boundingBox())!;
  return { at: (box.x - timeline.x) / SCALE, duration: box.width / SCALE, top: box.y - timeline.y };
}

async function glide(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

test("dragging a region moves it, snapped to beats, and the application keeps it there", async ({ page }) => {
  const kick = page.getByRole("gridcell", { name: "Kick" });
  const box = (await kick.boundingBox())!;
  // 100 px is 1.6 s: from 1 s to 2.6 s, which snaps to 2.5 s.
  await glide(page, { x: box.x + 60, y: box.y + 7 }, { x: box.x + 160, y: box.y + 7 });
  const place = await placeOf(page, kick);
  expect(place.at).toBeCloseTo(2.5, 1);
  await expect(kick).toHaveAttribute("aria-selected", "true");
});

test("dragging a region down moves it to the next track", async ({ page }) => {
  const kick = page.getByRole("gridcell", { name: "Kick" });
  const box = (await kick.boundingBox())!;
  await glide(page, { x: box.x + 60, y: box.y + 20 }, { x: box.x + 60, y: box.y + 20 + 48 });
  await expect(page.getByRole("row", { name: "bass" }).getByRole("gridcell", { name: "Kick" })).toBeVisible();
});

test("the end handle, there when the pointer is on the region, trims it to a beat", async ({ page }) => {
  const kick = page.getByRole("gridcell", { name: "Kick" });
  await kick.hover();
  const end = kick.getByRole("slider", { name: "End" });
  await expect(end).toBeVisible();
  const box = (await end.boundingBox())!;
  // 70 px to the left is 1.12 s: from 4 s long to 2.88, which snaps to an end at 4 s: 3 s long.
  await glide(page, { x: box.x + 4, y: box.y + 20 }, { x: box.x + 4 - 70, y: box.y + 20 });
  expect((await placeOf(page, kick)).duration).toBeCloseTo(3, 1);
});

test("from the keyboard: Tab reaches the regions, Space selects, Ctrl and an arrow move by a beat", async ({ page }) => {
  const kick = page.getByRole("gridcell", { name: "Kick" });
  await page.keyboard.press("Tab");
  await expect(kick).toBeFocused();
  await page.keyboard.press("Space");
  await expect(kick).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Control+ArrowRight");
  expect((await placeOf(page, kick)).at).toBeCloseTo(1.5, 1);
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("gridcell", { name: "Bass" })).not.toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("gridcell", { name: "Bass" })).toBeFocused();
});
