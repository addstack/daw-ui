"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { percentFormat } from "../core/format.js";
import { arcPath, knobAngle, polar } from "../core/index.js";
import { onEveryFrame } from "./frame-loop.js";
import { mergeLive, type Live } from "./live.js";
import { focusFromPointer, unselectable, useMergedRef, useRenderPart, type PartProps } from "./render.js";
import {
  controlLive,
  splitValueControlProps,
  staticAttributes,
  useIsomorphicLayoutEffect,
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

/** The depth of a modulation, as `Knob.ModulationDepth` holds it. */
type Depth = { readonly value: number; subscribe(listener: () => void): () => void };

/**
 * The depths of a knob's modulations by source, outside React, so that
 * `Knob.ModulationRange` follows the `Knob.ModulationDepth` of its source
 * without rendering.
 */
class Depths {
  private readonly depths = new Map<string, Depth>();
  private readonly listeners = new Set<() => void>();

  get(source: string): Depth | undefined {
    return this.depths.get(source);
  }

  register(source: string, depth: Depth): () => void {
    this.depths.set(source, depth);
    this.notify();
    return () => {
      if (this.depths.get(source) !== depth) return;
      this.depths.delete(source);
      this.notify();
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    for (const listener of this.listeners) listener();
  }
}

type KnobContextValue = { control: ValueControl; sweep: number; depths: Depths };

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

  const [depths] = useState(() => new Depths());
  const element = useRenderPart("div", control.state, elementProps, {
    ref: live.ref,
    ...staticAttributes(control.state),
    ...live.attributes,
    style: live.style,
  });
  return <KnobContext.Provider value={{ control, sweep, depths }}>{element}</KnobContext.Provider>;
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
 * The range a modulation (an LFO, an envelope) moves the knob over: the arc
 * from the value to the value plus the modulation's depth, as in Serum and
 * Vital, or to either side of it when `bipolar`. The depth is a fraction of
 * the knob's travel, from −1 to 1: the `Knob.ModulationDepth` of the same
 * `source`, or `depth`. The arc follows the value and the depth without
 * rendering, and stops at the ends of the sweep.
 */
export function KnobModulationRange({ source = "", depth, bipolar = false, radius = 46, ...props }: KnobModulationRange.Props) {
  const { control, sweep, depths } = useKnobContext("ModulationRange");
  const { store, range } = control;
  const settings = useRef({ depth, bipolar, radius });
  settings.current = { depth, bipolar, radius };

  const path = useCallback((): string | null => {
    const { depth, bipolar, radius } = settings.current;
    const amount = depth ?? depths.get(source)?.value ?? 0;
    if (amount === 0 || !Number.isFinite(amount)) return null;
    const at = range.normalize(store.value);
    const [from, to] = bipolar ? [at - Math.abs(amount), at + Math.abs(amount)] : [at, at + amount];
    const inSweep = (travel: number) => (range.wrap || range.endless ? travel : Math.min(1, Math.max(0, travel)));
    return arcPath(CENTER, CENTER, radius, knobAngle(inSweep(from), sweep), knobAngle(inSweep(to), sweep));
  }, [depths, source, range, store, sweep]);

  const element = useRef<SVGPathElement | null>(null);
  const draw = useCallback(() => {
    const target = element.current;
    if (!target) return;
    const d = path();
    if (d === null) target.removeAttribute("d");
    else if (target.getAttribute("d") !== d) target.setAttribute("d", d);
  }, [path]);
  // Follows the knob's value, and the depth of its source, which may mount after this part.
  const follow = useCallback(
    (target: SVGPathElement | null) => {
      element.current = target;
      if (!target) return;
      let stopDepth = () => {};
      const followDepth = () => {
        stopDepth();
        stopDepth = depths.get(source)?.subscribe(draw) ?? (() => {});
        draw();
      };
      followDepth();
      const stopDepths = depths.subscribe(followDepth);
      const stopValue = store.subscribe(draw);
      return () => {
        stopDepths();
        stopValue();
        stopDepth();
      };
    },
    [depths, source, store, draw],
  );
  useIsomorphicLayoutEffect(draw);

  const live = useLivePart(control, valueLive);
  const ref = useMergedRef(follow, live.ref);
  return useRenderPart("path", control.state, props, {
    ref,
    d: path() ?? undefined,
    fill: "none",
    ...staticAttributes(control.state),
    ...live.attributes,
  });
}

export namespace KnobModulationRange {
  export type State = ValueControlState;
  export type Props = PartProps<"path", State> & {
    /**
     * Which modulation: the `source` of its `Knob.ModulationDepth`, for a
     * knob with more than one.
     * @default ""
     */
    source?: string | undefined;
    /**
     * The depth, from −1 to 1 of the knob's travel, when no
     * `Knob.ModulationDepth` sets it: a depth set elsewhere, as in a
     * modulation matrix.
     */
    depth?: number | undefined;
    /**
     * The modulation moves the value to either side, as far as the depth.
     * @default false
     */
    bipolar?: boolean | undefined;
    /**
     * Radius in the 100 × 100 view box; outside the range's arc by default.
     * @default 46
     */
    radius?: number | undefined;
  };
}

const depthFormat = percentFormat();

/**
 * A handle that sets how deep a modulation moves the knob, as the one beside
 * a modulated knob in Serum: a `slider` of its own, from −1 to 1 of the
 * knob's travel, that `Knob.ModulationRange` of the same `source` shows.
 * It drags, steps and resets as a knob does, in steps of 1% unless `step`
 * says otherwise; a reset goes to 0. Place it
 * outside `Knob.Control`, and position it with CSS. Sets `--knob-depth` on
 * its element.
 */
export function KnobModulationDepth({ source = "", ...props }: KnobModulationDepth.Props) {
  const { control: knob, depths } = useKnobContext("ModulationDepth");
  const [controlProps, elementProps] = splitValueControlProps(props);
  const depth = useValueControl(
    {
      ...controlProps,
      min: -1,
      max: 1,
      origin: 0,
      // Whole percents: an arrow moves the depth by 1%.
      step: controlProps.step ?? 0.01,
      resetValue: controlProps.resetValue ?? 0,
      format: controlProps.format ?? depthFormat,
      disabled: controlProps.disabled || knob.state.disabled,
    },
    { orientation: "vertical", defaultSensitivity: () => 200, resetOnDoubleClick: true, role: "slider" },
  );
  const { store } = depth;
  const shared = useMemo<Depth>(
    () => ({
      get value() {
        return store.value;
      },
      subscribe: (listener) => store.subscribe(listener),
    }),
    [store],
  );
  useIsomorphicLayoutEffect(() => depths.register(source, shared), [depths, source, shared]);
  const live = useLivePart(depth, (state) => mergeLive(controlLive(state), { style: { "--knob-depth": String(state.value) } }));
  const ref = useMergedRef(depth.controlProps.ref, live.ref);
  return useRenderPart("div", depth.state, elementProps, {
    ...depth.controlProps,
    ref,
    ...staticAttributes(depth.state),
    ...live.attributes,
    style: { ...depth.controlProps.style, ...live.style },
  });
}

export namespace KnobModulationDepth {
  export type State = ValueControlState;
  export type Props = Omit<PartProps<"div", State>, keyof ValueControlProps> &
    Omit<ValueControlProps, "min" | "max" | "scale" | "wrap" | "endless" | "origin" | "zones" | "pointerLock"> & {
      /**
       * Names the modulation, for the `Knob.ModulationRange` that shows it,
       * on a knob with more than one.
       * @default ""
       */
      source?: string | undefined;
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
