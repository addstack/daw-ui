"use client";

import { createContext, useContext, useId, useRef, type CSSProperties, type ReactNode, type RefObject } from "react";

import { useRightToLeft } from "./direction.js";
import { dataAttributes, useRenderPart, type PartProps } from "./render.js";
import {
  splitValueControlProps,
  useLabel,
  useValueControl,
  type ValueControl,
  type ValueControlProps,
  type ValueControlState,
} from "./value-control.js";

type Orientation = "vertical" | "horizontal";

type FaderContextValue = {
  control: ValueControl;
  orientation: Orientation;
  rightToLeft: boolean;
  trackRef: RefObject<HTMLElement | null>;
};

const FaderContext = createContext<FaderContextValue | null>(null);

function useFaderContext(part: string): FaderContextValue {
  const context = useContext(FaderContext);
  if (!context) throw new Error(`<Fader.${part}> must be placed inside <Fader.Root>.`);
  return context;
}

export type FaderState = ValueControlState & { orientation: Orientation };

const stateAttributes = (state: FaderState) =>
  dataAttributes({
    dragging: state.dragging,
    disabled: state.disabled,
    bipolar: state.bipolar,
    orientation: state.orientation,
  });

function useFaderState(context: FaderContextValue): FaderState {
  return { ...context.control.state, orientation: context.orientation };
}

/** Places an element at a travel position along the track, centered on it. */
function centeredAt(context: FaderContextValue, normalized: number): CSSProperties {
  const offset = `${normalized * 100}%`;
  if (context.orientation === "vertical") return { position: "absolute", bottom: offset, translate: "0 50%" };
  return { position: "absolute", insetInlineStart: offset, translate: `${context.rightToLeft ? "50%" : "-50%"} 0` };
}

/**
 * Groups the parts of a fader and holds its value. Sets `--fader-value`
 * (travel in [0, 1]) on its element for styling in CSS.
 */
export function FaderRoot(props: FaderRoot.Props) {
  const [controlProps, { orientation = "vertical", ...elementProps }] = splitValueControlProps(props);
  const trackRef = useRef<HTMLElement | null>(null);
  const [rightToLeft, directionRef] = useRightToLeft();
  const control = useValueControl(controlProps, {
    orientation,
    // By default, dragging moves the thumb with the pointer: the full travel is the track's length.
    defaultSensitivity(element) {
      const box = (trackRef.current ?? element).getBoundingClientRect();
      return orientation === "vertical" ? box.height : box.width;
    },
    resetOnDoubleClick: true,
    role: "slider",
  });
  const context: FaderContextValue = { control, orientation, rightToLeft, trackRef };
  const state = useFaderState(context);

  const element = useRenderPart("div", state, elementProps, {
    ref: directionRef,
    ...stateAttributes(state),
    style: { "--fader-value": state.normalized } as CSSProperties,
  });
  return <FaderContext.Provider value={context}>{element}</FaderContext.Provider>;
}

export namespace FaderRoot {
  export type State = FaderState;
  export type Props = Omit<PartProps<"div", State>, keyof ValueControlProps> &
    ValueControlProps & {
      /** Defaults to `"vertical"`, as on a mixer. */
      orientation?: Orientation | undefined;
    };
}

/** The focusable element (`role="slider"`) that takes drags, keys and the wheel. */
export function FaderControl(props: FaderControl.Props) {
  const context = useFaderContext("Control");
  const state = useFaderState(context);
  return useRenderPart("div", state, props, { ...context.control.controlProps, ...stateAttributes(state) });
}

export namespace FaderControl {
  export type State = FaderState;
  export type Props = PartProps<"div", State>;
}

/** Names the fader for assistive technology. Clicking it focuses the control. */
export function FaderLabel(props: FaderLabel.Props) {
  const context = useFaderContext("Label");
  const generatedId = useId();
  const id = props.id ?? generatedId;
  useLabel(context.control, id);
  return useRenderPart("span", useFaderState(context), props, {
    id,
    onClick: () => document.getElementById(context.control.controlId)?.focus(),
  });
}

export namespace FaderLabel {
  export type State = FaderState;
  export type Props = PartProps<"span", State>;
}

/**
 * The line the thumb travels along. `Range`, `Thumb` and `Tick` are positioned
 * inside it, and its length is the full travel of a drag.
 */
export function FaderTrack(props: FaderTrack.Props) {
  const context = useFaderContext("Track");
  const state = useFaderState(context);
  return useRenderPart("div", state, props, {
    ref: context.trackRef,
    ...stateAttributes(state),
    style: { position: "relative" },
  });
}

export namespace FaderTrack {
  export type State = FaderState;
  export type Props = PartProps<"div", State>;
}

/** The filled part of the track, from `origin` to the value. */
export function FaderRange(props: FaderRange.Props) {
  const context = useFaderContext("Range");
  const state = useFaderState(context);
  const start = `${Math.min(state.originNormalized, state.normalized) * 100}%`;
  const length = `${Math.abs(state.normalized - state.originNormalized) * 100}%`;
  const style: CSSProperties =
    context.orientation === "vertical"
      ? { position: "absolute", bottom: start, height: length }
      : { position: "absolute", insetInlineStart: start, width: length };
  return useRenderPart("div", state, props, { ...stateAttributes(state), style });
}

export namespace FaderRange {
  export type State = FaderState;
  export type Props = PartProps<"div", State>;
}

/** The handle, centered on the value. */
export function FaderThumb(props: FaderThumb.Props) {
  const context = useFaderContext("Thumb");
  const state = useFaderState(context);
  return useRenderPart("div", state, props, {
    ...stateAttributes(state),
    style: centeredAt(context, state.normalized),
  });
}

export namespace FaderThumb {
  export type State = FaderState;
  export type Props = PartProps<"div", State>;
}

/** A scale mark centered on `value`, e.g. `<Fader.Tick value={-6}>-6</Fader.Tick>`. */
export function FaderTick({ value, ...props }: FaderTick.Props) {
  const context = useFaderContext("Tick");
  const state = useFaderState(context);
  return useRenderPart("div", state, props, {
    "aria-hidden": true,
    style: centeredAt(context, context.control.range.normalize(value)),
  });
}

export namespace FaderTick {
  export type State = FaderState;
  export type Props = PartProps<"div", State> & {
    /** Where the mark goes, in the fader's units. */
    value: number;
  };
}

/**
 * The formatted value. The control already announces it, so it is not a live
 * region. `dir="auto"` lets the text set its direction: "-6.0 dB" stays in
 * order inside a right-to-left page.
 */
export function FaderValue({ children, ...props }: FaderValue.Props) {
  const context = useFaderContext("Value");
  const state = useFaderState(context);
  const content = typeof children === "function" ? children(state.text, state.value) : (children ?? state.text);
  return useRenderPart("output", state, { ...props, children: content }, {
    htmlFor: context.control.controlId,
    "aria-live": "off",
    dir: "auto",
  });
}

export namespace FaderValue {
  export type State = FaderState;
  export type Props = Omit<PartProps<"output", State>, "children"> & {
    children?: ReactNode | ((text: string, value: number) => ReactNode);
  };
}
