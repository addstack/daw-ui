"use client";

import { useCallback, useRef, type CSSProperties, type RefCallback } from "react";

/**
 * What a part shows of its control's value: DOM attributes, CSS properties
 * and text. React applies it when the part renders; when only the value
 * changes (a drag, a key, automation), it is written straight to the DOM,
 * and nothing renders (docs/principles.md, section 7).
 */
export type Live = {
  /** By DOM attribute name; `null` or `undefined` removes the attribute. */
  attributes?: Record<string, string | number | null | undefined>;
  /** By CSS property name: `bottom`, `inset-inline-start`, `--knob-value`. */
  style?: Record<string, string>;
  /** The element's only text, when the part renders the value as text. */
  text?: string | undefined;
};

export type LiveListener<State> = (state: State) => void;
export type LiveSubscribe<State> = (listener: LiveListener<State>) => () => void;

export function mergeLive(...parts: Live[]): Live {
  const merged: Required<Omit<Live, "text">> & Pick<Live, "text"> = { attributes: {}, style: {} };
  for (const part of parts) {
    Object.assign(merged.attributes, part.attributes);
    Object.assign(merged.style, part.style);
    if (part.text !== undefined) merged.text = part.text;
  }
  return merged;
}

const reactStyleName = (name: string) =>
  name.startsWith("--") ? name : name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());

/** The attributes of a live description as React props, and its CSS as a React style object. */
export function liveProps(live: Live): { attributes: Record<string, string | number>; style: CSSProperties } {
  const attributes: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(live.attributes ?? {})) {
    if (value !== null && value !== undefined) attributes[name] = value;
  }
  const style: Record<string, string> = {};
  for (const [name, value] of Object.entries(live.style ?? {})) style[reactStyleName(name)] = value;
  return { attributes, style: style as CSSProperties };
}

/**
 * Brings an element in line with a live description, writing only what
 * differs from the DOM. Comparing with the DOM, not with a cache, keeps it
 * right whichever of React and this function wrote last.
 */
export function writeLive(element: HTMLElement | SVGElement, live: Live): void {
  for (const [name, value] of Object.entries(live.attributes ?? {})) {
    const next = value === null || value === undefined ? null : String(value);
    if (element.getAttribute(name) === next) continue;
    if (next === null) element.removeAttribute(name);
    else element.setAttribute(name, next);
  }
  for (const [name, value] of Object.entries(live.style ?? {})) {
    if (element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value);
  }
  if (live.text !== undefined) {
    // Change React's own text node rather than replacing it, so that React's next render still finds it.
    const node = element.firstChild;
    if (node && node === element.lastChild && node.nodeType === Node.TEXT_NODE && node.nodeValue !== live.text) {
      node.nodeValue = live.text;
    }
  }
}

/**
 * A ref that keeps an element in line with `live` for every state the
 * store emits, without rendering.
 */
export function useLive<State>(subscribe: LiveSubscribe<State>, live: (state: State) => Live): RefCallback<HTMLElement | SVGElement> {
  const latest = useRef(live);
  latest.current = live;
  return useCallback(
    (element: HTMLElement | SVGElement | null) => {
      if (!element) return;
      return subscribe((state) => writeLive(element, latest.current(state)));
    },
    [subscribe],
  );
}
