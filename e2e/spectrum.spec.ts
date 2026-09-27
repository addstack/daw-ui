import { expect, test } from "@playwright/test";

test("a spectrum draws its line in its CSS color, at the level of each frequency on a logarithmic axis", async ({ page }) => {
  await page.goto("/?view=spectrum");
  await expect(page.getByRole("heading", { name: "daw-ui spectrum" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Tone" })).toBeVisible();
  // Where the line is in a column, as a fraction of the height from the top, or null where nothing is drawn.
  const lineAt = (fraction: number) =>
    page.getByTestId("tone line").evaluate((canvas: HTMLCanvasElement, at) => {
      const context = canvas.getContext("2d")!;
      const x = Math.round(at * canvas.width);
      const column = context.getImageData(x, 0, 1, canvas.height).data;
      for (let y = 0; y < canvas.height; y++) {
        if (column[y * 4 + 3]! > 128) return { y: y / canvas.height, color: [column[y * 4], column[y * 4 + 1], column[y * 4 + 2]] };
      }
      return null;
    }, fraction);
  // 1 kHz is at log(1000 / 20) / log(1000) of the width: the tone reaches −6 dB, near the top.
  await expect.poll(async () => (await lineAt(Math.log10(1000 / 20) / 3))?.y ?? 1).toBeLessThan(0.1);
  const tone = (await lineAt(Math.log10(1000 / 20) / 3))!;
  expect(tone.color).toEqual([0, 255, 0]);
  // At 100 Hz, −80 dB: a ninth of the way up.
  expect((await lineAt(Math.log10(100 / 20) / 3))!.y).toBeCloseTo(8 / 9, 1);
});
