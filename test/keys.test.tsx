// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { formats } from "../src/core/index.js";
import { Keys, type KeysPressDetails, type KeysReleaseDetails } from "../src/react/index.js";
import { setBox } from "./helpers.js";

let frames: FrameRequestCallback[] = [];
beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal("cancelAnimationFrame", () => {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function frame() {
  const pending = frames;
  frames = [];
  for (const callback of pending) callback(0);
}

const notes = (lowest: number, highest: number) => Array.from({ length: highest - lowest + 1 }, (_, index) => lowest + index);
const names = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];

type Log = { played: string[]; presses: KeysPressDetails[]; releases: KeysReleaseDetails[] };

/**
 * C4 to E4 on a keyboard 120 × 100 px: white keys 40 px wide, the full
 * height; black keys 20 px wide, 60 px long from the top, over the gaps.
 */
function setup(props: Partial<Keys.Root.Props> = {}) {
  const log: Log = { played: [], presses: [], releases: [] };
  let commits = 0;
  render(
    <Profiler id="keys" onRender={() => commits++}>
      <Keys.Root
        range={[60, 64]}
        aria-label="Keyboard"
        data-testid="keys"
        onPress={(note, details) => {
          log.played.push(`+${note}`);
          log.presses.push(details);
        }}
        onRelease={(note, details) => {
          log.played.push(`-${note}`);
          log.releases.push(details);
        }}
        {...props}
      >
        {notes(60, 64).map((note) => (
          <Keys.Key key={note} note={note} data-testid={String(note)} />
        ))}
      </Keys.Root>
    </Profiler>,
  );
  const boxes: Record<number, [number, number, number]> = { 60: [0, 40, 100], 61: [30, 20, 60], 62: [40, 40, 100], 63: [70, 20, 60], 64: [80, 40, 100] };
  for (const [note, [x, width, height]] of Object.entries(boxes)) setBox(screen.getByTestId(note), { x, y: 0, width, height });
  return { log, root: screen.getByTestId("keys"), commits: () => commits };
}

const key = (note: number) => screen.getByTestId(String(note));

function pointer(type: "pointerDown" | "pointerMove" | "pointerUp", element: Element, x: number, y: number, pointerId = 1) {
  fireEvent[type](element, { pointerId, isPrimary: pointerId === 1, button: 0, buttons: type === "pointerUp" ? 0 : 1, clientX: x, clientY: y });
}

describe("Keys", () => {
  test("is a group of buttons, named by the format, with one tab stop at middle C", () => {
    render(
      <Keys.Root range={[59, 62]} format={formats.pitch({ names })} aria-label="Keyboard">
        {notes(59, 62).map((note) => (
          <Keys.Key key={note} note={note} />
        ))}
      </Keys.Root>,
    );
    expect(screen.getByRole("group", { name: "Keyboard" })).toBeTruthy();
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual(["B3", "C4", "C♯4", "D4"]);
    expect(buttons.map((button) => button.tabIndex)).toEqual([-1, 0, -1, -1]);
    expect(buttons.map((button) => [button.hasAttribute("data-black"), button.hasAttribute("data-white")])).toEqual([
      [false, true],
      [false, true],
      [true, false],
      [false, true],
    ]);
  });

  test("without a format, a key is named by its MIDI note number", () => {
    setup();
    expect(key(61).getAttribute("aria-label")).toBe("61");
  });

  test('"piano" puts white keys side by side and black keys over the gaps, as a piano does', () => {
    render(
      <Keys.Root range={[60, 71]}>
        {notes(60, 71).map((note) => (
          <Keys.Key key={note} note={note} data-testid={String(note)} />
        ))}
      </Keys.Root>,
    );
    // Seven white keys; black keys on twelve even slots of the octave, over the white keys.
    expect([key(60).style.left, key(60).style.width]).toEqual(["0%", "14.286%"]);
    expect([key(62).style.left, key(64).style.left, key(71).style.left]).toEqual(["14.286%", "28.571%", "85.714%"]);
    expect([key(61).style.left, key(61).style.width, key(61).style.zIndex]).toEqual(["8.333%", "8.333%", "1"]);
    expect([key(70).style.left, key(60).style.zIndex]).toEqual(["83.333%", ""]);
    expect(key(60).style.insetBlock).toBe("0px");
  });

  test('"rows" gives every semitone a row, as the rows of Notes over the same range, from the bottom when vertical', () => {
    render(
      <Keys.Root range={[60, 64]} orientation="vertical" layout="rows">
        {notes(60, 64).map((note) => (
          <Keys.Key key={note} note={note} data-testid={String(note)} />
        ))}
      </Keys.Root>,
    );
    const rows = notes(60, 64).map((note) => [key(note).style.bottom, key(note).style.height]);
    // C4 takes its row and half of C♯4's; C♯4 its row alone, in fifths from the bottom; D4 half a row either side.
    expect(rows).toEqual([
      ["0%", "30%"],
      ["20%", "20%"],
      ["30%", "40%"],
      ["60%", "20%"],
      ["70%", "30%"],
    ]);
    expect(key(61).getAttribute("data-orientation")).toBe("vertical");
  });

  test("a press plays the key, harder towards its front; a glide lets go of one key and plays the next, without rendering", () => {
    const { log, root, commits } = setup();
    const before = commits();
    pointer("pointerDown", key(60), 10, 75);
    expect(log.played).toEqual(["+60"]);
    expect(log.presses[0]).toMatchObject({ reason: "pointer", velocity: 0.75 });
    expect(key(60).hasAttribute("data-pressed")).toBe(true);
    expect(document.activeElement).toBe(key(60));
    // Along the fronts of the white keys, then up onto a black key.
    pointer("pointerMove", root, 20, 80);
    pointer("pointerMove", root, 50, 90);
    pointer("pointerMove", root, 75, 30);
    expect(log.played).toEqual(["+60", "-60", "+62", "-62", "+63"]);
    expect(log.presses.at(-1)!.velocity).toBe(0.5);
    // Off the keys: nothing plays until the pointer comes back.
    pointer("pointerMove", root, 200, 30);
    pointer("pointerUp", root, 200, 30);
    expect(log.played).toEqual(["+60", "-60", "+62", "-62", "+63", "-63"]);
    expect(log.releases.at(-1)!.reason).toBe("pointer");
    expect(notes(60, 64).filter((note) => key(note).hasAttribute("data-pressed"))).toEqual([]);
    expect(commits()).toBe(before);
  });

  test("black keys lie over the white ones, and a fixed velocity plays every press alike", () => {
    const { log } = setup({ velocity: 1 });
    pointer("pointerDown", key(61), 35, 10);
    expect(log.played).toEqual(["+61"]);
    expect(log.presses[0]!.velocity).toBe(1);
  });

  test("every pointer plays its own key; a key two pointers hold comes up when both let go", () => {
    const { log, root } = setup();
    pointer("pointerDown", key(60), 10, 90, 1);
    pointer("pointerDown", key(64), 90, 90, 2);
    expect(log.played).toEqual(["+60", "+64"]);
    // The second finger glides onto the first one's key.
    pointer("pointerMove", root, 20, 90, 2);
    expect(log.played).toEqual(["+60", "+64", "-64"]);
    pointer("pointerUp", root, 20, 90, 1);
    expect(log.played).toEqual(["+60", "+64", "-64"]);
    expect(key(60).hasAttribute("data-pressed")).toBe(true);
    pointer("pointerUp", root, 20, 90, 2);
    expect(log.played).toEqual(["+60", "+64", "-64", "-60"]);
  });

  test("Space holds the focused key down; arrows move along the keys, and a held key goes with them", () => {
    const { log } = setup();
    const c = key(60);
    c.focus();
    fireEvent.keyDown(c, { key: " " });
    fireEvent.keyDown(c, { key: " ", repeat: true });
    expect(log.played).toEqual(["+60"]);
    expect(log.presses[0]).toMatchObject({ reason: "keyboard", velocity: 0.8 });
    fireEvent.keyDown(c, { key: "ArrowRight" });
    expect(document.activeElement).toBe(key(61));
    expect(log.played).toEqual(["+60", "-60", "+61"]);
    fireEvent.keyUp(key(61), { key: " " });
    expect(log.played).toEqual(["+60", "-60", "+61", "-61"]);
    // The tab stop follows focus, without rendering.
    expect([key(60).tabIndex, key(61).tabIndex]).toEqual([-1, 0]);
    fireEvent.keyDown(key(61), { key: "End" });
    expect(document.activeElement).toBe(key(64));
    fireEvent.keyDown(key(64), { key: "PageDown" });
    expect(document.activeElement).toBe(key(60));
    fireEvent.keyDown(key(60), { key: "ArrowUp" });
    expect(document.activeElement).toBe(key(61));
  });

  test("focus leaving the keyboard lets go of the key it holds", () => {
    const { log } = setup();
    key(60).focus();
    fireEvent.keyDown(key(60), { key: "Enter" });
    fireEvent.blur(key(60), { relatedTarget: document.body });
    expect(log.played).toEqual(["+60", "-60"]);
  });

  test("keys held elsewhere show from held, and from read once per frame, without rendering", () => {
    setup({ held: [62] });
    expect(key(62).hasAttribute("data-held")).toBe(true);
    cleanup();
    let held = [60, 64];
    const { commits } = setup({ read: () => held });
    const before = commits();
    frame();
    expect(notes(60, 64).filter((note) => key(note).hasAttribute("data-held"))).toEqual([60, 64]);
    held = [61];
    frame();
    expect(notes(60, 64).filter((note) => key(note).hasAttribute("data-held"))).toEqual([61]);
    expect(commits()).toBe(before);
  });

  test("disabled keys do not play and are passed over; a disabled keyboard ignores input", () => {
    const log: string[] = [];
    render(
      <Keys.Root range={[60, 62]} onPress={(note) => log.push(`+${note}`)}>
        <Keys.Key note={60} data-testid="60" />
        <Keys.Key note={61} data-testid="61" disabled />
        <Keys.Key note={62} data-testid="62" />
      </Keys.Root>,
    );
    pointer("pointerDown", key(61), 0, 0);
    key(60).focus();
    fireEvent.keyDown(key(60), { key: "ArrowRight" });
    expect(document.activeElement).toBe(key(62));
    expect(log).toEqual([]);
    expect(key(61).getAttribute("aria-disabled")).toBe("true");
    cleanup();

    const { log: disabledLog } = setup({ disabled: true });
    pointer("pointerDown", key(60), 10, 90);
    fireEvent.keyDown(key(60), { key: " " });
    expect(disabledLog.played).toEqual([]);
    expect(notes(60, 64).map((note) => key(note).tabIndex)).toEqual([-1, -1, -1, -1, -1]);
  });

  test("keys outside a root say where they belong", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Keys.Key note={60} />)).toThrow(/Keys.Root/);
  });
});
