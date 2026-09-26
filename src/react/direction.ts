"use client";

import { useCallback, useState, type RefCallback } from "react";

/** Whether an element lays out right to left (`dir="rtl"` or CSS `direction: rtl`). */
export function isRightToLeft(element: Element): boolean {
  return getComputedStyle(element).direction === "rtl";
}

/**
 * Reads the direction of an element once, when it mounts, for the few styles
 * that have no logical form in CSS (`translate`, `clip-path`).
 */
export function useRightToLeft(): [boolean, RefCallback<Element>] {
  const [rightToLeft, setRightToLeft] = useState(false);
  const ref = useCallback((element: Element | null) => {
    if (element) setRightToLeft(isRightToLeft(element));
  }, []);
  return [rightToLeft, ref];
}
