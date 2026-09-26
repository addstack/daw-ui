// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Profiler, useState } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { formats } from "../src/core/index.js";
import { Fader, Knob, NumberBox } from "../src/react/index.js";
import { drag, pointerDown, pointerMove, pointerUp } from "./helpers.js";

// docs/principles.md, section 7: values that change at audio-visual rates never
// go through React. The parts write what they show straight to the DOM.

afterEach(cleanup);

let frames: FrameRequestCallback[] = [];
beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal("cancelAnimationFrame", () => {
    frames = [];
  });
});
afterEach(() => vi.unstubAllGlobals());

function frame(now = 0) {
  const pending = frames;
  frames = [];
  for (const callback of pending) callback(now);
}

function TestKnob(props: Knob.Root.Props) {
  return (
    <Knob.Root data-testid="root" {...props}>
      <Knob.Control>
        <svg viewBox="0 0 100 100">
          <Knob.Range data-testid="range" />
          <Knob.Pointer data-testid="pointer" />
        </svg>
      </Knob.Control>
      <Knob.Value data-testid="value" />
    </Knob.Root>
  );
}

describe("read", () => {
  test("the value follows `read` on every frame, without rendering", () => {
    let automation = 0.25;
    let renders = 0;
    render(
      <Profiler id="knob" onRender={() => renders++}>
        <TestKnob read={() => automation} />
      </Profiler>,
    );
    renders = 0;
    frame();
    const slider = screen.getByRole("slider");
    expect(slider.getAttribute("aria-valuenow")).toBe("0.25");
    automation = 0.75;
    frame();
    expect(slider.getAttribute("aria-valuenow")).toBe("0.75");
    expect(screen.getByTestId("value").textContent).toBe("0.75");
    expect(screen.getByTestId("root").style.getPropertyValue("--knob-value")).toBe("0.75");
    expect(renders).toBe(0);
  });

  test("while the user drags, the user's value wins; afterwards `read` takes over again", () => {
    let automation = 0.5;
    const onValueChange = vi.fn((value: number) => (automation = value));
    render(<TestKnob read={() => automation} sensitivity={100} onValueChange={onValueChange} />);
    frame();
    const slider = screen.getByRole("slider");
    pointerDown(slider, { y: 100 });
    pointerMove(slider, { y: 90 });
    expect(slider.getAttribute("aria-valuenow")).toBe("0.6");
    // The automation moves on, but the knob is held.
    automation = 0.1;
    frame();
    expect(slider.getAttribute("aria-valuenow")).toBe("0.6");
    pointerUp(slider, { y: 90 });
    frame();
    expect(slider.getAttribute("aria-valuenow")).toBe("0.1");
  });
});

describe("rendering stays consistent with the DOM", () => {
  test("a render for another reason after a drag shows the dragged value in the new format", () => {
    function Host() {
      const [digits, setDigits] = useState(2);
      return (
        <>
          <button type="button" onClick={() => setDigits(1)}>
            fewer digits
          </button>
          <TestKnob format={formats.number({ locale: "en", digits })} sensitivity={100} />
        </>
      );
    }
    render(<Host />);
    drag(screen.getByRole("slider"), [{ y: 100 }, { y: 70 }]);
    expect(screen.getByTestId("value").textContent).toBe("0.30");
    fireEvent.click(screen.getByRole("button", { name: "fewer digits" }));
    expect(screen.getByTestId("value").textContent).toBe("0.3");
    expect(screen.getByRole("slider").getAttribute("aria-valuetext")).toBe("0.3");
    // And the value keeps moving without rendering afterwards.
    drag(screen.getByRole("slider"), [{ y: 100 }, { y: 90 }]);
    expect(screen.getByTestId("value").textContent).toBe("0.4");
  });

  test("a controlled knob shows the value its parent passes, through the same path", () => {
    function Controlled() {
      const [value, setValue] = useState(0.2);
      return <TestKnob value={value} onValueChange={setValue} />;
    }
    render(<Controlled />);
    fireEvent.keyDown(screen.getByRole("slider"), { key: "PageUp" });
    expect(screen.getByTestId("value").textContent).toBe("0.30");
    expect(screen.getByTestId("range").getAttribute("d")).not.toBe("M 21.716 78.284");
  });
});

describe("children functions", () => {
  test("a children function renders only its part, on every change", () => {
    const parts = new Map<string, number>();
    const count = (id: string) => () => parts.set(id, (parts.get(id) ?? 0) + 1);
    render(
      <Profiler id="root" onRender={count("root")}>
        <Fader.Root sensitivity={100}>
          <Fader.Control>
            <Fader.Thumb />
          </Fader.Control>
          <Profiler id="value" onRender={count("value")}>
            <Fader.Value data-testid="value">{(text) => <b>{text}</b>}</Fader.Value>
          </Profiler>
        </Fader.Root>
      </Profiler>,
    );
    parts.clear();
    drag(screen.getByRole("slider"), [{ y: 100 }, { y: 90 }, { y: 80 }]);
    expect(screen.getByTestId("value").textContent).toBe("0.20");
    // The Value part renders; nothing else does.
    expect(parts.get("value")).toBe(2);
    expect(parts.get("root")).toBe(2);
    expect([...parts.keys()].sort()).toEqual(["root", "value"]);
  });
});

describe("Knob.Modulation", () => {
  test("draws the arc from the value to the modulated value on every frame, without rendering", () => {
    let modulated = 0.5;
    let renders = 0;
    render(
      <Profiler id="knob" onRender={() => renders++}>
        <Knob.Root defaultValue={0.5}>
          <Knob.Control>
            <svg viewBox="0 0 100 100">
              <Knob.Modulation data-testid="modulation" read={() => modulated} />
            </svg>
          </Knob.Control>
        </Knob.Root>
      </Profiler>,
    );
    renders = 0;
    const arc = screen.getByTestId("modulation");
    frame();
    // Value and modulation at 12 o'clock: an empty arc.
    expect(arc.getAttribute("d")).toBe("M 50 4");
    modulated = 1;
    frame();
    expect(arc.getAttribute("d")).toMatch(/^M 50 4 A 46 46 0 0 1 /);
    expect(renders).toBe(0);
  });
});

describe("number box", () => {
  test("drags without rendering, and edits the value it shows now", () => {
    let renders = 0;
    render(
      <Profiler id="box" onRender={() => renders++}>
        <NumberBox.Root min={20} max={999} step={1} defaultValue={120} sensitivity={979}>
          <NumberBox.Field />
        </NumberBox.Root>
      </Profiler>,
    );
    renders = 0;
    const field = screen.getByRole("spinbutton");
    drag(field, [{ y: 100 }, { y: 90 }]);
    expect(field.textContent).toBe("130");
    expect(renders).toBe(0);
    act(() => void fireEvent.doubleClick(field));
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("130");
  });

  test("the wheel changes it", () => {
    render(
      <NumberBox.Root min={0} max={100} step={1} defaultValue={50}>
        <NumberBox.Field />
      </NumberBox.Root>,
    );
    fireEvent.wheel(screen.getByRole("spinbutton"), { deltaY: -100 });
    expect(screen.getByRole("spinbutton").textContent).toBe("55");
  });
});
