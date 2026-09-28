import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";

import { formats, scales, type ValueFormat } from "../../../src/core/index.js";
import { Knob, Toggle } from "../../../src/react/index.js";
import type { Box } from "../engine/box.js";
import { PARAMS, RATES, type Kind } from "../engine/params.js";

// The box's controls on the library's parts: a knob or a switch for any parameter of the box they are in.

export const BoxContext = createContext<Box | null>(null);

export function useBox(): Box {
  const box = useContext(BoxContext);
  if (!box) throw new Error("Place ShaperBox controls inside BoxContext.");
  return box;
}

export const NAMES: Record<Kind, string> = {
  volume: "Volume",
  filter: "Filter",
  time: "Time",
  pan: "Pan",
  width: "Width",
  noise: "Noise",
  crush: "Crush",
  drive: "Drive",
  liquid: "Liquid",
};

export const COLORS: Record<Kind, string> = {
  volume: "#ffc53d",
  filter: "#3dd9ff",
  time: "#ff5fa2",
  pan: "#7ee07e",
  width: "#3de0c0",
  noise: "#c8d0da",
  crush: "#ff9340",
  drive: "#ff5a52",
  liquid: "#a78bff",
};

export const BAND_NAMES = ["Low", "Mid", "High"] as const;

/** A rate as its note value, "1/4T"; parses the same. */
export const rateFormat: ValueFormat = {
  format: (value) => RATES[Math.round(value)]?.label ?? "",
  parse(text) {
    const index = RATES.findIndex((rate) => rate.label.toLowerCase() === text.trim().toLowerCase());
    return index < 0 ? null : index;
  },
};

const percent = formats.percent();
const decibels = formats.decibel();

/** How a parameter's value reads, by what it is. */
export function formatFor(id: string): ValueFormat {
  if (/\.(threshold|level|output|amount)$/.test(id)) return decibels;
  if (id.endsWith(".smooth")) return formats.time();
  if (id.endsWith(".bits")) return formats.number({ digits: 1, unit: "bit" });
  if (id.endsWith(".downsample")) return formats.number({ digits: 1, unit: "×" });
  if (id.endsWith(".feedback") || id.endsWith(".color")) return formats.number({ digits: 2 });
  if (/\.(low|high|split1|split2)$/.test(id)) return formats.frequency();
  return percent;
}

/** A knob for the parameter `id`, on its range. */
export function ParamKnob({ id, label, onChange }: { id: string; label: string; onChange?: (value: number) => void }) {
  const box = useBox();
  const spec = PARAMS[id]!;
  return (
    <Knob.Root
      min={spec.min}
      max={spec.max}
      step={spec.step}
      scale={spec.curve === "log" ? scales.log : scales.linear}
      origin={spec.min < 0 && spec.max > 0 && id !== "global.output" ? 0 : undefined}
      defaultValue={box.params[id]}
      format={formatFor(id)}
      onValueChange={(value) => {
        box.setParam(id, value);
        onChange?.(value);
      }}
      className="knob"
    >
      <Knob.Control className="knob-control">
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <Knob.Track radius={38} className="knob-track" />
          <Knob.Range radius={38} className="knob-range" />
          <Knob.Pointer from={12} to={30} className="knob-pointer" />
        </svg>
      </Knob.Control>
      <Knob.Label className="knob-label">{label}</Knob.Label>
      <Knob.Value className="knob-value" />
    </Knob.Root>
  );
}

/** An on/off switch for the parameter `id`. */
export function ParamToggle({
  id,
  label,
  className = "switch",
  onChange,
  children,
}: {
  id: string;
  label: string;
  className?: string;
  onChange?: (on: boolean) => void;
  children: ReactNode;
}) {
  const box = useBox();
  return (
    <Toggle
      defaultPressed={box.params[id] === 1}
      onPressedChange={(on) => {
        box.setParam(id, on ? 1 : 0);
        onChange?.(on);
      }}
      aria-label={label}
      className={className}
    >
      {children}
    </Toggle>
  );
}

/** Runs `draw` once per animation frame while mounted. */
export function useFrame(draw: () => void) {
  const latest = useRef(draw);
  latest.current = draw;
  useEffect(() => {
    let frame = requestAnimationFrame(function tick() {
      latest.current();
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, []);
}
