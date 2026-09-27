"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { numberFormat } from "../core/format.js";
import type { ValueFormat } from "../core/index.js";
import { isRightToLeft } from "./direction.js";
import { onEveryFrame } from "./frame-loop.js";
import { writeLive } from "./live.js";
import { dataAttributes, unselectable, useRenderPart, type PartProps } from "./render.js";
import { useIsomorphicLayoutEffect } from "./value-control.js";

export type KeysReason = "pointer" | "keyboard";

export type KeysPressDetails = {
  reason: KeysReason;
  event: Event;
  /** How hard the key was pressed, from 0 to 1. */
  velocity: number;
};

export type KeysReleaseDetails = { reason: KeysReason; event: Event };

type Orientation = "horizontal" | "vertical";
type Layout = "piano" | "rows";

export type KeysState = { orientation: Orientation; layout: Layout; disabled: boolean };

export type KeysKeyState = { note: number; black: boolean; orientation: Orientation; disabled: boolean };

const MIDDLE_C = 60;
// Keys pressed from the keyboard have no place along the key to take a velocity from.
const KEY_VELOCITY = 0.8;

// Which notes of an octave, from C, are black keys, and where each white key starts, in white keys from C.
const BLACK = [false, true, false, true, false, false, true, false, true, false, true, false];
const WHITE = [0, 0, 1, 0, 2, 3, 0, 4, 0, 5, 0, 6];

const inOctave = (note: number) => ((note % 12) + 12) % 12;
const isBlack = (note: number) => BLACK[inOctave(note)]!;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** Where a key lies along the keyboard, in the layout's units: semitones for rows, white keys for a piano. */
function span(note: number, layout: Layout): [number, number] {
  const black = isBlack(note);
  if (layout === "rows") {
    // One row per semitone; a white key reaches halfway into the black keys beside it.
    return black ? [note, note + 1] : [note - (isBlack(note - 1) ? 0.5 : 0), note + 1 + (isBlack(note + 1) ? 0.5 : 0)];
  }
  // White keys side by side; black keys on twelve even slots of the octave, over the gaps, as on a piano.
  const octave = Math.floor(note / 12) * 7;
  const at = inOctave(note);
  return black ? [octave + (at * 7) / 12, octave + ((at + 1) * 7) / 12] : [octave + WHITE[at]!, octave + WHITE[at]! + 1];
}

/** A key's start and size along the keyboard, as fractions of its length. */
function place(note: number, [lowest, highest]: readonly [number, number], layout: Layout): [number, number] {
  const from = layout === "rows" ? lowest : span(lowest, layout)[0];
  const to = layout === "rows" ? highest + 1 : span(highest, layout)[1];
  const [start, end] = span(note, layout);
  const length = to - from || 1;
  return [(Math.max(from, start) - from) / length, Math.max(0, Math.min(to, end) - Math.max(from, start)) / length];
}

// Rounded, so that the CSS the browser serializes compares equal to what was written.
const percent = (fraction: number) => `${Math.round(fraction * 100_000) / 1000}%`;

type KeyEntry = { element: HTMLElement; options: { disabled: boolean } };

/**
 * The keys that are down, outside React: pressed here, by pointers and the
 * keyboard, or held elsewhere. Changes are written to the keys they concern,
 * and nothing renders.
 */
class KeysStore {
  /** How many pointers, and the keyboard, hold down each key pressed here. */
  private readonly holders = new Map<number, number>();
  private readonly keys = new Map<number, KeyEntry>();
  private readonly notes = new WeakMap<Element, number>();
  held: ReadonlySet<number>;

  constructor(
    held: Iterable<number>,
    /** The key in the tab order (roving tab index). */
    public focusable: number,
    public disabled: boolean,
  ) {
    this.held = new Set(held);
  }

  register(note: number, element: HTMLElement, options: { disabled: boolean }): () => void {
    this.keys.set(note, { element, options });
    this.notes.set(element, note);
    this.write(note);
    return () => {
      if (this.keys.get(note)?.element === element) this.keys.delete(note);
    };
  }

  /** The note of the key an event target is in. */
  noteOf(target: EventTarget | null): number | undefined {
    for (let node = target instanceof Element ? target : null; node; node = node.parentElement) {
      const note = this.notes.get(node);
      if (note !== undefined) return note;
    }
  }

  element(note: number): HTMLElement | undefined {
    return this.keys.get(note)?.element;
  }

  enabled(note: number): boolean {
    const key = this.keys.get(note);
    return key !== undefined && !key.options.disabled && !this.disabled;
  }

  pressed(note: number): boolean {
    return this.holders.has(note);
  }

  /** The keys that can be played, from the lowest. */
  playable(): number[] {
    return [...this.keys.keys()].filter((note) => this.enabled(note)).sort((a, b) => a - b);
  }

  /** Where the keys are on screen, black keys first, as they lie over the white ones. */
  boxes(): { note: number; box: DOMRect }[] {
    return [...this.keys]
      .map(([note, { element }]) => ({ note, box: element.getBoundingClientRect() }))
      .sort((a, b) => Number(isBlack(b.note)) - Number(isBlack(a.note)));
  }

  /** Holds a key down; true when it was up. */
  press(note: number): boolean {
    const holders = this.holders.get(note) ?? 0;
    this.holders.set(note, holders + 1);
    if (holders > 0) return false;
    this.write(note);
    return true;
  }

  /** Lets go of a key; true when nothing else holds it down. */
  release(note: number): boolean {
    const holders = this.holders.get(note) ?? 0;
    if (holders === 0) return false;
    if (holders > 1) {
      this.holders.set(note, holders - 1);
      return false;
    }
    this.holders.delete(note);
    this.write(note);
    return true;
  }

  setHeld(notes: Iterable<number>): void {
    const next = new Set(notes);
    const before = this.held;
    if (next.size === before.size && [...next].every((note) => before.has(note))) return;
    this.held = next;
    for (const note of before) if (!next.has(note)) this.write(note);
    for (const note of next) if (!before.has(note)) this.write(note);
  }

  setDisabled(disabled: boolean): void {
    if (disabled === this.disabled) return;
    this.disabled = disabled;
    for (const note of this.keys.keys()) this.write(note);
  }

  setFocusable(note: number): void {
    const before = this.focusable;
    if (note === before) return;
    this.focusable = note;
    this.write(before);
    this.write(note);
  }

  tabIndex(note: number): number {
    return !this.disabled && note === this.focusable ? 0 : -1;
  }

  private write(note: number): void {
    const key = this.keys.get(note);
    if (!key) return;
    writeLive(key.element, {
      attributes: {
        "data-pressed": this.holders.has(note) ? "" : null,
        "data-held": this.held.has(note) ? "" : null,
        tabindex: this.tabIndex(note),
      },
    });
  }
}

type KeysContextValue = {
  store: KeysStore;
  range: readonly [number, number];
  orientation: Orientation;
  layout: Layout;
  format: ValueFormat;
  disabled: boolean;
};

const KeysContext = createContext<KeysContextValue | null>(null);

function useKeysContext(part: string): KeysContextValue {
  const context = useContext(KeysContext);
  if (!context) throw new Error(`<Keys.${part}> must be placed inside <Keys.Root>.`);
  return context;
}

const defaultFormat = numberFormat({ digits: 0 });

type Callbacks = Pick<KeysRoot.Props, "onPress" | "onRelease"> & { velocity: number | "position" };

/**
 * A piano keyboard: an instrument on screen, or the keys beside a piano
 * roll. It has a key for each note from `range[0]` to `range[1]`, MIDI note
 * numbers, which the application renders with `Keys.Key`, and places them:
 * white keys side by side and black keys over the gaps, as on a piano, or
 * one row per semitone, to line up with the rows of `Notes` over the same
 * range. Low notes are on the left, or at the bottom, in every language.
 *
 * Reports what is played with `onPress` and `onRelease`, and shows keys held
 * elsewhere, by MIDI input or playback, from `held` or `read`. Keys go down
 * and up without rendering. A `group`: name it with `aria-label`.
 */
export function KeysRoot({
  range,
  orientation = "horizontal",
  layout = "piano",
  velocity = "position",
  onPress,
  onRelease,
  held,
  read,
  format,
  disabled = false,
  ...props
}: KeysRoot.Props) {
  const [lowest, highest] = range;
  const [store] = useState(() => new KeysStore(held ?? [], clamp(MIDDLE_C, lowest, highest), disabled));
  const [callbacks] = useState<{ current: Callbacks }>(() => ({ current: { velocity } }));
  callbacks.current = { onPress, onRelease, velocity };
  const reads = read !== undefined;

  useIsomorphicLayoutEffect(() => {
    store.setDisabled(disabled);
    if (held !== undefined && !reads) store.setHeld(held);
    if (store.focusable < lowest || store.focusable > highest) store.setFocusable(clamp(MIDDLE_C, lowest, highest));
  });

  // Keys held elsewhere that change on their own, as playback, are read once per frame.
  const [readRef] = useState<{ current: KeysRoot.Props["read"] }>(() => ({ current: undefined }));
  readRef.current = read;
  useEffect(() => {
    if (!reads) return;
    return onEveryFrame(() => {
      if (readRef.current) store.setHeld(readRef.current());
    });
  }, [reads, readRef, store]);

  const press = useCallback(
    (note: number, velocity: number, reason: KeysReason, event: Event) => {
      if (store.press(note)) callbacks.current.onPress?.(note, { reason, event, velocity });
    },
    [store, callbacks],
  );
  const release = useCallback(
    (note: number, reason: KeysReason, event: Event) => {
      if (store.release(note)) callbacks.current.onRelease?.(note, { reason, event });
    },
    [store, callbacks],
  );
  const keyVelocity = () => (typeof callbacks.current.velocity === "number" ? callbacks.current.velocity : KEY_VELOCITY);

  /**
   * A press follows the pointer: gliding across the keys lets go of one and
   * presses the next, as a glissando. Every pointer plays its own key.
   */
  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    const first = store.noteOf(event.target);
    if (disabled || event.button !== 0 || first === undefined) return;
    event.preventDefault();
    const root = event.currentTarget;
    const rightToLeft = orientation === "vertical" && isRightToLeft(root);
    // Layout is read once per press, not on every move.
    const boxes = store.boxes();
    const pointerId = event.pointerId;
    // From the back of the key to its front: the top of a horizontal keyboard, the inline start of a vertical one.
    const velocityAt = (box: DOMRect, x: number, y: number) => {
      const { velocity } = callbacks.current;
      if (velocity !== "position") return velocity;
      const travel =
        orientation === "vertical" ? (rightToLeft ? box.right - x : x - box.left) / (box.width || 1) : (y - box.top) / (box.height || 1);
      return clamp(travel, 0, 1);
    };
    let current: number | null = null;
    const glide = (x: number, y: number, moved: Event, target?: number) => {
      const hit =
        target !== undefined
          ? boxes.find((one) => one.note === target)
          : boxes.find(({ box }) => x >= box.left && x < box.right && y >= box.top && y < box.bottom);
      const next = hit && store.enabled(hit.note) ? hit.note : null;
      if (next === current) return;
      if (current !== null) release(current, "pointer", moved);
      current = next;
      if (hit && next !== null) press(next, velocityAt(hit.box, x, y), "pointer", moved);
    };
    glide(event.clientX, event.clientY, event.nativeEvent, first);
    store.element(first)?.focus({ preventScroll: true });
    try {
      root.setPointerCapture(pointerId);
    } catch {
      // The pointer may already be gone (a synthetic event).
    }
    const move = (moved: PointerEvent) => {
      if (moved.pointerId === pointerId) glide(moved.clientX, moved.clientY, moved);
    };
    const end = (ended: PointerEvent) => {
      if (ended.pointerId !== pointerId) return;
      root.removeEventListener("pointermove", move);
      root.removeEventListener("pointerup", end);
      root.removeEventListener("pointercancel", end);
      root.removeEventListener("lostpointercapture", end);
      if (current !== null) release(current, "pointer", ended);
      current = null;
    };
    root.addEventListener("pointermove", move);
    root.addEventListener("pointerup", end);
    root.addEventListener("pointercancel", end);
    root.addEventListener("lostpointercapture", end);
  };

  // The key Space or Enter holds down, until it is let go.
  const [keyboard] = useState<{ note: number | null }>(() => ({ note: null }));

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    const note = store.noteOf(event.target);
    if (note === undefined || disabled) return;
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      if (event.repeat || keyboard.note !== null || !store.enabled(note)) return;
      keyboard.note = note;
      press(note, keyVelocity(), "keyboard", event.nativeEvent);
      return;
    }
    const playable = store.playable();
    const above = (from: number) => playable.find((one) => one >= from);
    const below = (from: number) => [...playable].reverse().find((one) => one <= from);
    let target: number | undefined;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowUp":
        target = above(note + 1);
        break;
      case "ArrowLeft":
      case "ArrowDown":
        target = below(note - 1);
        break;
      case "PageUp":
        target = above(note + 12) ?? below(Infinity);
        break;
      case "PageDown":
        target = below(note - 12) ?? above(-Infinity);
        break;
      case "Home":
        target = playable[0];
        break;
      case "End":
        target = playable.at(-1);
        break;
      default:
        return;
    }
    event.preventDefault();
    if (target === undefined || target === note) return;
    // A key held down from the keyboard goes along to the key focus moves to.
    if (keyboard.note !== null) {
      release(keyboard.note, "keyboard", event.nativeEvent);
      keyboard.note = target;
      press(target, keyVelocity(), "keyboard", event.nativeEvent);
    }
    store.element(target)?.focus();
  };

  const onKeyUp = (event: ReactKeyboardEvent<HTMLElement>) => {
    if ((event.key !== " " && event.key !== "Enter") || keyboard.note === null) return;
    event.preventDefault();
    release(keyboard.note, "keyboard", event.nativeEvent);
    keyboard.note = null;
  };

  const onFocus = (event: ReactFocusEvent<HTMLElement>) => {
    const note = store.noteOf(event.target);
    if (note !== undefined) store.setFocusable(note);
  };

  // Focus leaving the keyboard lets go of the key the keyboard holds.
  const onBlur = (event: ReactFocusEvent<HTMLElement>) => {
    if (keyboard.note === null || store.noteOf(event.relatedTarget) !== undefined) return;
    release(keyboard.note, "keyboard", event.nativeEvent);
    keyboard.note = null;
  };

  const context = useMemo<KeysContextValue>(
    () => ({ store, range: [lowest, highest], orientation, layout, format: format ?? defaultFormat, disabled }),
    [store, lowest, highest, orientation, layout, format, disabled],
  );
  const state: KeysState = { orientation, layout, disabled };
  const rendered = useRenderPart("div", state, props, {
    role: "group",
    ...dataAttributes({ orientation, layout, disabled }),
    onPointerDown,
    onKeyDown,
    onKeyUp,
    onFocus,
    onBlur,
    style: { position: "relative", touchAction: "none" },
  });
  return <KeysContext.Provider value={context}>{rendered}</KeysContext.Provider>;
}

export namespace KeysRoot {
  export type State = KeysState;
  export type Props = PartProps<"div", State> & {
    /** The lowest and highest key, as MIDI note numbers: `[21, 108]` for the 88 keys of a piano. */
    range: readonly [lowest: number, highest: number];
    /**
     * Keys run left to right, or bottom to top, as beside a piano roll.
     * @default "horizontal"
     */
    orientation?: Orientation | undefined;
    /**
     * `"piano"` makes every white key the same size, with black keys over
     * the gaps. `"rows"` makes every semitone the same size, so that the keys
     * line up with the rows of `Notes` over the same `range`.
     * @default "piano"
     */
    layout?: Layout | undefined;
    /**
     * How hard presses play, from 0 to 1: a number for every press, or
     * `"position"`, softer at the back of the key and harder at its front,
     * as on-screen keyboards in DAWs play. Keys pressed from the keyboard
     * then play at 0.8.
     * @default "position"
     */
    velocity?: number | "position" | undefined;
    /** Called when a key goes down: a pointer presses it or glides onto it, or Space or Enter presses it. */
    onPress?: ((note: number, details: KeysPressDetails) => void) | undefined;
    /** Called when a key comes back up. A key pressed by two pointers comes up when both let go. */
    onRelease?: ((note: number, details: KeysReleaseDetails) => void) | undefined;
    /** Keys held down elsewhere, by MIDI input or playback, when they change rarely. For playback, use `read`. */
    held?: Iterable<number> | undefined;
    /** Returns the keys held down elsewhere; called once per animation frame. */
    read?: (() => Iterable<number>) | undefined;
    /**
     * Names each key for assistive technology: `formats.pitch({ names })`,
     * with note names in the application's language.
     * @default the MIDI note number
     */
    format?: ValueFormat | undefined;
    /**
     * Ignores input, and takes the keys out of the tab order.
     * @default false
     */
    disabled?: boolean | undefined;
  };
}

/**
 * The key of `note`, placed along the keyboard: a `button` named by the
 * root's `format`, in one tab stop for the whole keyboard. Give it a look,
 * and black keys their length across the keyboard, with CSS: they lie over
 * the white keys from the back. Sets `data-black` or `data-white`, and,
 * without rendering, `data-pressed` while pressed here and `data-held`
 * while held elsewhere.
 */
export function KeysKey({ note, disabled: keyDisabled = false, ...props }: KeysKey.Props) {
  const { store, range, orientation, layout, format, disabled: rootDisabled } = useKeysContext("Key");
  const disabled = rootDisabled || keyDisabled;
  const [options] = useState(() => ({ disabled }));
  options.disabled = disabled;
  const register = useCallback((element: HTMLElement | null) => (element ? store.register(note, element, options) : undefined), [store, note, options]);
  const black = isBlack(note);
  const [start, size] = place(note, range, layout);
  const state: KeysKeyState = { note, black, orientation, disabled };
  return useRenderPart("button", state, props, {
    ref: register,
    type: "button",
    tabIndex: !rootDisabled && store.focusable === note ? 0 : -1,
    "aria-label": format.format(note),
    "aria-disabled": disabled || undefined,
    ...dataAttributes({ black, white: !black, orientation, disabled, pressed: store.pressed(note), held: store.held.has(note) }),
    style: {
      ...unselectable,
      position: "absolute",
      zIndex: black ? 1 : undefined,
      ...(orientation === "vertical"
        ? { insetInline: 0, bottom: percent(start), height: percent(size) }
        : { insetBlock: 0, left: percent(start), width: percent(size) }),
    },
  });
}

export namespace KeysKey {
  export type State = KeysKeyState;
  export type Props = PartProps<"button", State> & {
    /** The key's note, a MIDI note number. */
    note: number;
    /**
     * Cannot be played, as keys beyond an instrument's range.
     * @default false
     */
    disabled?: boolean | undefined;
  };
}
