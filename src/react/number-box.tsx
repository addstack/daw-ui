"use client";

import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";

import type { ValueField, ValueSegment } from "../core/index.js";
import { liveProps, mergeLive, type Live } from "./live.js";
import { dataAttributes, unselectable, useMergedRef, useRenderPart, type PartProps } from "./render.js";
import {
  FINE,
  splitValueControlProps,
  useLabel,
  controlLive,
  staticAttributes,
  useLivePart,
  useValueControl,
  useValueText,
  useWheelListener,
  valueLive,
  type ValueControl,
  type ValueControlProps,
  type ValueControlState,
} from "./value-control.js";

export type NumberBoxState = ValueControlState & { editing: boolean };

type NumberBoxContextValue = {
  control: ValueControl;
  state: NumberBoxState;
  editing: { draft: string } | null;
  startEditing(draft: string): void;
  setDraft(draft: string): void;
  finishEditing(commit: boolean, event: Event): void;
};

const NumberBoxContext = createContext<NumberBoxContextValue | null>(null);

function useNumberBoxContext(part: string): NumberBoxContextValue {
  const context = useContext(NumberBoxContext);
  if (!context) throw new Error(`<NumberBox.${part}> must be placed inside <NumberBox.Root>.`);
  return context;
}

/** The attributes that change with the number box's props and editing, not with its value. */
const stateAttributes = (state: NumberBoxState) => ({
  ...staticAttributes(state),
  ...dataAttributes({ editing: state.editing }),
});

const liveAttributes = (live: Live) => liveProps(live).attributes;

// A character that starts typing a value, as in Ableton Live: focus a number box and type.
const STARTS_A_VALUE = /^[0-9.,+\-−]$/;

/** Travel for a full drag: two pixels per step, within reason; without ends, two pixels per step. */
function numberBoxSensitivity(min: number, max: number, step: number | undefined, endless: boolean): number {
  if (!Number.isFinite(max - min) || step === undefined) return 400;
  const pixels = (2 * (max - min)) / step;
  return endless ? pixels : Math.min(1000, Math.max(100, pixels));
}

/**
 * A value shown as text that changes by dragging up and down, like the tempo
 * field of a DAW. Double-click, Enter or typing a digit edits it as text.
 */
export function NumberBoxRoot(props: NumberBoxRoot.Props) {
  const [controlProps, elementProps] = splitValueControlProps(props);
  const { min = 0, max = 1, step, endless = false } = controlProps;
  const control = useValueControl(controlProps, {
    orientation: "vertical",
    defaultSensitivity: () => numberBoxSensitivity(min, max, step, endless),
    resetOnDoubleClick: false,
    role: "spinbutton",
  });
  const [editing, setEditing] = useState<{ draft: string } | null>(null);
  // Enter finishes editing, and the input's blur may follow; only the first counts.
  const editingRef = useRef(editing);
  editingRef.current = editing;

  const startEditing = useCallback((draft: string) => setEditing({ draft }), []);
  const setDraft = useCallback((draft: string) => setEditing({ draft }), []);
  const { format, change, endGesture } = control;
  const finishEditing = useCallback(
    (commit: boolean, event: Event) => {
      const current = editingRef.current;
      if (!current) return;
      editingRef.current = null;
      setEditing(null);
      if (!commit) return;
      const parsed = format.parse(current.draft);
      if (parsed === null) return;
      change(parsed, "input", event);
      endGesture();
    },
    [format, change, endGesture],
  );

  const state: NumberBoxState = { ...control.state, editing: editing !== null };
  const live = useLivePart(control, valueLive);
  const element = useRenderPart("div", state, elementProps, { ref: live.ref, ...stateAttributes(state), ...live.attributes });
  return (
    <NumberBoxContext.Provider value={{ control, state, editing, startEditing, setDraft, finishEditing }}>
      {element}
    </NumberBoxContext.Provider>
  );
}

export namespace NumberBoxRoot {
  export type State = NumberBoxState;
  export type Props = Omit<PartProps<"div", State>, keyof ValueControlProps> & ValueControlProps;
}

/** The text of the value now: it changes without rendering. */
const currentText = (control: ValueControl) => control.format.format(control.store.value);

/**
 * Starts editing on Enter, or on a typed character that starts a value;
 * returns whether it did.
 */
function startsEditing(event: ReactKeyboardEvent<HTMLElement>, context: NumberBoxContextValue): boolean {
  if (context.state.disabled || event.ctrlKey || event.metaKey || event.altKey) return false;
  if (event.key === "Enter") context.startEditing(currentText(context.control));
  else if (STARTS_A_VALUE.test(event.key)) context.startEditing(event.key);
  else return false;
  event.preventDefault();
  return true;
}

function focusInput(element: HTMLInputElement | null) {
  if (!element) return;
  element.focus({ preventScroll: true });
  // Typing replaces the formatted value; a typed first character stays.
  if (element.value.length > 1) element.select();
}

/** The text input that replaces the value while editing. `onClose` runs on Enter and Escape, before focus goes back. */
function inputProps(context: NumberBoxContextValue, state: NumberBoxState, onClose: () => void) {
  const { control, editing, setDraft, finishEditing } = context;
  return {
    ref: focusInput,
    id: control.controlId,
    type: "text",
    inputMode: "decimal" as const,
    autoComplete: "off",
    spellCheck: false,
    dir: "auto",
    value: editing?.draft ?? "",
    "aria-labelledby": control.labelId,
    ...stateAttributes(state),
    ...liveAttributes(valueLive(state)),
    onChange: (event: ChangeEvent<HTMLInputElement>) => setDraft(event.target.value),
    onKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter" || event.key === "Escape") {
        event.preventDefault();
        onClose();
        finishEditing(event.key === "Enter", event.nativeEvent);
      }
    },
    onBlur: (event: FocusEvent<HTMLInputElement>) => finishEditing(true, event.nativeEvent),
  };
}

/**
 * The value: a focusable `spinbutton` that takes drags and keys, replaced by
 * a text input while editing. Enter or leaving the field applies the typed
 * value; Escape discards it.
 */
export function NumberBoxField({ children, ...props }: NumberBoxField.Props) {
  const context = useNumberBoxContext("Field");
  const { control, state: rendered, editing, startEditing } = context;
  const returnFocus = useRef(false);

  // The plain text is written without rendering; a `children` function renders the field on every change.
  const live = useValueText(control, children, controlLive);
  const state: NumberBoxState = { ...live.state, editing: rendered.editing };

  const displayRef = useCallback((element: HTMLElement | null) => {
    if (element && returnFocus.current) {
      returnFocus.current = false;
      element.focus({ preventScroll: true });
    }
  }, []);

  const displayRefs = useMergedRef(displayRef, control.controlProps.ref, live.ref);

  const ownDisplayProps = {
    ...control.controlProps,
    ref: displayRefs,
    // The text sets its direction, so "120.00 BPM" stays in order inside a right-to-left page.
    dir: "auto",
    ...stateAttributes(state),
    ...live.attributes,
    style: { ...control.controlProps.style, ...unselectable },
    onDoubleClick: () => {
      if (!state.disabled) startEditing(currentText(control));
    },
    onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
      if (!startsEditing(event, context)) control.controlProps.onKeyDown(event);
    },
  };

  return useRenderPart(
    editing ? "input" : "span",
    state,
    editing ? props : { ...props, children: live.content },
    editing ? inputProps(context, state, () => (returnFocus.current = true)) : ownDisplayProps,
  );
}

export namespace NumberBoxField {
  export type State = NumberBoxState;
  export type Props = Omit<PartProps<"span", State>, "children"> & {
    /** What to show instead of the formatted value while not editing. */
    children?: ReactNode | ((text: string, value: number) => ReactNode);
  };
}

/** Names the number box for assistive technology. Clicking it focuses the field. */
export function NumberBoxLabel(props: NumberBoxLabel.Props) {
  const { control, state } = useNumberBoxContext("Label");
  const generatedId = useId();
  const id = props.id ?? generatedId;
  useLabel(control, id);
  const live = useLivePart(control, valueLive);
  return useRenderPart("span", state, props, {
    ref: live.ref,
    ...live.attributes,
    id,
    ...stateAttributes(state),
    style: unselectable,
    onClick: () => document.getElementById(control.controlId)?.focus(),
  });
}

export namespace NumberBoxLabel {
  export type State = NumberBoxState;
  export type Props = PartProps<"span", State>;
}

// --- segments ---

/** A segment of the format, as `NumberBox.Segments` passes it to its `children`. */
export type NumberBoxSegmentItem = ValueSegment & {
  /** The segment's place in the format's `segments`. */
  index: number;
};

type SegmentsContextValue = {
  labels: Readonly<Record<string, string>>;
  group: RefObject<HTMLElement | null>;
  /** The id of the first field, which the label focuses. */
  firstField: number;
  /** The segment editing started from, which gets focus back after Enter or Escape. */
  editingFrom: { current: number };
  returnFocusTo: { current: number | null };
};

const SegmentsContext = createContext<SegmentsContextValue | null>(null);

// Pixels of drag, and of wheel scroll, for one step of a segment: a mouse notch is one step.
const PIXELS_PER_STEP = 4;
const WHEEL_PIXELS_PER_STEP = 100;

/**
 * The value as segments that change one at a time: the bars, beats and
 * sixteenths of `formats.position()`, the hours to frames of
 * `formats.timecode()`, the whole part and decimals of `formats.number()`.
 * The segments come from the format; every field is a `spinbutton` in the
 * tab order, and the arrows move between them. Replaced by a text input
 * while editing, as the field is.
 *
 * Renders only when its props or the format change: the segments write
 * their text straight to the DOM.
 */
export function NumberBoxSegments({ labels, children, ...props }: NumberBoxSegments.Props) {
  const context = useNumberBoxContext("Segments");
  const { control, state, editing } = context;
  const segments = control.format.segments;
  if (!segments) throw new Error("<NumberBox.Segments> needs a format with segments, such as formats.position().");

  const items = useMemo(() => segments.map((segment, index): NumberBoxSegmentItem => ({ ...segment, index })), [segments]);
  const group = useRef<HTMLElement | null>(null);
  const editingFrom = useRef(0);
  const returnFocusTo = useRef<number | null>(null);
  const segmentsContext: SegmentsContextValue = {
    labels,
    group,
    firstField: segments.findIndex((segment) => segment.type === "field"),
    editingFrom,
    returnFocusTo,
  };

  const live = useLivePart(control, valueLive);
  const groupRef = useMergedRef(group, live.ref);
  const ownGroupProps = {
    ref: groupRef,
    role: "group",
    "aria-labelledby": control.labelId,
    // Fields of a number read left to right in every language: "12.3.2" stays in order in a right-to-left page.
    dir: "ltr",
    ...stateAttributes(state),
    ...live.attributes,
    // The segments inherit it.
    style: unselectable,
  };
  const content = items.map((item) => (
    <Fragment key={item.index}>{children ? children(item) : <NumberBoxSegment segment={item} />}</Fragment>
  ));

  const element = useRenderPart(
    editing ? "input" : "div",
    state,
    editing ? props : { ...props, children: content },
    editing ? inputProps(context, state, () => (returnFocusTo.current = editingFrom.current)) : ownGroupProps,
  );
  return <SegmentsContext.Provider value={segmentsContext}>{element}</SegmentsContext.Provider>;
}

export namespace NumberBoxSegments {
  export type State = NumberBoxState;
  export type Segment = NumberBoxSegmentItem;
  export type Props = Omit<PartProps<"div", State>, "children"> & {
    /**
     * Names each field for assistive technology, by the field's `name`:
     * `{ bars: "Bar", beats: "Beat", divisions: "Sixteenth" }` for a
     * position, in the application's language.
     */
    labels: Readonly<Record<string, string>>;
    /**
     * Renders each segment, for styling: `(segment) => <NumberBox.Segment
     * segment={segment} className="…" />`. Called when the format changes,
     * not when the value does.
     * @default a NumberBox.Segment for each segment
     */
    children?: ((segment: NumberBoxSegmentItem) => ReactNode) | undefined;
  };
}

/**
 * One segment of `NumberBox.Segments`. A field is a `spinbutton` named by
 * its label: dragging it up and down or pressing the arrows up and down
 * changes the value by the field's step, and carries into the next field.
 * The text between fields is hidden from assistive technology.
 */
export function NumberBoxSegment({ segment, ...props }: NumberBoxSegment.Props) {
  return segment.type === "field" ? (
    <FieldSegment segment={segment} {...props} />
  ) : (
    <LiteralSegment segment={segment} {...props} />
  );
}

export namespace NumberBoxSegment {
  export type State = NumberBoxState;
  export type Props = Omit<PartProps<"span", State>, "children"> & {
    /** The segment, as `NumberBox.Segments` passes it to its `children`. */
    segment: NumberBoxSegmentItem;
  };
}

function useSegmentsContext(): SegmentsContextValue {
  const context = useContext(SegmentsContext);
  if (!context) throw new Error("<NumberBox.Segment> must be placed inside <NumberBox.Segments>.");
  return context;
}

function LiteralSegment({ segment, ...props }: NumberBoxSegment.Props & { segment: { type: "literal"; text: string } }) {
  const { state } = useNumberBoxContext("Segment");
  useSegmentsContext();
  return useRenderPart("span", state, { ...props, children: segment.text }, {
    "aria-hidden": true,
    "data-literal": "",
    ...stateAttributes(state),
  });
}

function FieldSegment({ segment, ...props }: NumberBoxSegment.Props & { segment: ValueField & { index: number } }) {
  const context = useNumberBoxContext("Segment");
  const { control, state, startEditing } = context;
  const { labels, group, firstField, editingFrom, returnFocusTo } = useSegmentsContext();
  const { index, step } = segment;
  const field = useRef(segment);
  field.current = segment;

  const live = useLivePart(control, (current) => {
    const number = field.current.get(current.value);
    return mergeLive(valueLive(current), {
      attributes: { "aria-valuenow": Number.isFinite(number) ? number : null },
      text: field.current.format(current.value),
    });
  });

  /** Moves the value by whole steps of this field; one call is one change. */
  const stepBy = (steps: number, reason: "drag" | "keyboard" | "wheel", event: Event) =>
    control.change(control.latestValue() + steps * step, reason, event, Math.sign(steps));

  const wheelRest = useRef(0);
  const wheelRef = useWheelListener((event) =>
    control.wheelBurst(event, (pixels, starting) => {
      if (starting) wheelRest.current = 0;
      wheelRest.current += pixels / WHEEL_PIXELS_PER_STEP;
      const steps = Math.trunc(wheelRest.current);
      if (steps === 0) return;
      wheelRest.current -= steps;
      stepBy(steps, "wheel", event);
    }),
  );
  const returnFocus = useCallback(
    (element: HTMLElement | null) => {
      if (element && returnFocusTo.current === index) {
        returnFocusTo.current = null;
        element.focus({ preventScroll: true });
      }
    },
    [returnFocusTo, index],
  );
  const ref = useMergedRef(live.ref, wheelRef, returnFocus);

  const edit = (text: string) => {
    editingFrom.current = index;
    startEditing(text);
  };

  return useRenderPart("span", state, { ...props, children: live.text }, {
    ref,
    id: index === firstField ? control.controlId : `${control.controlId}-${index}`,
    role: "spinbutton",
    tabIndex: state.disabled ? -1 : 0,
    "aria-label": labels[segment.name],
    "aria-valuemin": segment.min,
    "aria-valuemax": segment.max,
    "aria-disabled": state.disabled || undefined,
    "data-segment": segment.name,
    ...stateAttributes(state),
    ...live.attributes,
    style: { touchAction: "none" },
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      let rest = 0;
      control.drag(event, (pixels, move) => {
        rest += (pixels / PIXELS_PER_STEP) * (move.shiftKey ? FINE : 1);
        const steps = Math.trunc(rest);
        if (steps === 0) return;
        rest -= steps;
        stepBy(steps, "drag", move);
      });
    },
    onDoubleClick: () => {
      if (!state.disabled) edit(currentText(control));
    },
    onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
      if (state.disabled) return;
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        stepBy(event.key === "ArrowUp" ? 1 : -1, "keyboard", event.nativeEvent);
        control.endGesture();
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const fields = [...(group.current?.querySelectorAll<HTMLElement>("[data-segment]") ?? [])];
        fields[fields.indexOf(event.currentTarget) + (event.key === "ArrowRight" ? 1 : -1)]?.focus();
      } else if (startsEditing(event, context)) {
        editingFrom.current = index;
      } else {
        // Page keys, Home, End and Delete act on the whole value, as on the field.
        control.controlProps.onKeyDown(event);
      }
    },
  });
}
