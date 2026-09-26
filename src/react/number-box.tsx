"use client";

import {
  createContext,
  useCallback,
  useContext,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

import { dataAttributes, useRenderPart, type PartProps } from "./render.js";
import {
  splitValueControlProps,
  useLabel,
  useValueControl,
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

const stateAttributes = (state: NumberBoxState) =>
  dataAttributes({ dragging: state.dragging, disabled: state.disabled, editing: state.editing });

// A character that starts typing a value, as in Ableton Live: focus a number box and type.
const STARTS_A_VALUE = /^[0-9.,+\-−]$/;

/** Travel for a full drag: two pixels per step, within reason. */
function numberBoxSensitivity(min: number, max: number, step: number | undefined): number {
  if (!Number.isFinite(max - min) || step === undefined) return 400;
  return Math.min(1000, Math.max(100, (2 * (max - min)) / step));
}

/**
 * A value shown as text that changes by dragging up and down, like the tempo
 * field of a DAW. Double-click, Enter or typing a digit edits it as text.
 */
export function NumberBoxRoot(props: NumberBoxRoot.Props) {
  const [controlProps, elementProps] = splitValueControlProps(props);
  const { min = 0, max = 1, step } = controlProps;
  const control = useValueControl(controlProps, {
    orientation: "vertical",
    defaultSensitivity: () => numberBoxSensitivity(min, max, step),
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
  const element = useRenderPart("div", state, elementProps, stateAttributes(state));
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

/**
 * The value: a focusable `spinbutton` that takes drags and keys, replaced by
 * a text input while editing. Enter or leaving the field applies the typed
 * value; Escape discards it.
 */
export function NumberBoxField({ children, ...props }: NumberBoxField.Props) {
  const { control, state, editing, startEditing, setDraft, finishEditing } = useNumberBoxContext("Field");
  const returnFocus = useRef(false);

  const displayRef = useCallback((element: HTMLElement | null) => {
    if (element && returnFocus.current) {
      returnFocus.current = false;
      element.focus({ preventScroll: true });
    }
  }, []);
  const inputRef = useCallback((element: HTMLInputElement | null) => {
    if (!element) return;
    element.focus({ preventScroll: true });
    // Typing replaces the formatted value; a typed first character stays.
    if (element.value.length > 1) element.select();
  }, []);

  const ownDisplayProps = {
    ...control.controlProps,
    ref: displayRef,
    // The text sets its direction, so "120.00 BPM" stays in order inside a right-to-left page.
    dir: "auto",
    ...stateAttributes(state),
    onDoubleClick: () => {
      if (!state.disabled) startEditing(state.text);
    },
    onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
      if (state.disabled || event.ctrlKey || event.metaKey || event.altKey) return control.controlProps.onKeyDown(event);
      if (event.key === "Enter") {
        event.preventDefault();
        startEditing(state.text);
      } else if (STARTS_A_VALUE.test(event.key)) {
        event.preventDefault();
        startEditing(event.key);
      } else {
        control.controlProps.onKeyDown(event);
      }
    },
  };

  const ownInputProps = {
    ref: inputRef,
    id: control.controlId,
    type: "text",
    inputMode: "decimal" as const,
    autoComplete: "off",
    spellCheck: false,
    dir: "auto",
    value: editing?.draft ?? "",
    "aria-labelledby": control.controlProps["aria-labelledby"],
    ...stateAttributes(state),
    onChange: (event: ChangeEvent<HTMLInputElement>) => setDraft(event.target.value),
    onKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter" || event.key === "Escape") {
        event.preventDefault();
        returnFocus.current = true;
        finishEditing(event.key === "Enter", event.nativeEvent);
      }
    },
    onBlur: (event: FocusEvent<HTMLInputElement>) => finishEditing(true, event.nativeEvent),
  };

  const content = typeof children === "function" ? children(state.text, state.value) : (children ?? state.text);
  return useRenderPart(
    editing ? "input" : "span",
    state,
    editing ? props : { ...props, children: content },
    editing ? ownInputProps : ownDisplayProps,
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
  return useRenderPart("span", state, props, {
    id,
    onClick: () => document.getElementById(control.controlId)?.focus(),
  });
}

export namespace NumberBoxLabel {
  export type State = NumberBoxState;
  export type Props = PartProps<"span", State>;
}
