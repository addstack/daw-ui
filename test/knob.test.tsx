// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Profiler, useState } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { formats, scales } from "../src/core/index.js";
import { Knob } from "../src/react/index.js";
import { drag, pointerDown, pointerUp } from "./helpers.js";

afterEach(cleanup);

function TestKnob(props: Knob.Root.Props) {
  return (
    <Knob.Root data-testid="root" {...props}>
      <Knob.Label>Cutoff</Knob.Label>
      <Knob.Control data-testid="control">
        <svg viewBox="0 0 100 100">
          <Knob.Track data-testid="track" />
          <Knob.Range data-testid="range" />
          <Knob.Pointer />
        </svg>
      </Knob.Control>
      <Knob.Value data-testid="value" />
    </Knob.Root>
  );
}

describe("accessibility", () => {
  test("is a slider named by its label, announcing the formatted value", () => {
    render(<TestKnob min={-70} max={6} defaultValue={-6} format={formats.decibel({ locale: "en" })} />);
    const slider = screen.getByRole("slider", { name: "Cutoff" });
    expect(slider).toHaveProperty("tabIndex", 0);
    expect(slider.getAttribute("aria-valuemin")).toBe("-70");
    expect(slider.getAttribute("aria-valuemax")).toBe("6");
    expect(slider.getAttribute("aria-valuenow")).toBe("-6");
    expect(slider.getAttribute("aria-valuetext")).toBe("-6.0 dB");
    expect(screen.getByTestId("value").textContent).toBe("-6.0 dB");
  });

  test("the value output is not a live region, so dragging does not flood screen readers", () => {
    render(<TestKnob />);
    expect(screen.getByTestId("value").getAttribute("aria-live")).toBe("off");
  });

  test("the value's text sets its own direction, so a unit stays in order in a right-to-left page", () => {
    render(<TestKnob />);
    expect(screen.getByTestId("value").getAttribute("dir")).toBe("auto");
  });

  test("clicking the label focuses the control", () => {
    render(<TestKnob />);
    fireEvent.click(screen.getByText("Cutoff"));
    expect(document.activeElement).toBe(screen.getByRole("slider"));
  });

  test("a disabled knob is out of the tab order and ignores input", () => {
    const onValueChange = vi.fn();
    render(<TestKnob disabled defaultValue={0.5} onValueChange={onValueChange} />);
    const slider = screen.getByRole("slider");
    expect(slider).toHaveProperty("tabIndex", -1);
    expect(slider.getAttribute("aria-disabled")).toBe("true");
    fireEvent.keyDown(slider, { key: "ArrowUp" });
    drag(slider, [{ y: 100 }, { y: 0 }]);
    expect(onValueChange).not.toHaveBeenCalled();
  });
});

describe("keyboard", () => {
  test("arrows move 1% of the travel, Shift 0.1%, Page keys 10%", () => {
    render(<TestKnob min={0} max={100} defaultValue={50} />);
    const slider = screen.getByRole("slider");
    fireEvent.keyDown(slider, { key: "ArrowUp" });
    expect(slider.getAttribute("aria-valuenow")).toBe("51");
    fireEvent.keyDown(slider, { key: "ArrowLeft", shiftKey: true });
    expect(Number(slider.getAttribute("aria-valuenow"))).toBeCloseTo(50.9);
    fireEvent.keyDown(slider, { key: "PageDown" });
    expect(Number(slider.getAttribute("aria-valuenow"))).toBeCloseTo(40.9);
    fireEvent.keyDown(slider, { key: "End" });
    expect(slider.getAttribute("aria-valuenow")).toBe("100");
    fireEvent.keyDown(slider, { key: "Home" });
    expect(slider.getAttribute("aria-valuenow")).toBe("0");
  });

  test("travel follows the scale: an arrow on a frequency knob is a ratio, not a number of Hz", () => {
    render(<TestKnob min={20} max={20_000} defaultValue={1000} scale={scales.log} />);
    const slider = screen.getByRole("slider");
    fireEvent.keyDown(slider, { key: "PageUp" });
    expect(Number(slider.getAttribute("aria-valuenow"))).toBeCloseTo(1000 * Math.pow(1000, 0.1), 0);
  });

  test("a stepped knob moves one step per arrow", () => {
    render(<TestKnob min={0} max={127} step={1} defaultValue={64} />);
    const slider = screen.getByRole("slider");
    fireEvent.keyDown(slider, { key: "ArrowDown" });
    expect(slider.getAttribute("aria-valuenow")).toBe("63");
    expect(slider.getAttribute("aria-valuetext")).toBe("63");
  });

  test("Delete resets to the default value", () => {
    render(<TestKnob defaultValue={0.25} />);
    const slider = screen.getByRole("slider");
    fireEvent.keyDown(slider, { key: "End" });
    fireEvent.keyDown(slider, { key: "Delete" });
    expect(slider.getAttribute("aria-valuenow")).toBe("0.25");
  });

  test("each key press is one gesture, and a press that changes nothing is none", () => {
    const events: string[] = [];
    render(
      <TestKnob
        defaultValue={1}
        onGestureStart={() => events.push("start")}
        onValueChange={(value, { reason }) => events.push(`${reason} ${value}`)}
        onGestureEnd={(value) => events.push(`end ${value}`)}
      />,
    );
    const slider = screen.getByRole("slider");
    fireEvent.keyDown(slider, { key: "ArrowUp" });
    fireEvent.keyDown(slider, { key: "ArrowDown" });
    expect(events).toEqual(["start", "keyboard 0.99", "end 0.99"]);
  });
});

describe("drag", () => {
  test("dragging up by the sensitivity covers the full travel; Shift is 10 times finer", () => {
    render(<TestKnob sensitivity={200} />);
    const slider = screen.getByRole("slider");
    drag(slider, [{ y: 300 }, { y: 250 }, { y: 200 }]);
    expect(slider.getAttribute("aria-valuenow")).toBe("0.5");
    drag(slider, [{ y: 300 }, { y: 200, shiftKey: true }]);
    expect(slider.getAttribute("aria-valuenow")).toBe("0.55");
  });

  test("going past the end and back responds at once, with no dead zone", () => {
    render(<TestKnob sensitivity={100} defaultValue={0.9} />);
    const slider = screen.getByRole("slider");
    drag(slider, [{ y: 100 }, { y: 0 }, { y: 10 }]);
    expect(slider.getAttribute("aria-valuenow")).toBe("0.9");
  });

  test("a drag is one gesture that starts with the first change; a click without movement is none", () => {
    const events: string[] = [];
    render(
      <TestKnob
        sensitivity={100}
        onGestureStart={() => events.push("start")}
        onValueChange={(_, { reason }) => events.push(reason)}
        onGestureEnd={(value) => events.push(`end ${value}`)}
      />,
    );
    const slider = screen.getByRole("slider");
    pointerDown(slider, { y: 100 });
    pointerUp(slider, { y: 100 });
    expect(events).toEqual([]);
    drag(slider, [{ y: 100 }, { y: 90 }, { y: 80 }]);
    expect(events).toEqual(["start", "drag", "drag", "end 0.2"]);
  });

  test("the root and control show data-dragging while the value moves", () => {
    render(<TestKnob />);
    const slider = screen.getByRole("slider");
    drag(slider, [{ y: 100 }, { y: 90 }], { release: false });
    expect(screen.getByTestId("root").hasAttribute("data-dragging")).toBe(true);
    expect(slider.hasAttribute("data-dragging")).toBe(true);
    pointerUp(slider, { y: 90 });
    expect(slider.hasAttribute("data-dragging")).toBe(false);
  });

  test("double-click resets", () => {
    const onValueChange = vi.fn();
    render(<TestKnob defaultValue={0.3} resetValue={0.5} onValueChange={onValueChange} />);
    fireEvent.doubleClick(screen.getByRole("slider"));
    expect(onValueChange).toHaveBeenCalledWith(0.5, expect.objectContaining({ reason: "reset" }));
  });
});

describe("wheel", () => {
  test("a wheel notch moves 5%, and a burst of wheel events is one gesture", () => {
    vi.useFakeTimers();
    try {
      const events: string[] = [];
      render(
        <TestKnob
          onGestureStart={() => events.push("start")}
          onGestureEnd={(value) => events.push(`end ${value}`)}
        />,
      );
      const slider = screen.getByRole("slider");
      const notUsed = fireEvent.wheel(slider, { deltaY: -100 });
      expect(notUsed).toBe(false);
      fireEvent.wheel(slider, { deltaY: -100 });
      expect(slider.getAttribute("aria-valuenow")).toBe("0.1");
      expect(events).toEqual(["start"]);
      act(() => void vi.advanceTimersByTime(500));
      expect(events).toEqual(["start", "end 0.1"]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("wheel={false} leaves the wheel to the page", () => {
    render(<TestKnob wheel={false} />);
    expect(fireEvent.wheel(screen.getByRole("slider"), { deltaY: -100 })).toBe(true);
  });
});

describe("controlled", () => {
  test("shows the value prop and reports changes", () => {
    function Controlled() {
      const [value, setValue] = useState(0.2);
      return <TestKnob value={value} onValueChange={setValue} />;
    }
    render(<Controlled />);
    const slider = screen.getByRole("slider");
    fireEvent.keyDown(slider, { key: "PageUp" });
    expect(slider.getAttribute("aria-valuenow")).toBe("0.3");
  });

  test("stays put when the parent does not take the change", () => {
    render(<TestKnob value={0.2} />);
    const slider = screen.getByRole("slider");
    fireEvent.keyDown(slider, { key: "PageUp" });
    expect(slider.getAttribute("aria-valuenow")).toBe("0.2");
  });
});

describe("styling", () => {
  test("exposes the value as CSS variables and data attributes", () => {
    render(<TestKnob min={-1} max={1} origin={0} defaultValue={0.5} />);
    const root = screen.getByTestId("root");
    expect(root.style.getPropertyValue("--knob-value")).toBe("0.75");
    expect(root.style.getPropertyValue("--knob-angle")).toBe("67.5deg");
    expect(root.hasAttribute("data-bipolar")).toBe(true);
  });

  test("the range arc starts at the origin", () => {
    render(<TestKnob min={-1} max={1} origin={0} defaultValue={0} />);
    // Origin and value are both at 12 o'clock: an empty arc.
    expect(screen.getByTestId("range").getAttribute("d")).toBe("M 50 10");
    expect(screen.getByTestId("track").getAttribute("d")).toMatch(/^M [\d.]+ [\d.]+ A /);
  });

  test("className and style are plain values, merged with the part's own", () => {
    render(
      <Knob.Root defaultValue={0.4}>
        <Knob.Control className="knob" style={{ opacity: 0.5 }} />
      </Knob.Root>,
    );
    const slider = screen.getByRole("slider");
    expect(slider.className).toBe("knob");
    expect(slider.style.opacity).toBe("0.5");
    // The part's own inline style stays.
    expect(slider.style.touchAction).toBe("none");
  });

  test("styling never runs a function per render (docs/principles.md, section 7)", () => {
    // @ts-expect-error: className takes a value; state reaches CSS through data attributes.
    const className: Knob.Control.Props["className"] = () => "high";
    // @ts-expect-error: style takes a value; values reach CSS as variables.
    const style: Knob.Control.Props["style"] = () => ({ opacity: 1 });
    expect([typeof className, typeof style]).toEqual(["function", "function"]);
  });

  test("render replaces the element and keeps the part's behaviour", () => {
    const onKeyDown = vi.fn();
    render(
      <Knob.Root>
        <Knob.Control render={<button type="button" className="mine" onKeyDown={onKeyDown} />} />
      </Knob.Root>,
    );
    const slider = screen.getByRole("slider");
    expect(slider.tagName).toBe("BUTTON");
    expect(slider.className).toBe("mine");
    fireEvent.keyDown(slider, { key: "ArrowUp" });
    expect(onKeyDown).toHaveBeenCalledOnce();
    expect(slider.getAttribute("aria-valuenow")).toBe("0.01");
  });

  test("a handler that calls preventDefault() skips the part's own handling", () => {
    render(
      <Knob.Root>
        <Knob.Control onKeyDown={(event) => event.preventDefault()} />
      </Knob.Root>,
    );
    const slider = screen.getByRole("slider");
    fireEvent.keyDown(slider, { key: "ArrowUp" });
    expect(slider.getAttribute("aria-valuenow")).toBe("0");
  });
});

describe("render budget", () => {
  test("dragging a knob renders nothing, not even the knob", () => {
    const commits = { a: 0, b: 0 };
    render(
      <>
        <Profiler id="a" onRender={() => commits.a++}>
          <TestKnob />
        </Profiler>
        <Profiler id="b" onRender={() => commits.b++}>
          <TestKnob />
        </Profiler>
      </>,
    );
    commits.a = commits.b = 0;
    const [first] = screen.getAllByRole("slider");
    drag(first!, [{ y: 100 }, { y: 90 }, { y: 80 }, { y: 70 }]);
    // The value moved: the parts wrote it to the DOM themselves.
    expect(first!.getAttribute("aria-valuenow")).toBe("0.15");
    expect(commits).toEqual({ a: 0, b: 0 });
  });
});
