"use client";

import {
  createContext,
  useContext,
  useId,
  useRef,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";

import { zoneOf } from "../core/index.js";
import { useRightToLeft } from "./direction.js";
import { mergeLive, type Live } from "./live.js";
import { dataAttributes, unselectable, useMergedRef, useRenderPart, type PartProps } from "./render.js";
import {
  controlLive,
  splitValueControlProps,
  staticAttributes,
  useLabel,
  useLivePart,
  useValueControl,
  useValueText,
  valueLive,
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

function faderState(context: FaderContextValue): FaderState {
  return { ...context.control.state, orientation: context.orientation };
}

/** The attributes that change with the fader's props, not with its value. */
const staticFaderAttributes = (state: FaderState) => ({
  ...staticAttributes(state),
  ...dataAttributes({ orientation: state.orientation }),
});

// Rounded, so that the CSS the browser serializes compares equal to what was written.
const percent = (travel: number) => `${Math.round(travel * 100_000) / 1000}%`;

/** The CSS property that places an element along the track. */
const offsetProperty = (orientation: Orientation) => (orientation === "vertical" ? "bottom" : "inset-inline-start");

/** How an element is centered on its position along the track. */
function centering(context: FaderContextValue): CSSProperties {
  if (context.orientation === "vertical") return { position: "absolute", translate: "0 50%" };
  return { position: "absolute", translate: `${context.rightToLeft ? "50%" : "-50%"} 0` };
}

/**
 * Groups the parts of a fader and holds its value. Sets `--fader-value`
 * (travel in [0, 1]) on its element for styling in CSS.
 *
 * When the value changes, the parts write what they show straight to the
 * DOM; nothing renders (docs/principles.md, section 7).
 */
export function FaderRoot(props: FaderRoot.Props) {
  const [controlProps, { orientation = "vertical", ...elementProps }] = splitValueControlProps(props);
  const trackRef = useRef<HTMLElement | null>(null);
  const [rightToLeft, directionRef] = useRightToLeft();
  const control = useValueControl({ ...controlProps, endless: false }, {
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
  const state = faderState(context);
  const live = useLivePart(control, (current) =>
    mergeLive(valueLive(current), { style: { "--fader-value": String(current.normalized) } }),
  );
  const ref = useMergedRef(directionRef, live.ref);

  const element = useRenderPart("div", state, elementProps, {
    ref,
    ...staticFaderAttributes(state),
    ...live.attributes,
    style: live.style,
  });
  return <FaderContext.Provider value={context}>{element}</FaderContext.Provider>;
}

export namespace FaderRoot {
  export type State = FaderState;
  export type Props = Omit<PartProps<"div", State>, keyof ValueControlProps> &
    // A fader has two ends.
    Omit<ValueControlProps, "endless"> & {
      /**
       * The direction of travel.
       * @default "vertical"
       */
      orientation?: Orientation | undefined;
    };
}

/** The focusable element (`role="slider"`) that takes drags, keys and the wheel. */
export function FaderControl(props: FaderControl.Props) {
  const context = useFaderContext("Control");
  const state = faderState(context);
  const live = useLivePart(context.control, controlLive);
  const ref = useMergedRef(context.control.controlProps.ref, live.ref);
  return useRenderPart("div", state, props, {
    ...context.control.controlProps,
    ref,
    ...staticFaderAttributes(state),
    ...live.attributes,
  });
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
  const state = faderState(context);
  const live = useLivePart(context.control, valueLive);
  return useRenderPart("span", state, props, {
    id,
    ref: live.ref,
    ...staticFaderAttributes(state),
    ...live.attributes,
    style: unselectable,
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
  const state = faderState(context);
  const live = useLivePart(context.control, valueLive);
  const ref = useMergedRef(context.trackRef, live.ref);
  return useRenderPart("div", state, props, {
    ref,
    ...staticFaderAttributes(state),
    ...live.attributes,
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
  const state = faderState(context);
  const { orientation } = context;
  const live = useLivePart(context.control, (current): Live => {
    const start = percent(Math.min(current.originNormalized, current.normalized));
    const length = percent(Math.abs(current.normalized - current.originNormalized));
    return mergeLive(valueLive(current), {
      style:
        orientation === "vertical" ? { bottom: start, height: length } : { "inset-inline-start": start, width: length },
    });
  });
  return useRenderPart("div", state, props, {
    ref: live.ref,
    ...staticFaderAttributes(state),
    ...live.attributes,
    style: { position: "absolute", ...live.style },
  });
}

export namespace FaderRange {
  export type State = FaderState;
  export type Props = PartProps<"div", State>;
}

/** The handle, centered on the value. */
export function FaderThumb(props: FaderThumb.Props) {
  const context = useFaderContext("Thumb");
  const state = faderState(context);
  const property = offsetProperty(context.orientation);
  const live = useLivePart(context.control, (current) =>
    mergeLive(valueLive(current), { style: { [property]: percent(current.normalized) } }),
  );
  return useRenderPart("div", state, props, {
    ref: live.ref,
    ...staticFaderAttributes(state),
    ...live.attributes,
    style: { ...centering(context), ...live.style },
  });
}

export namespace FaderThumb {
  export type State = FaderState;
  export type Props = PartProps<"div", State>;
}

/**
 * A scale mark centered on `value`, e.g. `<Fader.Tick value={-6}>-6</Fader.Tick>`.
 * Its `data-zone` is the zone of its own value, so the marks of a zone can be
 * coloured like it.
 */
export function FaderTick({ value, ...props }: FaderTick.Props) {
  const context = useFaderContext("Tick");
  const state = faderState(context);
  const offset = context.orientation === "vertical" ? "bottom" : "insetInlineStart";
  return useRenderPart("div", state, props, {
    "aria-hidden": true,
    ...dataAttributes({ orientation: state.orientation, zone: zoneOf(value, context.control.zones) }),
    style: { ...unselectable, ...centering(context), [offset]: percent(context.control.range.normalize(value)) },
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
 *
 * The text is written without rendering. A `children` function renders this
 * part on every change of the value, so keep it for values that change rarely.
 */
export function FaderValue({ children, ...props }: FaderValue.Props) {
  const context = useFaderContext("Value");
  const { control } = context;
  const text = useValueText(control, children);
  const state: FaderState = { ...text.state, orientation: context.orientation };
  return useRenderPart("output", state, { ...props, children: text.content }, {
    ref: text.ref,
    htmlFor: control.controlId,
    "aria-live": "off",
    dir: "auto",
    ...staticFaderAttributes(state),
    ...text.attributes,
    style: unselectable,
  });
}

export namespace FaderValue {
  export type State = FaderState;
  export type Props = Omit<PartProps<"output", State>, "children"> & {
    /**
     * What to show instead of the formatted value, or a function of it. A
     * function renders the part on every change of the value.
     */
    children?: ReactNode | ((text: string, value: number) => ReactNode);
  };
}
