"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { createRange, formats, type Range, type Scale, type ValueFormat } from "../core/index.js";
import { isRightToLeft, useRightToLeft } from "./direction.js";
import { onEveryFrame } from "./frame-loop.js";
import { writeLive } from "./live.js";
import { dataAttributes, unselectable, useMergedRef, useRenderPart, type PartProps } from "./render.js";
import { FINE, useIsomorphicLayoutEffect } from "./value-control.js";

/** A thumb's value: across, then up. */
export type XYValue = readonly [x: number, y: number];

/** One axis of a pad, as a knob or a fader's range. */
export type XYAxis = { min?: number | undefined; max?: number | undefined; step?: number | undefined; scale?: Scale | undefined };

export type XYPadChangeReason = "drag" | "keyboard" | "reset";

export type XYPadChangeDetails = { reason: XYPadChangeReason; event: Event; /** The index of the thumb that moved. */ thumb: number };

export type XYPadState = { values: XYValue[]; dragging: boolean; disabled: boolean };

export type XYPadThumbState = { x: number; y: number; index: number; dragging: boolean; disabled: boolean };

type Ranges = { x: Range; y: Range };

/** The values of a pad and which thumb is dragged, outside React: thumbs write what they show straight to the DOM. */
class XYStore {
  dragging: number | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(public values: readonly XYValue[]) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  set(values: readonly XYValue[], dragging = this.dragging): void {
    if (values === this.values && dragging === this.dragging) return;
    this.values = values;
    this.dragging = dragging;
    for (const listener of this.listeners) listener();
  }
}

type XYPadContextValue = {
  store: XYStore;
  ranges: Ranges;
  formats: { x: ValueFormat; y: ValueFormat };
  disabled: boolean;
  labelId: string | undefined;
  setLabelId: (id: string | undefined) => void;
  controlElement: { current: HTMLElement | null };
  change: (index: number, value: XYValue, reason: XYPadChangeReason, event: Event) => void;
  endGesture: () => void;
  reset: (index: number, event: Event) => void;
  latest: () => readonly XYValue[];
  holding: { current: boolean };
};

const XYPadContext = createContext<XYPadContextValue | null>(null);

function useXYPadContext(part: string): XYPadContextValue {
  const context = useContext(XYPadContext);
  if (!context) throw new Error(`<XYPad.${part}> must be placed inside <XYPad.Root>.`);
  return context;
}

const constrain = (ranges: Ranges, [x, y]: XYValue): XYValue => [ranges.x.constrain(x), ranges.y.constrain(y)];
const sameValue = (a: XYValue | undefined, b: XYValue | undefined) => a !== undefined && b !== undefined && Object.is(a[0], b[0]) && Object.is(a[1], b[1]);

const defaultFormat = formats.number({ digits: 2 });

/**
 * A pad that moves one or more thumbs across two axes at once: the cutoff
 * and resonance of a filter, the frequency and gain of the bands of an EQ,
 * the positions of sources in a panner. Each thumb's value is `[x, y]`, on
 * the ranges `x` and `y`, as a knob's or a fader's; `value` is the list of
 * them. Thumbs do not stop each other.
 *
 * As the values change, the thumbs write what they show straight to the
 * DOM, and nothing renders (docs/principles.md, section 7). A `group`,
 * named by `XYPad.Label`; each thumb is a `slider` of its own.
 */
export function XYPadRoot({
  value: controlledValue,
  defaultValue,
  resetValue,
  onValueChange,
  onGestureStart,
  onGestureEnd,
  read,
  x = {},
  y = {},
  format,
  disabled = false,
  ...props
}: XYPadRoot.Props) {
  const ranges = useMemo<Ranges>(
    () => ({ x: createRange({ min: x.min ?? 0, max: x.max ?? 1, step: x.step, scale: x.scale }), y: createRange({ min: y.min ?? 0, max: y.max ?? 1, step: y.step, scale: y.scale }) }),
    [x.min, x.max, x.step, x.scale, y.min, y.max, y.step, y.scale],
  );
  const controlled = controlledValue !== undefined;
  const [store] = useState(() => new XYStore((controlledValue ?? defaultValue ?? [[ranges.x.min, ranges.y.min]]).map((one) => constrain(ranges, one))));
  const values = controlled ? controlledValue.map((one) => constrain(ranges, one)) : store.values;

  // The values as of the last change this pad made, so that events arriving before the parent renders build on them.
  const [latest] = useState<{ current: readonly XYValue[] }>(() => ({ current: store.values }));
  useIsomorphicLayoutEffect(() => {
    if (!controlled) return;
    latest.current = values;
    store.set(values);
  });

  const [callbacks] = useState<{ current: Pick<XYPadRoot.Props, "onValueChange" | "onGestureStart" | "onGestureEnd"> }>(() => ({ current: {} }));
  callbacks.current = { onValueChange, onGestureStart, onGestureEnd };
  const [gesture] = useState({ current: false });
  const [holding] = useState({ current: false });
  const [controlElement] = useState<{ current: HTMLElement | null }>(() => ({ current: null }));

  const change = useCallback(
    (index: number, value: XYValue, reason: XYPadChangeReason, event: Event) => {
      const next = constrain(ranges, value);
      if (sameValue(next, latest.current[index])) return;
      if (!gesture.current) {
        gesture.current = true;
        callbacks.current.onGestureStart?.();
      }
      latest.current = latest.current.map((one, at) => (at === index ? next : one));
      // Uncontrolled, the pad shows the values at once, without rendering; controlled, when the parent passes them back.
      if (!controlled) store.set(latest.current);
      callbacks.current.onValueChange?.([...latest.current], { reason, event, thumb: index });
    },
    [ranges, latest, gesture, callbacks, controlled, store],
  );
  const endGesture = useCallback(() => {
    if (!gesture.current) return;
    gesture.current = false;
    callbacks.current.onGestureEnd?.([...latest.current]);
  }, [gesture, callbacks, latest]);
  const reset = useCallback(
    (index: number, event: Event) => {
      const to = resetValue?.[index] ?? defaultValue?.[index];
      if (!to) return;
      change(index, to, "reset", event);
      endGesture();
    },
    [change, endGesture, resetValue, defaultValue],
  );

  // Values that change on their own, as automation, are read once per frame, except while a thumb is held.
  const [readRef] = useState<{ current: XYPadRoot.Props["read"] }>(() => ({ current: undefined }));
  readRef.current = read;
  const reads = read !== undefined;
  useEffect(() => {
    if (!reads) return;
    return onEveryFrame(() => {
      if (!readRef.current || holding.current || gesture.current) return;
      const next = readRef.current().map((one) => constrain(ranges, one));
      if (next.length === store.values.length && next.every((one, index) => sameValue(one, store.values[index]))) return;
      latest.current = next;
      store.set(next);
    });
  }, [reads, readRef, ranges, holding, gesture, latest, store]);

  const [labelId, setLabelId] = useState<string | undefined>(undefined);
  const context: XYPadContextValue = {
    store,
    ranges,
    formats: { x: format?.x ?? defaultFormat, y: format?.y ?? defaultFormat },
    disabled,
    labelId,
    setLabelId,
    controlElement,
    change,
    endGesture,
    reset,
    latest: () => latest.current,
    holding,
  };
  const state: XYPadState = { values: [...values], dragging: store.dragging !== null, disabled };
  const rendered = useRenderPart("div", state, props, {
    role: "group",
    "aria-labelledby": labelId,
    ...dataAttributes({ disabled }),
  });
  return <XYPadContext.Provider value={context}>{rendered}</XYPadContext.Provider>;
}

export namespace XYPadRoot {
  export type State = XYPadState;
  export type Props = Omit<PartProps<"div", State>, "defaultValue" | "onChange"> & {
    /** The thumbs' values, `[x, y]` each, when controlled. */
    value?: readonly XYValue[] | undefined;
    /**
     * The thumbs' values at first, when uncontrolled.
     * @default one thumb at the minimum of both axes
     */
    defaultValue?: readonly XYValue[] | undefined;
    /**
     * The values a double-click or Delete returns each thumb to.
     * @default `defaultValue`
     */
    resetValue?: readonly XYValue[] | undefined;
    /** Called with every thumb's value when a drag, a key or a reset moves one; `details.thumb` says which. */
    onValueChange?: ((values: XYValue[], details: XYPadChangeDetails) => void) | undefined;
    /** Called before the first change of a gesture. */
    onGestureStart?: (() => void) | undefined;
    /** Called when a gesture ends, with the values it left: one undo step. */
    onGestureEnd?: ((values: XYValue[]) => void) | undefined;
    /** Returns the values when they change on their own, as automation; called once per animation frame. */
    read?: (() => readonly XYValue[]) | undefined;
    /**
     * The horizontal axis: `min`, `max`, `step` and `scale`, as a knob's or fader's range.
     * @default { min: 0, max: 1 }
     */
    x?: XYAxis | undefined;
    /**
     * The vertical axis, from `min` at the bottom to `max` at the top.
     * @default { min: 0, max: 1 }
     */
    y?: XYAxis | undefined;
    /**
     * Text of each axis's value, for `XYPad.Value` and what the thumbs announce.
     * @default formats.number({ digits: 2 }) for both
     */
    format?: { x?: ValueFormat | undefined; y?: ValueFormat | undefined } | undefined;
    /**
     * Ignores input.
     * @default false
     */
    disabled?: boolean | undefined;
  };
}

/** Names the pad for assistive technology. */
export function XYPadLabel(props: XYPadLabel.Props) {
  const context = useXYPadContext("Label");
  const generated = useId();
  const id = props.id ?? generated;
  const { setLabelId } = context;
  useIsomorphicLayoutEffect(() => {
    setLabelId(id);
    return () => setLabelId(undefined);
  }, [id, setLabelId]);
  return useRenderPart("span", rootState(context), props, { id, style: unselectable });
}

export namespace XYPadLabel {
  export type State = XYPadState;
  export type Props = PartProps<"span", State>;
}

const rootState = (context: XYPadContextValue): XYPadState => ({
  values: [...context.store.values],
  dragging: context.store.dragging !== null,
  disabled: context.disabled,
});

/** A pointer's travel across the control, 0 … 1 on each axis: x along the reading direction, y upwards. */
function travelAt(element: HTMLElement, clientX: number, clientY: number, rightToLeft: boolean): [number, number] {
  const box = element.getBoundingClientRect();
  const across = (clientX - box.left) / (box.width || 1);
  return [rightToLeft ? 1 - across : across, 1 - (clientY - box.top) / (box.height || 1)];
}

/**
 * Follows a drag of thumb `index` from this press: a move of the pointer
 * moves it as far across the control (Shift: a tenth as far). One gesture.
 */
function dragThumb(context: XYPadContextValue, index: number, event: ReactPointerEvent<HTMLElement>, jump: boolean) {
  const control = context.controlElement.current;
  if (context.disabled || event.button !== 0 || !control) return;
  const element = event.currentTarget;
  event.preventDefault();
  const rightToLeft = isRightToLeft(control);
  const box = control.getBoundingClientRect();
  const { ranges } = context;
  const current = context.latest()[index];
  if (!current) return;
  let position: [number, number] = [ranges.x.normalize(current[0]), ranges.y.normalize(current[1])];
  // A press on the control away from the thumbs brings the nearest thumb there.
  if (jump) {
    position = travelAt(control, event.clientX, event.clientY, rightToLeft);
    context.change(index, [ranges.x.denormalize(position[0]), ranges.y.denormalize(position[1])], "drag", event.nativeEvent);
  }
  let last = { x: event.clientX, y: event.clientY };
  context.holding.current = true;
  context.store.set(context.store.values, index);
  try {
    element.setPointerCapture(event.pointerId);
  } catch {
    // The pointer may already be gone (a synthetic event).
  }
  const move = (moved: PointerEvent) => {
    const factor = moved.shiftKey ? FINE : 1;
    const across = ((moved.clientX - last.x) / (box.width || 1)) * (rightToLeft ? -1 : 1);
    const up = -(moved.clientY - last.y) / (box.height || 1);
    last = { x: moved.clientX, y: moved.clientY };
    position = [Math.min(1, Math.max(0, position[0] + across * factor)), Math.min(1, Math.max(0, position[1] + up * factor))];
    context.change(index, [ranges.x.denormalize(position[0]), ranges.y.denormalize(position[1])], "drag", moved);
  };
  const end = () => {
    element.removeEventListener("pointermove", move);
    element.removeEventListener("pointerup", end);
    element.removeEventListener("pointercancel", end);
    context.holding.current = false;
    context.store.set(context.store.values, null);
    context.endGesture();
  };
  element.addEventListener("pointermove", move);
  element.addEventListener("pointerup", end);
  element.addEventListener("pointercancel", end);
}

/**
 * The area the thumbs move on: size it with CSS. A press on it away from
 * the thumbs brings the nearest thumb to the pointer, and a drag goes on
 * from there.
 */
export function XYPadControl(props: XYPadControl.Props) {
  const context = useXYPadContext("Control");
  const register = useCallback(
    (element: HTMLElement | null) => {
      context.controlElement.current = element;
    },
    [context.controlElement],
  );
  return useRenderPart("div", rootState(context), props, {
    ref: register,
    ...dataAttributes({ disabled: context.disabled }),
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      if (event.target instanceof Element && event.target.closest("[data-xy-thumb]")) return;
      const control = context.controlElement.current;
      if (!control) return;
      const [across, up] = travelAt(control, event.clientX, event.clientY, isRightToLeft(control));
      const { ranges } = context;
      // The nearest thumb, by distance on the control.
      let nearest = 0;
      let distance = Infinity;
      context.latest().forEach(([x, y], index) => {
        const d = Math.hypot(ranges.x.normalize(x) - across, ranges.y.normalize(y) - up);
        if (d < distance) [nearest, distance] = [index, d];
      });
      dragThumb(context, nearest, event, true);
      control.querySelectorAll<HTMLElement>("[data-xy-thumb]")[nearest]?.focus({ preventScroll: true });
    },
    style: { position: "relative", touchAction: "none" },
  });
}

export namespace XYPadControl {
  export type State = XYPadState;
  export type Props = PartProps<"div", State>;
}

// Rounded, so that the CSS the browser serializes compares equal to what was written.
const percent = (travel: number) => `${Math.round(travel * 100_000) / 1000}%`;

/**
 * A thumb, for the value at `index`: a `slider` whose text says both its
 * values, named with `aria-label`. Left and Right move it across (along the
 * reading direction), Up and Down move it up and down, Shift finer; Page Up
 * and Page Down by a tenth upwards, Home and End to the ends across; Delete,
 * Backspace or a double-click reset it. Sets `--xy-pad-x` and `--xy-pad-y`
 * (travel in [0, 1]) on its element, and `data-dragging` while dragged.
 */
export function XYPadThumb({ index, ...props }: XYPadThumb.Props) {
  const context = useXYPadContext("Thumb");
  const [rightToLeft, directionRef] = useRightToLeft();
  const { ranges, store } = context;
  const describe = useCallback(
    (value: XYValue | undefined) => {
      if (!value) return { attributes: {}, style: {} };
      const across = ranges.x.normalize(value[0]);
      const up = ranges.y.normalize(value[1]);
      return {
        attributes: {
          "aria-valuenow": Number.isFinite(value[0]) ? value[0] : null,
          "aria-valuetext": `${context.formats.x.format(value[0])}, ${context.formats.y.format(value[1])}`,
          "data-dragging": store.dragging === index ? "" : null,
        },
        style: { "inset-inline-start": percent(across), bottom: percent(up), "--xy-pad-x": String(across), "--xy-pad-y": String(up) },
      };
    },
    [ranges, context.formats, store, index],
  );
  const follow = useCallback(
    (element: HTMLElement | null) => {
      if (!element) return;
      const write = () => writeLive(element, describe(store.values[index]));
      write();
      return store.subscribe(write);
    },
    [store, index, describe],
  );
  const ref = useMergedRef(follow, directionRef);
  const value = store.values[index] ?? [ranges.x.min, ranges.y.min];
  const shown = describe(value);
  const state: XYPadThumbState = { x: value[0], y: value[1], index, dragging: store.dragging === index, disabled: context.disabled };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (context.disabled) return;
    const current = context.latest()[index];
    if (!current) return;
    const small = event.shiftKey ? 0.001 : 0.01;
    const by = (range: Range, value: number, direction: number, amount = small) =>
      range.step !== undefined && amount === small ? value + direction * range.step : range.denormalize(range.normalize(value) + direction * amount);
    const flip = isRightToLeft(event.currentTarget) ? -1 : 1;
    let next: XYValue;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowLeft":
        next = [by(ranges.x, current[0], (event.key === "ArrowRight" ? 1 : -1) * flip), current[1]];
        break;
      case "ArrowUp":
      case "ArrowDown":
        next = [current[0], by(ranges.y, current[1], event.key === "ArrowUp" ? 1 : -1)];
        break;
      case "PageUp":
      case "PageDown":
        next = [current[0], by(ranges.y, current[1], event.key === "PageUp" ? 1 : -1, 0.1)];
        break;
      case "Home":
        next = [ranges.x.min, current[1]];
        break;
      case "End":
        next = [ranges.x.max, current[1]];
        break;
      case "Delete":
      case "Backspace":
        event.preventDefault();
        context.reset(index, event.nativeEvent);
        return;
      default:
        return;
    }
    event.preventDefault();
    context.change(index, next, "keyboard", event.nativeEvent);
    context.endGesture();
  };

  return useRenderPart("div", state, props, {
    ref,
    role: "slider",
    tabIndex: context.disabled ? -1 : 0,
    "aria-valuemin": Number.isFinite(ranges.x.min) ? ranges.x.min : undefined,
    "aria-valuemax": Number.isFinite(ranges.x.max) ? ranges.x.max : undefined,
    "aria-valuenow": shown.attributes["aria-valuenow"] ?? undefined,
    "aria-valuetext": shown.attributes["aria-valuetext"],
    "aria-disabled": context.disabled || undefined,
    "data-xy-thumb": "",
    ...dataAttributes({ dragging: state.dragging, disabled: context.disabled }),
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      event.currentTarget.focus({ preventScroll: true });
      dragThumb(context, index, event, false);
    },
    onKeyDown,
    onDoubleClick: (event: ReactMouseEvent<HTMLElement>) => {
      if (!context.disabled) context.reset(index, event.nativeEvent);
    },
    style: {
      position: "absolute",
      insetInlineStart: shown.style["inset-inline-start"],
      bottom: shown.style.bottom,
      translate: `${rightToLeft ? "50%" : "-50%"} 50%`,
      touchAction: "none",
      "--xy-pad-x": shown.style["--xy-pad-x"],
      "--xy-pad-y": shown.style["--xy-pad-y"],
    } as CSSProperties,
  });
}

export namespace XYPadThumb {
  export type State = XYPadThumbState;
  export type Props = PartProps<"div", State> & {
    /** Which value of the root's it moves. */
    index: number;
  };
}

/** The text of a thumb's value: both axes, or one of them with `axis`. */
export function XYPadValue({ index = 0, axis, ...props }: XYPadValue.Props) {
  const context = useXYPadContext("Value");
  const text = useCallback(
    (value: XYValue | undefined) => {
      if (!value) return "";
      const x = context.formats.x.format(value[0]);
      const y = context.formats.y.format(value[1]);
      return axis === "x" ? x : axis === "y" ? y : `${x}, ${y}`;
    },
    [context.formats, axis],
  );
  const follow = useCallback(
    (element: HTMLElement | null) => {
      if (!element) return;
      const write = () => {
        const next = text(context.store.values[index]);
        if (element.textContent !== next) element.textContent = next;
      };
      write();
      return context.store.subscribe(write);
    },
    [context.store, index, text],
  );
  return useRenderPart("output", rootState(context), props, {
    ref: follow,
    dir: "auto",
    children: text(context.store.values[index]),
    style: unselectable,
  });
}

export namespace XYPadValue {
  export type State = XYPadState;
  export type Props = Omit<PartProps<"output", State>, "children"> & {
    /**
     * Which thumb's value.
     * @default 0
     */
    index?: number | undefined;
    /** Only this axis's value. */
    axis?: "x" | "y" | undefined;
  };
}
