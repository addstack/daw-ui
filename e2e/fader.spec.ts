import { expect, test } from "@playwright/test";

import { center, openControls, valueOf } from "./fixture.js";

test.beforeEach(({ page }) => openControls(page));

test("the thumb follows the pointer one to one", async ({ page }) => {
  const thumb = page.getByTestId("volume-thumb");
  const start = await center(thumb);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x, start.y + 50, { steps: 10 });
  await page.mouse.up();
  const end = await center(thumb);
  expect(end.y - start.y).toBeCloseTo(50, 0);
  await expect(page.getByRole("slider", { name: "Volume" })).not.toHaveAttribute("aria-valuetext", "0.0 dB");
});

for (const direction of ["ltr", "rtl"] as const) {
  test(`horizontal, ${direction}: drag towards the inline end increases the value`, async ({ page }) => {
    const slider = page.getByRole("slider", { name: `Balance ${direction}` });
    const thumb = page.getByTestId(`balance-${direction}-thumb`);
    const track = page.getByTestId(`balance-${direction}`).locator(".fader-track");

    // At 0.5, the thumb sits at the middle of the track in both directions.
    expect((await center(thumb)).x).toBeCloseTo((await center(track)).x, 0);

    const start = await center(thumb);
    const towardsEnd = direction === "ltr" ? 40 : -40;
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + towardsEnd, start.y, { steps: 8 });
    await page.mouse.up();
    expect(await valueOf(slider)).toBeCloseTo(0.7, 2);
    expect((await center(thumb)).x - start.x).toBeCloseTo(towardsEnd, 0);
  });

  test(`horizontal, ${direction}: the arrow towards the inline end increases the value`, async ({ page }) => {
    const slider = page.getByRole("slider", { name: `Balance ${direction}` });
    await slider.focus();
    await page.keyboard.press(direction === "ltr" ? "ArrowRight" : "ArrowLeft");
    expect(await valueOf(slider)).toBeCloseTo(0.51, 5);
  });
}
