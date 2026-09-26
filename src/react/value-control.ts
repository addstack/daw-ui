"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { createRange, formats, zoneOf, type Range, type Scale, type ValueFormat, type Zones } from "../core/index.js";
import { isRightToLeft } from "./direction.js";
import { onEveryFrame } from "./frame-loop.js";
import { liveProps, mergeLive, useLive, type Live, type LiveListener } from "./live.js";
import { dataAttributes } from "./render.js";

export const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export type ValueChangeReason = "drag" | "keyboard" | "wheel" | "reset" | "input";

export type ValueChangeDetails = {
  reason: ValueChangeReason;
  event: Event;
};

/** Props shared by `Knob.Root`, `Fader.Root` and `NumberBox.Root`. */
export type ValueControlProps = {
  /**
   * The value, when controlled by React state. Use with `onValueChange`.
   * For values that change on every frame, such as automation, use `read`.
   */
  value?: number | undefined;
  /**
   * Returns the value; called once per animation frame, for values that
   * change on their own: automation, modulation, a control surface. The
   * control shows it without rendering. While the user drags or types, the
   * user's value wins; report it with `onValueChange`, and `read` returns
   * it from then on.
   */
  read?: (() => number) | undefined;
  /** Initial value when uncontrolled. Also where a reset goes, unless `resetValue` is set. */
  defaultValue?: number | undefined;
  /**
   * Where double-click and Delete reset to.
   * @default defaultValue, then origin
   */
  resetValue?: number | undefined;
  /** Called with each new value and why it changed: `"drag"`, `"keyboard"`, `"wheel"`, `"reset"` or `"input"`. */
  onValueChange?: ((value: number, details: ValueChangeDetails) => void) | undefined;
  /**
   * Called before the first change of a user action: a drag, a key press, a
   * burst of wheel events, a reset, a typed value. Pair with `onGestureEnd` to
   * make the action one undo step, or to record automation.
   */
  onGestureStart?: (() => void) | undefined;
  /** Called when that action ends, with the final value. */
  onGestureEnd?: ((value: number) => void) | undefined;
  /**
   * The lowest value.
   * @default 0
   */
  min?: number | undefined;
  /**
   * The highest value.
   * @default 1
   */
  max?: number | undefined;
  /**
   * Values snap to `min + k * step` (to `k * step` when `min` is `-Infinity`),
   * and arrow keys move one step. Leave it out for a continuous value.
   */
  step?: number | undefined;
  /**
   * How travel maps to value: `scales.linear`, `scales.log`, `scales.power(n)` or `scales.decibel`.
   * @default scales.linear
   */
  scale?: Scale | undefined;
  /** Text for the value and `aria-valuetext`, and parsing of typed values. */
  format?: ValueFormat | undefined;
  /**
   * Where the value's range starts when drawn: `origin={0}` on a -1 … 1 pan
   * knob draws from the center (`data-bipolar`).
   * @default min
   */
  origin?: number | undefined;
  /**
   * Named zones of the value by their lower bound, e.g. `{ hot: 0 }` on a
   * fader in dB. Every part gets `data-zone` with the zone the value is in,
   * which changes only when the value crosses a bound: style it in CSS
   * instead of comparing values in code.
   */
  zones?: Zones | undefined;
  /**
   * Pixels of drag for the full travel. Shift divides the speed by 10.
   * @default 200 for a knob, the track length for a fader, two pixels per step for a number box
   */
  sensitivity?: number | undefined;
  /**
   * Changes the value on mouse wheel and trackpad scroll.
   * @default true
   */
  wheel?: boolean | undefined;
  /**
   * Hides the pointer during a drag so it never stops at the edge of the
   * screen, as desktop DAWs do. Browsers show a notice the first time.
   * @default false
   */
  pointerLock?: boolean | undefined;
  /**
   * Ignores input and leaves the tab order.
   * @default false
   */
  disabled?: boolean | undefined;
};

export type ValueControlState = {
  value: number;
  /** Travel position in [0, 1]. */
  normalized: number;
  /** Travel position of `origin`. */
  originNormalized: number;
  /** The formatted value. */
  text: string;
  dragging: boolean;
  disabled: boolean;
  bipolar: boolean;
  /** The zone of `zones` the value is in. */
  zone: string | undefined;
};

/**
 * The value of a control and whether it is being dragged, outside React.
 * Parts subscribe and write what they show straight to the DOM.
 */
class ValueStore {
  value: number;
  dragging = false;
  derive: (value: number, dragging: boolean) => ValueControlState;
  private listeners = new Set<LiveListener<ValueControlState>>();

  constructor(value: number, derive: (value: number, dragging: boolean) => ValueControlState) {
    this.value = value;
    this.derive = derive;
  }

  subscribe = (listener: LiveListener<ValueControlState>) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  set(value: number, dragging = this.dragging): void {
    if (Object.is(value, this.value) && dragging === this.dragging) return;
    this.value = value;
    this.dragging = dragging;
    if (this.listeners.size === 0) return;
    const state = this.derive(value, dragging);
    for (const listener of this.listeners) listener(state);
  }
}

type Options = {
  orientation: "vertical" | "horizontal";
  /** Pixels for the full travel when `sensitivity` is not given; measured at the start of a drag. */
  defaultSensitivity: (element: HTMLElement) => number;
  resetOnDoubleClick: boolean;
  role: "slider" | "spinbutton";
};

const FINE = 0.1;
const WHEEL_GESTURE_MS = 400;
// Share of the travel per pixel of wheel scroll: a mouse notch (100 px) moves 5%.
const WHEEL_TRAVEL_PER_PIXEL = 0.0005;

/** Pixels of scroll towards a higher value: wheel up, or a swipe to the right. */
function wheelPixels(event: WheelEvent): number {
  // Shift turns a vertical wheel into a horizontal one on macOS and Windows; keep its direction.
  const delta = event.deltaY !== 0 ? -event.deltaY : event.shiftKey ? -event.deltaX : event.deltaX;
  if (event.deltaMode === 1) return delta * 33;
  if (event.deltaMode === 2) return delta * 800;
  return delta;
}

export function useValueControl(props: ValueControlProps, options: Options) {
  const {
    value: controlledValue,
    read,
    defaultValue,
    resetValue,
    onValueChange,
    onGestureStart,
    onGestureEnd,
    min = 0,
    max = 1,
    step,
    scale,
    format: formatProp,
    origin: originProp,
    zones,
    sensitivity,
    wheel = true,
    pointerLock = false,
    disabled = false,
  } = props;

  const range: Range = useMemo(() => createRange({ min, max, step, scale }), [min, max, step, scale]);
  const format = useMemo(
    () => formatProp ?? formats.number({ digits: step !== undefined && Number.isInteger(step) ? 0 : 2 }),
    [formatProp, step],
  );
  const origin = range.clamp(originProp ?? min);
  const originNormalized = range.normalize(origin);
  const bipolar = originNormalized > 0 && originNormalized < 1;

  const derive = (value: number, dragging: boolean): ValueControlState => ({
    value,
    normalized: range.normalize(value),
    originNormalized,
    text: format.format(value),
    dragging,
    disabled,
    bipolar,
    zone: zoneOf(value, zones),
  });

  const controlled = controlledValue !== undefined;
  const [store] = useState(
    () => new ValueStore(controlled ? range.clamp(controlledValue) : range.constrain(defaultValue ?? origin), derive),
  );
  // Emitted states use the current range, format and zones.
  store.derive = derive;
  const value = controlled ? range.clamp(controlledValue) : range.clamp(store.value);

  // The value as of the last change this control made, so that events arriving
  // before the parent re-renders build on it rather than on a stale prop.
  const latest = useRef(value);

  // A controlled value reaches the parts through the store, like any other.
  useIsomorphicLayoutEffect(() => {
    if (!controlled) return;
    latest.current = value;
    store.set(value);
  });

  const callbacks = useRef({ onValueChange, onGestureStart, onGestureEnd });
  callbacks.current = { onValueChange, onGestureStart, onGestureEnd };

  const inGesture = useRef(false);
  const beginGesture = useCallback(() => {
    if (inGesture.current) return;
    inGesture.current = true;
    callbacks.current.onGestureStart?.();
  }, []);
  const endGesture = useCallback(() => {
    if (!inGesture.current) return;
    inGesture.current = false;
    callbacks.current.onGestureEnd?.(latest.current);
  }, []);

  const isControlled = useRef(controlled);
  isControlled.current = controlled;

  const change = useCallback(
    (next: number, reason: ValueChangeReason, event: Event) => {
      const constrained = range.constrain(next);
      if (Object.is(constrained, latest.current)) return;
      beginGesture();
      latest.current = constrained;
      // Uncontrolled, the control shows the value at once, without rendering; controlled, when the parent passes it back.
      if (!isControlled.current) store.set(constrained);
      callbacks.current.onValueChange?.(constrained, { reason, event });
    },
    [range, beginGesture, store],
  );

  const reset = useCallback(
    (event: Event) => {
      change(resetValue ?? defaultValue ?? origin, "reset", event);
      endGesture();
    },
    [change, endGesture, resetValue, defaultValue, origin],
  );

  // --- drag ---

  const optionsRef = useRef(options);
  optionsRef.current = options;
  const settings = useRef({ sensitivity, pointerLock, disabled, wheel });
  settings.current = { sensitivity, pointerLock, disabled, wheel };
  // While the pointer is down, `read` does not move the value from under it.
  const holding = useRef(false);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (settings.current.disabled || event.button !== 0) return;
      const element = event.currentTarget;
      // No text selection while dragging; focus still moves to the control.
      event.preventDefault();
      element.focus({ preventScroll: true });

      const { orientation, defaultSensitivity } = optionsRef.current;
      const measured = defaultSensitivity(element);
      const pixels = settings.current.sensitivity ?? (measured > 0 ? measured : 200);
      const towardsStart = orientation === "horizontal" && isRightToLeft(element) ? -1 : 1;
      let position = range.normalize(latest.current);
      let lastX = event.clientX;
      let lastY = event.clientY;
      const pointerId = event.pointerId;
      holding.current = true;

      try {
        element.setPointerCapture(pointerId);
      } catch {
        // The pointer may already be gone (e.g. a synthetic event).
      }
      if (settings.current.pointerLock) {
        // Chrome returns a promise that rejects when the lock is refused; others return nothing.
        Promise.resolve(element.requestPointerLock?.()).catch(() => {});
      }

      const onMove = (move: PointerEvent) => {
        if (move.pointerId !== pointerId) return;
        const locked = document.pointerLockElement === element;
        const dx = locked ? move.movementX : move.clientX - lastX;
        const dy = locked ? move.movementY : move.clientY - lastY;
        lastX = move.clientX;
        lastY = move.clientY;
        const pixelsMoved = orientation === "vertical" ? -dy : dx * towardsStart;
        if (pixelsMoved === 0) return;
        store.set(store.value, true);
        position = Math.min(1, Math.max(0, position + (pixelsMoved / pixels) * (move.shiftKey ? FINE : 1)));
        change(range.denormalize(position), "drag", move);
      };
      const onEnd = (end: PointerEvent) => {
        if (end.pointerId !== pointerId) return;
        element.removeEventListener("pointermove", onMove);
        element.removeEventListener("pointerup", onEnd);
        element.removeEventListener("pointercancel", onEnd);
        element.removeEventListener("lostpointercapture", onEnd);
        if (document.pointerLockElement === element) document.exitPointerLock();
        holding.current = false;
        store.set(store.value, false);
        endGesture();
      };
      element.addEventListener("pointermove", onMove);
      element.addEventListener("pointerup", onEnd);
      element.addEventListener("pointercancel", onEnd);
      element.addEventListener("lostpointercapture", onEnd);
    },
    [range, change, endGesture, store],
  );

  // --- keyboard ---

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (settings.current.disabled) return;
      const current = latest.current;
      const position = range.normalize(current);
      const byTravel = (amount: number) => range.denormalize(position + amount);
      const bySteps = (count: number) => current + count * range.step!;
      const small = (direction: 1 | -1) =>
        range.step !== undefined ? bySteps(direction) : byTravel(direction * (event.shiftKey ? 0.001 : 0.01));
      const large = (direction: 1 | -1) =>
        range.step !== undefined
          ? Math.abs(range.denormalize(position + direction * 0.1) - current) > range.step
            ? byTravel(direction * 0.1)
            : bySteps(direction)
          : byTravel(direction * 0.1);

      // Left and right follow the reading direction on horizontal controls.
      const flip =
        (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
        optionsRef.current.orientation === "horizontal" &&
        isRightToLeft(event.currentTarget);

      let next: number;
      switch (event.key) {
        case "ArrowUp":
          next = small(1);
          break;
        case "ArrowRight":
          next = small(flip ? -1 : 1);
          break;
        case "ArrowDown":
          next = small(-1);
          break;
        case "ArrowLeft":
          next = small(flip ? 1 : -1);
          break;
        case "PageUp":
          next = large(1);
          break;
        case "PageDown":
          next = large(-1);
          break;
        case "Home":
          next = range.min;
          break;
        case "End":
          next = range.max;
          break;
        case "Delete":
        case "Backspace":
          event.preventDefault();
          reset(event.nativeEvent);
          return;
        default:
          return;
      }
      event.preventDefault();
      change(next, "keyboard", event.nativeEvent);
      endGesture();
    },
    [range, change, endGesture, reset],
  );

  const onDoubleClick = useCallback(
    (event: { nativeEvent: Event }) => {
      if (settings.current.disabled || !optionsRef.current.resetOnDoubleClick) return;
      reset(event.nativeEvent);
    },
    [reset],
  );

  // --- wheel: a native listener, because React's is passive and cannot stop the page from scrolling ---

  const wheelState = useRef<{ position: number; timer: ReturnType<typeof setTimeout> | undefined }>({
    position: 0,
    timer: undefined,
  });
  const onWheel = useCallback(
    (event: WheelEvent) => {
      if (settings.current.disabled || !settings.current.wheel) return;
      const pixels = wheelPixels(event);
      if (pixels === 0) return;
      event.preventDefault();
      const state = wheelState.current;
      if (state.timer === undefined) state.position = range.normalize(latest.current);
      else clearTimeout(state.timer);
      state.timer = setTimeout(() => {
        state.timer = undefined;
        endGesture();
      }, WHEEL_GESTURE_MS);
      const amount = pixels * WHEEL_TRAVEL_PER_PIXEL * (event.shiftKey ? FINE : 1);
      state.position = Math.min(1, Math.max(0, state.position + amount));
      change(range.denormalize(state.position), "wheel", event);
    },
    [range, change, endGesture],
  );
  const onWheelRef = useRef(onWheel);
  onWheelRef.current = onWheel;
  useEffect(
    () => () => {
      clearTimeout(wheelState.current.timer);
    },
    [],
  );

  const controlRef = useCallback((element: HTMLElement | null) => {
    if (!element) return;
    const listener = (event: WheelEvent) => onWheelRef.current(event);
    element.addEventListener("wheel", listener, { passive: false });
    return () => element.removeEventListener("wheel", listener);
  }, []);

  // --- read: values that change on their own, read once per frame ---

  const readRef = useRef(read);
  readRef.current = read;
  const reads = read !== undefined;
  useEffect(() => {
    if (!reads) return;
    return onEveryFrame(() => {
      if (!readRef.current || holding.current || inGesture.current) return;
      const next = range.constrain(readRef.current());
      if (Object.is(next, store.value)) return;
      latest.current = next;
      store.set(next);
    });
  }, [reads, range, store]);

  // --- labelling ---

  const controlId = useId();
  const [labelId, setLabelId] = useState<string | undefined>(undefined);

  const state = derive(value, store.dragging);

  /** The static props of the focusable element; its value attributes are live (`controlLive`). */
  const controlProps = {
    ref: controlRef,
    id: controlId,
    role: options.role,
    tabIndex: disabled ? -1 : 0,
    "aria-valuemin": Number.isFinite(range.min) ? range.min : undefined,
    "aria-valuemax": range.max,
    "aria-orientation": options.role === "slider" ? options.orientation : undefined,
    "aria-disabled": disabled || undefined,
    "aria-labelledby": labelId,
    onPointerDown,
    onKeyDown,
    onDoubleClick,
    style: { touchAction: "none" },
  };

  return {
    state,
    store,
    subscribe: store.subscribe,
    range,
    format,
    zones,
    controlProps,
    controlId,
    setLabelId,
    change,
    endGesture,
  };
}

export type ValueControl = ReturnType<typeof useValueControl>;

/** Registers a label part with its control while it is mounted. */
export function useLabel(control: Pick<ValueControl, "setLabelId">, id: string): void {
  const { setLabelId } = control;
  useIsomorphicLayoutEffect(() => {
    setLabelId(id);
    return () => setLabelId(undefined);
  }, [setLabelId, id]);
}

const VALUE_CONTROL_KEYS = [
  "value",
  "read",
  "defaultValue",
  "resetValue",
  "onValueChange",
  "onGestureStart",
  "onGestureEnd",
  "min",
  "max",
  "step",
  "scale",
  "format",
  "origin",
  "zones",
  "sensitivity",
  "wheel",
  "pointerLock",
  "disabled",
] as const satisfies readonly (keyof ValueControlProps)[];

/** Separates a root's value-control props from the props of the element it renders. */
export function splitValueControlProps<Props extends ValueControlProps>(
  props: Props,
): [ValueControlProps, Omit<Props, keyof ValueControlProps>] {
  const control: Record<string, unknown> = {};
  const rest: Record<string, unknown> = { ...props };
  for (const key of VALUE_CONTROL_KEYS) {
    control[key] = props[key];
    delete rest[key];
  }
  return [control as ValueControlProps, rest as Omit<Props, keyof ValueControlProps>];
}

/** The data attributes every part of a knob, fader or number box carries that do not change with the value. */
export function staticAttributes(state: ValueControlState): Record<string, unknown> {
  return dataAttributes({ disabled: state.disabled, bipolar: state.bipolar });
}

/** What every part of a knob, fader or number box shows of the value: `data-dragging` and `data-zone`. */
export function valueLive(state: ValueControlState): Live {
  return { attributes: { "data-dragging": state.dragging ? "" : null, "data-zone": state.zone ?? null } };
}

/** What the focusable element shows of the value: its accessible value, and the value attributes. */
export function controlLive(state: ValueControlState): Live {
  return mergeLive(valueLive(state), {
    attributes: {
      "aria-valuenow": Number.isFinite(state.value) ? state.value : null,
      "aria-valuetext": state.text,
    },
  });
}

/**
 * A part's live description (`live`) applied for the render, and the ref
 * that keeps it current when only the value changes, without rendering.
 */
export function useLivePart(control: ValueControl, live: (state: ValueControlState) => Live) {
  const ref = useLive(control.subscribe, live);
  const current = live(control.state);
  return { ref, ...liveProps(current), text: current.text };
}

const noSubscription = () => () => {};

/**
 * The state and content of a part that shows the formatted value. The plain
 * text is written without rendering; a `children` function renders the part
 * (alone) on every change of the value.
 */
export function useValueText(
  control: ValueControl,
  children: ReactNode | ((text: string, value: number) => ReactNode),
  live: (state: ValueControlState) => Live = valueLive,
) {
  const renders = typeof children === "function";
  const snapshot = useSyncExternalStore(
    renders ? control.subscribe : noSubscription,
    () => control.store.value,
    () => control.state.value,
  );
  const state = renders ? control.store.derive(snapshot, control.store.dragging) : control.state;
  const part = useLivePart(control, (current) =>
    children === undefined ? mergeLive(live(current), { text: current.text }) : live(current),
  );
  const content = typeof children === "function" ? children(state.text, state.value) : (children ?? part.text);
  return { state, content, ref: part.ref, attributes: part.attributes };
}
