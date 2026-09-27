import { expect, test } from "@playwright/test";

import { center, eventsOf, openControls, valueOf } from "./fixture.js";

test.beforeEach(({ page }) => openControls(page));

test("dragging up by the sensitivity covers the travel, as one gesture", async ({ page }) => {
  const knob = page.getByRole("slider", { name: "Cutoff" });
  const start = await center(knob);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x, start.y - 100, { steps: 10 });
  await page.mouse.up();
  expect(await valueOf(knob)).toBeCloseTo(0.5, 2);
  await expect(knob).toBeFocused();

  const events = await eventsOf(page, "knob");
  expect(events.at(0)?.type).toBe("start");
  expect(events.at(-1)).toEqual({ source: "knob", type: "end", value: 0.5 });
  expect(events.filter((event) => event.type === "start")).toHaveLength(1);
});

test("the drag keeps going when the pointer leaves the knob", async ({ page }) => {
  const knob = page.getByRole("slider", { name: "Cutoff" });
  const start = await center(knob);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  // Far to the side of the knob, over other content.
  await page.mouse.move(start.x + 400, start.y - 40, { steps: 5 });
  await page.mouse.move(start.x + 400, start.y - 60, { steps: 2 });
  await page.mouse.up();
  expect(await valueOf(knob)).toBeCloseTo(0.3, 2);
});

test("Shift makes the drag ten times finer", async ({ page }) => {
  const knob = page.getByRole("slider", { name: "Cutoff" });
  const start = await center(knob);
  await page.mouse.move(start.x, start.y);
  await page.keyboard.down("Shift");
  await page.mouse.down();
  await page.mouse.move(start.x, start.y - 100, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  expect(await valueOf(knob)).toBeCloseTo(0.05, 2);
});

test("the wheel changes the value instead of scrolling the page", async ({ page }) => {
  const knob = page.getByRole("slider", { name: "Cutoff" });
  await knob.focus();
  await page.keyboard.press("End");
  const { x, y } = await center(knob);
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, 100);
  await expect.poll(() => valueOf(knob)).toBeLessThan(1);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test("Tab reaches the knob, arrows change it, double-click resets it", async ({ page }) => {
  const knob = page.getByRole("slider", { name: "Cutoff" });
  await page.keyboard.press("Tab");
  await expect(knob).toBeFocused();
  await page.keyboard.press("PageUp");
  await page.keyboard.press("ArrowUp");
  expect(await valueOf(knob)).toBeCloseTo(0.11, 5);
  await knob.dblclick();
  expect(await valueOf(knob)).toBe(0);
});

test("an endless knob keeps turning past a full turn, one step per detent", async ({ page }) => {
  const encoder = page.getByRole("spinbutton", { name: "Browse" });
  const start = await center(encoder);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  // Down, where the page has room: 240 px is one turn of 24 steps, 300 px a turn and a quarter.
  await page.mouse.move(start.x, start.y + 300, { steps: 30 });
  await page.mouse.up();
  expect(await valueOf(encoder)).toBe(-30);
  // From -180deg at 0, on past -540deg: the rotation never jumps back.
  await expect(page.getByTestId("encoder")).toHaveCSS("--knob-angle", "-630deg");

  const changes = (await eventsOf(page, "encoder")).filter((event) => event.type === "change");
  expect(changes.reduce((sum, event) => sum + (event.delta ?? 0), 0)).toBe(-30);
});

test("double-clicking a label or a value, or dragging across them, selects no text", async ({ page }) => {
  // WebKit may select the line break between the fixture's own sections; no text of a part is selected.
  const selection = () => page.evaluate(() => getSelection()?.toString().trim() ?? "");
  const label = page.getByText("Cutoff", { exact: true });
  await label.dblclick();
  expect(await selection()).toBe("");
  await page.getByTestId("knob").locator("output").dblclick();
  expect(await selection()).toBe("");

  const from = await center(label);
  const volume = await center(page.getByText("Volume", { exact: true }));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(volume.x + 40, volume.y + 60, { steps: 10 });
  await page.mouse.up();
  expect(await selection()).toBe("");
});

test("the depth handle of a modulation drags as a knob does, and the range around the knob follows it", async ({ page }) => {
  const handle = page.getByRole("slider", { name: "LFO depth" });
  const range = page.getByTestId("modulation range");
  const before = await range.getAttribute("d");
  await expect(handle).toHaveAttribute("aria-valuetext", "25%");
  const start = await center(handle);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  // 200 px is the whole travel from −100% to 100%: 50 px up is 50% more.
  await page.mouse.move(start.x, start.y - 50, { steps: 5 });
  await page.mouse.up();
  await expect(handle).toHaveAttribute("aria-valuetext", "75%");
  expect(await range.getAttribute("d")).not.toBe(before);
  // The knob keeps its value; only the depth changed, as one gesture.
  expect(await valueOf(page.getByRole("slider", { name: "Level" }))).toBe(0.5);
  const events = await eventsOf(page, "depth");
  expect(events.filter((event) => event.type === "start")).toHaveLength(1);
  expect(events.at(-1)).toEqual({ source: "depth", type: "end", value: 0.75 });
  // A double-click takes the modulation away.
  await handle.dblclick();
  await expect(handle).toHaveAttribute("aria-valuetext", "0%");
  await expect(range).not.toHaveAttribute("d");
});
