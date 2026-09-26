import { expect, type Locator, type Page } from "@playwright/test";

import type { HarnessEvent } from "./app/harness.js";

export async function openControls(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "daw-ui fixture" })).toBeVisible();
}

/** The middle of an element, scrolled into view: `page.mouse` does not scroll by itself. */
export async function center(locator: Locator): Promise<{ x: number; y: number }> {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error("The element is not rendered.");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export function valueOf(locator: Locator): Promise<number> {
  return locator.getAttribute("aria-valuenow").then(Number);
}

/** Gesture and change events of one source, without values of intermediate changes. */
export async function eventsOf(page: Page, source: string): Promise<HarnessEvent[]> {
  const events = await page.evaluate(() => window.e2e.events);
  return events.filter((event) => event.source === source);
}

export async function clearEvents(page: Page): Promise<void> {
  await page.evaluate(() => (window.e2e.events.length = 0));
}
