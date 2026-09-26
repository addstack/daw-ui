import { fireEvent } from "@testing-library/react";

type PointerInit = { x?: number; y?: number; button?: number; shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean };

function init({ x = 0, y = 0, button = 0, ...modifiers }: PointerInit) {
  return { pointerId: 1, isPrimary: true, button, buttons: button === 2 ? 2 : 1, clientX: x, clientY: y, ...modifiers };
}

// jsdom has no pointer capture: a test dispatches the moves where a capturing
// browser would deliver them, on the element that captured the pointer.

export const pointerDown = (element: Element, options: PointerInit = {}) =>
  fireEvent.pointerDown(element, init(options));
export const pointerMove = (element: Element, options: PointerInit = {}) =>
  fireEvent.pointerMove(element, init(options));
export const pointerUp = (element: Element, options: PointerInit = {}) => {
  fireEvent.pointerUp(element, init(options));
  // Toggles ignore the click that follows a press they already handled; it clears on the next task.
  fireEvent.pointerUp(window, init(options));
};

/** Presses, moves through `points` and releases, all on `element`. */
export function drag(element: Element, points: PointerInit[], options: { release?: boolean } = {}): void {
  const [first, ...rest] = points;
  pointerDown(element, first);
  for (const point of rest) pointerMove(element, point);
  if (options.release !== false) pointerUp(element, rest.at(-1) ?? first);
}

/** Gives an element a layout box, which jsdom does not compute. */
export function setBox(element: Element, box: { x: number; y: number; width: number; height: number }): void {
  const rect = {
    ...box,
    left: box.x,
    top: box.y,
    right: box.x + box.width,
    bottom: box.y + box.height,
    toJSON: () => box,
  };
  element.getBoundingClientRect = () => rect as DOMRect;
}
