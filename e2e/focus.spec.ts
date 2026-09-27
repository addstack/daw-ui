import { expect, test, type Locator, type Page } from "@playwright/test";

import { center } from "./fixture.js";

// docs/principles.md, section 2: a press with a pointer moves focus to what it pressed, without the focus
// ring, which is for the keyboard, as the browser's own focusing on a click shows none.

const focusVisible = (locator: Locator) => locator.evaluate((element) => element.matches(":focus-visible"));

async function press(page: Page, locator: Locator) {
  const { x, y } = await center(locator);
  await page.mouse.click(x, y);
}

test("a press on a knob, a fader, a toggle or a label focuses without a ring; the keyboard shows one", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "daw-ui fixture" })).toBeVisible();
  for (const control of [
    page.getByRole("slider", { name: "Cutoff", exact: true }),
    page.getByRole("slider", { name: "Volume", exact: true }),
    page.getByRole("button", { name: "ltr step 1", exact: true }),
  ]) {
    await press(page, control);
    await expect(control).toBeFocused();
    expect(await focusVisible(control)).toBe(false);
  }
  // A click on a label focuses its control.
  await press(page, page.getByText("Cutoff", { exact: true }));
  await expect(page.getByRole("slider", { name: "Cutoff", exact: true })).toBeFocused();
  expect(await focusVisible(page.getByRole("slider", { name: "Cutoff", exact: true }))).toBe(false);

  await page.getByRole("button", { name: "ltr step 1", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  const next = page.getByRole("button", { name: "ltr step 2", exact: true });
  await expect(next).toBeFocused();
  expect(await focusVisible(next)).toBe(true);
});

test("a press on a thumb of an XY pad or a key focuses without a ring; the keyboard shows one", async ({ page }) => {
  await page.goto("/?view=xy-pad");
  const thumb = page.getByRole("slider", { name: "Pad 1", exact: true });
  await press(page, thumb);
  await expect(thumb).toBeFocused();
  expect(await focusVisible(thumb)).toBe(false);

  await page.goto("/?view=keys");
  const piano = page.getByRole("group", { name: "Piano", exact: true });
  const key = piano.getByRole("button", { name: "C4", exact: true });
  await press(page, key);
  await expect(key).toBeFocused();
  expect(await focusVisible(key)).toBe(false);
  await page.keyboard.press("ArrowRight");
  const next = piano.getByRole("button", { name: "C♯4", exact: true });
  await expect(next).toBeFocused();
  expect(await focusVisible(next)).toBe(true);
});
