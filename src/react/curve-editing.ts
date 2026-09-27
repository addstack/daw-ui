"use client";

import { useState } from "react";

import { numberFormat } from "../core/format.js";
import { gridStep, type CurvePoint, type Range, type TimeGrid, type ValueFormat } from "../core/index.js";
import { curvePosition, pointAfter } from "../core/curve.js";
import type { ContentAxis } from "./content.js";
import { focusFromPointer } from "./render.js";

/** An axis a point does not move on: `"both"`, and it cannot be grabbed at all. */
export type CurveLock = "time" | "value" | "both";

export type CurveEditReason = "drag" | "keyboard" | "add" | "remove" | "bend";

export type CurveChangeDetails = { reason: CurveEditReason; event: Event };

export type CurveEditingOptions = {
  /**
   * Moves snap: in time to the finest lines of `time` at least 12 px apart,
   * those a `Timeline.Grid` shows by default; in value to multiples of
   * `value`. Shift does not snap.
   */
  snap?: { time?: TimeGrid | undefined; value?: number | undefined } | undefined;
  /** Axes that points do not move on, by index, or as a function of the index and the point. */
  lock?: Readonly<Record<number, CurveLock>> | ((index: number, point: CurvePoint) => CurveLock | undefined) | undefined;
  /**
   * The application's rule for the points, applied to every change before
   * it shows: returns the points as they may be, e.g. an envelope's shape
   * from where its handles went. Keep the number of points and their order.
   */
  constrain?: ((points: CurvePoint[]) => CurvePoint[]) | undefined;
  /**
   * Whether a double-click on the curve adds a point.
   * @default true
   */
  canAdd?: boolean | undefined;
  /**
   * Whether a double-click on a point, or Delete, removes it.
   * @default true
   */
  canRemove?: boolean | undefined;
  /**
   * Text of a time and of a value, for what a point's handle announces.
   * @default formats.number({ digits: 2, unit: "s" }) and formats.number({ digits: 2 })
   */
  format?: { time?: ValueFormat | undefined; value?: ValueFormat | undefined } | undefined;
  /**
   * Called with the points as a gesture changes them, as it goes: a drag, a
   * key, a point added or removed, a segment bent. The curve shows them
   * without rendering; when the gesture ends it returns to its `points`, so
   * update them to keep the changes, here or in `onGestureEnd`.
   */
  onPointsChange?: ((points: CurvePoint[], details: CurveChangeDetails) => void) | undefined;
  /** Called before the first change of a gesture. */
  onGestureStart?: (() => void) | undefined;
  /** Called when a gesture ends, with the points it left: one undo step. */
  onGestureEnd?: ((points: CurvePoint[]) => void) | undefined;
  /** Called with the indexes of the selected points when a press or a key changes them. */
  onSelectedChange?: ((selected: number[]) => void) | undefined;
};

/** What a curve shows, given to its editing by `Curve.Root`. */
export type CurveTarget = { points: readonly CurvePoint[]; range: Range; axis: ContentAxis; element: HTMLElement | null };

type Active = { kind: "point" | "bend"; index: number };

// Pixels a press moves before it is a drag.
const THRESHOLD = 3;
// CSS pixels: a pointer this close to a point, or to the middle of a segment, grabs it.
const RADIUS = 8;
// Of the travel from bottom to top: what a key moves a value by, and with Shift.
const KEY_STEP = 0.01;
const FINE_STEP = 0.001;
// Of the tension: what Alt with Up or Down bends a segment by, and with Shift.
const BEND_STEP = 0.1;
const FINE_BEND_STEP = 0.02;

const defaultTime = numberFormat({ digits: 2, unit: "s" });
const defaultValue = numberFormat({ digits: 2 });

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const samePoint = (a: CurvePoint, b: CurvePoint) => a.at === b.at && a.value === b.value && (a.shape ?? "linear") === (b.shape ?? "linear");
const samePoints = (a: readonly CurvePoint[], b: readonly CurvePoint[]) => a.length === b.length && a.every((point, index) => samePoint(point, b[index]!));

/**
 * Edits the points of a `Curve.Root` it is given to: selects them, moves
 * them with a drag or keys, adds and removes them, bends the segments
 * between them. A stable object, not state: a gesture shows the points it
 * makes without rendering, and reports them through the callbacks.
 */
export class CurveEditing {
  options: CurveEditingOptions = {};
  private target: CurveTarget | null = null;
  /** The points a gesture makes, shown instead of the target's until it ends. */
  private live: CurvePoint[] | null = null;
  private readonly selection = new Set<number>();
  private hover: Active | null = null;
  private held: Active | null = null;
  private gesture: { started: boolean } | null = null;
  /** The point whose handle is the tab stop. */
  private current = 0;
  private focusPending: number | null = null;
  /** How many points the application gives back after an add or a remove of ours: the selection stays. */
  private expected: number | null = null;
  /** The curve's box while the pointer is over it, read once. */
  private box: DOMRect | undefined;
  private readonly listeners = new Set<() => void>();

  /** The points the curve shows: as a gesture makes them, or its own. */
  get points(): readonly CurvePoint[] {
    return this.live ?? this.target?.points ?? [];
  }

  /** The points a gesture makes while it goes, or `null`. */
  get preview(): readonly CurvePoint[] | null {
    return this.live;
  }

  /** The indexes of the selected points, in order. */
  get selected(): number[] {
    return [...this.selection].sort((a, b) => a - b);
  }

  /** Selects the points at `indexes`, and no others. */
  select(indexes: readonly number[]): void {
    this.selection.clear();
    for (const index of indexes) if (index >= 0 && index < this.points.length) this.selection.add(index);
    this.emit();
    this.options.onSelectedChange?.(this.selected);
  }

  selectAll(): void {
    this.select(this.points.map((_, index) => index));
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Called by `Curve.Root` on every render, with what it shows. */
  attach(target: CurveTarget): void {
    const previous = this.target;
    this.target = target;
    if (!this.live && previous && previous.points.length !== target.points.length) {
      // Points came from outside with another count: the selection no longer means the same points.
      if (target.points.length !== this.expected) this.selection.clear();
      this.expected = null;
    }
    this.current = clamp(this.current, 0, Math.max(0, target.points.length - 1));
    if (previous?.points !== target.points) this.emit();
  }

  lockOf(index: number): CurveLock | undefined {
    const { lock } = this.options;
    const point = this.points[index];
    if (!lock || !point) return undefined;
    return typeof lock === "function" ? lock(index, point) : lock[index];
  }

  private grabbable(index: number): boolean {
    return index >= 0 && index < this.points.length && this.lockOf(index) !== "both";
  }

  /** The point whose handle takes the focus from Tab: the current one, or the first that can be grabbed. */
  private tabStop(): number {
    if (this.grabbable(this.current)) return this.current;
    return this.points.findIndex((_, index) => this.grabbable(index));
  }

  isTabStop(index: number): boolean {
    return this.tabStop() === index;
  }

  isSelected(index: number): boolean {
    return this.selection.has(index);
  }

  isHeld(kind: Active["kind"], index: number): boolean {
    return this.held?.kind === kind && this.held.index === index && this.gesture !== null;
  }

  /** The points that have a handle now: the tab stop, the selection, the one pointed at or held. */
  handles(): number[] {
    const shown = new Set<number>();
    for (const index of [this.tabStop(), ...this.selection]) if (this.grabbable(index)) shown.add(index);
    for (const active of [this.hover, this.held]) if (active?.kind === "point" && this.grabbable(active.index)) shown.add(active.index);
    return [...shown].sort((a, b) => a - b);
  }

  /** The segments, by the index of their first point, that have a bend handle now: pointed at or held. */
  bends(): number[] {
    const shown = new Set<number>();
    for (const active of [this.hover, this.held]) if (active?.kind === "bend" && this.bendAt(active.index)) shown.add(active.index);
    return [...shown];
  }

  /** Whether the handle of `index` should take the focus now, once. */
  takeFocus(index: number): boolean {
    if (this.focusPending !== index) return false;
    this.focusPending = null;
    return true;
  }

  focusOn(index: number): void {
    if (this.current === index) return;
    this.current = index;
    this.emit();
  }

  // --- geometry ---

  private position(value: number): number {
    return clamp(this.target!.range.normalize(value), 0, 1);
  }

  private rect(): DOMRect | undefined {
    return this.target?.element?.getBoundingClientRect();
  }

  /** Seconds of the curve at `clientX`. */
  private timeAt(clientX: number, rect: DOMRect): number {
    const { view, placement, lies } = this.target!.axis;
    const seconds = (clientX - rect.left) / (view.scale || 1);
    return lies === "timeline" ? view.start + seconds - placement.at + placement.offset : placement.offset + seconds;
  }

  /** The travel position, 0 at the bottom and 1 at the top, at `clientY`. */
  private travelAt(clientY: number, rect: DOMRect): number {
    return clamp(1 - (clientY - rect.top) / (rect.height || 1), 0, 1);
  }

  /** The time step of a move: the snap grid's, a pixel with Shift, or ten pixels without a grid. */
  private timeStep(fine: boolean): number {
    const scale = this.target!.axis.view.scale || 1;
    const grid = this.options.snap?.time;
    if (fine) return 1 / scale;
    return grid ? gridStep(grid, scale, 12) : 10 / scale;
  }

  /** Where the bend handle of the segment after `index` is: its middle in time, on the curve. */
  bendAt(index: number): { at: number; position: number } | null {
    const points = this.points;
    const a = points[index];
    const b = points[index + 1];
    if (!a || !b || a.shape === "hold" || !(b.at > a.at) || !this.target) return null;
    if (this.position(a.value) === this.position(b.value)) return null;
    const at = (a.at + b.at) / 2;
    return { at, position: clamp(curvePosition(a, b, at, this.target.range), 0, 1) };
  }

  private hit(clientX: number, clientY: number, rect: DOMRect): Active | null {
    const points = this.points;
    if (points.length === 0 || !this.target) return null;
    const scale = this.target.axis.view.scale;
    const time = this.timeAt(clientX, rect);
    const y = clientY - rect.top;
    const distance = (at: number, position: number) => Math.hypot((at - time) * scale, (1 - position) * rect.height - y);
    const around = pointAfter(points, time);
    let found: Active | null = null;
    let nearest = RADIUS;
    for (let index = Math.max(0, around - 2); index < Math.min(points.length, around + 2); index++) {
      if (!this.grabbable(index)) continue;
      const d = distance(points[index]!.at, this.position(points[index]!.value));
      if (d <= nearest) [found, nearest] = [{ kind: "point", index }, d];
    }
    if (found) return found;
    for (let index = Math.max(0, around - 2); index < Math.min(points.length - 1, around + 1); index++) {
      const middle = this.bendAt(index);
      if (!middle) continue;
      const d = distance(middle.at, middle.position);
      if (d <= nearest) [found, nearest] = [{ kind: "bend", index }, d];
    }
    return found;
  }

  // --- pointer ---

  /** A pointer over the curve shows the handle of the point, or the bend, it is near. */
  hoverAt(event: PointerEvent): void {
    if (this.gesture) return;
    const rect = (this.box ??= this.rect());
    const found = rect ? this.hit(event.clientX, event.clientY, rect) : null;
    if (found?.kind === this.hover?.kind && found?.index === this.hover?.index) return;
    this.hover = found;
    this.emit();
  }

  leave(): void {
    this.box = undefined;
    if (!this.hover || this.gesture) return;
    this.hover = null;
    this.emit();
  }

  /** A press on the curve away from its handles clears the selection. */
  pressEmpty(event: PointerEvent): void {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || this.selection.size === 0) return;
    this.select([]);
  }

  /** A press on a point's handle: selects it, and a drag moves the selection. */
  pressPoint(index: number, event: PointerEvent, handle: HTMLElement): void {
    if (event.button !== 0 || !this.target) return;
    event.preventDefault();
    focusFromPointer(handle);
    this.current = index;
    const toggle = event.metaKey || event.ctrlKey;
    const wasSelected = this.selection.has(index);
    if (toggle) {
      if (wasSelected) this.selection.delete(index);
      else this.selection.add(index);
      this.emit();
      this.options.onSelectedChange?.(this.selected);
      if (wasSelected) return;
    } else if (!wasSelected) {
      this.select([index]);
    }
    const rect = this.rect();
    if (!rect) return;
    const snapshot = [...this.points];
    const start = { x: event.clientX, y: event.clientY };
    this.track({ kind: "point", index }, event, handle, "drag", (move) =>
      this.moved(snapshot, index, (move.clientX - start.x) / this.target!.axis.view.scale, -(move.clientY - start.y) / rect.height, !move.shiftKey),
      () => {
        // A press on a point already selected, without a drag, selects it alone.
        if (!toggle && wasSelected) this.select([index]);
      },
    );
  }

  /** A press on a bend handle: a drag up or down bends its segment, through the pointer. */
  pressBend(index: number, event: PointerEvent, handle: HTMLElement): void {
    if (event.button !== 0 || !this.target) return;
    event.preventDefault();
    const rect = this.rect();
    if (!rect) return;
    const snapshot = [...this.points];
    this.track({ kind: "bend", index }, event, handle, "bend", (move) => this.bent(snapshot, index, this.travelAt(move.clientY, rect)));
  }

  /** Follows a press on a handle until it is released: a drag once it has moved `THRESHOLD` pixels. */
  private track(
    active: Active,
    event: PointerEvent,
    handle: HTMLElement,
    reason: CurveEditReason,
    points: (move: PointerEvent) => CurvePoint[] | null,
    click?: () => void,
  ): void {
    this.held = active;
    this.emit();
    const start = { x: event.clientX, y: event.clientY };
    let dragging = false;
    handle.setPointerCapture?.(event.pointerId);
    const move = (moveEvent: PointerEvent) => {
      if (!dragging && Math.hypot(moveEvent.clientX - start.x, moveEvent.clientY - start.y) < THRESHOLD) return;
      if (!dragging) {
        dragging = true;
        this.gesture = { started: false };
      }
      const next = points(moveEvent);
      if (next) this.show(next, reason, moveEvent);
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      if (dragging) this.finish();
      else click?.();
      this.held = null;
      this.emit();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }

  /** A double-click on the curve, away from its handles, adds a point there. */
  addAt(event: MouseEvent): void {
    if (!this.target || this.options.canAdd === false) return;
    const rect = this.rect();
    if (!rect || this.hit(event.clientX, event.clientY, rect)) return;
    const { range } = this.target;
    let at = this.timeAt(event.clientX, rect);
    if (!event.shiftKey && this.options.snap?.time) {
      const step = this.timeStep(false);
      at = Math.round(at / step) * step;
    }
    const value = this.snapValue(range.denormalize(this.travelAt(event.clientY, rect)), !event.shiftKey);
    const points = this.points;
    const index = pointAfter(points, at);
    const added = [...points.slice(0, index), { at, value }, ...points.slice(index)];
    this.renumber((old) => (old >= index ? old + 1 : old));
    this.expected = added.length;
    if (this.once(added, "add", event)) {
      this.selection.clear();
      this.selection.add(index);
      this.current = index;
      this.focusPending = index;
      this.emit();
      this.options.onSelectedChange?.(this.selected);
    }
  }

  /** Removes the points at `indexes`, except those that cannot be grabbed. */
  remove(indexes: readonly number[], event: Event): void {
    if (this.options.canRemove === false) return;
    const removed = new Set(indexes.filter((index) => this.grabbable(index)));
    if (removed.size === 0) return;
    const kept = this.points.filter((_, index) => !removed.has(index));
    const below = (old: number) => [...removed].filter((index) => index < old).length;
    this.selection.clear();
    this.current = Math.max(0, this.current - below(this.current));
    this.focusPending = this.current;
    this.expected = kept.length;
    this.once(kept, "remove", event);
    this.options.onSelectedChange?.(this.selected);
  }

  /** A double-click on a bend handle makes its segment straight again. */
  straighten(index: number, event: Event): void {
    const points = this.points;
    const point = points[index];
    if (!point || typeof point.shape !== "number") return;
    this.once(points.map((one, at) => (at === index ? { ...one, shape: "linear" as const } : one)), "bend", event);
  }

  // --- keys ---

  /** A key on a point's handle; returns whether it was used. */
  keyOnPoint(index: number, event: KeyboardEvent): boolean {
    const edit = event.metaKey || event.ctrlKey;
    const fine = event.shiftKey;
    const points = this.points;
    const direction = event.key === "ArrowRight" || event.key === "ArrowUp" ? 1 : -1;
    // Keys move the selection when the point is in it, else the point alone.
    const group = this.selection.has(index) ? this.selected : [index];
    switch (event.key) {
      case "ArrowLeft":
      case "ArrowRight": {
        if (edit) return this.keyMove(group, index, direction * this.timeStep(fine), 0, event);
        for (let next = index + direction; next >= 0 && next < points.length; next += direction) {
          if (!this.grabbable(next)) continue;
          this.current = next;
          this.focusPending = next;
          this.emit();
          break;
        }
        return true;
      }
      case "ArrowUp":
      case "ArrowDown": {
        if (event.altKey) return this.keyBend(index, direction * (fine ? FINE_BEND_STEP : BEND_STEP), event);
        const step = this.options.snap?.value;
        if (step && !fine) {
          const point = points[index]!;
          const next = this.snapValue(point.value + direction * step, true);
          return this.keyMove(group, index, 0, this.position(next) - this.position(point.value), event);
        }
        return this.keyMove(group, index, 0, direction * (fine ? FINE_STEP : KEY_STEP), event);
      }
      case "Delete":
      case "Backspace":
        this.remove(group, event);
        return true;
      case " ": {
        if (edit) {
          if (this.selection.has(index)) this.selection.delete(index);
          else this.selection.add(index);
          this.emit();
          this.options.onSelectedChange?.(this.selected);
        } else {
          this.select([index]);
        }
        return true;
      }
      default:
        return false;
    }
  }

  private keyMove(group: number[], held: number, seconds: number, travel: number, event: Event): boolean {
    const moved = this.moved(this.points, held, seconds, travel, false, group);
    if (moved) this.once(moved, "keyboard", event);
    return true;
  }

  /** Bends the segment after `index` so that its middle goes up by `step` of the tension's way. */
  private keyBend(index: number, step: number, event: Event): boolean {
    const points = this.points;
    const a = points[index];
    const b = points[index + 1];
    if (!a || !b || !this.bendAt(index)) return true;
    const rising = this.position(b.value) > this.position(a.value);
    // Up raises the middle: a rising segment moves earlier, a falling one later.
    const tension = clamp((typeof a.shape === "number" ? a.shape : 0) + (rising ? -step : step), -1, 1);
    this.once(points.map((one, at) => (at === index ? { ...one, shape: Math.abs(tension) < 1e-9 ? ("linear" as const) : tension } : one)), "bend", event);
    return true;
  }

  // --- changes ---

  private snapValue(value: number, snap: boolean): number {
    const step = this.options.snap?.value;
    return snap && step ? this.target!.range.clamp(Math.round(value / step) * step) : value;
  }

  /**
   * The points after moving `group` (the selection, by default) by
   * `seconds` and `travel`, from `snapshot`: the held point snapped, and the
   * move limited for the group, so that no point passes a neighbour that
   * does not move and no value leaves the range.
   */
  private moved(
    snapshot: readonly CurvePoint[],
    held: number,
    seconds: number,
    travel: number,
    snap: boolean,
    group: readonly number[] = this.selected,
  ): CurvePoint[] | null {
    const { range } = this.target!;
    const moving = new Set(group.filter((index) => this.grabbable(index)));
    moving.add(held);
    const heldPoint = snapshot[held];
    if (!heldPoint) return null;
    const heldLock = this.lockOf(held);
    if (snap && heldLock !== "time" && this.options.snap?.time) {
      const step = this.timeStep(false);
      seconds = Math.round((heldPoint.at + seconds) / step) * step - heldPoint.at;
    }
    if (snap && heldLock !== "value" && this.options.snap?.value) {
      const value = this.snapValue(range.denormalize(clamp(this.position(heldPoint.value) + travel, 0, 1)), true);
      travel = this.position(value) - this.position(heldPoint.value);
    }
    const movesInTime = (index: number) => moving.has(index) && this.lockOf(index) !== "time";
    let [lowest, highest, lowestTravel, highestTravel] = [-Infinity, Infinity, -Infinity, Infinity];
    for (const index of moving) {
      const point = snapshot[index]!;
      const lock = this.lockOf(index);
      if (lock !== "time") {
        let before = index - 1;
        while (before >= 0 && movesInTime(before)) before--;
        let after = index + 1;
        while (after < snapshot.length && movesInTime(after)) after++;
        if (before >= 0) lowest = Math.max(lowest, snapshot[before]!.at - point.at);
        if (after < snapshot.length) highest = Math.min(highest, snapshot[after]!.at - point.at);
      }
      if (lock !== "value") {
        const position = this.position(point.value);
        lowestTravel = Math.max(lowestTravel, -position);
        highestTravel = Math.min(highestTravel, 1 - position);
      }
    }
    seconds = clamp(seconds, lowest, highest);
    travel = clamp(travel, lowestTravel, highestTravel);
    return snapshot.map((point, index) => {
      if (!moving.has(index)) return point;
      const lock = this.lockOf(index);
      const at = lock === "time" ? point.at : point.at + seconds;
      const value = lock === "value" || travel === 0 ? point.value : range.denormalize(this.position(point.value) + travel);
      return at === point.at && value === point.value ? point : { ...point, at, value };
    });
  }

  /** The points after bending the segment after `index` so that its middle is at `travel`. */
  private bent(snapshot: readonly CurvePoint[], index: number, travel: number): CurvePoint[] | null {
    const a = snapshot[index];
    const b = snapshot[index + 1];
    if (!a || !b) return null;
    const from = this.position(a.value);
    const to = this.position(b.value);
    if (from === to) return null;
    // The middle of a segment bent by a tension t is at from + (to - from) · 0.5 ** 2 ** (3t).
    const ratio = clamp((travel - from) / (to - from), 0.01, 0.99);
    let tension = clamp(Math.log2(Math.log(ratio) / Math.log(0.5)) / 3, -1, 1);
    if (Math.abs(tension) < 0.03) tension = 0;
    return snapshot.map((point, at) => (at === index ? { ...point, shape: tension === 0 ? ("linear" as const) : tension } : point));
  }

  /** Shows `points` as the gesture's, through the application's rule; reports them when they changed. */
  private show(points: CurvePoint[], reason: CurveEditReason, event: Event): boolean {
    const shown = this.options.constrain ? this.options.constrain(points) : points;
    if (samePoints(shown, this.points)) return false;
    if (this.gesture && !this.gesture.started) {
      this.gesture.started = true;
      this.options.onGestureStart?.();
    }
    this.live = shown;
    this.emit();
    this.options.onPointsChange?.(shown, { reason, event });
    return true;
  }

  private finish(): void {
    const gesture = this.gesture;
    this.gesture = null;
    if (gesture?.started && this.live) this.options.onGestureEnd?.(this.live);
    this.live = null;
    this.emit();
  }

  /** A change made at once, by a key or a double-click: one gesture. */
  private once(points: CurvePoint[], reason: CurveEditReason, event: Event): boolean {
    this.gesture = { started: false };
    const changed = this.show(points, reason, event);
    this.finish();
    return changed;
  }

  private renumber(to: (index: number) => number): void {
    const selected = [...this.selection];
    this.selection.clear();
    for (const index of selected) this.selection.add(to(index));
    this.current = to(this.current);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

/**
 * An editing engine for a `Curve.Root`: give it to the root as `editing`,
 * and its handles and bends take the gestures. The object is the same on
 * every render; read `selected` and call `select` or `selectAll` on it.
 */
export function useCurveEditing(options: CurveEditingOptions = {}): CurveEditing {
  const [editing] = useState(() => new CurveEditing());
  editing.options = options;
  return editing;
}

export const curveFormats = (options: CurveEditingOptions) => ({
  time: options.format?.time ?? defaultTime,
  value: options.format?.value ?? defaultValue,
});
