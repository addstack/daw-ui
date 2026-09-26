import { expect, test, type Page } from "@playwright/test";

import { center, eventsOf, openControls } from "./fixture.js";

test.beforeEach(({ page }) => openControls(page));

const step = (page: Page, index: number, direction: "ltr" | "rtl" = "ltr") =>
  page.getByRole("button", { name: `${direction} step ${index}`, exact: true });

async function pressedSteps(page: Page, direction: "ltr" | "rtl" = "ltr"): Promise<string> {
  let result = "";
  for (let index = 1; index <= 16; index++) {
    result += (await step(page, index, direction).getAttribute("aria-pressed")) === "true" ? "1" : "0";
  }
  return result;
}

test("one fast move across the row paints every step it passes, as one gesture", async ({ page }) => {
  const from = await center(step(page, 1));
  const to = await center(step(page, 16));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // A single pointer event from the first step to the last.
  await page.mouse.move(to.x, to.y, { steps: 1 });
  await page.mouse.up();
  expect(await pressedSteps(page)).toBe("1111111111111111");
  expect(await eventsOf(page, "steps-ltr")).toEqual([
    { source: "steps-ltr", type: "start" },
    { source: "steps-ltr", type: "end" },
  ]);
});

test("a stroke continues outside the group and ends when the button is released there", async ({ page }) => {
  const group = page.getByRole("group", { name: "Steps ltr" });
  const from = await center(step(page, 3));
  const to = await center(step(page, 6));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y + 300, { steps: 4 });
  await expect(group).toHaveAttribute("data-painting", "on");
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.move(to.x, to.y + 300, { steps: 4 });
  await page.mouse.up();
  await expect(group).not.toHaveAttribute("data-painting");
  expect(await pressedSteps(page)).toMatch(/^001.*1/);
});

test("the right button erases, without opening the context menu", async ({ page }) => {
  const first = await center(step(page, 1));
  const last = await center(step(page, 16));
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  await page.mouse.move(last.x, last.y, { steps: 4 });
  await page.mouse.up();

  const contextMenus = await page.evaluateHandle(() => {
    const counter = { count: 0 };
    document.addEventListener("contextmenu", (event) => {
      if (!event.defaultPrevented) counter.count++;
    });
    return counter;
  });
  const from = await center(step(page, 5));
  const to = await center(step(page, 8));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up({ button: "right" });
  expect(await pressedSteps(page)).toBe("1111000011111111");
  expect(await contextMenus.evaluate((counter) => counter.count)).toBe(0);
});

test("the group is one tab stop; arrows follow the reading direction", async ({ page }) => {
  await step(page, 1, "rtl").focus();
  // In a right-to-left row, Left moves to the next step.
  await page.keyboard.press("ArrowLeft");
  await expect(step(page, 2, "rtl")).toBeFocused();
  await page.keyboard.press("Space");
  await page.keyboard.press("Shift+ArrowLeft");
  await expect(step(page, 3, "rtl")).toBeFocused();
  expect(await pressedSteps(page, "rtl")).toBe("0110000000000000");
  // One tab stop per group: Tab leaves it, Shift+Tab lands on the previous group's stop.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("textbox", { name: "After the steps" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(step(page, 3, "rtl")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(step(page, 1, "ltr")).toBeFocused();
});

test("steps react on press, like hardware", async ({ page }) => {
  const { x, y } = await center(step(page, 4));
  await page.mouse.move(x, y);
  await page.mouse.down();
  await expect(step(page, 4)).toHaveAttribute("aria-pressed", "true");
  await page.mouse.up();
  await expect(step(page, 4)).toHaveAttribute("aria-pressed", "true");
});
