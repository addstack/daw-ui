// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { formats } from "../src/core/index.js";
import { NumberBox } from "../src/react/index.js";
import { drag } from "./helpers.js";

afterEach(cleanup);

function Tempo(props: NumberBox.Root.Props) {
  return (
    <NumberBox.Root min={20} max={999} step={0.01} defaultValue={120} format={formats.number({ locale: "en" })} {...props}>
      <NumberBox.Label>Tempo</NumberBox.Label>
      <NumberBox.Field data-testid="field" />
    </NumberBox.Root>
  );
}

describe("NumberBox", () => {
  test("is a spinbutton named by its label, showing the formatted value", () => {
    render(<Tempo />);
    const field = screen.getByRole("spinbutton", { name: "Tempo" });
    expect(field.textContent).toBe("120.00");
    expect(field.getAttribute("aria-valuenow")).toBe("120");
  });

  test("dragging changes the value; arrows move one step", () => {
    render(<Tempo sensitivity={979} />);
    const field = screen.getByRole("spinbutton");
    drag(field, [{ y: 100 }, { y: 90 }]);
    expect(field.textContent).toBe("130.00");
    fireEvent.keyDown(field, { key: "ArrowDown" });
    expect(field.textContent).toBe("129.99");
  });

  test("double-click edits the value as text; Enter applies it and gives focus back", () => {
    const events: string[] = [];
    render(
      <Tempo
        onGestureStart={() => events.push("start")}
        onValueChange={(value, { reason }) => events.push(`${reason} ${value}`)}
        onGestureEnd={() => events.push("end")}
      />,
    );
    fireEvent.doubleClick(screen.getByRole("spinbutton"));
    const input = screen.getByRole("textbox", { name: "Tempo" }) as HTMLInputElement;
    expect(input.value).toBe("120.00");
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "128" } });
    fireEvent.keyDown(input, { key: "Enter" });
    const field = screen.getByRole("spinbutton");
    expect(field.textContent).toBe("128.00");
    expect(document.activeElement).toBe(field);
    expect(events).toEqual(["start", "input 128", "end"]);
  });

  test("typing a digit while focused starts editing with it, as in Ableton Live", () => {
    render(<Tempo />);
    const field = screen.getByRole("spinbutton");
    field.focus();
    fireEvent.keyDown(field, { key: "9" });
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("9");
    fireEvent.change(input, { target: { value: "90,5" } });
    fireEvent.blur(input);
    expect(screen.getByRole("spinbutton").textContent).toBe("90.50");
  });

  test("Escape discards the text, and text that does not parse keeps the value", () => {
    const onValueChange = vi.fn();
    render(<Tempo onValueChange={onValueChange} />);
    fireEvent.keyDown(screen.getByRole("spinbutton"), { key: "Enter" });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "140" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(screen.getByRole("spinbutton").textContent).toBe("120.00");
    fireEvent.keyDown(screen.getByRole("spinbutton"), { key: "Enter" });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "fast" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(screen.getByRole("spinbutton").textContent).toBe("120.00");
    expect(onValueChange).not.toHaveBeenCalled();
  });

  test("an endless number box has no bounds, and drags two pixels per step", () => {
    render(
      <NumberBox.Root endless step={1} defaultValue={0}>
        <NumberBox.Field data-testid="field" />
      </NumberBox.Root>,
    );
    const field = screen.getByRole("spinbutton");
    expect(field.hasAttribute("aria-valuemin")).toBe(false);
    drag(field, [{ y: 100 }, { y: 300 }]);
    expect(field.getAttribute("aria-valuenow")).toBe("-100");
  });

  test("typed values are constrained to the range and step", () => {
    render(<Tempo />);
    fireEvent.keyDown(screen.getByRole("spinbutton"), { key: "Enter" });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "5000" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(screen.getByRole("spinbutton").textContent).toBe("999.00");
  });

  test("the field shows data-editing while editing", () => {
    render(<Tempo />);
    fireEvent.doubleClick(screen.getByRole("spinbutton"));
    expect(screen.getByRole("textbox").hasAttribute("data-editing")).toBe(true);
  });
});

describe("NumberBox.Segments", () => {
  const labels = { bars: "Bar", beats: "Beat", divisions: "Sixteenth" };

  function Position(props: NumberBox.Root.Props) {
    return (
      <NumberBox.Root min={0} max={400} defaultValue={0} format={formats.position({ locale: "en" })} {...props}>
        <NumberBox.Label>Position</NumberBox.Label>
        <NumberBox.Segments labels={labels} data-testid="segments" />
      </NumberBox.Root>
    );
  }

  const field = (name: string) => screen.getByRole("spinbutton", { name });

  test("shows each field of the format as a spinbutton, named by the application's labels, in a labelled group", () => {
    render(<Position defaultValue={5.25} />);
    expect(screen.getByRole("group", { name: "Position" })).toBe(screen.getByTestId("segments"));
    expect([field("Bar"), field("Beat"), field("Sixteenth")].map((element) => element.textContent)).toEqual(["2", "2", "2"]);
    expect(field("Beat").getAttribute("aria-valuemax")).toBe("4");
    expect(screen.getByTestId("segments").textContent).toBe("2.2.2");
    // The dots are for the eye only.
    expect(screen.getByTestId("segments").querySelector("[data-literal]")!.getAttribute("aria-hidden")).toBe("true");
  });

  test("the arrows step a field, and a step past its end carries into the next", () => {
    const deltas: number[] = [];
    render(<Position defaultValue={3} onValueChange={(_, { delta }) => deltas.push(delta)} />);
    fireEvent.keyDown(field("Beat"), { key: "ArrowUp" });
    expect(screen.getByTestId("segments").textContent).toBe("2.1.1");
    fireEvent.keyDown(field("Sixteenth"), { key: "ArrowDown" });
    expect(screen.getByTestId("segments").textContent).toBe("1.4.4");
    expect(deltas).toEqual([1, -0.25]);
  });

  test("left and right move between the fields, and every field is in the tab order", () => {
    render(<Position />);
    field("Bar").focus();
    fireEvent.keyDown(field("Bar"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(field("Beat"));
    fireEvent.keyDown(field("Beat"), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(field("Bar"));
    expect([field("Bar"), field("Beat"), field("Sixteenth")].map((element) => element.tabIndex)).toEqual([0, 0, 0]);
  });

  test("clicking the label focuses the first field", () => {
    render(<Position />);
    fireEvent.click(screen.getByText("Position"));
    expect(document.activeElement).toBe(field("Bar"));
  });

  test("dragging a field moves it one step per 4 pixels, as one gesture", () => {
    const events: string[] = [];
    render(
      <Position
        onGestureStart={() => events.push("start")}
        onValueChange={(_, { reason }) => events.push(reason)}
        onGestureEnd={(value) => events.push(`end ${value}`)}
      />,
    );
    drag(field("Bar"), [{ y: 100 }, { y: 96 }, { y: 88 }]);
    expect(screen.getByTestId("segments").textContent).toBe("4.1.1");
    expect(events).toEqual(["start", "drag", "drag", "end 12"]);
  });

  test("the wheel moves a field one step per notch", () => {
    vi.useFakeTimers();
    try {
      render(<Position />);
      fireEvent.wheel(field("Beat"), { deltaY: -100 });
      fireEvent.wheel(field("Beat"), { deltaY: -100 });
      expect(screen.getByTestId("segments").textContent).toBe("1.3.1");
      act(() => void vi.advanceTimersByTime(500));
    } finally {
      vi.useRealTimers();
    }
  });

  test("Enter edits the whole value as text, and focus goes back to the field it came from", () => {
    render(<Position />);
    const beat = field("Beat");
    beat.focus();
    fireEvent.keyDown(beat, { key: "Enter" });
    const input = screen.getByRole("textbox", { name: "Position" });
    expect(input).toHaveProperty("value", "1.1.1");
    fireEvent.change(input, { target: { value: "12.3" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByTestId("segments").textContent).toBe("12.3.1");
    expect(document.activeElement).toBe(field("Beat"));
  });

  test("keys for the whole value act on it, as on the field", () => {
    render(<Position defaultValue={8} />);
    fireEvent.keyDown(field("Beat"), { key: "End" });
    expect(screen.getByTestId("segments").textContent).toBe("101.1.1");
    fireEvent.keyDown(field("Beat"), { key: "Delete" });
    expect(screen.getByTestId("segments").textContent).toBe("3.1.1");
  });

  test("timecode frames carry into seconds", () => {
    render(
      <NumberBox.Root min={0} max={3600} defaultValue={0.96} format={formats.timecode({ fps: 25, locale: "en" })}>
        <NumberBox.Segments labels={{ hours: "h", minutes: "min", seconds: "s", frames: "fr" }} data-testid="segments" />
      </NumberBox.Root>,
    );
    fireEvent.keyDown(screen.getByRole("spinbutton", { name: "fr" }), { key: "ArrowUp" });
    expect(screen.getByTestId("segments").textContent).toBe("00:00:01:00");
  });

  test("children style each segment; they render with the format, not with the value", () => {
    let calls = 0;
    let commits = 0;
    render(
      <Profiler id="box" onRender={() => commits++}>
        <NumberBox.Root min={0} max={400} defaultValue={0} format={formats.position({ locale: "en" })}>
          <NumberBox.Segments labels={labels}>
            {(segment) => {
              calls++;
              return <NumberBox.Segment segment={segment} className={segment.type === "literal" ? "dot" : "field"} />;
            }}
          </NumberBox.Segments>
        </NumberBox.Root>
      </Profiler>,
    );
    const beat = field("Beat");
    expect(beat.className).toBe("field");
    [calls, commits] = [0, 0];
    fireEvent.keyDown(beat, { key: "ArrowUp" });
    drag(beat, [{ y: 100 }, { y: 88 }]);
    expect(screen.getByRole("group").textContent).toBe("2.1.1");
    expect({ calls, commits }).toEqual({ calls: 0, commits: 0 });
  });

  test("needs a format with segments", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      render(
        <NumberBox.Root format={formats.decibel()}>
          <NumberBox.Segments labels={{}} />
        </NumberBox.Root>,
      ),
    ).toThrow(/segments/);
    vi.restoreAllMocks();
  });
});
