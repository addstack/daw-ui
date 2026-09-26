// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
