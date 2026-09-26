import { expect, test } from "@playwright/test";

import { center, openControls } from "./fixture.js";

test.beforeEach(({ page }) => openControls(page));

test("a number box shows and parses numbers in the locale it is given", async ({ page }) => {
  const tempo = page.getByRole("spinbutton", { name: "Tempo" });
  await expect(tempo).toHaveText("120,00");
  await tempo.dblclick();
  const input = page.getByRole("textbox", { name: "Tempo" });
  await expect(input).toBeFocused();
  await input.fill("128,5");
  await page.keyboard.press("Enter");
  await expect(tempo).toHaveText("128,50");
  await expect(tempo).toBeFocused();
});

test("typing a digit on a focused number box starts editing with it", async ({ page }) => {
  const tempo = page.getByRole("spinbutton", { name: "Tempo" });
  await tempo.focus();
  await page.keyboard.type("90");
  await page.keyboard.press("Enter");
  await expect(tempo).toHaveText("90,00");
});

test("dragging a number box changes it", async ({ page }) => {
  const tempo = page.getByRole("spinbutton", { name: "Tempo" });
  const { x, y } = await center(tempo);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 50, { steps: 5 });
  await page.mouse.up();
  await expect(tempo).not.toHaveText("120,00");
  await expect(page.getByRole("textbox", { name: "Tempo" })).toHaveCount(0);
});

test("the meter follows the level and keeps a clip until it is reset", async ({ page }) => {
  const meter = page.getByTestId("meter");
  const levelVariable = () => meter.evaluate((element) => getComputedStyle(element).getPropertyValue("--meter-level"));
  await page.evaluate(() => (window.e2e.level = -30));
  await expect.poll(levelVariable).toBe("0.5");
  await expect(meter).toHaveAttribute("data-active");
  await expect(page.getByRole("meter", { name: "Master" })).toHaveAttribute("aria-valuenow", "-30");

  await page.evaluate(() => (window.e2e.level = 3));
  const clip = page.getByRole("button", { name: "Reset clip" });
  await expect(clip).toHaveAttribute("data-clipped");
  await page.evaluate(() => (window.e2e.level = -20));
  await clip.click();
  await expect(clip).not.toHaveAttribute("data-clipped");
});
