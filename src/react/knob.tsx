"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from "react";

import { arcPath, knobAngle, polar } from "../core/index.js";
import { onEveryFrame } from "./frame-loop.js";
import { mergeLive, type Live } from "./live.js";
import { focusFromPointer, unselectable, useMergedRef, useRenderPart, type PartProps } from "./render.js";
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

// The drawing parts (Track, Range, Pointer, Modulation) draw into an `<svg viewBox="0 0 100 100">`.
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
 * in [0, 1]) and `--knob-angle` on its element for styling in CSS. On an
 * endless knob both count on past a turn, so a rotation never jumps back.
 *
 * When the value changes, the parts write what they show straight to the
 * DOM; nothing renders (docs/principles.md, section 7).
 */
export function KnobRoot(props: KnobRoot.Props) {
  const [controlProps, { sweep: sweepProp, ...elementProps }] = splitValueControlProps(props);
  const sweep = sweepProp ?? (controlProps.wrap || controlProps.endless ? 360 : 270);
  const control = useValueControl(controlProps, {
    orientation: "vertical",
    defaultSensitivity: () => 200,
    resetOnDoubleClick: true,
    role: "slider",
  });
  const live = useLivePart(control, (state) =>
    mergeLive(valueLive(state), {
      style: { "--knob-value": String(state.normalized), "--knob-angle": `${knobAngle(state.normalized, sweep)}deg` },
    }),
  );

  const element = useRenderPart("div", control.state, elementProps, {
    ref: live.ref,
    ...staticAttributes(control.state),
    ...live.attributes,
    style: live.style,
  });
  return <KnobContext.Provider value={{ control, sweep }}>{element}</KnobContext.Provider>;
}

export namespace KnobRoot {
  export type State = ValueControlState;
  export type Props = Omit<PartProps<"div", State>, keyof ValueControlProps> &
    ValueControlProps & {
      /**
       * Degrees of rotation from `min` to `max`. The middle of the range
       * points up.
       * @default 270, or 360 when the knob wraps or is endless
       */
      sweep?: number | undefined;
    };
}

/** The focusable element (`role="slider"`) that takes drags, keys and the wheel. */
export function KnobControl(props: KnobControl.Props) {
  const { control } = useKnobContext("Control");
  const live = useLivePart(control, controlLive);
  const ref = useMergedRef(control.controlProps.ref, live.ref);
  return useRenderPart("div", control.state, props, {
    ...control.controlProps,
    ref,
    ...staticAttributes(control.state),
    ...live.attributes,
  });
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
  const live = useLivePart(control, valueLive);
  return useRenderPart("span", control.state, props, {
    id,
    ref: live.ref,
    ...staticAttributes(control.state),
    ...live.attributes,
    style: unselectable,
    onClick: () => focusFromPointer(document.getElementById(control.controlId)),
  });
}

export namespace KnobLabel {
  export type State = ValueControlState;
  export type Props = PartProps<"span", State>;
}

/** The whole sweep, as an SVG path. */
export function KnobTrack({ radius = 40, ...props }: KnobTrack.Props) {
  const { control, sweep } = useKnobContext("Track");
  const live = useLivePart(control, valueLive);
  return useRenderPart("path", control.state, props, {
    ref: live.ref,
    d: arcPath(CENTER, CENTER, radius, -sweep / 2, sweep / 2),
    fill: "none",
    ...staticAttributes(control.state),
    ...live.attributes,
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

/** The arc from `origin` to the value, as an SVG path. An endless knob has no range, and draws none. */
export function KnobRange({ radius = 40, ...props }: KnobRange.Props) {
  const { control, sweep } = useKnobContext("Range");
  const { endless } = control.range;
  const live = useLivePart(control, (state) =>
    mergeLive(valueLive(state), {
      attributes: {
        d: endless
          ? null
          : arcPath(CENTER, CENTER, radius, knobAngle(state.originNormalized, sweep), knobAngle(state.normalized, sweep)),
      },
    }),
  );
  return useRenderPart("path", control.state, props, {
    ref: live.ref,
    fill: "none",
    ...staticAttributes(control.state),
    ...live.attributes,
  });
}

export namespace KnobRange {
  export type State = ValueControlState;
  export type Props = KnobTrack.Props;
}

/** A line pointing at the value, as an SVG line. */
export function KnobPointer({ from = 0, to = 40, ...props }: KnobPointer.Props) {
  const { control, sweep } = useKnobContext("Pointer");
  const live = useLivePart(control, (state): Live => {
    const angle = knobAngle(state.normalized, sweep);
    const start = polar(CENTER, CENTER, from, angle);
    const end = polar(CENTER, CENTER, to, angle);
    return mergeLive(valueLive(state), { attributes: { x1: start.x, y1: start.y, x2: end.x, y2: end.y } });
  });
  return useRenderPart("line", control.state, props, {
    ref: live.ref,
    ...staticAttributes(control.state),
    ...live.attributes,
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
 * The arc from the value to where modulation (an LFO, an envelope) moves it
 * now, as in Bitwig Studio and Ableton Live. `read` returns the modulated
 * value in the knob's units; it is called once per animation frame, and the
 * arc is drawn without rendering.
 */
export function KnobModulation({ read, radius = 46, ...props }: KnobModulation.Props) {
  const { control, sweep } = useKnobContext("Modulation");
  const { store, range } = control;
  const path = useRef<SVGPathElement | null>(null);
  const readRef = useRef(read);
  readRef.current = read;

  const draw = useCallback(() => {
    const element = path.current;
    if (!element) return;
    const from = knobAngle(range.normalize(store.value), sweep);
    const to = knobAngle(range.normalize(readRef.current()), sweep);
    const d = arcPath(CENTER, CENTER, radius, from, to);
    if (element.getAttribute("d") !== d) element.setAttribute("d", d);
  }, [store, range, sweep, radius]);
  useEffect(() => onEveryFrame(draw), [draw]);

  // `d` belongs to the frame loop alone, so that a render never draws a stale arc.
  const drawOnMount = useCallback(
    (element: SVGPathElement | null) => {
      path.current = element;
      draw();
    },
    [draw],
  );
  const live = useLivePart(control, valueLive);
  const ref = useMergedRef(drawOnMount, live.ref);
  return useRenderPart("path", control.state, props, {
    ref,
    fill: "none",
    ...staticAttributes(control.state),
    ...live.attributes,
  });
}

export namespace KnobModulation {
  export type State = ValueControlState;
  export type Props = PartProps<"path", State> & {
    /** Returns the modulated value, in the knob's units; called once per animation frame. */
    read: () => number;
    /**
     * Radius in the 100 × 100 view box; outside the range's arc by default.
     * @default 46
     */
    radius?: number | undefined;
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
export function KnobValue({ children, ...props }: KnobValue.Props) {
  const { control } = useKnobContext("Value");
  const { state, content, ref, attributes } = useValueText(control, children);
  return useRenderPart("output", state, { ...props, children: content }, {
    ref,
    htmlFor: control.controlId,
    "aria-live": "off",
    dir: "auto",
    ...staticAttributes(state),
    ...attributes,
    style: unselectable,
  });
}

export namespace KnobValue {
  export type State = ValueControlState;
  export type Props = Omit<PartProps<"output", State>, "children"> & {
    /**
     * What to show instead of the formatted value, or a function of it. A
     * function renders the part on every change of the value.
     */
    children?: ReactNode | ((text: string, value: number) => ReactNode);
  };
}
