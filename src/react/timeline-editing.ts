import { gridStep, type TimeGrid, type ValueFormat } from "../core/index.js";
import type { RegionPlacement, RegionState, TimelineView } from "./timeline.js";

/** What a gesture does to regions: moves them, or moves their start or end edge. */
export type RegionEdit = "move" | "start" | "end";

/** Where a region is after a gesture, and on which track. */
export type RegionChange = {
  value: string;
  at: number;
  duration: number;
  offset: number;
  /** The `value` of its track. */
  track: string | undefined;
};

export type RegionsChangeDetails = {
  reason: "drag" | "keyboard";
  edit: RegionEdit;
  event: Event;
};

export type SelectionChangeDetails = {
  reason: "press" | "keyboard";
  event: Event;
};

export type EditingOptions = {
  snap: TimeGrid | undefined;
  onRegionsChange: ((changes: RegionChange[], details: RegionsChangeDetails) => void) | undefined;
  onGestureStart: (() => void) | undefined;
  onGestureEnd: ((changes: RegionChange[]) => void) | undefined;
  onSelectedChange: ((selected: string[], details: SelectionChangeDetails) => void) | undefined;
  /** The selection from props, when controlled. */
  selected: readonly string[] | undefined;
  /** Text of a time, for the handles' `aria-valuetext`. */
  format: ValueFormat | undefined;
};

// Pixels a pointer moves before a press on a region becomes a drag: a click that trembles moves nothing.
const DRAG_THRESHOLD = 3;
// Snap points are the finest lines of `snap` at least this far apart: those of a `Timeline.Grid` with its default spacing.
const SNAP_SPACING = 12;
// Without snapping, a key moves this many pixels of time; with Shift, one.
const KEY_PIXELS = 10;

/** A track, for moving regions between tracks. */
export class TrackEntry {
  constructor(
    public value: string | undefined,
    public element: HTMLElement,
  ) {}
}

/** A region as the timeline edits it: its placement outside React, and what its parts show. */
export class RegionEntry {
  value: string | undefined = undefined;
  /** The placement from props, which a gesture's preview returns to when it ends. */
  props: RegionState;
  /** Seconds of content, when bounded: trimming never goes past it. */
  length: number | undefined = undefined;
  track: TrackEntry | null = null;
  element: HTMLElement | null = null;
  /** The id of its `RegionLabel`, which names it. */
  labelId: string | undefined = undefined;
  hovered = false;
  focused = false;
  private listeners = new Set<() => void>();

  constructor(
    readonly placement: RegionPlacement,
    props: RegionState,
  ) {
    this.props = props;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  emit(): void {
    for (const listener of this.listeners) listener();
  }
}

type Grabbed = { entry: RegionEntry; at: number; duration: number; offset: number; track: number };

/**
 * The editing of regions on a timeline: the selection, and gestures that
 * move or trim every selected region together (docs/principles.md,
 * section 6). A region only starts a gesture; the timeline applies it to the
 * selection, keeps the group within its limits, snaps the region the user
 * holds, and reports one list of changes per step, and the gesture once.
 *
 * During a gesture, regions show where they go by their placement, without
 * rendering; when it ends, they return to their props, which the
 * application has updated if it took the changes.
 */
export class TimelineEditing {
  options: EditingOptions = {
    snap: undefined,
    onRegionsChange: undefined,
    onGestureStart: undefined,
    onGestureEnd: undefined,
    onSelectedChange: undefined,
    selected: undefined,
    format: undefined,
  };
  editable = false;
  root: HTMLElement | null = null;
  readonly regions = new Set<RegionEntry>();
  readonly tracks = new Set<TrackEntry>();
  private selected = new Set<string>();
  private tabStop: RegionEntry | null = null;
  /** Regions being dragged. */
  private dragging = new Set<RegionEntry>();
  /** A region to focus when it mounts, after a key moved it to another track. */
  private pendingFocus: string | undefined;

  constructor(private readonly view: TimelineView) {}

  // --- registration ---

  addRegion(entry: RegionEntry): () => void {
    this.regions.add(entry);
    if (entry.value !== undefined && entry.value === this.pendingFocus) {
      this.pendingFocus = undefined;
      this.tabStop = entry;
      entry.element?.focus({ preventScroll: true });
    }
    this.refreshTabStops();
    return () => {
      this.regions.delete(entry);
      if (this.tabStop === entry) this.tabStop = null;
      this.refreshTabStops();
    };
  }

  addTrack(entry: TrackEntry): () => void {
    this.tracks.add(entry);
    return () => {
      this.tracks.delete(entry);
    };
  }

  // --- what parts show ---

  isSelected(entry: RegionEntry): boolean {
    return entry.value !== undefined && this.selected.has(entry.value);
  }

  isDragging(entry: RegionEntry): boolean {
    return this.dragging.has(entry);
  }

  /** Whether the region shows its handles: pointed at, focused, selected, or being edited. */
  isActive(entry: RegionEntry): boolean {
    return entry.hovered || entry.focused || this.isSelected(entry) || this.dragging.has(entry);
  }

  /** The one region in the tab order: the last focused, or the first. */
  isTabStop(entry: RegionEntry): boolean {
    return this.currentTabStop() === entry;
  }

  private currentTabStop(): RegionEntry | null {
    if (this.tabStop && this.regions.has(this.tabStop)) return this.tabStop;
    for (const entry of this.regions) if (entry.value !== undefined) return entry;
    return null;
  }

  private refreshTabStops(): void {
    for (const entry of this.regions) entry.emit();
  }

  setHovered(entry: RegionEntry, hovered: boolean): void {
    if (entry.hovered === hovered) return;
    entry.hovered = hovered;
    entry.emit();
  }

  setFocused(entry: RegionEntry, focused: boolean): void {
    if (entry.focused === focused) return;
    entry.focused = focused;
    if (focused && this.tabStop !== entry) {
      const previous = this.currentTabStop();
      this.tabStop = entry;
      previous?.emit();
    }
    entry.emit();
  }

  // --- selection ---

  /** The selection from props, or initially from `defaultSelected`. */
  setSelection(values: readonly string[]): void {
    const next = new Set(values);
    if (next.size === this.selected.size && [...next].every((value) => this.selected.has(value))) return;
    const changed = new Set([...this.selected, ...next].filter((value) => this.selected.has(value) !== next.has(value)));
    this.selected = next;
    for (const entry of this.regions) if (entry.value !== undefined && changed.has(entry.value)) entry.emit();
  }

  /** A selection the user made: reported, and applied unless the selection is controlled. */
  private select(next: Set<string>, details: SelectionChangeDetails): void {
    const same = next.size === this.selected.size && [...next].every((value) => this.selected.has(value));
    if (same) return;
    if (this.options.selected === undefined) this.setSelection([...next]);
    this.options.onSelectedChange?.([...next], details);
  }

  /** A press on a track outside its regions clears the selection. */
  pressTrack(event: PointerEvent): void {
    if (!this.editable || event.button !== 0) return;
    this.select(new Set(), { reason: "press", event });
  }

  /**
   * The selection a press or key on `entry` makes, and the regions its
   * gesture applies to: an unselected region alone, a selected one with the
   * others, and with Cmd or Ctrl, the selection with `entry` toggled.
   */
  private selectFor(entry: RegionEntry, event: KeyboardEvent | PointerEvent, reason: SelectionChangeDetails["reason"]) {
    const value = entry.value!;
    const additive = event.metaKey || event.ctrlKey;
    const selected = new Set(this.selected);
    if (additive) {
      if (selected.has(value)) selected.delete(value);
      else selected.add(value);
    } else if (!selected.has(value)) {
      selected.clear();
      selected.add(value);
    }
    this.select(selected, { reason, event });
    return selected;
  }

  // --- geometry ---

  private step(fine: boolean): number {
    const scale = this.view.scale;
    if (!(scale > 0)) return 0;
    if (!this.options.snap || fine) return 1 / scale;
    return gridStep(this.options.snap, scale, SNAP_SPACING);
  }

  private snap(time: number, fine: boolean): number {
    const snap = this.options.snap;
    if (!snap || fine || !(this.view.scale > 0)) return time;
    const step = gridStep(snap, this.view.scale, SNAP_SPACING);
    return Math.round(time / step) * step;
  }

  /** The shortest a region can be trimmed to: one snap step, or one pixel. */
  private minimum(): number {
    return this.step(false) || 0;
  }

  /** Tracks in document order, with their boxes: read once per gesture. */
  private trackBoxes(): { entry: TrackEntry; top: number; bottom: number }[] {
    return [...this.tracks]
      .sort((a, b) => (a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
      .map((entry) => {
        const box = entry.element.getBoundingClientRect();
        return { entry, top: box.top, bottom: box.bottom };
      });
  }

  private grab(values: Set<string>, tracks: { entry: TrackEntry }[]): Grabbed[] {
    const grabbed: Grabbed[] = [];
    for (const entry of this.regions) {
      if (entry.value === undefined || !values.has(entry.value)) continue;
      const { at, duration, offset } = entry.placement;
      grabbed.push({ entry, at, duration, offset, track: tracks.findIndex((track) => track.entry === entry.track) });
    }
    return grabbed;
  }

  /**
   * Places the group for an edit by `delta` seconds (of the edge or the start
   * the user holds) and `rows` tracks, within the limits of every region, and
   * returns the changes.
   */
  private place(
    group: Grabbed[],
    edit: RegionEdit,
    delta: number,
    rows: number,
    tracks: { entry: TrackEntry; top: number }[],
  ): RegionChange[] {
    const minimum = this.minimum();
    let low = -Infinity;
    let high = Infinity;
    for (const { entry, at, duration, offset } of group) {
      if (edit === "move") low = Math.max(low, -at);
      else if (edit === "end") {
        low = Math.max(low, minimum - duration);
        if (entry.length !== undefined) high = Math.min(high, entry.length - offset - duration);
      } else {
        low = Math.max(low, -offset, -at);
        high = Math.min(high, duration - minimum);
      }
    }
    const clamped = low > high ? 0 : Math.min(high, Math.max(low, delta));

    let lowRows = -Infinity;
    let highRows = Infinity;
    for (const { track } of group) {
      if (track < 0) lowRows = highRows = 0;
      else {
        lowRows = Math.max(lowRows, -track);
        highRows = Math.min(highRows, tracks.length - 1 - track);
      }
    }
    const shift = edit === "move" && lowRows <= highRows ? Math.min(highRows, Math.max(lowRows, rows)) : 0;

    return group.map(({ entry, at, duration, offset, track }) => {
      const next =
        edit === "move"
          ? { at: at + clamped, duration, offset }
          : edit === "end"
            ? { at, duration: duration + clamped, offset }
            : { at: at + clamped, duration: duration - clamped, offset: offset + clamped };
      const to = track >= 0 ? track + shift : -1;
      const lift = to >= 0 ? tracks[to]!.top - tracks[track]!.top : 0;
      entry.placement.set(next.at, next.duration, next.offset, lift);
      return { value: entry.value!, ...next, track: to >= 0 ? tracks[to]!.entry.value : entry.track?.value };
    });
  }

  private end(group: Grabbed[]): void {
    for (const { entry } of group) {
      this.dragging.delete(entry);
      // Back to the props, which the application has updated if it took the changes.
      entry.placement.set(entry.props.at, entry.props.duration, entry.props.offset, 0);
      entry.emit();
    }
  }

  // --- pointer ---

  /** A press on a region (`move`) or on one of its handles (`start`, `end`). */
  press(entry: RegionEntry, edit: RegionEdit, event: PointerEvent, target: HTMLElement): void {
    if (!this.editable || entry.value === undefined || event.button !== 0) return;
    event.preventDefault();
    entry.element?.focus({ preventScroll: true });
    const wasSelected = this.isSelected(entry);
    const selected = this.selectFor(entry, event, "press");
    // Cmd or Ctrl on a selected region only takes it out of the selection.
    if (!selected.has(entry.value)) return;

    const tracks = this.trackBoxes();
    const group = this.grab(selected, tracks);
    const held = group.find((grabbed) => grabbed.entry === entry)!;
    const originX = event.clientX;
    const originY = event.clientY;
    const left = this.root?.getBoundingClientRect().left ?? 0;
    const timeAt = (x: number) => this.view.start + (x - left) / this.view.scale;
    const origin = timeAt(originX);
    const pointerId = event.pointerId;
    let dragging = false;
    let started = false;
    let last: RegionChange[] = [];

    try {
      target.setPointerCapture(pointerId);
    } catch {
      // The pointer may already be gone.
    }

    const onMove = (move: PointerEvent) => {
      if (move.pointerId !== pointerId) return;
      if (!dragging) {
        if (Math.hypot(move.clientX - originX, move.clientY - originY) < DRAG_THRESHOLD) return;
        dragging = true;
        for (const { entry: grabbed } of group) {
          this.dragging.add(grabbed);
          grabbed.emit();
        }
      }
      // The held region's start or edge snaps; the others keep their places relative to it.
      const edge = edit === "end" ? held.at + held.duration : held.at;
      const delta = this.snap(edge + timeAt(move.clientX) - origin, move.shiftKey) - edge;
      const row = tracks.findIndex((track) => move.clientY < track.bottom);
      const rows = held.track < 0 ? 0 : (row < 0 ? tracks.length - 1 : row) - held.track;
      const changes = this.place(group, edit, delta, rows, tracks);
      if (sameChanges(changes, last)) return;
      last = changes;
      if (!started) {
        started = true;
        this.options.onGestureStart?.();
      }
      this.options.onRegionsChange?.(changes, { reason: "drag", edit, event: move });
    };
    const onEnd = (end: PointerEvent) => {
      if (end.pointerId !== pointerId) return;
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onEnd);
      target.removeEventListener("pointercancel", onEnd);
      target.removeEventListener("lostpointercapture", onEnd);
      // A click on one of several selected regions, without a drag, selects it alone.
      if (!dragging && wasSelected && !(event.metaKey || event.ctrlKey)) this.select(new Set([entry.value!]), { reason: "press", event: end });
      if (started) this.options.onGestureEnd?.(last);
      if (dragging) this.end(group);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onEnd);
    target.addEventListener("pointercancel", onEnd);
    target.addEventListener("lostpointercapture", onEnd);
  }

  // --- keyboard ---

  /** Keys on a focused region: arrows move focus, Space selects, Cmd or Ctrl and arrows move the selection. */
  keyOnRegion(entry: RegionEntry, event: KeyboardEvent): boolean {
    if (!this.editable || entry.value === undefined) return false;
    const command = event.metaKey || event.ctrlKey;
    if (event.key === " ") {
      this.selectFor(entry, event, "keyboard");
      return true;
    }
    const horizontal = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    const vertical = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (!horizontal && !vertical) return false;
    if (!command) {
      this.focusNeighbour(entry, horizontal, vertical);
      return true;
    }
    this.editByKey(entry, "move", horizontal, vertical, event);
    return true;
  }

  /** Arrows on a focused handle move its edge, for the selection. */
  keyOnHandle(entry: RegionEntry, side: "start" | "end", event: KeyboardEvent): boolean {
    if (!this.editable || entry.value === undefined) return false;
    const direction = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (!direction) return false;
    this.editByKey(entry, side, direction, 0, event);
    return true;
  }

  private editByKey(entry: RegionEntry, edit: RegionEdit, horizontal: number, vertical: number, event: KeyboardEvent): void {
    // An unselected region is edited alone; Cmd or Ctrl here means "edit", not "add to the selection".
    let selected = new Set(this.selected);
    if (!selected.has(entry.value!)) {
      selected = new Set([entry.value!]);
      this.select(selected, { reason: "keyboard", event });
    }
    const tracks = this.trackBoxes();
    const group = this.grab(selected, tracks);
    // One snap step; with Shift, or without snapping, pixels of time.
    const scale = this.view.scale || 1;
    const step = event.shiftKey ? 1 / scale : this.options.snap ? this.step(false) : KEY_PIXELS / scale;
    const changes = this.place(group, edit, horizontal * step, vertical, tracks);
    const moved = changes.some((change, index) => {
      const before = group[index]!;
      return change.at !== before.at || change.duration !== before.duration || change.track !== before.entry.track?.value;
    });
    if (moved) {
      this.options.onGestureStart?.();
      this.options.onRegionsChange?.(changes, { reason: "keyboard", edit, event });
      this.options.onGestureEnd?.(changes);
      // Focus follows the region to its new track, where it mounts again right after this event.
      if (vertical) {
        this.pendingFocus = entry.value;
        setTimeout(() => (this.pendingFocus = undefined));
      }
    }
    this.end(group);
  }

  private focusNeighbour(entry: RegionEntry, horizontal: number, vertical: number): void {
    const inTrack = (track: TrackEntry | null) =>
      [...this.regions].filter((other) => other.value !== undefined && other.track === track).sort((a, b) => a.placement.at - b.placement.at);
    let next: RegionEntry | undefined;
    if (horizontal) {
      const row = inTrack(entry.track);
      next = row[row.indexOf(entry) + horizontal];
    } else if (entry.track) {
      const tracks = this.trackBoxes();
      const index = tracks.findIndex((track) => track.entry === entry.track);
      const target = tracks[index + vertical];
      if (target) {
        const row = inTrack(target.entry);
        next = row.sort((a, b) => Math.abs(a.placement.at - entry.placement.at) - Math.abs(b.placement.at - entry.placement.at))[0];
      }
    }
    next?.element?.focus();
  }
}

const sameChanges = (a: RegionChange[], b: RegionChange[]) =>
  a.length === b.length &&
  a.every((change, index) => {
    const other = b[index]!;
    return change.at === other.at && change.duration === other.duration && change.offset === other.offset && change.track === other.track;
  });
