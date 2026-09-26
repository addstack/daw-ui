// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import { createRange, formats, scales } from "../src/core/index.js";
import { Fader } from "../src/react/index.js";
import { drag, setBox } from "./helpers.js";

afterEach(cleanup);

function Volume(props: Fader.Root.Props) {
  return (
    <Fader.Root
      min={-70}
      max={6}
      defaultValue={0}
      scale={scales.decibel}
      format={formats.decibel({ locale: "en" })}
      data-testid="root"
      {...props}
    >
      <Fader.Label>Volume</Fader.Label>
      <Fader.Control data-testid="control">
        <Fader.Track
          data-testid="track"
          ref={(element) => {
            if (element) setBox(element, { x: 0, y: 0, width: 8, height: 100 });
          }}
        >
          <Fader.Range data-testid="range" />
          <Fader.Thumb data-testid="thumb" />
          <Fader.Tick value={0} data-testid="tick">
            0
          </Fader.Tick>
        </Fader.Track>
      </Fader.Control>
      <Fader.Value />
    </Fader.Root>
  );
}

describe("Fader", () => {
  test("is a vertical slider named by its label", () => {
    render(<Volume />);
    const slider = screen.getByRole("slider", { name: "Volume" });
    expect(slider.getAttribute("aria-orientation")).toBe("vertical");
    expect(slider.getAttribute("aria-valuetext")).toBe("0.0 dB");
    expect(screen.getByTestId("root").getAttribute("data-orientation")).toBe("vertical");
  });

  test("by default, the thumb follows the pointer: the track's length is the full travel", () => {
    render(<Volume />);
    const slider = screen.getByRole("slider");
    const start = Number(screen.getByTestId("root").style.getPropertyValue("--fader-value"));
    drag(slider, [{ y: 50 }, { y: 60 }]);
    const end = Number(screen.getByTestId("root").style.getPropertyValue("--fader-value"));
    expect(end).toBeCloseTo(start - 0.1, 3);
  });

  test("thumb, range and ticks are positioned along the track with the scale", () => {
    render(<Volume defaultValue={-12} origin={-70} />);
    const range = createRange({ min: -70, max: 6, scale: scales.decibel });
    const travel = range.normalize(-12);
    const thumb = screen.getByTestId("thumb");
    expect(thumb.style.position).toBe("absolute");
    expect(parseFloat(thumb.style.bottom)).toBeCloseTo(travel * 100, 1);
    const filled = screen.getByTestId("range");
    expect(filled.style.bottom).toBe("0%");
    expect(parseFloat(filled.style.height)).toBeCloseTo(travel * 100, 1);
    expect(parseFloat(screen.getByTestId("tick").style.bottom)).toBeCloseTo(range.normalize(0) * 100, 1);
    expect(screen.getByTestId("tick").getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByTestId("track").style.position).toBe("relative");
  });

  test("horizontal: positions from the inline start and drags to the right", () => {
    render(
      <Fader.Root orientation="horizontal" defaultValue={0.5} sensitivity={100}>
        <Fader.Control>
          <Fader.Thumb data-testid="thumb" />
        </Fader.Control>
      </Fader.Root>,
    );
    const slider = screen.getByRole("slider");
    expect(slider.getAttribute("aria-orientation")).toBe("horizontal");
    expect(screen.getByTestId("thumb").style.insetInlineStart).toBe("50%");
    drag(slider, [{ x: 0 }, { x: 20 }]);
    expect(slider.getAttribute("aria-valuenow")).toBe("0.7");
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(slider.getAttribute("aria-valuenow")).toBe("0.69");
  });

  test("a fader down to silence shows -∞ at the bottom", () => {
    render(<Volume min={-Infinity} />);
    const slider = screen.getByRole("slider");
    fireEvent.keyDown(slider, { key: "Home" });
    expect(slider.getAttribute("aria-valuetext")).toBe("-∞ dB");
    expect(slider.hasAttribute("aria-valuemin")).toBe(false);
  });
});
