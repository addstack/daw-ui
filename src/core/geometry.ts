export type Point = { x: number; y: number };

/** An axis-aligned box in the shape of `DOMRect`. */
export type Box = { left: number; top: number; right: number; bottom: number };

/** Angle in degrees, clockwise from 12 o'clock, of a knob at a travel position. */
export function knobAngle(normalized: number, sweep = 270): number {
  return -sweep / 2 + normalized * sweep;
}

/** Point on a circle at an angle in degrees, clockwise from 12 o'clock. */
export function polar(cx: number, cy: number, radius: number, angle: number): Point {
  const radians = (angle * Math.PI) / 180;
  return { x: cx + radius * Math.sin(radians), y: cy - radius * Math.cos(radians) };
}

const round = (value: number) => Math.round(value * 1000) / 1000;

/**
 * SVG path data for a circular arc between two angles (degrees, clockwise
 * from 12 o'clock), in either order. An empty arc is a bare move, which draws
 * nothing.
 */
export function arcPath(cx: number, cy: number, radius: number, from: number, to: number): string {
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  const move = polar(cx, cy, radius, start);
  if (end - start < 1e-6) return `M ${round(move.x)} ${round(move.y)}`;
  // Two halves, so that arcs of 180° and more (up to a full circle) draw without ambiguity.
  const middle = polar(cx, cy, radius, (start + end) / 2);
  const last = polar(cx, cy, radius, end);
  const arc = (point: Point) => `A ${radius} ${radius} 0 0 1 ${round(point.x)} ${round(point.y)}`;
  return `M ${round(move.x)} ${round(move.y)} ${arc(middle)} ${arc(last)}`;
}

/**
 * Where the segment `from → to` enters `box`, as a fraction of its length in
 * [0, 1], or `null` when it misses. A segment that starts inside enters at 0.
 */
export function segmentEntry(from: Point, to: Point, box: Box): number | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  // Liang–Barsky: clip the segment against the four sides.
  const sides: [number, number][] = [
    [-dx, from.x - box.left],
    [dx, box.right - from.x],
    [-dy, from.y - box.top],
    [dy, box.bottom - from.y],
  ];
  let enter = 0;
  let exit = 1;
  for (const [direction, distance] of sides) {
    if (direction === 0) {
      if (distance < 0) return null;
      continue;
    }
    const t = distance / direction;
    if (direction < 0) enter = Math.max(enter, t);
    else exit = Math.min(exit, t);
    if (enter > exit) return null;
  }
  return enter;
}

/**
 * Indices of the boxes the segment `from → to` passes through, in the order
 * it reaches them. Pointer events arrive tens of pixels apart during a fast
 * drag; testing the whole segment keeps small targets from being skipped.
 */
export function boxesAlongSegment(from: Point, to: Point, boxes: readonly Box[]): number[] {
  const hits: { index: number; t: number }[] = [];
  boxes.forEach((box, index) => {
    const t = segmentEntry(from, to, box);
    if (t !== null) hits.push({ index, t });
  });
  return hits.sort((a, b) => a.t - b.t || a.index - b.index).map((hit) => hit.index);
}
