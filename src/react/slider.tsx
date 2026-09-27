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

import { numberFormat } from "../core/format.js";
import { createRange, type Range, type Scale, type ValueFormat } from "../core/index.js";
import { isRightToLeft, useRightToLeft } from "./direction.js";
import { onEveryFrame } from "./frame-loop.js";
import { writeLive, type Live } from "./live.js";
import { dataAttributes, focusFromPointer, unselectable, useMergedRef, useRenderPart, type PartProps } from "./render.js";
import { FINE, useIsomorphicLayoutEffect } from "./value-control.js";

type Orientation = "horizontal" | "vertical";

export type SliderChangeReason = "drag" | "keyboard" | "reset";

export type SliderChangeDetails = { reason: SliderChangeReason; event: Event; /** The index of the thumb that moved. */ thumb: number };

export type SliderState = { values: number[]; orientation: Orientation; dragging: boolean; disabled: boolean };

export type SliderThumbState = { index: number; value: number; orientation: Orientation; dragging: boolean; disabled: boolean };

/** The values and which thumb is dragged, outside React: the parts write what they show straight to the DOM. */
class SliderStore {
  dragging: number | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(public values: readonly number[]) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  set(values: readonly number[], dragging = this.dragging): void {
    if (values === this.values && dragging === this.dragging) return;
    this.values = values;
    this.dragging = dragging;
    for (const listener of this.listeners) listener();
  }
}

type SliderContextValue = {
  store: SliderStore;
  range: Range;
  format: ValueFormat;
  orientation: Orientation;
  disabled: boolean;
  /** The travel of `origin`, where a single thumb's range starts. */
  origin: number;
  trackElement: { current: HTMLElement | null };
  thumbs: Map<number, HTMLElement>;
  setLabelId: (id: string | undefined) => void;
  change: (index: number, value: number, reason: SliderChangeReason, event: Event) => void;
  endGesture: () => void;
  reset: (index: number, event: Event) => void;
  latest: () => readonly number[];
  holding: { current: boolean };
};

const SliderContext = createContext<SliderContextValue | null>(null);

function useSliderContext(part: string): SliderContextValue {
  const context = useContext(SliderContext);
  if (!context) throw new Error(`<Slider.${part}> must be placed inside <Slider.Root>.`);
  return context;
}

const sameValues = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
// Rounded, so that the CSS the browser serializes compares equal to what was written.
const percent = (travel: number) => `${Math.round(travel * 100_000) / 1000}%`;

/** Values in the range, each at least the one before it. */
function inOrder(range: Range, values: readonly number[]): number[] {
  const ordered: number[] = [];
  for (const value of values) ordered.push(Math.max(ordered.at(-1) ?? -Infinity, range.constrain(value)));
  return ordered;
}

/** How far thumb `index` may go: from the thumb before it to the thumb after it. */
const bounds = (range: Range, values: readonly number[], index: number): [number, number] => [values[index - 1] ?? range.min, values[index + 1] ?? range.max];

/**
 * One track with one or more thumbs whose values stay in order: the split
 * frequencies of a multiband processor, the start and end of a loop, the
 * lowest and highest velocity of a sampler's zone. `value` is the list of
 * them, on `min` … `max` with the `step` and `scale` of a knob's or fader's
 * range; a thumb stops at its neighbours. `Slider.Band` is a part between
 * two thumbs, such as a band of the multiband.
 *
 * For one value, a level, use `Fader`. As the values change, the parts
 * write what they show straight to the DOM, and nothing renders
 * (docs/principles.md, section 7). A `group`, named by `Slider.Label`; each
 * thumb is a `slider` of its own. Sets `--slider-value-0`, `--slider-value-1`
 * and so on, each thumb's travel in [0, 1], for styles that follow them.
 */
export function SliderRoot({
  value: controlledValue,
  defaultValue,
  resetValue,
  onValueChange,
  onGestureStart,
  onGestureEnd,
  read,
  min = 0,
  max = 1,
  step,
  scale,
  origin: originProp,
  format,
  orientation = "horizontal",
  disabled = false,
  ...props
}: SliderRoot.Props) {
  const range = useMemo(() => createRange({ min, max, step, scale }), [min, max, step, scale]);
  const controlled = controlledValue !== undefined;
  const [store] = useState(() => new SliderStore(inOrder(range, controlledValue ?? defaultValue ?? [range.min])));
  const values = controlled ? inOrder(range, controlledValue) : store.values;

  // The values as of the last change, so that events arriving before the parent renders build on them.
  const [latest] = useState<{ current: readonly number[] }>(() => ({ current: store.values }));
  useIsomorphicLayoutEffect(() => {
    if (!controlled || sameValues(values, latest.current)) return;
    latest.current = values;
    store.set(values);
  });

  const [callbacks] = useState<{ current: Pick<SliderRoot.Props, "onValueChange" | "onGestureStart" | "onGestureEnd"> }>(() => ({ current: {} }));
  callbacks.current = { onValueChange, onGestureStart, onGestureEnd };
  const [gesture] = useState({ current: false });
  const [holding] = useState({ current: false });
  const [trackElement] = useState<{ current: HTMLElement | null }>(() => ({ current: null }));
  const [thumbs] = useState(() => new Map<number, HTMLElement>());

  const change = useCallback(
    (index: number, value: number, reason: SliderChangeReason, event: Event) => {
      const current = latest.current;
      if (index < 0 || index >= current.length) return;
      const [low, high] = bounds(range, current, index);
      const next = clamp(range.constrain(value), low, high);
      if (Object.is(next, current[index])) return;
      if (!gesture.current) {
        gesture.current = true;
        callbacks.current.onGestureStart?.();
      }
      latest.current = current.map((one, at) => (at === index ? next : one));
      // Uncontrolled, the slider shows the values at once, without rendering; controlled, when the parent passes them back.
      if (!controlled) store.set(latest.current);
      callbacks.current.onValueChange?.([...latest.current], { reason, event, thumb: index });
    },
    [latest, range, gesture, callbacks, controlled, store],
  );
  const endGesture = useCallback(() => {
    if (!gesture.current) return;
    gesture.current = false;
    callbacks.current.onGestureEnd?.([...latest.current]);
  }, [gesture, callbacks, latest]);
  const reset = useCallback(
    (index: number, event: Event) => {
      const to = resetValue?.[index] ?? defaultValue?.[index];
      if (to === undefined) return;
      change(index, to, "reset", event);
      endGesture();
    },
    [change, endGesture, resetValue, defaultValue],
  );

  // Values that change on their own, as automation, are read once per frame, except while a thumb is held.
  const [readRef] = useState<{ current: SliderRoot.Props["read"] }>(() => ({ current: undefined }));
  readRef.current = read;
  const reads = read !== undefined;
  useEffect(() => {
    if (!reads) return;
    return onEveryFrame(() => {
      if (!readRef.current || holding.current || gesture.current) return;
      const next = inOrder(range, readRef.current());
      if (sameValues(next, store.values)) return;
      latest.current = next;
      store.set(next);
    });
  }, [reads, readRef, holding, gesture, range, latest, store]);

  const shownFormat = useMemo(() => format ?? numberFormat({ digits: step !== undefined && Number.isInteger(step) ? 0 : 2 }), [format, step]);
  const variables = useCallback(
    (): Live => ({ style: Object.fromEntries(store.values.map((value, index) => [`--slider-value-${index}`, String(range.normalize(value))])) }),
    [store, range],
  );
  const follow = useCallback(
    (element: HTMLElement | null) => {
      if (!element) return;
      const write = () => writeLive(element, { ...variables(), attributes: { "data-dragging": store.dragging !== null ? "" : null } });
      write();
      return store.subscribe(write);
    },
    [store, variables],
  );

  const [labelId, setLabelId] = useState<string | undefined>(undefined);
  const context: SliderContextValue = {
    store,
    range,
    format: shownFormat,
    orientation,
    disabled,
    origin: range.normalize(range.clamp(originProp ?? min)),
    trackElement,
    thumbs,
    setLabelId,
    change,
    endGesture,
    reset,
    latest: () => latest.current,
    holding,
  };
  const state: SliderState = { values: [...values], orientation, dragging: store.dragging !== null, disabled };
  const rendered = useRenderPart("div", state, props, {
    ref: follow,
    role: "group",
    "aria-labelledby": labelId,
    ...dataAttributes({ orientation, disabled, dragging: state.dragging }),
    style: variables().style as CSSProperties,
  });
  return <SliderContext.Provider value={context}>{rendered}</SliderContext.Provider>;
}

export namespace SliderRoot {
  export type State = SliderState;
  export type Props = Omit<PartProps<"div", State>, "defaultValue" | "onChange"> & {
    /** The thumbs' values, in order, when controlled. */
    value?: readonly number[] | undefined;
    /**
     * The thumbs' values at first, in order, when uncontrolled.
     * @default one thumb at `min`
     */
    defaultValue?: readonly number[] | undefined;
    /**
     * The values a double-click or Delete returns each thumb to, as far as its neighbours let it.
     * @default `defaultValue`
     */
    resetValue?: readonly number[] | undefined;
    /** Called with every thumb's value when a drag, a key or a reset moves one; `details.thumb` says which. */
    onValueChange?: ((values: number[], details: SliderChangeDetails) => void) | undefined;
    /** Called before the first change of a gesture. */
    onGestureStart?: (() => void) | undefined;
    /** Called when a gesture ends, with the values it left: one undo step. */
    onGestureEnd?: ((values: number[]) => void) | undefined;
    /** Returns the values when they change on their own, as automation; called once per animation frame. */
    read?: (() => readonly number[]) | undefined;
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
    /** Values snap to `min + k * step`; arrow keys move one step. */
    step?: number | undefined;
    /**
     * How travel maps to value, as a knob's: `scales.log` for frequencies.
     * @default scales.linear
     */
    scale?: Scale | undefined;
    /**
     * Where `Slider.Range` starts when there is one thumb.
     * @default min
     */
    origin?: number | undefined;
    /**
     * Text of a value, for `Slider.Value` and what the thumbs announce.
     * @default formats.number({ digits: 2 }), without decimals when `step` is whole
     */
    format?: ValueFormat | undefined;
    /**
     * The direction of travel: left to right along the reading direction, or bottom to top.
     * @default "horizontal"
     */
    orientation?: Orientation | undefined;
    /**
     * Ignores input, and takes the thumbs out of the tab order.
     * @default false
     */
    disabled?: boolean | undefined;
  };
}

const rootState = (context: SliderContextValue): SliderState => ({
  values: [...context.store.values],
  orientation: context.orientation,
  dragging: context.store.dragging !== null,
  disabled: context.disabled,
});

/** Names the slider for assistive technology. */
export function SliderLabel(props: SliderLabel.Props) {
  const context = useSliderContext("Label");
  const generated = useId();
  const id = props.id ?? generated;
  const { setLabelId } = context;
  useIsomorphicLayoutEffect(() => {
    setLabelId(id);
    return () => setLabelId(undefined);
  }, [id, setLabelId]);
  return useRenderPart("span", rootState(context), props, { id, style: unselectable });
}

export namespace SliderLabel {
  export type State = SliderState;
  export type Props = PartProps<"span", State>;
}

/** A pointer's travel along the track, 0 … 1 from its start. */
function travelAt(context: SliderContextValue, track: HTMLElement, clientX: number, clientY: number): number {
  const box = track.getBoundingClientRect();
  if (context.orientation === "vertical") return clamp(1 - (clientY - box.top) / (box.height || 1), 0, 1);
  const across = clamp((clientX - box.left) / (box.width || 1), 0, 1);
  return isRightToLeft(track) ? 1 - across : across;
}

/**
 * Follows a drag of thumb `index` from this press: a move of the pointer
 * moves it as far along the track (Shift: a tenth as far), up to its
 * neighbours. When the thumb shares its value with a neighbour, the first
 * move takes whichever of them can go that way. One gesture.
 */
function dragThumb(context: SliderContextValue, pressed: number, event: ReactPointerEvent<HTMLElement>, jumpTo?: number) {
  const track = context.trackElement.current;
  if (context.disabled || event.button !== 0 || !track) return;
  const element = event.currentTarget;
  event.preventDefault();
  const { range, orientation } = context;
  const box = track.getBoundingClientRect();
  const length = (orientation === "vertical" ? box.height : box.width) || 1;
  const towardsStart = orientation === "horizontal" && isRightToLeft(track) ? -1 : 1;
  if (jumpTo !== undefined) context.change(pressed, range.denormalize(jumpTo), "drag", event.nativeEvent);

  let index: number | null = null;
  let position = range.normalize(context.latest()[pressed] ?? range.min);
  let last = { x: event.clientX, y: event.clientY };
  context.holding.current = true;
  context.store.set(context.store.values, pressed);
  try {
    element.setPointerCapture(event.pointerId);
  } catch {
    // The pointer may already be gone (a synthetic event).
  }
  const pointerId = event.pointerId;
  const move = (moved: PointerEvent) => {
    if (moved.pointerId !== pointerId) return;
    const pixels = orientation === "vertical" ? -(moved.clientY - last.y) : (moved.clientX - last.x) * towardsStart;
    last = { x: moved.clientX, y: moved.clientY };
    if (pixels === 0) return;
    const values = context.latest();
    if (index === null) {
      // Among thumbs at the same value, the last one goes up, the first one down.
      index = pressed;
      while (pixels > 0 && values[index + 1] === values[index]) index++;
      while (pixels < 0 && values[index - 1] === values[index]) index--;
      if (index !== pressed) {
        context.store.set(context.store.values, index);
        focusFromPointer(context.thumbs.get(index));
      }
    }
    const [low, high] = bounds(range, values, index);
    // Clamped at the neighbours, so that moving back responds at once.
    position = clamp(position + (pixels / length) * (moved.shiftKey ? FINE : 1), range.normalize(low), range.normalize(high));
    context.change(index, range.denormalize(position), "drag", moved);
  };
  const end = (ended: PointerEvent) => {
    if (ended.pointerId !== pointerId) return;
    element.removeEventListener("pointermove", move);
    element.removeEventListener("pointerup", end);
    element.removeEventListener("pointercancel", end);
    element.removeEventListener("lostpointercapture", end);
    context.holding.current = false;
    context.store.set(context.store.values, null);
    context.endGesture();
  };
  element.addEventListener("pointermove", move);
  element.addEventListener("pointerup", end);
  element.addEventListener("pointercancel", end);
  element.addEventListener("lostpointercapture", end);
}

/**
 * The area that takes presses: a press away from the thumbs brings the
 * nearest thumb to the pointer, and a drag goes on from there.
 */
export function SliderControl(props: SliderControl.Props) {
  const context = useSliderContext("Control");
  return useRenderPart("div", rootState(context), props, {
    ...dataAttributes({ orientation: context.orientation, disabled: context.disabled }),
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      if (event.target instanceof Element && event.target.closest("[data-slider-thumb]")) return;
      const track = context.trackElement.current;
      if (!track || context.disabled) return;
      const travel = travelAt(context, track, event.clientX, event.clientY);
      const values = context.latest();
      // The nearest thumb; of thumbs at the same place, the one that can go towards the pointer.
      let nearest = 0;
      let distance = Infinity;
      values.forEach((value, index) => {
        const d = Math.abs(context.range.normalize(value) - travel);
        if (d < distance || (d === distance && travel > context.range.normalize(value))) [nearest, distance] = [index, d];
      });
      dragThumb(context, nearest, event, travel);
      focusFromPointer(context.thumbs.get(nearest));
    },
    style: { touchAction: "none" },
  });
}

export namespace SliderControl {
  export type State = SliderState;
  export type Props = PartProps<"div", State>;
}

/** The line the thumbs travel along: `Range` and the thumbs are placed in it, and its length is the full travel of a drag. */
export function SliderTrack(props: SliderTrack.Props) {
  const context = useSliderContext("Track");
  const register = useCallback(
    (element: HTMLElement | null) => {
      context.trackElement.current = element;
    },
    [context.trackElement],
  );
  return useRenderPart("div", rootState(context), props, {
    ref: register,
    ...dataAttributes({ orientation: context.orientation, disabled: context.disabled }),
    style: { position: "relative" },
  });
}

export namespace SliderTrack {
  export type State = SliderState;
  export type Props = PartProps<"div", State>;
}

/** Where a part lies along the track, from `from` to `to` in travel: its start and length. */
function span(orientation: Orientation, from: number, to: number): Record<string, string> {
  const start = percent(Math.min(from, to));
  const length = percent(Math.abs(to - from));
  return orientation === "vertical" ? { bottom: start, height: length } : { "inset-inline-start": start, width: length };
}

const reactStyle = (style: Record<string, string>): CSSProperties =>
  Object.fromEntries(
    Object.entries(style).map(([name, value]) => [name.startsWith("--") ? name : name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase()), value]),
  );

/** A part placed along the track by the values, rewritten without rendering as they change. */
function usePlaced(context: SliderContextValue, place: (travels: number[]) => Record<string, string>) {
  const { store, range } = context;
  const describe = useCallback(() => place(store.values.map((value) => range.normalize(value))), [store, range, place]);
  const follow = useCallback(
    (element: HTMLElement | null) => {
      if (!element) return;
      const write = () => writeLive(element, { style: describe() });
      write();
      return store.subscribe(write);
    },
    [store, describe],
  );
  return { ref: follow, style: reactStyle(describe()) };
}

/**
 * A thumb, for the value at `index`: a `slider` named with `aria-label`,
 * whose minimum and maximum are its neighbours. Arrow keys move it (Left
 * and Right along the reading direction), Shift finer; Page Up and Page
 * Down by a tenth; Home and End as far as its neighbours let it; Delete,
 * Backspace or a double-click reset it. Centred on its value; sets
 * `--slider-value` (its travel) and `data-dragging` while dragged.
 */
export function SliderThumb({ index, ...props }: SliderThumb.Props) {
  const context = useSliderContext("Thumb");
  const { store, range, format, orientation, disabled, thumbs } = context;
  const [rightToLeft, directionRef] = useRightToLeft();
  const describe = useCallback((): Live => {
    const values = store.values;
    const value = values[index] ?? range.min;
    const [low, high] = bounds(range, values, index);
    const travel = range.normalize(value);
    return {
      attributes: {
        "aria-valuenow": Number.isFinite(value) ? value : null,
        "aria-valuetext": format.format(value),
        "aria-valuemin": Number.isFinite(low) ? low : null,
        "aria-valuemax": Number.isFinite(high) ? high : null,
        "data-dragging": store.dragging === index ? "" : null,
      },
      style: { [orientation === "vertical" ? "bottom" : "inset-inline-start"]: percent(travel), "--slider-value": String(travel) },
    };
  }, [store, range, format, orientation, index]);
  const follow = useCallback(
    (element: HTMLElement | null) => {
      if (!element) return;
      thumbs.set(index, element);
      const write = () => writeLive(element, describe());
      write();
      const stop = store.subscribe(write);
      return () => {
        stop();
        if (thumbs.get(index) === element) thumbs.delete(index);
      };
    },
    [thumbs, index, store, describe],
  );
  const ref = useMergedRef(follow, directionRef);
  const shown = describe();
  const value = store.values[index] ?? range.min;

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (disabled) return;
    const values = context.latest();
    const current = values[index];
    if (current === undefined) return;
    const position = range.normalize(current);
    const small = event.shiftKey ? 0.001 : 0.01;
    const by = (direction: number, amount = small) =>
      range.step !== undefined && amount === small ? current + direction * range.step : range.denormalize(position + direction * amount);
    const flip = orientation === "horizontal" && isRightToLeft(event.currentTarget) ? -1 : 1;
    const [low, high] = bounds(range, values, index);
    let next: number;
    switch (event.key) {
      case "ArrowUp":
      case "ArrowDown":
        next = by(event.key === "ArrowUp" ? 1 : -1);
        break;
      case "ArrowRight":
      case "ArrowLeft":
        next = by((event.key === "ArrowRight" ? 1 : -1) * flip);
        break;
      case "PageUp":
      case "PageDown":
        next = by(event.key === "PageUp" ? 1 : -1, 0.1);
        break;
      case "Home":
        next = low;
        break;
      case "End":
        next = high;
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

  const state: SliderThumbState = { index, value, orientation, dragging: store.dragging === index, disabled };
  const centred: CSSProperties =
    orientation === "vertical" ? { translate: "0 50%" } : { translate: `${rightToLeft ? "50%" : "-50%"} 0` };
  return useRenderPart("div", state, props, {
    ref,
    role: "slider",
    tabIndex: disabled ? -1 : 0,
    "aria-orientation": orientation,
    "aria-valuemin": shown.attributes?.["aria-valuemin"] ?? undefined,
    "aria-valuemax": shown.attributes?.["aria-valuemax"] ?? undefined,
    "aria-valuenow": shown.attributes?.["aria-valuenow"] ?? undefined,
    "aria-valuetext": shown.attributes?.["aria-valuetext"],
    "aria-disabled": disabled || undefined,
    "data-slider-thumb": "",
    ...dataAttributes({ orientation, disabled, dragging: state.dragging }),
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      focusFromPointer(event.currentTarget);
      dragThumb(context, index, event);
    },
    onKeyDown,
    onDoubleClick: (event: ReactMouseEvent<HTMLElement>) => {
      if (!disabled) context.reset(index, event.nativeEvent);
    },
    style: { position: "absolute", touchAction: "none", ...centred, ...reactStyle(shown.style ?? {}) },
  });
}

export namespace SliderThumb {
  export type State = SliderThumbState;
  export type Props = PartProps<"div", State> & {
    /** Which value of the root's it moves. */
    index: number;
  };
}

/**
 * The filled part of the track: from the first thumb to the last, or with
 * one thumb, from `origin` to its value. Place it in `Slider.Track`.
 */
export function SliderRange(props: SliderRange.Props) {
  const context = useSliderContext("Range");
  const { orientation, origin } = context;
  const place = useCallback(
    (travels: number[]) => span(orientation, travels.length > 1 ? travels[0]! : origin, travels.at(-1) ?? origin),
    [orientation, origin],
  );
  const placed = usePlaced(context, place);
  return useRenderPart("div", rootState(context), props, {
    ref: placed.ref,
    ...dataAttributes({ orientation, disabled: context.disabled }),
    style: { position: "absolute", ...placed.style },
  });
}

export namespace SliderRange {
  export type State = SliderState;
  export type Props = PartProps<"div", State>;
}

/**
 * A part between two thumbs, such as a band of a multiband processor:
 * `index` 0 from the start to the first thumb, `index` i from thumb i − 1
 * to thumb i, and the last from the last thumb to the end. Placed along
 * whatever holds it, in percent: in `Slider.Track`, or over a graph as wide
 * as the track, where its edges mark the thumbs' values. Its extent across
 * is yours.
 */
export function SliderBand({ index, ...props }: SliderBand.Props) {
  const context = useSliderContext("Band");
  const { orientation } = context;
  const place = useCallback(
    (travels: number[]) => span(orientation, index === 0 ? 0 : (travels[index - 1] ?? 1), travels[index] ?? 1),
    [orientation, index],
  );
  const placed = usePlaced(context, place);
  return useRenderPart("div", { ...rootState(context), index }, props, {
    ref: placed.ref,
    ...dataAttributes({ orientation, disabled: context.disabled }),
    style: { position: "absolute", ...placed.style },
  });
}

export namespace SliderBand {
  export type State = SliderState & { index: number };
  export type Props = PartProps<"div", State> & {
    /** Which part: 0 before the first thumb, the number of thumbs after the last. */
    index: number;
  };
}

/** The text of a thumb's value. Place it in the thumb to have it follow. */
export function SliderValue({ index = 0, ...props }: SliderValue.Props) {
  const context = useSliderContext("Value");
  const { store, format } = context;
  const text = useCallback(() => {
    const value = store.values[index];
    return value === undefined ? "" : format.format(value);
  }, [store, format, index]);
  const follow = useCallback(
    (element: HTMLElement | null) => {
      if (!element) return;
      const write = () => {
        const next = text();
        if (element.textContent !== next) element.textContent = next;
      };
      write();
      return store.subscribe(write);
    },
    [store, text],
  );
  return useRenderPart("output", rootState(context), props, { ref: follow, dir: "auto", children: text(), style: unselectable });
}

export namespace SliderValue {
  export type State = SliderState;
  export type Props = Omit<PartProps<"output", State>, "children"> & {
    /**
     * Which thumb's value.
     * @default 0
     */
    index?: number | undefined;
  };
}
