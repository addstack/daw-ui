import { expect, test } from "@playwright/test";

async function open(page: import("@playwright/test").Page, mode: string) {
  await page.goto(`/?view=waveforms&mode=${mode}`);
  await expect(page.getByRole("heading", { name: "daw-ui waveforms" })).toBeVisible();
}

test("a waveform draws the audio into canvas tiles, in its CSS color", async ({ page }) => {
  await open(page, "play");
  const clip = page.getByRole("img", { name: "Track 1 at 0" });
  const tile = clip.locator(".clip-shape canvas").first();
  const painted = () =>
    tile.evaluate((canvas: HTMLCanvasElement) => {
      const { data } = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
      let pixels = 0;
      let blue = 0;
      for (let index = 0; index < data.length; index += 4) {
        if (data[index + 3]! === 0) continue;
        pixels++;
        if (data[index + 2]! > data[index]!) blue++;
      }
      return { pixels, blue };
    });
  await expect.poll(async () => (await painted()).pixels).toBeGreaterThan(1000);
  // #3b82f6, from the stylesheet.
  const { pixels, blue } = await painted();
  expect(blue / pixels).toBeGreaterThan(0.9);
});

test("one playhead moves over every track, and the played part follows it", async ({ page }) => {
  await open(page, "play");
  const playhead = page.getByTestId("playhead");
  const left = () => playhead.evaluate((element) => element.getBoundingClientRect().left);
  const before = await left();
  await expect.poll(left).toBeGreaterThan(before);

  const timeline = await page.locator(".timeline").boundingBox();
  const line = await playhead.boundingBox();
  expect(line!.height).toBeCloseTo(timeline!.height, 0);

  const progress = page.getByRole("img", { name: "Track 1 at 0" }).locator(".clip-progress");
  await expect(progress).not.toHaveCSS("clip-path", "none");
});

test("the ruler labels bars, and its labels move with the view without changing", async ({ page }) => {
  await open(page, "scroll");
  const ruler = page.getByTestId("ruler");
  // About 21 px per second: labels every two bars, 1, 3, 5 …
  const label = ruler.locator("[data-label]", { hasText: /^9$/ });
  await expect(label).toHaveCount(1);
  const left = () => label.evaluate((element) => element.getBoundingClientRect().left);
  const before = await left();
  await expect.poll(left).toBeLessThan(before);
  await expect(label).toHaveText("9");
});

test("a recording widens as audio arrives", async ({ page }) => {
  await open(page, "record");
  const take = page.getByRole("img", { name: "Recording" });
  const width = () => take.evaluate((element) => element.getBoundingClientRect().width);
  await expect.poll(width).toBeGreaterThan(0);
  const before = await width();
  await expect.poll(width).toBeGreaterThan(before + 5);
  await expect.poll(() => take.locator("canvas").count()).toBeGreaterThan(0);
});

test("notes draw into canvas tiles, one bar per note, in their CSS color", async ({ page }) => {
  await page.goto("/?view=waveforms&mode=play&notes");
  const tile = page.getByRole("img", { name: "Keys at 0" }).locator(".clip-notes canvas").first();
  const painted = () =>
    tile.evaluate((canvas: HTMLCanvasElement) => {
      const { data } = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
      let pixels = 0;
      let green = 0;
      for (let index = 0; index < data.length; index += 4) {
        if (data[index + 3]! === 0) continue;
        pixels++;
        if (data[index + 1]! > data[index]! && data[index + 1]! > data[index + 2]!) green++;
      }
      return { pixels, green };
    });
  await expect.poll(async () => (await painted()).pixels).toBeGreaterThan(500);
  // #34d399, from the stylesheet.
  const { pixels, green } = await painted();
  expect(green / pixels).toBeGreaterThan(0.9);
});
