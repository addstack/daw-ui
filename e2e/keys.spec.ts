import { expect, test, type Page } from "@playwright/test";

import { clearEvents, eventsOf } from "./fixture.js";

async function open(page: Page) {
  await page.goto("/?view=keys");
  await expect(page.getByRole("heading", { name: "daw-ui keys" })).toBeVisible();
}

const key = (page: Page, group: string, name: string) =>
  page.getByRole("group", { name: group, exact: true }).getByRole("button", { name, exact: true });

const boxOf = async (page: Page, group: string, name?: string) => {
  const root = page.getByRole("group", { name: group, exact: true });
  const box = await (name ? root.getByRole("button", { name, exact: true }) : root).boundingBox();
  if (!box) throw new Error(`${group} ${name ?? ""} is not rendered.`);
  return box;
};

/** What a keyboard played: "+60" for a press, "-60" for a release. */
const played = async (page: Page, source: string) =>
  (await eventsOf(page, source)).map((event) => `${event.type === "press" ? "+" : "-"}${String(event.value)}`);

test("keys lie as on a piano; a press plays harder towards the front of the key", async ({ page }) => {
  await open(page);
  const piano = await boxOf(page, "Piano");
  const c = await boxOf(page, "Piano", "C4");
  const cSharp = await boxOf(page, "Piano", "C♯4");
  // The eighth of 15 white keys of 28 px; the black key over the gap after it, on the octave's second twelfth.
  // Within a tenth of a pixel: browsers lay out in fractions of one.
  const near = (actual: number[], expected: number[]) => actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, 1));
  near([c.x - piano.x, c.width, c.height], [196, 28, 100]);
  near([cSharp.x - piano.x, cSharp.width, cSharp.height], [212.33, 16.33, 60]);

  // D4, near its front.
  await page.mouse.click(piano.x + 238, piano.y + 90);
  // The top of the gap between C4 and D4 is the black key's.
  await page.mouse.click(piano.x + 224, piano.y + 20);
  expect(await played(page, "Piano")).toEqual(["+62", "-62", "+61", "-61"]);
  const [d, , black] = await eventsOf(page, "Piano");
  expect(d!.velocity).toBeCloseTo(0.9, 1);
  expect(black!.velocity).toBeCloseTo(0.33, 1);
});

test("a glide plays every key the pointer crosses, one at a time", async ({ page }) => {
  await open(page);
  const piano = await boxOf(page, "Piano");
  // Along the fronts of C3, D3 and E3, below the black keys.
  await page.mouse.move(piano.x + 14, piano.y + 95);
  await page.mouse.down();
  await page.mouse.move(piano.x + 70, piano.y + 95, { steps: 8 });
  await expect(key(page, "Piano", "E3")).toHaveAttribute("data-pressed", "");
  await page.mouse.up();
  expect(await played(page, "Piano")).toEqual(["+48", "-48", "+50", "-50", "+52", "-52"]);
  await expect(key(page, "Piano", "E3")).not.toHaveAttribute("data-pressed");
});

test('"rows" keys line up with the rows of notes over the same range; black keys lie from the inline start', async ({ page }) => {
  await open(page);
  for (const name of ["Roll keys", "RTL roll keys"]) {
    const keys = await boxOf(page, name);
    const notes = (await page.getByRole("img", { name: `${name} notes`, exact: true }).boundingBox())!;
    // 12 rows of 20 px, B4 at the top, as notes draw them.
    for (const [key, row] of [["C♯4", 10], ["D♯4", 8], ["A♯4", 1]] as const) {
      const box = await boxOf(page, name, key);
      expect(box.y - notes.y).toBeCloseTo(row * 20, 1);
      expect(box.height).toBeCloseTo(20, 1);
    }
    const c = await boxOf(page, name, "C4");
    expect(c.y + c.height).toBeCloseTo(notes.y + notes.height, 1);
    expect(c.height).toBeCloseTo(30, 1);
    const black = await boxOf(page, name, "C♯4");
    expect(name === "RTL roll keys" ? keys.x + keys.width - (black.x + black.width) : black.x - keys.x).toBeCloseTo(0, 1);
  }

  // The front of a vertical keyboard is its inline end.
  const ltr = await boxOf(page, "Roll keys", "D4");
  await page.mouse.click(ltr.x + 54, ltr.y + ltr.height / 2);
  const rtl = await boxOf(page, "RTL roll keys", "D4");
  await page.mouse.click(rtl.x + 6, rtl.y + rtl.height / 2);
  expect((await eventsOf(page, "Roll keys"))[0]!.velocity).toBeCloseTo(0.9, 1);
  expect((await eventsOf(page, "RTL roll keys"))[0]!.velocity).toBeCloseTo(0.9, 1);
});

test("from the keyboard: one tab stop at middle C, Space holds a key down, arrows take it along", async ({ page }) => {
  await open(page);
  const stop = page.getByRole("group", { name: "Piano", exact: true }).locator('[tabindex="0"]');
  await expect(stop).toHaveAccessibleName("C4");
  await stop.focus();
  await clearEvents(page);
  await page.keyboard.down(" ");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.up(" ");
  expect(await played(page, "Piano")).toEqual(["+60", "-60", "+61", "-61"]);
  expect((await eventsOf(page, "Piano"))[0]).toMatchObject({ reason: "keyboard", velocity: 0.8 });
  await expect(key(page, "Piano", "C♯4")).toBeFocused();
});
