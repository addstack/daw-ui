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
  type CSSProperties,
  type RefObject,
} from "react";

import {
  createMeterBallistics,
  createRange,
  zoneOf,
  type MeterBallistics,
  type MeterBallisticsOptions,
  type Range,
  type Scale,
  type ValueFormat,
  type Zones,
} from "../core/index.js";
import { decibelFormat } from "../core/format.js";
import { useRightToLeft } from "./direction.js";
import { onEveryFrame } from "./frame-loop.js";
import { dataAttributes, unselectable, useMergedRef, useRenderPart, type PartProps } from "./render.js";
import { useIsomorphicLayoutEffect } from "./value-control.js";

type Orientation = "vertical" | "horizontal";

export type MeterState = { orientation: Orientation };

type MeterContextValue = {
  state: MeterState;
  range: Range;
  format: ValueFormat;
  rightToLeft: boolean;
  ballistics: MeterBallistics;
  track: RefObject<HTMLElement | null>;
  clipIndicators: Set<HTMLElement>;
  labelId: string | undefined;
  setLabelId(id: string | undefined): void;
};

const MeterContext = createContext<MeterContextValue | null>(null);

function useMeterContext(part: string): MeterContextValue {
  const context = useContext(MeterContext);
  if (!context) throw new Error(`<Meter.${part}> must be placed inside <Meter.Root>.`);
  return context;
}

// Screen readers do not need 60 updates a second; the accessible value follows at this pace.
const ACCESSIBLE_UPDATE_MS = 250;

/** Writes an attribute only when it changes, so a silent meter costs no DOM work. */
function setAttribute(element: Element, name: string, value: string | null): void {
  if (element.getAttribute(name) === value) return;
  if (value === null) element.removeAttribute(name);
  else element.setAttribute(name, value);
}

/**
 * A peak level meter. The level is read on every animation frame from `read`
 * (or the `level` prop) and written to the DOM directly, never through React
 * state: a mixer of 64 running meters renders nothing.
 *
 * Sets `--meter-level` and `--meter-peak` (travel in [0, 1]) on its element,
 * `data-active` while there is signal, `data-clipped` after a clip, and
 * `data-zone` with the zone of `zones` the level is in.
 */
export function MeterRoot(props: MeterRoot.Props) {
  const {
    read,
    level,
    min = -60,
    max = 6,
    scale,
    format: formatProp,
    fall,
    hold,
    clipAbove,
    orientation = "vertical",
    zones,
    ref: userRef,
    ...elementProps
  } = props;

  const range = useMemo(() => createRange({ min, max, scale }), [min, max, scale]);
  const format = useMemo(() => formatProp ?? decibelFormat(), [formatProp]);
  const ballistics = useMemo(
    () => createMeterBallistics({ floor: min, fall, hold, clipAbove }),
    [min, fall, hold, clipAbove],
  );

  const clipIndicators = useRef(new Set<HTMLElement>()).current;
  const root = useRef<HTMLElement | null>(null);
  const track = useRef<HTMLElement | null>(null);
  const [rightToLeft, directionRef] = useRightToLeft();
  const ref = useMergedRef(root, directionRef, userRef);
  const [labelId, setLabelId] = useState<string | undefined>(undefined);

  const input = useRef({ read, level, zones });
  input.current = { read, level, zones };

  useEffect(() => {
    let written: { level: number; peak: number; active: boolean; clipped: boolean; zone: string | undefined } = {
      level: -1,
      peak: -1,
      active: false,
      clipped: false,
      zone: undefined,
    };
    let accessibleAt = -Infinity;
    return onEveryFrame((now) => {
      const element = root.current;
      if (!element) return;
      const { read, level, zones } = input.current;
      const reading = ballistics.update(read ? read() : (level ?? -Infinity), now);
      const levelTravel = Math.round(range.normalize(reading.level) * 1000) / 1000;
      const peakTravel = Math.round(range.normalize(reading.peak) * 1000) / 1000;
      const active = reading.peak > range.min;
      const zone = zoneOf(reading.level, zones);

      if (levelTravel !== written.level) element.style.setProperty("--meter-level", String(levelTravel));
      if (peakTravel !== written.peak) element.style.setProperty("--meter-peak", String(peakTravel));
      if (active !== written.active) setAttribute(element, "data-active", active ? "" : null);
      if (zone !== written.zone) setAttribute(element, "data-zone", zone ?? null);
      if (reading.clipped !== written.clipped) {
        setAttribute(element, "data-clipped", reading.clipped ? "" : null);
        for (const indicator of clipIndicators) setAttribute(indicator, "data-clipped", reading.clipped ? "" : null);
      }
      written = { level: levelTravel, peak: peakTravel, active, clipped: reading.clipped, zone };

      if (track.current && now - accessibleAt >= ACCESSIBLE_UPDATE_MS) {
        accessibleAt = now;
        const rounded = Math.round(reading.level * 10) / 10;
        setAttribute(track.current, "aria-valuenow", String(rounded));
        setAttribute(track.current, "aria-valuetext", format.format(rounded));
      }
    });
  }, [range, format, ballistics, clipIndicators]);

  const state: MeterState = { orientation };
  const rendered = useRenderPart("div", state, { ...elementProps, ref }, dataAttributes({ orientation }));
  const context: MeterContextValue = {
    state,
    range,
    format,
    rightToLeft,
    ballistics,
    track,
    clipIndicators,
    labelId,
    setLabelId,
  };
  return <MeterContext.Provider value={context}>{rendered}</MeterContext.Provider>;
}

export namespace MeterRoot {
  export type State = MeterState;
  export type Props = PartProps<"div", State> & {
      /**
       * Returns the current level in dBFS; called once per animation frame.
       * Read an `AnalyserNode` or a value your audio code keeps up to date.
       */
      read?: (() => number) | undefined;
      /** The current level in dBFS, when it comes from React state instead of `read`. */
      level?: number | undefined;
      /**
       * Bottom of the scale in dBFS; lower levels show as empty.
       * @default -60
       */
      min?: number | undefined;
      /**
       * Top of the scale in dBFS.
       * @default 6
       */
      max?: number | undefined;
      /**
       * How dB map to the meter's length.
       * @default scales.linear
       */
      scale?: Scale | undefined;
      /**
       * Text for `aria-valuetext`.
       * @default formats.decibel()
       */
      format?: ValueFormat | undefined;
      /**
       * The direction the level rises in.
       * @default "vertical"
       */
      orientation?: Orientation | undefined;
      /**
       * Named zones of the level by their lower bound in dBFS, e.g.
       * `{ warm: -18, hot: -6, clip: 0 }`. The root gets `data-zone` with the
       * zone the level is in, written only when it changes.
       */
      zones?: Zones | undefined;
    } & Omit<MeterBallisticsOptions, "floor">;
}

/**
 * The scale the level fills (`role="meter"`). `Bar` and `Peak` are positioned
 * inside it. Name it with `Meter.Label` or an `aria-label`.
 */
export function MeterTrack(props: MeterTrack.Props) {
  const { state, range, format, track, labelId } = useMeterContext("Track");
  const ref = useMergedRef(track, props.ref);
  return useRenderPart("div", state, { ...props, ref }, {
    role: "meter",
    "aria-valuemin": range.min,
    "aria-valuemax": range.max,
    // Initial values; the frame loop keeps them current.
    "aria-valuenow": range.min,
    "aria-valuetext": format.format(range.min),
    "aria-labelledby": labelId,
    style: { position: "relative" },
  });
}

export namespace MeterTrack {
  export type State = MeterState;
  export type Props = PartProps<"div", State>;
}

/**
 * The lit part of the meter. It covers the track and is clipped to the
 * level, so a gradient on it stays in place (green below, red at the top).
 */
export function MeterBar(props: MeterBar.Props) {
  const { state, rightToLeft } = useMeterContext("Bar");
  const unlit = "calc((1 - var(--meter-level, 0)) * 100%)";
  const clipPath =
    state.orientation === "vertical"
      ? `inset(${unlit} 0 0 0)`
      : rightToLeft
        ? `inset(0 0 0 ${unlit})`
        : `inset(0 ${unlit} 0 0)`;
  return useRenderPart("div", state, props, {
    style: { position: "absolute", inset: 0, clipPath } satisfies CSSProperties,
  });
}

export namespace MeterBar {
  export type State = MeterState;
  export type Props = PartProps<"div", State>;
}

/** The peak-hold marker. Its edge sits at the recent peak; hide it while the root has no `data-active`. */
export function MeterPeak(props: MeterPeak.Props) {
  const { state } = useMeterContext("Peak");
  const offset = "calc(var(--meter-peak, 0) * 100%)";
  const style: CSSProperties =
    state.orientation === "vertical"
      ? { position: "absolute", bottom: offset }
      : { position: "absolute", insetInlineStart: offset };
  return useRenderPart("div", state, props, { style });
}

export namespace MeterPeak {
  export type State = MeterState;
  export type Props = PartProps<"div", State>;
}

/**
 * The clip indicator, a button: `data-clipped` after the level went over
 * `clipAbove`, until it is pressed. Place it outside `Meter.Track` (a meter's
 * content is hidden from assistive technology) and give it an `aria-label`
 * in your application's language.
 */
export function MeterClip(props: MeterClip.Props) {
  const { state, ballistics, clipIndicators } = useMeterContext("Clip");
  const register = useCallback(
    (element: HTMLElement | null) => {
      if (!element) return;
      clipIndicators.add(element);
      if (ballistics.reading.clipped) element.setAttribute("data-clipped", "");
      return () => {
        clipIndicators.delete(element);
      };
    },
    [clipIndicators, ballistics],
  );
  const ref = useMergedRef(register, props.ref);
  return useRenderPart("button", state, { ...props, ref }, {
    type: "button",
    style: unselectable,
    // The frame loop removes `data-clipped` on the next frame.
    onClick: () => ballistics.resetClip(),
  });
}

export namespace MeterClip {
  export type State = MeterState;
  export type Props = PartProps<"button", State>;
}

/** Names the meter for assistive technology. */
export function MeterLabel(props: MeterLabel.Props) {
  const { state, setLabelId } = useMeterContext("Label");
  const generatedId = useId();
  const id = props.id ?? generatedId;
  useIsomorphicLayoutEffect(() => {
    setLabelId(id);
    return () => setLabelId(undefined);
  }, [setLabelId, id]);
  return useRenderPart("span", state, props, { id, style: unselectable });
}

export namespace MeterLabel {
  export type State = MeterState;
  export type Props = PartProps<"span", State>;
}
