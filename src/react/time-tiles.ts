import { onEveryFrame } from "./frame-loop.js";
import type { TimelineView } from "./timeline.js";

/** A stretch of the timeline that one tile draws. */
export type TileStretch = {
  /** Timeline seconds at the tile's left edge. */
  start: number;
  /** Seconds it covers. */
  length: number;
  /** Device pixels. */
  width: number;
  /** Device pixels. */
  height: number;
  /** Device pixels per CSS pixel. */
  ratio: number;
};

/** What tiles draw, and where on the timeline there is something to draw. */
export type TilePainter = {
  /** Timeline seconds with content, `[from, to)`: a clip, or `-Infinity` … `Infinity` for a grid. */
  extent(): { from: number; to: number };
  /** Draws a stretch into a cleared tile, with `fillStyle` set to the element's CSS `color`. */
  paint(context: CanvasRenderingContext2D, stretch: TileStretch): void;
};

/**
 * Where the element holding the tiles sits: at the start of the painter's
 * extent, as a waveform placed like a `Timeline.Item`, or at the view's left
 * edge, as a grid that spans the timeline.
 */
export type TilePlacement = "item" | "view";

// CSS pixels per tile when drawn: wide enough that a screen needs few, narrow enough to draw several per frame.
const TILE = 1024;
// A zoom that stops for this long is drawn again, sharp; until then, the tiles are stretched.
const SETTLE_MS = 150;
// Milliseconds of drawing per frame, for all tiles together: the rest of the frame stays free.
const FRAME_BUDGET_MS = 4;

// --- one queue for everything drawn in tiles, worked off within the frame budget ---

const pending = new Set<TimeTiles>();
let stopWorking: (() => void) | null = null;

function work(): void {
  const deadline = performance.now() + FRAME_BUDGET_MS;
  // Round-robin, so that everything in view gets its visible tiles first.
  while (pending.size > 0 && performance.now() < deadline) {
    for (const tiles of pending) {
      if (!tiles.drawNext()) pending.delete(tiles);
      if (performance.now() >= deadline) break;
    }
  }
  if (pending.size === 0) stop();
}

function stop(): void {
  stopWorking?.();
  stopWorking = null;
}

function request(tiles: TimeTiles): void {
  pending.add(tiles);
  stopWorking ??= onEveryFrame(work);
}

/**
 * Tiles drawn at one scale. A tile covers a fixed stretch of time and is
 * placed and sized in CSS from the timeline's variables, so a layer stays
 * in place at any zoom, stretched until a layer at the new scale replaces it.
 */
type Layer = {
  /** CSS pixels per second when drawn. */
  scale: number;
  element: HTMLDivElement;
  tiles: Map<number, HTMLCanvasElement>;
  drawn: Set<number>;
};

type Range = { first: number; last: number; before: number; after: number; base: number; seconds: number; to: number };

/**
 * Draws what a painter paints on a timeline into canvas tiles inside
 * `container`, without React.
 *
 * Tiles are drawn once, from a queue shared by everything drawn in tiles
 * that spends at most 4 ms per frame, visible tiles first, then one on each
 * side. Playback and scrolling move them in CSS and draw only tiles that
 * come into view. A zoom stretches them in CSS; when it rests, or goes past
 * twice or half their scale, a new layer is drawn at the new scale over the
 * old one, which is removed once the new one covers the view. The color is
 * the container's CSS `color`, read again when it changes.
 */
export class TimeTiles {
  private readonly probe: HTMLSpanElement;
  private readonly cleanups: (() => void)[] = [];
  /** The complete layer on screen. */
  private shown: Layer | null = null;
  /** The layer being drawn, over `shown`. */
  private next: Layer | null = null;
  private height = 0;
  private visible = true;
  private color = "";
  private settle: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly container: HTMLElement,
    private readonly view: TimelineView,
    private readonly painter: TilePainter,
    private readonly placement: TilePlacement,
  ) {
    // Transitions report a change of the inherited color, whatever caused it: a theme class, a media query, a hover.
    this.probe = container.ownerDocument.createElement("span");
    this.probe.setAttribute("aria-hidden", "true");
    this.probe.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;transition:color 1ms";
    container.append(this.probe);

    const recolor = () => {
      this.color = "";
      this.relayer(true);
    };
    this.probe.addEventListener("transitionend", recolor);
    this.cleanups.push(() => this.probe.removeEventListener("transitionend", recolor));
    this.cleanups.push(view.subscribe(() => this.onView()));

    const window = container.ownerDocument.defaultView;
    if (window?.ResizeObserver) {
      const observer = new window.ResizeObserver(() => {
        const height = container.clientHeight;
        if (height === this.height) return;
        this.height = height;
        this.relayer(true);
      });
      observer.observe(container);
      this.cleanups.push(() => observer.disconnect());
    }
    if (window?.IntersectionObserver) {
      // Out of sight (a track scrolled away), nothing is drawn until it returns.
      const observer = new window.IntersectionObserver(([entry]) => {
        this.visible = entry!.isIntersecting;
        this.cull();
      });
      observer.observe(container);
      this.cleanups.push(() => observer.disconnect());
    }
    if (window?.matchMedia) {
      // A change of pixel ratio (another screen, the browser's zoom) needs sharper or smaller tiles.
      let resolution: MediaQueryList | undefined;
      const onResolution = () => {
        watchResolution();
        this.relayer(true);
      };
      const watchResolution = () => {
        resolution?.removeEventListener("change", onResolution);
        resolution = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
        resolution.addEventListener("change", onResolution);
      };
      watchResolution();
      const scheme = window.matchMedia("(prefers-color-scheme: dark)");
      scheme.addEventListener("change", recolor);
      this.cleanups.push(() => {
        resolution?.removeEventListener("change", onResolution);
        scheme.removeEventListener("change", recolor);
      });
    }
    this.relayer(false);
  }

  /** The painter draws something else: what is shown goes at once. */
  reset(): void {
    this.relayer(false);
  }

  /** What is drawn from `from` (timeline seconds) on has changed, as when audio arrives: it is drawn again over itself. */
  invalidate(from: number): void {
    for (const layer of [this.shown, this.next]) {
      const range = layer && this.range(layer);
      if (!layer || !range) continue;
      for (const index of layer.drawn) {
        if (range.base + (index + 1) * range.seconds > from) layer.drawn.delete(index);
      }
    }
    this.cull();
  }

  /** Drops tiles far from the view, and asks the queue for the ones missing in it: after a scroll, or a change of the extent. */
  cull(): void {
    for (const layer of [this.shown, this.next]) {
      const range = layer && this.range(layer);
      if (!layer || !range) continue;
      for (const [index, canvas] of layer.tiles) {
        if (index >= range.before - 1 && index <= range.after + 1) continue;
        canvas.remove();
        layer.tiles.delete(index);
        layer.drawn.delete(index);
      }
    }
    if (this.visible && this.height > 0 && this.nextTile() !== null) request(this);
  }

  destroy(): void {
    clearTimeout(this.settle);
    pending.delete(this);
    if (pending.size === 0) stop();
    for (const cleanup of this.cleanups) cleanup();
    this.shown?.element.remove();
    this.next?.element.remove();
    this.probe.remove();
  }

  private onView(): void {
    const top = this.next ?? this.shown;
    if (!top) return this.relayer(false);
    const ratio = this.view.scale / top.scale;
    // Scrolling keeps the scale, up to rounding: (start + 60) − start is not always 60.
    if (Math.abs(ratio - 1) < 1e-6) {
      clearTimeout(this.settle);
      this.settle = undefined;
    } else if (ratio < 0.5 || ratio > 2) {
      return this.relayer(true);
    } else {
      clearTimeout(this.settle);
      this.settle = setTimeout(() => this.relayer(true), SETTLE_MS);
    }
    this.cull();
  }

  /** Starts a layer at the current scale, over what is shown, which stays while `keep` until the new one covers the view. */
  private relayer(keep: boolean): void {
    clearTimeout(this.settle);
    this.settle = undefined;
    if (this.next) {
      // A layer never finished: it replaces nothing yet shown, or it goes.
      if (!this.shown && keep) this.shown = this.next;
      else this.next.element.remove();
    }
    if (!keep) {
      this.shown?.element.remove();
      this.shown = null;
    }
    this.next = null;
    const scale = this.view.scale;
    if (!(scale > 0)) return;
    const element = this.container.ownerDocument.createElement("div");
    element.style.cssText = "position:absolute;inset:0";
    this.container.insertBefore(element, this.probe);
    this.next = { scale, element, tiles: new Map(), drawn: new Set() };
    this.cull();
  }

  /** The tiles of `layer` in view, and with one on each side. */
  private range(layer: Layer): Range | null {
    const { from, to } = this.painter.extent();
    if (!(to > from)) return null;
    const seconds = TILE / layer.scale;
    const base = Number.isFinite(from) ? from : 0;
    const lowest = Number.isFinite(from) ? 0 : -Infinity;
    const highest = Number.isFinite(to) ? Math.ceil((to - base) / seconds) - 1 : Infinity;
    const first = Math.max(lowest, Math.floor((this.view.start - base) / seconds));
    const last = Math.min(highest, Math.floor((this.view.end - base) / seconds));
    if (last < first) return { first, last, before: first, after: last, base, seconds, to };
    return { first, last, before: Math.max(lowest, first - 1), after: Math.min(highest, last + 1), base, seconds, to };
  }

  /** The most needed tile not drawn yet in the top layer: in view first, then one on each side. */
  private nextTile(): number | null {
    const layer = this.next ?? this.shown;
    const range = layer && this.range(layer);
    if (!layer || !range) return null;
    for (let index = range.first; index <= range.last; index++) if (!layer.drawn.has(index)) return index;
    if (this.next) {
      // The new layer covers the view: the old one can go.
      this.shown?.element.remove();
      this.shown = this.next;
      this.next = null;
    }
    if (range.last < range.first) return null;
    for (const index of [range.after, range.before]) if (!layer.drawn.has(index)) return index;
    return null;
  }

  /** Draws one tile; returns whether any is left to draw. Called by the shared queue. */
  drawNext(): boolean {
    if (!this.visible || this.height <= 0) return false;
    const index = this.nextTile();
    const layer = this.next ?? this.shown;
    const range = layer && this.range(layer);
    if (index === null || !layer || !range) return false;
    let canvas = layer.tiles.get(index);
    if (!canvas) {
      canvas = this.container.ownerDocument.createElement("canvas");
      layer.element.append(canvas);
      layer.tiles.set(index, canvas);
    }
    this.draw(canvas, index, layer, range);
    layer.drawn.add(index);
    return this.nextTile() !== null;
  }

  private draw(canvas: HTMLCanvasElement, index: number, layer: Layer, range: Range): void {
    const window = this.container.ownerDocument.defaultView;
    const ratio = window?.devicePixelRatio || 1;
    const start = range.base + index * range.seconds;
    const length = Math.min(range.seconds, range.to - start);
    const width = Math.max(1, Math.round(length * layer.scale * ratio));
    const height = Math.max(1, Math.round(this.height * ratio));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    // Placed in time, not in pixels: at another zoom the tile stretches and stays in place. `translate`, not
    // `left`, so that scrolling a grid moves it without layout.
    const offset = this.placement === "view" ? `(${start} - var(--timeline-start))` : `${start - range.base}`;
    canvas.style.cssText = `position:absolute;top:0;left:0;height:100%;width:calc(${length} * var(--timeline-scale));translate:calc(${offset} * var(--timeline-scale)) 0`;

    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, width, height);
    this.color ||= window?.getComputedStyle(this.container).color ?? "";
    context.fillStyle = this.color;
    this.painter.paint(context, { start, length, width, height, ratio });
  }
}
