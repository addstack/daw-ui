"use client";

import {
  createContext,
  useCallback,
  useContext,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { boxesAlongSegment, type Point } from "../core/index.js";
import { isRightToLeft } from "./direction.js";
import { dataAttributes, useMergedRef, useRenderPart, type PartProps } from "./render.js";
import { useIsomorphicLayoutEffect } from "./value-control.js";

export type ToggleChangeReason =
  /** Pressed with a pointer. */
  | "press"
  /** Let go of a momentary toggle, or of a hybrid one held longer than `holdDelay`. */
  | "release"
  /** Pressed with the keyboard or activated by assistive technology. */
  | "keyboard"
  /** Reached by a drag (or Shift+Arrow) that started on another toggle. */
  | "paint"
  /** Turned off because another toggle in an exclusive group turned on. */
  | "exclusive";

export type ToggleChangeDetails = { reason: ToggleChangeReason; event: Event };

export type ToggleBehavior = "toggle" | "momentary" | "hybrid";

/**
 * `"click"`: a plain press is exclusive and Cmd/Ctrl+press adds (Ableton
 * Live's solo). `"modifier"`: the other way around.
 */
export type ExclusiveMode = "click" | "modifier";

type Item = {
  readonly id: string;
  readonly element: HTMLElement | null;
  readonly disabled: boolean;
  /** Only plain toggles take part in painting. */
  readonly paintable: boolean;
  readonly lane: string | undefined;
  /** The latest known state, including changes the parent has not rendered yet. */
  pressed: boolean;
  setPressed(pressed: boolean, details: ToggleChangeDetails): void;
};

type ItemRef = { readonly current: Item };

const byDocumentPosition = (a: ItemRef, b: ItemRef) => {
  const first = a.current.element;
  const second = b.current.element;
  if (!first || !second) return 0;
  return first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
};

type Orientation = "horizontal" | "vertical" | "grid";

/**
 * The group's toggles as lines: arrow keys along the line's axis move within
 * it, the other arrow keys move to the same position in the next line. Lanes
 * are lines; so are the rows of a grid.
 */
function arrange(
  items: ItemRef[],
  orientation: Orientation,
  columns: number | undefined,
): { lines: ItemRef[][]; axis: "horizontal" | "vertical" } {
  if (items.some((item) => item.current.lane !== undefined)) {
    const lanes = new Map<string | undefined, ItemRef[]>();
    for (const item of items) {
      const lane = lanes.get(item.current.lane);
      if (lane) lane.push(item);
      else lanes.set(item.current.lane, [item]);
    }
    return { lines: [...lanes.values()], axis: orientation === "vertical" ? "vertical" : "horizontal" };
  }
  if (orientation === "grid") {
    const size = Math.max(1, columns ?? items.length);
    const lines: ItemRef[][] = [];
    for (let start = 0; start < items.length; start += size) lines.push(items.slice(start, start + size));
    return { lines, axis: "horizontal" };
  }
  return { lines: [items], axis: orientation };
}

const enabled = (item: ItemRef | undefined): item is ItemRef => item !== undefined && !item.current.disabled;

/**
 * The group's shared state. Toggles subscribe with selectors, so a change
 * re-renders only the toggles it affects: painting one step of a 16 × 64 grid
 * renders that step, not the grid.
 */
class ToggleGroupStore {
  value: readonly string[];
  /** The toggle that is in the tab order (roving tab index). */
  focusableId: string | null = null;
  private activeId: string | null = null;
  private items = new Map<string, ItemRef>();
  private listeners = new Set<() => void>();
  private updatePending = false;

  constructor(value: readonly string[]) {
    this.value = value;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private notify() {
    for (const listener of this.listeners) listener();
  }

  setValue(value: readonly string[]) {
    if (value === this.value) return;
    this.value = value;
    this.notify();
  }

  register(item: ItemRef): () => void {
    const { id } = item.current;
    this.items.set(id, item);
    this.scheduleFocusableUpdate();
    return () => {
      this.items.delete(id);
      this.scheduleFocusableUpdate();
    };
  }

  /** Registered toggles in document order. */
  sorted(): ItemRef[] {
    return [...this.items.values()].filter((item) => item.current.element).sort(byDocumentPosition);
  }

  setActive(id: string) {
    this.activeId = id;
    this.updateFocusable();
  }

  /**
   * Batches the updates of many toggles mounting at once into one. The group
   * flushes it in its layout effect, which runs after its toggles' effects;
   * the microtask covers toggles that mount later on their own.
   */
  scheduleFocusableUpdate() {
    if (this.updatePending) return;
    this.updatePending = true;
    queueMicrotask(() => this.flushFocusableUpdate());
  }

  flushFocusableUpdate() {
    if (!this.updatePending) return;
    this.updatePending = false;
    this.updateFocusable();
  }

  private updateFocusable() {
    const enabled = this.sorted().filter((item) => !item.current.disabled);
    const next =
      enabled.find((item) => item.current.id === this.activeId)?.current.id ?? enabled[0]?.current.id ?? null;
    if (next === this.focusableId) return;
    this.focusableId = next;
    this.notify();
  }
}

type ToggleGroupContextValue = {
  store: ToggleGroupStore;
  disabled: boolean;
  setItemValue(value: string, pressed: boolean, details: ToggleChangeDetails): void;
  press(item: ItemRef, event: MouseEvent | KeyboardEvent, reason: "press" | "keyboard"): void;
  startPaint(item: ItemRef, event: ReactPointerEvent<HTMLElement>): boolean;
};

const ToggleGroupContext = createContext<ToggleGroupContextValue | null>(null);

const noSubscription = () => () => {};

export type ToggleGroupState = {
  orientation: Orientation;
  disabled: boolean;
  /** `"on"` or `"off"` while a paint stroke sets toggles to that state. */
  painting: "on" | "off" | null;
};

/**
 * Groups toggles: one tab stop with arrow-key navigation, painting (drag
 * across toggles to set them all to the state of the first), exclusive
 * presses (solo), and one gesture per user action for undo.
 *
 * Toggles with a `value` take their state from the group's `value`; toggles
 * without one keep their own `pressed` state, e.g. in a store per track.
 */
export function ToggleGroup(props: ToggleGroup.Props) {
  const {
    value: valueProp,
    defaultValue,
    onValueChange,
    multiple = false,
    paint = false,
    erase = false,
    exclusive = false,
    orientation = "horizontal",
    columns,
    disabled = false,
    onGestureStart,
    onGestureEnd,
    ref: userRef,
    ...elementProps
  } = props;

  const [store] = useState(() => new ToggleGroupStore(valueProp ?? defaultValue ?? []));
  const [painting, setPainting] = useState<"on" | "off" | null>(null);
  const root = useRef<HTMLElement | null>(null);
  const ref = useMergedRef(root, userRef);

  // The group's value follows the prop; between a change and the parent's
  // re-render, the store holds the value the change produced.
  useIsomorphicLayoutEffect(() => {
    if (valueProp !== undefined) store.setValue(valueProp);
    store.flushFocusableUpdate();
  });

  const settings = useRef({ ...props, multiple, paint, erase, exclusive, orientation });
  settings.current = { ...props, multiple, paint, erase, exclusive, orientation };

  const inGesture = useRef(false);
  const beginGesture = useCallback(() => {
    if (inGesture.current) return;
    inGesture.current = true;
    settings.current.onGestureStart?.();
  }, []);
  const endGesture = useCallback(() => {
    if (!inGesture.current) return;
    inGesture.current = false;
    // A controlled group that rejected the changes goes back to its prop.
    if (settings.current.value !== undefined) store.setValue(settings.current.value);
    settings.current.onGestureEnd?.();
  }, [store]);

  const setItemValue = useCallback(
    (itemValue: string, pressed: boolean, details: ToggleChangeDetails) => {
      const current = store.value;
      if (current.includes(itemValue) === pressed) return;
      const next = pressed
        ? settings.current.multiple
          ? [...current, itemValue]
          : [itemValue]
        : current.filter((candidate) => candidate !== itemValue);
      store.setValue(next);
      settings.current.onValueChange?.(next, details);
    },
    [store],
  );

  /** Sets the pressed toggle, and with `exclusive`, turns the others off. */
  const apply = useCallback(
    (item: ItemRef, pressed: boolean, event: Event, reason: ToggleChangeReason) => {
      const { exclusive } = settings.current;
      const mode = typeof exclusive === "object" ? exclusive[item.current.lane ?? ""] : exclusive;
      const modifier = "metaKey" in event && ((event as MouseEvent).metaKey || (event as MouseEvent).ctrlKey);
      const exclusiveNow = pressed && (mode === "click" ? !modifier : mode === "modifier" ? modifier : false);
      item.current.setPressed(pressed, { reason, event });
      if (!exclusiveNow) return;
      for (const other of store.sorted()) {
        if (other.current.lane !== item.current.lane) continue;
        if (other !== item && other.current.pressed && !other.current.disabled) {
          other.current.setPressed(false, { reason: "exclusive", event });
        }
      }
    },
    [store],
  );

  const press = useCallback(
    (item: ItemRef, event: MouseEvent | KeyboardEvent, reason: "press" | "keyboard") => {
      beginGesture();
      apply(item, !item.current.pressed, event, reason);
      endGesture();
    },
    [apply, beginGesture, endGesture],
  );

  const startPaint = useCallback(
    (item: ItemRef, event: ReactPointerEvent<HTMLElement>): boolean => {
      const { paint, erase } = settings.current;
      const erasing = event.button === 2 && erase === "secondary";
      if (event.button !== 0 && !erasing) return false;
      const target = erasing ? false : !item.current.pressed;

      beginGesture();
      apply(item, target, event.nativeEvent, "press");
      const element = root.current;
      if (!paint || !element) {
        endGesture();
        return true;
      }

      // Layout is read once per stroke, not on every move. A stroke stays in its lane.
      const candidates = store
        .sorted()
        .filter(
          (candidate) =>
            candidate.current.paintable && !candidate.current.disabled && candidate.current.lane === item.current.lane,
        );
      // In a lane, only travel along it counts: drifting into the next lane keeps painting this one.
      const laneAxis = item.current.lane === undefined ? null : settings.current.orientation === "vertical" ? "vertical" : "horizontal";
      const boxes = candidates.map((candidate) => {
        const { left, top, right, bottom } = candidate.current.element!.getBoundingClientRect();
        if (laneAxis === "horizontal") return { left, right, top: -Infinity, bottom: Infinity };
        if (laneAxis === "vertical") return { left: -Infinity, right: Infinity, top, bottom };
        return { left, top, right, bottom };
      });
      const visited = new Set<ItemRef>([item]);
      const pointerId = event.pointerId;
      let last: Point = { x: event.clientX, y: event.clientY };

      try {
        element.setPointerCapture(pointerId);
      } catch {
        // The pointer may already be gone (e.g. a synthetic event).
      }
      setPainting(target ? "on" : "off");

      const onMove = (move: PointerEvent) => {
        if (move.pointerId !== pointerId) return;
        const point = { x: move.clientX, y: move.clientY };
        for (const index of boxesAlongSegment(last, point, boxes)) {
          const candidate = candidates[index]!;
          if (visited.has(candidate)) continue;
          visited.add(candidate);
          if (candidate.current.pressed !== target) candidate.current.setPressed(target, { reason: "paint", event: move });
        }
        last = point;
      };
      const onEnd = (end: PointerEvent) => {
        if (end.pointerId !== pointerId) return;
        element.removeEventListener("pointermove", onMove);
        element.removeEventListener("pointerup", onEnd);
        element.removeEventListener("pointercancel", onEnd);
        element.removeEventListener("lostpointercapture", onEnd);
        setPainting(null);
        endGesture();
      };
      element.addEventListener("pointermove", onMove);
      element.addEventListener("pointerup", onEnd);
      element.addEventListener("pointercancel", onEnd);
      element.addEventListener("lostpointercapture", onEnd);
      return true;
    },
    [store, apply, beginGesture, endGesture],
  );

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    const items = store.sorted();
    const current = items.find((item) => item.current.element?.contains(event.target as Node));
    if (!current) return;
    const { lines, axis } = arrange(items, orientation, columns);
    const lineIndex = lines.findIndex((line) => line.includes(current));
    const line = lines[lineIndex]!;
    const position = line.indexOf(current);

    let target: ItemRef | undefined;
    let moved = false;
    const alongLine = (step: number) => {
      moved = true;
      for (let index = position + step; index >= 0 && index < line.length; index += step) {
        if (enabled(line[index])) return line[index];
      }
    };
    const acrossLines = (step: number) => {
      moved = true;
      for (let index = lineIndex + step; index >= 0 && index < lines.length; index += step) {
        const other = lines[index]!;
        const candidate = other[Math.min(position, other.length - 1)];
        if (enabled(candidate)) return candidate;
      }
    };

    const key = event.key;
    if (key === "ArrowLeft" || key === "ArrowRight") {
      // Left and right follow the reading direction.
      const step = (key === "ArrowRight" ? 1 : -1) * (isRightToLeft(event.currentTarget) ? -1 : 1);
      target = axis === "horizontal" ? alongLine(step) : acrossLines(step);
    } else if (key === "ArrowUp" || key === "ArrowDown") {
      const step = key === "ArrowDown" ? 1 : -1;
      target = axis === "vertical" ? alongLine(step) : acrossLines(step);
    } else if (key === "Home" || key === "End") {
      // Home and End go to the ends of the line; with Ctrl, to the ends of the group.
      const pool = (event.ctrlKey ? lines.flat() : line).filter(enabled);
      target = key === "Home" ? pool[0] : pool.at(-1);
    } else {
      return;
    }
    event.preventDefault();
    if (!target || target === current) return;

    // Shift+Arrow paints: the next toggle in the lane takes the state of the current one.
    const painting =
      moved && event.shiftKey && current.current.paintable && target.current.paintable && target.current.lane === current.current.lane;
    if (painting && target.current.pressed !== current.current.pressed) {
      beginGesture();
      target.current.setPressed(current.current.pressed, { reason: "paint", event: event.nativeEvent });
      endGesture();
    }
    target.current.element?.focus();
  };

  const onContextMenu = (event: ReactMouseEvent<HTMLElement>) => {
    // The secondary button erases; the browser's menu would interrupt the stroke.
    if (erase === "secondary") event.preventDefault();
  };

  const state: ToggleGroupState = { orientation, disabled, painting };
  const rendered = useRenderPart("div", state, { ...elementProps, ref }, {
    role: "group",
    ...dataAttributes({ orientation, disabled, painting: painting ?? undefined }),
    onKeyDown,
    onContextMenu,
  });
  const context: ToggleGroupContextValue = { store, disabled, setItemValue, press, startPaint };
  return <ToggleGroupContext.Provider value={context}>{rendered}</ToggleGroupContext.Provider>;
}

export namespace ToggleGroup {
  export type State = ToggleGroupState;
  export type Props = Omit<PartProps<"div", State>, "defaultValue" | "onChange"> & {
    /** Values of the pressed toggles, for toggles that have a `value`. */
    value?: readonly string[] | undefined;
    defaultValue?: readonly string[] | undefined;
    onValueChange?: ((value: string[], details: ToggleChangeDetails) => void) | undefined;
    /** Lets more than one toggle with a `value` be pressed. Defaults to `false`. */
    multiple?: boolean | undefined;
    /**
     * Dragging from a toggle sets every toggle the pointer crosses to the
     * state the first one took. Shift+Arrow does the same from the keyboard.
     */
    paint?: boolean | undefined;
    /** `"secondary"`: dragging with the secondary (right) button turns toggles off, as in FL Studio. */
    erase?: "secondary" | false | undefined;
    /**
     * Turning a toggle on turns the others in its lane off. `"click"`: a plain
     * press is exclusive and Cmd/Ctrl+press adds (Ableton Live's solo).
     * `"modifier"`: the other way around. A map sets it per lane, e.g.
     * `{ solo: "click" }` for a mixer whose mute buttons stay independent.
     */
    exclusive?: ExclusiveMode | false | Partial<Record<string, ExclusiveMode | false>> | undefined;
    /** Which arrow keys move focus. Defaults to `"horizontal"`. */
    orientation?: Orientation | undefined;
    /** Toggles per row, for `orientation="grid"`. */
    columns?: number | undefined;
    disabled?: boolean | undefined;
    /**
     * Called before the first change of a user action: a press, a paint
     * stroke, an exclusive press that turns other toggles off. Pair with
     * `onGestureEnd` to make it one undo step.
     */
    onGestureStart?: (() => void) | undefined;
    onGestureEnd?: (() => void) | undefined;
  };
}

export type ToggleState = { pressed: boolean; disabled: boolean };

/**
 * A two-state button (`aria-pressed`) that reacts on press, not on release.
 * Works alone or inside a `ToggleGroup`.
 */
export function Toggle(props: Toggle.Props) {
  const {
    pressed: pressedProp,
    defaultPressed = false,
    onPressedChange,
    value,
    behavior = "toggle",
    holdDelay = 250,
    lane,
    disabled: disabledProp = false,
    ref: userRef,
    ...elementProps
  } = props;

  const group = useContext(ToggleGroupContext);
  const id = useId();
  const groupOwned = group !== null && value !== undefined;
  const [uncontrolledPressed, setUncontrolledPressed] = useState(defaultPressed);

  const subscribe = group?.store.subscribe ?? noSubscription;
  const readPressedInGroup = () => group !== null && value !== undefined && group.store.value.includes(value);
  const pressedInGroup = useSyncExternalStore(subscribe, readPressedInGroup, readPressedInGroup);
  const focusable = useSyncExternalStore(
    subscribe,
    () => group?.store.focusableId === id,
    () => false,
  );

  const pressed = groupOwned ? pressedInGroup : (pressedProp ?? uncontrolledPressed);
  const disabled = disabledProp || (group?.disabled ?? false);

  const element = useRef<HTMLElement | null>(null);
  const ref = useMergedRef(element, userRef);
  const latest = useRef({ onPressedChange, group, value, groupOwned });
  latest.current = { onPressedChange, group, value, groupOwned };

  const setPressed = useCallback((next: boolean, details: ToggleChangeDetails) => {
    const { onPressedChange, group, value, groupOwned } = latest.current;
    const item = itemRef.current;
    if (item.pressed === next) return;
    item.pressed = next;
    if (groupOwned) {
      group!.setItemValue(value!, next, details);
    } else {
      setUncontrolledPressed(next);
      onPressedChange?.(next, details);
    }
  }, []);

  const itemRef = useRef<Item>(null!);
  itemRef.current = {
    id,
    get element() {
      return element.current;
    },
    disabled,
    paintable: behavior === "toggle",
    lane,
    pressed,
    setPressed,
  };

  const store = group?.store;
  useIsomorphicLayoutEffect(() => store?.register(itemRef), [store]);
  useIsomorphicLayoutEffect(() => store?.scheduleFocusableUpdate(), [store, disabled]);

  // A press is handled on pointerdown; the click that follows the release must not toggle again.
  const pointerPress = useRef(false);
  const markPointerPress = () => {
    pointerPress.current = true;
    const clear = () => setTimeout(() => (pointerPress.current = false));
    window.addEventListener("pointerup", clear, { once: true, capture: true });
    window.addEventListener("pointercancel", clear, { once: true, capture: true });
  };

  /** Momentary and hybrid behaviour: returns the release handler. */
  const hold = (event: Event, timeStamp: number) => {
    const original = itemRef.current.pressed;
    const reason = event instanceof KeyboardEvent ? "keyboard" : "press";
    setPressed(behavior === "momentary" ? true : !original, { reason, event });
    return (release: Event) => {
      if (behavior === "momentary") setPressed(false, { reason: "release", event: release });
      else if (release.timeStamp - timeStamp >= holdDelay) setPressed(original, { reason: "release", event: release });
    };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (disabled) return;
    markPointerPress();
    if (event.button === 0) {
      // No text selection while painting; focus still moves to the toggle.
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
    }

    if (behavior === "toggle") {
      if (group) group.startPaint(itemRef, event);
      else if (event.button === 0) setPressed(!itemRef.current.pressed, { reason: "press", event: event.nativeEvent });
      return;
    }
    if (event.button !== 0) return;
    const release = hold(event.nativeEvent, event.timeStamp);
    const target = event.currentTarget;
    const pointerId = event.pointerId;
    try {
      target.setPointerCapture(pointerId);
    } catch {
      // The pointer may already be gone (e.g. a synthetic event).
    }
    const onEnd = (end: PointerEvent) => {
      if (end.pointerId !== pointerId) return;
      target.removeEventListener("pointerup", onEnd);
      target.removeEventListener("pointercancel", onEnd);
      target.removeEventListener("lostpointercapture", onEnd);
      release(end);
    };
    target.addEventListener("pointerup", onEnd);
    target.addEventListener("pointercancel", onEnd);
    target.addEventListener("lostpointercapture", onEnd);
  };

  const onClick = (event: ReactMouseEvent<HTMLElement>) => {
    // Keyboard presses and assistive technology arrive here without a pointerdown.
    if (pointerPress.current || disabled || behavior !== "toggle") return;
    if (group) group.press(itemRef, event.nativeEvent, "keyboard");
    else setPressed(!itemRef.current.pressed, { reason: "keyboard", event: event.nativeEvent });
  };

  const keyRelease = useRef<((event: Event) => void) | null>(null);
  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (behavior === "toggle" || disabled || (event.key !== " " && event.key !== "Enter")) return;
    event.preventDefault();
    if (event.repeat || keyRelease.current) return;
    keyRelease.current = hold(event.nativeEvent, event.timeStamp);
  };
  const onKeyUp = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== " " && event.key !== "Enter") return;
    const release = keyRelease.current;
    if (!release) return;
    event.preventDefault();
    keyRelease.current = null;
    release(event.nativeEvent);
  };

  const state: ToggleState = { pressed, disabled };
  return useRenderPart("button", state, { ...elementProps, ref }, {
    type: "button",
    "aria-pressed": pressed,
    "aria-disabled": disabled || undefined,
    tabIndex: group ? (focusable ? 0 : -1) : undefined,
    ...dataAttributes({ pressed, disabled }),
    onPointerDown,
    onClick,
    onKeyDown,
    onKeyUp,
    onFocus: () => store?.setActive(id),
  });
}

export namespace Toggle {
  export type State = ToggleState;
  export type Props = Omit<PartProps<"button", State>, "value"> & {
    pressed?: boolean | undefined;
    defaultPressed?: boolean | undefined;
    onPressedChange?: ((pressed: boolean, details: ToggleChangeDetails) => void) | undefined;
    /** Inside a `ToggleGroup`: take the state from the group's `value`. */
    value?: string | undefined;
    /**
     * `"toggle"` flips on press. `"momentary"` is on only while held.
     * `"hybrid"` flips on press, and flips back on release when held longer
     * than `holdDelay`, like the buttons of hardware controllers.
     */
    behavior?: ToggleBehavior | undefined;
    /** Milliseconds a hybrid toggle must be held to act as momentary. Defaults to 250. */
    holdDelay?: number | undefined;
    /**
     * Inside a `ToggleGroup`: toggles with the same lane form a line, such as
     * the mute buttons of a mixer's channels, or one row of a step sequencer.
     * A paint stroke and an exclusive press stay in the lane where they start;
     * arrow keys move along the lane and across lanes.
     */
    lane?: string | undefined;
    disabled?: boolean | undefined;
  };
}
