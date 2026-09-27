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
import { isRightToLeft } from "./direction.js";
import { onEveryFrame } from "./frame-loop.js";
import { writeLive, type Live } from "./live.js";
import { dataAttributes, focusFromPointer, unselectable, useRenderPart, type PartProps } from "./render.js";
import { FINE, useIsomorphicLayoutEffect } from "./value-control.js";

export type BarGraphChangeReason = "paint" | "drag" | "keyboard" | "reset";

export type BarGraphChangeDetails = {
  reason: BarGraphChangeReason;
  event: Event;
  /** The indexes of the values that changed. */
  indexes: number[];
};

export type BarGraphState = { values: number[]; painting: boolean; disabled: boolean };

export type BarGraphItemState = { index: number; value: number; disabled: boolean };

/** The values, which item is in the tab order, which one was last focused or changed, and whether a stroke is under way, outside React. */
class BarGraphStore {
  painting = false;
  focusable = 0;
  active = 0;
  private readonly listeners = new Set<() => void>();

  constructor(public values: readonly number[]) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private notify() {
    for (const listener of this.listeners) listener();
  }

  set(values: readonly number[], painting = this.painting): void {
    if (values === this.values && painting === this.painting) return;
    this.values = values;
    this.painting = painting;
    this.notify();
  }

  focus(index: number): void {
    if (index === this.focusable && index === this.active) return;
    this.focusable = index;
    this.active = index;
    this.notify();
  }

  activate(index: number): void {
    if (index === this.active) return;
    this.active = index;
    this.notify();
  }
}

type BarGraphContextValue = {
  store: BarGraphStore;
  range: Range;
  /** The travel the values are drawn from. */
  origin: number;
  format: ValueFormat;
  disabled: boolean;
  count: number;
  items: Map<number, HTMLElement>;
  setLabelId: (id: string | undefined) => void;
  apply: (updates: readonly (readonly [index: number, value: number])[], reason: BarGraphChangeReason, event: Event) => void;
  endGesture: () => void;
  reset: (index: number, event: Event) => void;
  latest: () => readonly number[];
  holding: { current: boolean };
};

const BarGraphContext = createContext<BarGraphContextValue | null>(null);

function useBarGraphContext(part: string): BarGraphContextValue {
  const context = useContext(BarGraphContext);
  if (!context) throw new Error(`<BarGraph.${part}> must be placed inside <BarGraph.Root>.`);
  return context;
}

const sameValues = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
const clampTravel = (travel: number) => Math.min(1, Math.max(0, travel));
// Rounded, so that the CSS the browser serializes compares equal to what was written.
const percent = (travel: number) => `${Math.round(travel * 100_000) / 1000}%`;
const wholeNumber = numberFormat({ digits: 0 });

/**
 * A row of values on one range, drawn as bars and painted by dragging
 * across them: the velocities under a piano roll or of a sequencer's steps,
 * the steps of an arpeggiator, the harmonics of an additive synthesizer.
 * `value` is the list of them, each on `min` … `max` with the `step` and
 * `scale` of a knob's or fader's range.
 *
 * A stroke sets every value the pointer crosses to where the pointer is,
 * and nothing renders as it goes: the items write what they show straight
 * to the DOM (docs/principles.md, section 7). A `group`, named by
 * `BarGraph.Label`; each value is a `slider` of its own, in one tab stop.
 */
export function BarGraphRoot({
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
  disabled = false,
  ...props
}: BarGraphRoot.Props) {
  const range = useMemo(() => createRange({ min, max, step, scale }), [min, max, step, scale]);
  const originValue = range.clamp(originProp ?? min);
  const controlled = controlledValue !== undefined;
  const [store] = useState(() => new BarGraphStore((controlledValue ?? defaultValue ?? []).map((one) => range.constrain(one))));
  const values = controlled ? controlledValue.map((one) => range.clamp(one)) : store.values;

  // The values as of the last change, so that events arriving before the parent renders build on them.
  const [latest] = useState<{ current: readonly number[] }>(() => ({ current: store.values }));
  useIsomorphicLayoutEffect(() => {
    if (!controlled || sameValues(values, latest.current)) return;
    latest.current = values;
    store.set(values);
  });

  const [callbacks] = useState<{ current: Pick<BarGraphRoot.Props, "onValueChange" | "onGestureStart" | "onGestureEnd"> }>(() => ({ current: {} }));
  callbacks.current = { onValueChange, onGestureStart, onGestureEnd };
  const [gesture] = useState({ current: false });
  const [holding] = useState({ current: false });
  const [items] = useState(() => new Map<number, HTMLElement>());

  const apply = useCallback(
    (updates: readonly (readonly [number, number])[], reason: BarGraphChangeReason, event: Event) => {
      const next = [...latest.current];
      const indexes: number[] = [];
      for (const [index, value] of updates) {
        if (index < 0 || index >= next.length) continue;
        const constrained = range.constrain(value);
        if (Object.is(constrained, next[index])) continue;
        next[index] = constrained;
        indexes.push(index);
      }
      if (indexes.length === 0) return;
      if (!gesture.current) {
        gesture.current = true;
        callbacks.current.onGestureStart?.();
      }
      latest.current = next;
      // Uncontrolled, the items show the values at once, without rendering; controlled, when the parent passes them back.
      if (!controlled) store.set(next);
      store.activate(indexes.at(-1)!);
      callbacks.current.onValueChange?.([...next], { reason, event, indexes });
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
      apply([[index, resetValue ?? defaultValue?.[index] ?? originValue]], "reset", event);
      endGesture();
    },
    [apply, endGesture, resetValue, defaultValue, originValue],
  );

  // Values that change on their own are read once per frame, except during a stroke.
  const [readRef] = useState<{ current: BarGraphRoot.Props["read"] }>(() => ({ current: undefined }));
  readRef.current = read;
  const reads = read !== undefined;
  useEffect(() => {
    if (!reads) return;
    return onEveryFrame(() => {
      if (!readRef.current || holding.current || gesture.current) return;
      const next = readRef.current().map((one) => range.constrain(one));
      if (sameValues(next, store.values)) return;
      latest.current = next;
      store.set(next);
    });
  }, [reads, readRef, holding, gesture, range, latest, store]);

  const [labelId, setLabelId] = useState<string | undefined>(undefined);
  const shownFormat = useMemo(() => format ?? numberFormat({ digits: step !== undefined && Number.isInteger(step) ? 0 : 2 }), [format, step]);
  const context: BarGraphContextValue = {
    store,
    range,
    origin: range.normalize(originValue),
    format: shownFormat,
    disabled,
    count: values.length,
    items,
    setLabelId,
    apply,
    endGesture,
    reset,
    latest: () => latest.current,
    holding,
  };
  const state: BarGraphState = { values: [...values], painting: store.painting, disabled };
  const rendered = useRenderPart("div", state, props, {
    role: "group",
    "aria-labelledby": labelId,
    ...dataAttributes({ disabled }),
  });
  return <BarGraphContext.Provider value={context}>{rendered}</BarGraphContext.Provider>;
}

export namespace BarGraphRoot {
  export type State = BarGraphState;
  export type Props = Omit<PartProps<"div", State>, "defaultValue" | "onChange"> & {
    /** The values, when controlled: one per item. */
    value?: readonly number[] | undefined;
    /** The values at first, when uncontrolled: one per item. */
    defaultValue?: readonly number[] | undefined;
    /**
     * Where a double-click or Delete returns a value.
     * @default its `defaultValue`, then `origin`
     */
    resetValue?: number | undefined;
    /** Called with every value when a stroke, a drag, a key or a reset changes some; `details.indexes` says which. */
    onValueChange?: ((values: number[], details: BarGraphChangeDetails) => void) | undefined;
    /** Called before the first change of a gesture: a stroke, a drag, a key, a reset. */
    onGestureStart?: (() => void) | undefined;
    /** Called when a gesture ends, with the values it left: one undo step. */
    onGestureEnd?: ((values: number[]) => void) | undefined;
    /** Returns the values when they change on their own; called once per animation frame. */
    read?: (() => readonly number[]) | undefined;
    /**
     * The lowest value, at the bottom.
     * @default 0
     */
    min?: number | undefined;
    /**
     * The highest value, at the top.
     * @default 1
     */
    max?: number | undefined;
    /** Values snap to `min + k * step`; arrow keys move one step. */
    step?: number | undefined;
    /**
     * How travel maps to value, as a knob's.
     * @default scales.linear
     */
    scale?: Scale | undefined;
    /**
     * Where the bars are drawn from: `origin={0}` on −1 … 1 draws them up or down from the middle.
     * @default min
     */
    origin?: number | undefined;
    /**
     * Text of a value, for `BarGraph.Value` and what the items announce.
     * @default formats.number({ digits: 2 }), without decimals when `step` is whole
     */
    format?: ValueFormat | undefined;
    /**
     * Ignores input, and takes the items out of the tab order.
     * @default false
     */
    disabled?: boolean | undefined;
  };
}

const rootState = (context: BarGraphContextValue): BarGraphState => ({
  values: [...context.store.values],
  painting: context.store.painting,
  disabled: context.disabled,
});

/** Names the bar graph for assistive technology. */
export function BarGraphLabel(props: BarGraphLabel.Props) {
  const context = useBarGraphContext("Label");
  const generated = useId();
  const id = props.id ?? generated;
  const { setLabelId } = context;
  useIsomorphicLayoutEffect(() => {
    setLabelId(id);
    return () => setLabelId(undefined);
  }, [id, setLabelId]);
  return useRenderPart("span", rootState(context), props, { id, style: unselectable });
}

export namespace BarGraphLabel {
  export type State = BarGraphState;
  export type Props = PartProps<"span", State>;
}

/**
 * Paints from a press on the control: every item the pointer's path
 * crosses takes the value where the path crosses it, so that a fast stroke
 * skips none, and items at the same place, the notes of a chord, all take
 * it. With Shift, the pressed item alone moves by a tenth of the pointer's
 * travel. One gesture.
 */
function paint(context: BarGraphContextValue, event: ReactPointerEvent<HTMLElement>) {
  if (context.disabled || event.button !== 0) return;
  const control = event.currentTarget;
  event.preventDefault();
  // Layout is read once per stroke, not on every move.
  const box = control.getBoundingClientRect();
  const items = [...context.items].map(([index, element]) => {
    const { left, right } = element.getBoundingClientRect();
    return { index, left, right, center: (left + right) / 2 };
  });
  const { range } = context;
  const valueAt = (y: number) => range.denormalize(clampTravel(1 - (y - box.top) / (box.height || 1)));
  const under = (x: number) => items.filter((item) => x >= item.left && x <= item.right);
  const nearest = under(event.clientX).sort((a, b) => Math.abs(a.center - event.clientX) - Math.abs(b.center - event.clientX))[0];
  if (nearest) focusFromPointer(context.items.get(nearest.index));

  let last = { x: event.clientX, y: event.clientY };
  const fine = event.shiftKey ? nearest : undefined;
  let travel = fine ? range.normalize(context.latest()[fine.index]!) : 0;
  if (!fine) context.apply(under(last.x).map((item) => [item.index, valueAt(last.y)] as const), "paint", event.nativeEvent);

  context.holding.current = true;
  context.store.set(context.store.values, true);
  try {
    control.setPointerCapture(event.pointerId);
  } catch {
    // The pointer may already be gone (a synthetic event).
  }
  const pointerId = event.pointerId;
  const move = (moved: PointerEvent) => {
    if (moved.pointerId !== pointerId) return;
    const point = { x: moved.clientX, y: moved.clientY };
    if (fine) {
      travel = clampTravel(travel - ((point.y - last.y) / (box.height || 1)) * FINE);
      context.apply([[fine.index, range.denormalize(travel)]], "drag", moved);
    } else {
      const from = Math.min(last.x, point.x);
      const to = Math.max(last.x, point.x);
      const start = last;
      const crossed = items.filter((item) => item.right >= from && item.left <= to);
      context.apply(
        crossed.map((item) => {
          // Where the path crosses the item's middle, or reaches the item when it ends inside it.
          const x = Math.min(to, Math.max(from, item.center));
          const along = point.x === start.x ? 1 : (x - start.x) / (point.x - start.x);
          return [item.index, valueAt(start.y + along * (point.y - start.y))] as const;
        }),
        "paint",
        moved,
      );
    }
    last = point;
  };
  const end = (ended: PointerEvent) => {
    if (ended.pointerId !== pointerId) return;
    control.removeEventListener("pointermove", move);
    control.removeEventListener("pointerup", end);
    control.removeEventListener("pointercancel", end);
    control.removeEventListener("lostpointercapture", end);
    context.holding.current = false;
    context.store.set(context.store.values, false);
    context.endGesture();
  };
  control.addEventListener("pointermove", move);
  control.addEventListener("pointerup", end);
  control.addEventListener("pointercancel", end);
  control.addEventListener("lostpointercapture", end);
}

/**
 * The area the items lie on and strokes paint: size it with CSS. Its
 * height is the range, `min` at the bottom and `max` at the top. Sets
 * `data-painting` during a stroke, without rendering.
 */
export function BarGraphControl(props: BarGraphControl.Props) {
  const context = useBarGraphContext("Control");
  const { store } = context;
  const follow = useCallback(
    (element: HTMLElement | null) => {
      if (!element) return;
      const write = () => writeLive(element, { attributes: { "data-painting": store.painting ? "" : null } });
      write();
      return store.subscribe(write);
    },
    [store],
  );
  return useRenderPart("div", rootState(context), props, {
    ref: follow,
    ...dataAttributes({ disabled: context.disabled, painting: store.painting }),
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => paint(context, event),
    style: { position: "relative", touchAction: "none" },
  });
}

export namespace BarGraphControl {
  export type State = BarGraphState;
  export type Props = PartProps<"div", State>;
}

const ItemContext = createContext<number | null>(null);

/**
 * The value at `index`: a `slider`, named by its number unless it has an
 * `aria-label`, placed as a column of the control, side by side with the
 * others along the reading direction. Up and Down change it, Shift finer,
 * Page Up and Page Down by a tenth, Home and End to the ends; Left and
 * Right move to the next item, and with Shift give it this item's value;
 * Delete, Backspace or a double-click reset it. Sets
 * `--bar-graph-value` (travel in [0, 1]), rewritten without rendering.
 * Placed elsewhere with `style`, as under the notes of a piano roll,
 * strokes still find it.
 */
export function BarGraphItem({ index, ...props }: BarGraphItem.Props) {
  const context = useBarGraphContext("Item");
  const { store, range, format, disabled, count, items } = context;
  const describe = useCallback((): Live => {
    const value = store.values[index] ?? range.min;
    return {
      attributes: {
        "aria-valuenow": Number.isFinite(value) ? value : null,
        "aria-valuetext": format.format(value),
        tabindex: !disabled && store.focusable === index ? 0 : -1,
      },
      style: { "--bar-graph-value": String(range.normalize(value)) },
    };
  }, [store, index, range, format, disabled]);
  const follow = useCallback(
    (element: HTMLElement | null) => {
      if (!element) return;
      items.set(index, element);
      // Written when what this item shows changes, not on every change of the others.
      let shown = "";
      const write = () => {
        const live = describe();
        const key = JSON.stringify(live);
        if (key === shown) return;
        shown = key;
        writeLive(element, live);
      };
      write();
      const stop = store.subscribe(write);
      return () => {
        stop();
        if (items.get(index) === element) items.delete(index);
      };
    },
    [items, index, store, describe],
  );
  const value = store.values[index] ?? range.min;
  const shown = describe();

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (disabled) return;
    const current = context.latest()[index];
    if (current === undefined) return;
    const position = range.normalize(current);
    const small = event.shiftKey ? 0.001 : 0.01;
    const by = (direction: number, amount = small) =>
      range.step !== undefined && amount === small ? current + direction * range.step : range.denormalize(position + direction * amount);
    let next: number;
    switch (event.key) {
      case "ArrowUp":
      case "ArrowDown":
        next = by(event.key === "ArrowUp" ? 1 : -1);
        break;
      case "PageUp":
      case "PageDown":
        next = by(event.key === "PageUp" ? 1 : -1, 0.1);
        break;
      case "Home":
        next = range.min;
        break;
      case "End":
        next = range.max;
        break;
      case "ArrowLeft":
      case "ArrowRight": {
        event.preventDefault();
        // Along the reading direction.
        const target = index + (event.key === "ArrowRight" ? 1 : -1) * (isRightToLeft(event.currentTarget) ? -1 : 1);
        if (target < 0 || target >= context.latest().length) return;
        // Shift paints: the next item takes this one's value.
        if (event.shiftKey) {
          context.apply([[target, current]], "paint", event.nativeEvent);
          context.endGesture();
        }
        items.get(target)?.focus();
        return;
      }
      case "Delete":
      case "Backspace":
        event.preventDefault();
        context.reset(index, event.nativeEvent);
        return;
      default:
        return;
    }
    event.preventDefault();
    context.apply([[index, next]], "keyboard", event.nativeEvent);
    context.endGesture();
  };

  const state: BarGraphItemState = { index, value, disabled };
  const rendered = useRenderPart("div", state, props, {
    ref: follow,
    role: "slider",
    tabIndex: shown.attributes?.tabindex as number,
    "aria-label": wholeNumber.format(index + 1),
    "aria-orientation": "vertical",
    "aria-valuemin": Number.isFinite(range.min) ? range.min : undefined,
    "aria-valuemax": Number.isFinite(range.max) ? range.max : undefined,
    "aria-valuenow": shown.attributes?.["aria-valuenow"] ?? undefined,
    "aria-valuetext": shown.attributes?.["aria-valuetext"],
    "aria-disabled": disabled || undefined,
    ...dataAttributes({ disabled }),
    onKeyDown,
    onFocus: () => store.focus(index),
    onDoubleClick: (event: ReactMouseEvent<HTMLElement>) => {
      if (!disabled) context.reset(index, event.nativeEvent);
    },
    style: {
      position: "absolute",
      insetBlock: 0,
      insetInlineStart: percent(index / (count || 1)),
      width: percent(1 / (count || 1)),
      "--bar-graph-value": shown.style?.["--bar-graph-value"],
    } as CSSProperties,
  });
  return <ItemContext.Provider value={index}>{rendered}</ItemContext.Provider>;
}

export namespace BarGraphItem {
  export type State = BarGraphItemState;
  export type Props = PartProps<"div", State> & {
    /** Which value of the root's it shows and changes. */
    index: number;
  };
}

/**
 * The bar of an item, from `origin` to its value: place it in a
 * `BarGraph.Item`, and give it a width with CSS. Its `bottom` and
 * `height` are rewritten without rendering.
 */
export function BarGraphRange(props: BarGraphRange.Props) {
  const context = useBarGraphContext("Range");
  const index = useContext(ItemContext);
  if (index === null) throw new Error("<BarGraph.Range> must be placed inside <BarGraph.Item>.");
  const { store, range, origin } = context;
  const describe = useCallback((): Live => {
    const travel = range.normalize(store.values[index] ?? range.min);
    return { style: { bottom: percent(Math.min(origin, travel)), height: percent(Math.abs(travel - origin)) } };
  }, [store, range, origin, index]);
  const follow = useCallback(
    (element: HTMLElement | null) => {
      if (!element) return;
      const write = () => writeLive(element, describe());
      write();
      return store.subscribe(write);
    },
    [store, describe],
  );
  const shown = describe().style!;
  return useRenderPart("div", rootState(context), props, {
    ref: follow,
    style: { position: "absolute", bottom: shown.bottom, height: shown.height },
  });
}

export namespace BarGraphRange {
  export type State = BarGraphState;
  export type Props = PartProps<"div", State>;
}

/** The text of the value at `index`, or of the item last focused or changed. */
export function BarGraphValue({ index, ...props }: BarGraphValue.Props) {
  const context = useBarGraphContext("Value");
  const { store, format } = context;
  const text = useCallback(() => {
    const value = store.values[index ?? store.active];
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

export namespace BarGraphValue {
  export type State = BarGraphState;
  export type Props = Omit<PartProps<"output", State>, "children"> & {
    /**
     * Which value.
     * @default the item last focused or changed
     */
    index?: number | undefined;
  };
}
