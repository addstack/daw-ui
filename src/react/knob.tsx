"use client";

import { createContext, useContext, useId, type CSSProperties, type ReactNode } from "react";

import { arcPath, knobAngle, polar } from "../core/index.js";
import { useRenderPart, type PartProps } from "./render.js";
import {
  splitValueControlProps,
  useLabel,
  useValueControl,
  valueAttributes,
  type ValueControl,
  type ValueControlProps,
  type ValueControlState,
} from "./value-control.js";

// The drawing parts (Track, Range, Pointer) draw into an `<svg viewBox="0 0 100 100">`.
const CENTER = 50;

type KnobContextValue = { control: ValueControl; sweep: number };

const KnobContext = createContext<KnobContextValue | null>(null);

function useKnobContext(part: string): KnobContextValue {
  const context = useContext(KnobContext);
  if (!context) throw new Error(`<Knob.${part}> must be placed inside <Knob.Root>.`);
  return context;
}


/**
 * Groups the parts of a knob and holds its value. Sets `--knob-value` (travel
 * in [0, 1]) and `--knob-angle` on its element for styling in CSS.
 */
export function KnobRoot(props: KnobRoot.Props) {
  const [controlProps, { sweep = 270, ...elementProps }] = splitValueControlProps(props);
  const control = useValueControl(controlProps, {
    orientation: "vertical",
    defaultSensitivity: () => 200,
    resetOnDoubleClick: true,
    role: "slider",
  });
  const { state } = control;

  const element = useRenderPart("div", state, elementProps, {
    ...valueAttributes(state),
    style: {
      "--knob-value": state.normalized,
      "--knob-angle": `${knobAngle(state.normalized, sweep)}deg`,
    } as CSSProperties,
  });
  return <KnobContext.Provider value={{ control, sweep }}>{element}</KnobContext.Provider>;
}

export namespace KnobRoot {
  export type State = ValueControlState;
  export type Props = Omit<PartProps<"div", State>, keyof ValueControlProps> &
    ValueControlProps & {
      /**
       * Degrees of rotation from the lowest to the highest value.
       * @default 270
       */
      sweep?: number | undefined;
    };
}

/** The focusable element (`role="slider"`) that takes drags, keys and the wheel. */
export function KnobControl(props: KnobControl.Props) {
  const { control } = useKnobContext("Control");
  return useRenderPart("div", control.state, props, { ...control.controlProps, ...valueAttributes(control.state) });
}

export namespace KnobControl {
  export type State = ValueControlState;
  export type Props = PartProps<"div", State>;
}

/** Names the knob for assistive technology. Clicking it focuses the control. */
export function KnobLabel(props: KnobLabel.Props) {
  const { control } = useKnobContext("Label");
  const generatedId = useId();
  const id = props.id ?? generatedId;
  useLabel(control, id);
  return useRenderPart("span", control.state, props, {
    id,
    ...valueAttributes(control.state),
    onClick: () => document.getElementById(control.controlId)?.focus(),
  });
}

export namespace KnobLabel {
  export type State = ValueControlState;
  export type Props = PartProps<"span", State>;
}

/** The whole sweep, as an SVG path. */
export function KnobTrack({ radius = 40, ...props }: KnobTrack.Props) {
  const { control, sweep } = useKnobContext("Track");
  return useRenderPart("path", control.state, props, {
    d: arcPath(CENTER, CENTER, radius, -sweep / 2, sweep / 2),
    fill: "none",
    ...valueAttributes(control.state),
  });
}

export namespace KnobTrack {
  export type State = ValueControlState;
  export type Props = PartProps<"path", State> & {
    /**
     * Radius in the 100 × 100 view box.
     * @default 40
     */
    radius?: number | undefined;
  };
}

/** The arc from `origin` to the value, as an SVG path. */
export function KnobRange({ radius = 40, ...props }: KnobRange.Props) {
  const { control, sweep } = useKnobContext("Range");
  const { normalized, originNormalized } = control.state;
  return useRenderPart("path", control.state, props, {
    d: arcPath(CENTER, CENTER, radius, knobAngle(originNormalized, sweep), knobAngle(normalized, sweep)),
    fill: "none",
    ...valueAttributes(control.state),
  });
}

export namespace KnobRange {
  export type State = ValueControlState;
  export type Props = KnobTrack.Props;
}

/** A line pointing at the value, as an SVG line. */
export function KnobPointer({ from = 0, to = 40, ...props }: KnobPointer.Props) {
  const { control, sweep } = useKnobContext("Pointer");
  const angle = knobAngle(control.state.normalized, sweep);
  const start = polar(CENTER, CENTER, from, angle);
  const end = polar(CENTER, CENTER, to, angle);
  return useRenderPart("line", control.state, props, {
    x1: start.x,
    y1: start.y,
    x2: end.x,
    y2: end.y,
    ...valueAttributes(control.state),
  });
}

export namespace KnobPointer {
  export type State = ValueControlState;
  export type Props = PartProps<"line", State> & {
    /**
     * Distance from the center where the line starts.
     * @default 0
     */
    from?: number | undefined;
    /**
     * Distance from the center where the line ends.
     * @default 40
     */
    to?: number | undefined;
  };
}

/**
 * The formatted value. The control already announces it, so it is not a live
 * region. `dir="auto"` lets the text set its direction: "-6.0 dB" stays in
 * order inside a right-to-left page.
 */
export function KnobValue({ children, ...props }: KnobValue.Props) {
  const { control } = useKnobContext("Value");
  const { state } = control;
  const content = typeof children === "function" ? children(state.text, state.value) : (children ?? state.text);
  return useRenderPart("output", state, { ...props, children: content }, {
    htmlFor: control.controlId,
    "aria-live": "off",
    dir: "auto",
    ...valueAttributes(state),
  });
}

export namespace KnobValue {
  export type State = ValueControlState;
  export type Props = Omit<PartProps<"output", State>, "children"> & {
    /** What to show instead of the formatted value, or a function of it. */
    children?: ReactNode | ((text: string, value: number) => ReactNode);
  };
}
