import { describe, expect, test } from "vitest";

import { arcPath, boxesAlongSegment, knobAngle, polar, segmentEntry, type Box } from "../src/core/index.js";

const box = (left: number, top: number, size = 10): Box => ({ left, top, right: left + size, bottom: top + size });

describe("segmentEntry", () => {
  test("returns where the segment enters the box", () => {
    expect(segmentEntry({ x: 0, y: 5 }, { x: 40, y: 5 }, box(20, 0))).toBe(0.5);
  });

  test("is 0 for a segment that starts inside", () => {
    expect(segmentEntry({ x: 25, y: 5 }, { x: 100, y: 5 }, box(20, 0))).toBe(0);
  });

  test("is null for a miss, including a segment parallel to a side", () => {
    expect(segmentEntry({ x: 0, y: 50 }, { x: 100, y: 50 }, box(20, 0))).toBeNull();
    expect(segmentEntry({ x: 0, y: 5 }, { x: 15, y: 5 }, box(20, 0))).toBeNull();
  });

  test("works for a single point", () => {
    expect(segmentEntry({ x: 25, y: 5 }, { x: 25, y: 5 }, box(20, 0))).toBe(0);
    expect(segmentEntry({ x: 5, y: 5 }, { x: 5, y: 5 }, box(20, 0))).toBeNull();
  });
});

describe("boxesAlongSegment", () => {
  // A row of 16 steps, 10 px wide with 2 px gaps.
  const steps = Array.from({ length: 16 }, (_, index) => box(index * 12, 0));

  test("finds every step a fast drag crosses between two pointer events", () => {
    expect(boxesAlongSegment({ x: 5, y: 5 }, { x: 185, y: 5 }, steps)).toEqual(
      Array.from({ length: 16 }, (_, index) => index),
    );
  });

  test("orders them by when the pointer reaches them, also right to left", () => {
    expect(boxesAlongSegment({ x: 65, y: 5 }, { x: 5, y: 5 }, steps)).toEqual([5, 4, 3, 2, 1, 0]);
  });

  test("follows a diagonal drag through a grid", () => {
    const grid = [box(0, 0), box(12, 0), box(0, 12), box(12, 12)];
    expect(boxesAlongSegment({ x: 2, y: 2 }, { x: 20, y: 20 }, grid)).toEqual([0, 3]);
  });
});

describe("knob geometry", () => {
  test("angles run clockwise from 12 o'clock across the sweep", () => {
    expect(knobAngle(0)).toBe(-135);
    expect(knobAngle(0.5)).toBe(0);
    expect(knobAngle(1, 300)).toBe(150);
  });

  test("polar points at 12 and 3 o'clock", () => {
    expect(polar(50, 50, 40, 0)).toEqual({ x: 50, y: 10 });
    const east = polar(50, 50, 40, 90);
    expect(east.x).toBeCloseTo(90);
    expect(east.y).toBeCloseTo(50);
  });

  test("an arc is drawn in two halves, and an empty one draws nothing", () => {
    expect(arcPath(50, 50, 40, -90, 90)).toBe("M 10 50 A 40 40 0 0 1 50 10 A 40 40 0 0 1 90 50");
    expect(arcPath(50, 50, 40, 90, -90)).toBe(arcPath(50, 50, 40, -90, 90));
    expect(arcPath(50, 50, 40, 30, 30)).toMatch(/^M [\d.]+ [\d.]+$/);
  });
});
