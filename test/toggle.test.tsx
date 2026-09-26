// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Profiler, useState } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { Toggle, ToggleGroup, type ToggleChangeDetails } from "../src/react/index.js";
import { pointerDown, pointerMove, pointerUp, setBox } from "./helpers.js";

afterEach(cleanup);

const button = (name: string) => screen.getByRole("button", { name });
/** A ref that lays the toggle out as a 10 × 10 box at `x`. */
const at = (x: number) => (element: HTMLElement | null) => {
  if (element) setBox(element, { x, y: 0, width: 10, height: 10 });
};
const pressed = (name: string) => button(name).getAttribute("aria-pressed") === "true";

describe("Toggle", () => {
  test("is a button with aria-pressed that flips on pointerdown, not on release", () => {
    render(<Toggle>M</Toggle>);
    const toggle = button("M");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    pointerDown(toggle);
    expect(pressed("M")).toBe(true);
    expect(toggle.hasAttribute("data-pressed")).toBe(true);
    // The click after the release must not flip it back.
    pointerUp(toggle);
    fireEvent.click(toggle, { detail: 1 });
    expect(pressed("M")).toBe(true);
  });

  test("Space and Enter (clicks without a pointer) flip it, as does assistive technology", () => {
    const onPressedChange = vi.fn();
    render(<Toggle onPressedChange={onPressedChange}>M</Toggle>);
    fireEvent.click(button("M"));
    expect(pressed("M")).toBe(true);
    expect(onPressedChange).toHaveBeenCalledWith(true, expect.objectContaining({ reason: "keyboard" }));
  });

  test("controlled: shows the prop until the parent changes it", () => {
    const onPressedChange = vi.fn();
    render(
      <Toggle pressed={false} onPressedChange={onPressedChange}>
        M
      </Toggle>,
    );
    pointerDown(button("M"));
    expect(onPressedChange).toHaveBeenCalledWith(true, expect.objectContaining({ reason: "press" }));
    expect(pressed("M")).toBe(false);
  });

  test("momentary: on while held, with the pointer or the keyboard", () => {
    render(<Toggle behavior="momentary">Cue</Toggle>);
    const toggle = button("Cue");
    pointerDown(toggle);
    expect(pressed("Cue")).toBe(true);
    pointerUp(toggle);
    expect(pressed("Cue")).toBe(false);
    fireEvent.keyDown(toggle, { key: " " });
    fireEvent.keyDown(toggle, { key: " ", repeat: true });
    expect(pressed("Cue")).toBe(true);
    fireEvent.keyUp(toggle, { key: " " });
    expect(pressed("Cue")).toBe(false);
  });

  test("hybrid: a short press latches, a long one acts as momentary", () => {
    render(
      <Toggle behavior="hybrid" holdDelay={250}>
        Arm
      </Toggle>,
    );
    const toggle = button("Arm");
    fireEvent.pointerDown(toggle, { pointerId: 1, button: 0, timeStamp: 1000 });
    fireEvent.pointerUp(toggle, { pointerId: 1, button: 0, timeStamp: 1100 });
    expect(pressed("Arm")).toBe(true);
    // jsdom sets its own timeStamp; a long hold is simulated with a later release.
    const down = new PointerEvent("pointerdown", { pointerId: 2, button: 0, bubbles: true });
    fireEvent(toggle, down);
    expect(pressed("Arm")).toBe(false);
    const up = new PointerEvent("pointerup", { pointerId: 2, button: 0, bubbles: true });
    Object.defineProperty(up, "timeStamp", { value: down.timeStamp + 400 });
    fireEvent(toggle, up);
    expect(pressed("Arm")).toBe(true);
  });

  test("disabled: ignores presses", () => {
    render(<Toggle disabled>M</Toggle>);
    pointerDown(button("M"));
    fireEvent.click(button("M"));
    expect(pressed("M")).toBe(false);
    expect(button("M").getAttribute("aria-disabled")).toBe("true");
  });
});

/** A row of toggles laid out 10 px wide with 2 px gaps, each with its own state, like mute buttons per track. */
function MuteRow({
  count = 8,
  onChange,
  group = {},
}: {
  count?: number;
  onChange?: (index: number, pressed: boolean, details: ToggleChangeDetails) => void;
  group?: ToggleGroup.Props;
}) {
  const [muted, setMuted] = useState<boolean[]>(() => Array.from({ length: count }, () => false));
  return (
    <ToggleGroup paint data-testid="group" {...group}>
      {muted.map((isMuted, index) => (
        <Toggle
          key={index}
          pressed={isMuted}
          ref={(element) => {
            if (element) setBox(element, { x: index * 12, y: 0, width: 10, height: 10 });
          }}
          onPressedChange={(next, details) => {
            onChange?.(index, next, details);
            setMuted((current) => current.map((value, i) => (i === index ? next : value)));
          }}
        >
          {`T${index + 1}`}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}

const states = (count = 8) => Array.from({ length: count }, (_, index) => (pressed(`T${index + 1}`) ? 1 : 0)).join("");

describe("painting", () => {
  test("a drag sets every toggle it crosses to the state the first one took", () => {
    render(<MuteRow />);
    const group = screen.getByTestId("group");
    pointerDown(button("T2"), { x: 17, y: 5 });
    expect(group.getAttribute("data-painting")).toBe("on");
    pointerMove(group, { x: 42, y: 5 });
    expect(states()).toBe("01110000");
    pointerMove(group, { x: 66, y: 5 });
    pointerUp(group, { x: 66, y: 5 });
    expect(states()).toBe("01111100");
    expect(group.hasAttribute("data-painting")).toBe(false);
  });

  test("a fast drag that jumps over toggles between two events still sets them", () => {
    render(<MuteRow />);
    pointerDown(button("T1"), { x: 5, y: 5 });
    pointerMove(screen.getByTestId("group"), { x: 90, y: 5 });
    expect(states()).toBe("11111111");
  });

  test("starting on a pressed toggle paints them off, and toggles already in that state are left alone", () => {
    const onChange = vi.fn();
    render(<MuteRow onChange={onChange} />);
    const group = screen.getByTestId("group");
    for (const name of ["T1", "T3"]) {
      pointerDown(button(name));
      pointerUp(group);
    }
    onChange.mockClear();
    pointerDown(button("T1"), { x: 5, y: 5 });
    pointerMove(group, { x: 40, y: 5 });
    pointerUp(group);
    expect(states()).toBe("00000000");
    expect(onChange.mock.calls.map(([index, value, { reason }]) => [index, value, reason])).toEqual([
      [0, false, "press"],
      [2, false, "paint"],
    ]);
  });

  test("dragging back over a toggle does not flip it again", () => {
    render(<MuteRow />);
    const group = screen.getByTestId("group");
    pointerDown(button("T1"), { x: 5, y: 5 });
    pointerMove(group, { x: 30, y: 5 });
    pointerMove(group, { x: 5, y: 5 });
    pointerUp(group);
    expect(states()).toBe("11100000");
  });

  test("erase='secondary': the right button always paints off", () => {
    render(<MuteRow group={{ erase: "secondary" }} />);
    const group = screen.getByTestId("group");
    pointerDown(button("T1"), { x: 5, y: 5 });
    pointerMove(group, { x: 90, y: 5 });
    pointerUp(group);
    expect(fireEvent.contextMenu(button("T3"))).toBe(false);
    pointerDown(button("T3"), { x: 29, y: 5, button: 2 });
    pointerMove(group, { x: 55, y: 5, button: 2 });
    pointerUp(group, { button: 2 });
    expect(states()).toBe("11000111");
  });

  test("a stroke is one gesture", () => {
    const events: string[] = [];
    render(
      <MuteRow
        onChange={(index, value, { reason }) => events.push(`${reason} ${index}=${value}`)}
        group={{ onGestureStart: () => events.push("start"), onGestureEnd: () => events.push("end") }}
      />,
    );
    const group = screen.getByTestId("group");
    pointerDown(button("T1"), { x: 5, y: 5 });
    pointerMove(group, { x: 20, y: 5 });
    pointerUp(group);
    expect(events).toEqual(["start", "press 0=true", "paint 1=true", "end"]);
  });

  test("without paint, a drag changes only the pressed toggle", () => {
    render(<MuteRow group={{ paint: false }} />);
    pointerDown(button("T1"), { x: 5, y: 5 });
    pointerMove(screen.getByTestId("group"), { x: 90, y: 5 });
    expect(states()).toBe("10000000");
  });

  test("painting skips disabled and momentary toggles", () => {
    render(
      <ToggleGroup paint data-testid="group">
        <Toggle ref={at(0)}>A</Toggle>
        <Toggle disabled ref={at(12)}>
          B
        </Toggle>
        <Toggle
          behavior="momentary"
          ref={at(24)}
        >
          C
        </Toggle>
        <Toggle ref={at(36)}>D</Toggle>
      </ToggleGroup>,
    );
    pointerDown(button("A"), { x: 5, y: 5 });
    pointerMove(screen.getByTestId("group"), { x: 40, y: 5 });
    expect(["A", "B", "C", "D"].map(pressed)).toEqual([true, false, false, true]);
  });
});

describe("exclusive", () => {
  function SoloRow({ exclusive }: { exclusive: "click" | "modifier" }) {
    const [soloed, setSoloed] = useState<string[]>(["kick"]);
    return (
      <ToggleGroup multiple exclusive={exclusive} value={soloed} onValueChange={setSoloed}>
        <Toggle value="kick">Kick</Toggle>
        <Toggle value="snare">Snare</Toggle>
        <Toggle value="bass">Bass</Toggle>
      </ToggleGroup>
    );
  }

  test("'click': a plain press solos only that toggle, Cmd/Ctrl+press adds", () => {
    render(<SoloRow exclusive="click" />);
    pointerDown(button("Bass"), { metaKey: true });
    pointerUp(button("Bass"));
    expect(["Kick", "Snare", "Bass"].map(pressed)).toEqual([true, false, true]);
    pointerDown(button("Snare"));
    pointerUp(button("Snare"));
    expect(["Kick", "Snare", "Bass"].map(pressed)).toEqual([false, true, false]);
  });

  test("'modifier': the other way around", () => {
    render(<SoloRow exclusive="modifier" />);
    pointerDown(button("Bass"));
    pointerUp(button("Bass"));
    expect(["Kick", "Snare", "Bass"].map(pressed)).toEqual([true, false, true]);
    pointerDown(button("Snare"), { ctrlKey: true });
    pointerUp(button("Snare"));
    expect(["Kick", "Snare", "Bass"].map(pressed)).toEqual([false, true, false]);
  });

  test("turning a soloed toggle off leaves the others", () => {
    render(<SoloRow exclusive="click" />);
    pointerDown(button("Bass"), { ctrlKey: true });
    pointerUp(button("Bass"));
    pointerDown(button("Kick"));
    pointerUp(button("Kick"));
    expect(["Kick", "Snare", "Bass"].map(pressed)).toEqual([false, false, true]);
  });

  test("an exclusive press that turns others off is one gesture, with each change reported", () => {
    const events: string[] = [];
    render(
      <ToggleGroup
        exclusive="click"
        onGestureStart={() => events.push("start")}
        onGestureEnd={() => events.push("end")}
      >
        {["A", "B", "C"].map((name) => (
          <Toggle
            key={name}
            defaultPressed={name !== "B"}
            onPressedChange={(value, { reason }) => events.push(`${reason} ${name}=${value}`)}
          >
            {name}
          </Toggle>
        ))}
      </ToggleGroup>,
    );
    pointerDown(button("B"));
    expect(events).toEqual(["start", "press B=true", "exclusive A=false", "exclusive C=false", "end"]);
  });
});

describe("group value", () => {
  test("toggles with a value take their state from the group", () => {
    const onValueChange = vi.fn();
    render(
      <ToggleGroup multiple defaultValue={["b"]} onValueChange={onValueChange}>
        <Toggle value="a">A</Toggle>
        <Toggle value="b">B</Toggle>
      </ToggleGroup>,
    );
    expect(pressed("B")).toBe(true);
    pointerDown(button("A"));
    expect(onValueChange).toHaveBeenLastCalledWith(["b", "a"], expect.objectContaining({ reason: "press" }));
    expect([pressed("A"), pressed("B")]).toEqual([true, true]);
  });

  test("without multiple, pressing one releases the other", () => {
    render(
      <ToggleGroup defaultValue={["a"]}>
        <Toggle value="a">A</Toggle>
        <Toggle value="b">B</Toggle>
      </ToggleGroup>,
    );
    pointerDown(button("B"));
    expect([pressed("A"), pressed("B")]).toEqual([false, true]);
  });

  test("a controlled group that rejects a change goes back to its value when the gesture ends", () => {
    render(
      <ToggleGroup value={["a"]}>
        <Toggle value="a">A</Toggle>
        <Toggle value="b">B</Toggle>
      </ToggleGroup>,
    );
    pointerDown(button("B"));
    expect([pressed("A"), pressed("B")]).toEqual([true, false]);
  });
});

describe("keyboard", () => {
  test("the group is one tab stop; arrows move focus, Home and End jump", () => {
    render(<MuteRow count={4} />);
    const toggles = ["T1", "T2", "T3", "T4"].map(button);
    expect(toggles.map((toggle) => toggle.tabIndex)).toEqual([0, -1, -1, -1]);
    toggles[0]!.focus();
    fireEvent.keyDown(toggles[0]!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(toggles[1]);
    expect(toggles.map((toggle) => toggle.tabIndex)).toEqual([-1, 0, -1, -1]);
    fireEvent.keyDown(toggles[1]!, { key: "End" });
    expect(document.activeElement).toBe(toggles[3]);
    fireEvent.keyDown(toggles[3]!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(toggles[3]);
    fireEvent.keyDown(toggles[3]!, { key: "Home" });
    expect(document.activeElement).toBe(toggles[0]);
  });

  test("Shift+Arrow paints the focused toggle's state onto the next", () => {
    render(<MuteRow count={4} />);
    const first = button("T1");
    first.focus();
    fireEvent.click(first);
    fireEvent.keyDown(first, { key: "ArrowRight", shiftKey: true });
    fireEvent.keyDown(button("T2"), { key: "ArrowRight", shiftKey: true });
    expect(states(4)).toBe("1110");
    expect(document.activeElement).toBe(button("T3"));
  });

  test("a grid moves by rows with Up and Down, and Left and Right stay in the row", () => {
    render(
      <ToggleGroup orientation="grid" columns={3}>
        {Array.from({ length: 6 }, (_, index) => (
          <Toggle key={index}>{`S${index}`}</Toggle>
        ))}
      </ToggleGroup>,
    );
    button("S1").focus();
    fireEvent.keyDown(button("S1"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(button("S4"));
    fireEvent.keyDown(button("S4"), { key: "ArrowRight" });
    fireEvent.keyDown(button("S5"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(button("S5"));
    fireEvent.keyDown(button("S5"), { key: "ArrowUp" });
    expect(document.activeElement).toBe(button("S2"));
  });

  test("arrows step over disabled toggles, and the tab stop is never a disabled one", () => {
    render(
      <ToggleGroup>
        <Toggle disabled>A</Toggle>
        <Toggle>B</Toggle>
        <Toggle disabled>C</Toggle>
        <Toggle>D</Toggle>
      </ToggleGroup>,
    );
    expect(button("B").tabIndex).toBe(0);
    button("B").focus();
    fireEvent.keyDown(button("B"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(button("D"));
  });

  test("a vertical group uses Up and Down only", () => {
    render(
      <ToggleGroup orientation="vertical">
        <Toggle>A</Toggle>
        <Toggle>B</Toggle>
      </ToggleGroup>,
    );
    button("A").focus();
    fireEvent.keyDown(button("A"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(button("A"));
    fireEvent.keyDown(button("A"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(button("B"));
  });

  test("a toggle that mounts later gets the tab stop if it comes first", async () => {
    function Late() {
      const [shown, setShown] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setShown(true)}>
            show
          </button>
          <ToggleGroup>
            {shown && <Toggle>A</Toggle>}
            <Toggle>B</Toggle>
          </ToggleGroup>
        </>
      );
    }
    render(<Late />);
    expect(button("B").tabIndex).toBe(0);
    await act(async () => fireEvent.click(button("show")));
    expect([button("A").tabIndex, button("B").tabIndex]).toEqual([0, -1]);
  });
});

describe("lanes", () => {
  /**
   * A mixer: each channel strip holds its mute and solo buttons, so in the DOM
   * they alternate (M1 S1 M2 S2 …). Mutes sit at y = 0, solos at y = 12.
   */
  function Mixer({ exclusive = "click" }: { exclusive?: ToggleGroup.Props["exclusive"] }) {
    return (
      <ToggleGroup paint exclusive={exclusive} data-testid="mixer">
        {[1, 2, 3, 4].map((channel) => (
          <div key={channel}>
            <Toggle
              lane="mute"
              ref={(element) => {
                if (element) setBox(element, { x: channel * 12, y: 0, width: 10, height: 10 });
              }}
            >{`M${channel}`}</Toggle>
            <Toggle
              lane="solo"
              ref={(element) => {
                if (element) setBox(element, { x: channel * 12, y: 12, width: 10, height: 10 });
              }}
            >{`S${channel}`}</Toggle>
          </div>
        ))}
      </ToggleGroup>
    );
  }
  const row = (prefix: string) => [1, 2, 3, 4].map((channel) => (pressed(`${prefix}${channel}`) ? 1 : 0)).join("");

  test("a stroke paints along its lane, even when the pointer drifts over another", () => {
    render(<Mixer />);
    pointerDown(button("M1"), { x: 17, y: 5 });
    pointerMove(screen.getByTestId("mixer"), { x: 53, y: 17 });
    pointerUp(screen.getByTestId("mixer"));
    expect(row("M")).toBe("1111");
    expect(row("S")).toBe("0000");
  });

  test("an exclusive press turns off only toggles in its lane", () => {
    render(<Mixer />);
    const mixer = screen.getByTestId("mixer");
    for (const name of ["M2", "S3"]) {
      pointerDown(button(name));
      pointerUp(mixer);
    }
    pointerDown(button("S1"));
    pointerUp(mixer);
    expect(row("M")).toBe("0100");
    expect(row("S")).toBe("1000");
  });

  test("exclusive per lane: solo is exclusive, mutes stay independent", () => {
    render(<Mixer exclusive={{ solo: "click" }} />);
    const mixer = screen.getByTestId("mixer");
    for (const name of ["M1", "M3", "S2", "S4"]) {
      pointerDown(button(name));
      pointerUp(mixer);
    }
    expect(row("M")).toBe("1010");
    expect(row("S")).toBe("0001");
  });

  test("Left and Right move along the lane, Up and Down across lanes", () => {
    render(<Mixer />);
    button("M1").focus();
    fireEvent.keyDown(button("M1"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(button("M2"));
    fireEvent.keyDown(button("M2"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(button("S2"));
    fireEvent.keyDown(button("S2"), { key: "End" });
    expect(document.activeElement).toBe(button("S4"));
    fireEvent.keyDown(button("S4"), { key: "Home", ctrlKey: true });
    expect(document.activeElement).toBe(button("M1"));
  });

  test("Shift+Arrow does not paint across lanes", () => {
    render(<Mixer />);
    const mute = button("M1");
    mute.focus();
    fireEvent.click(mute);
    fireEvent.keyDown(mute, { key: "ArrowDown", shiftKey: true });
    expect(document.activeElement).toBe(button("S1"));
    expect(row("S")).toBe("0000");
  });
});

describe("render budget", () => {
  test("painting a step of a group-owned grid renders that step, not the grid", () => {
    const renders = new Map<string, number>();
    const count = (id: string) => renders.get(id) ?? 0;
    render(
      <ToggleGroup paint multiple defaultValue={[]} orientation="grid" columns={16} data-testid="group">
        {Array.from({ length: 64 }, (_, index) => (
          <Profiler key={index} id={`s${index}`} onRender={(id) => renders.set(id, count(id) + 1)}>
            <Toggle
              value={`s${index}`}
              ref={(element) => {
                if (element)
                  setBox(element, { x: (index % 16) * 12, y: Math.floor(index / 16) * 12, width: 10, height: 10 });
              }}
            >{`S${index}`}</Toggle>
          </Profiler>
        ))}
      </ToggleGroup>,
    );
    renders.clear();
    pointerDown(button("S0"), { x: 5, y: 5 });
    pointerMove(screen.getByTestId("group"), { x: 29, y: 5 });
    pointerUp(screen.getByTestId("group"));
    expect(["S0", "S1", "S2"].map(pressed)).toEqual([true, true, true]);
    const rendered = [...renders.keys()].sort();
    expect(rendered).toEqual(["s0", "s1", "s2"]);
  });
});
