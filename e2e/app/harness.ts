export type HarnessEvent = {
  source: string;
  type: "start" | "change" | "end";
  value?: unknown;
  reason?: string;
};

export type FrameStats = {
  frames: number;
  intervals: number[];
  longAnimationFrames: number;
};

declare global {
  interface Window {
    /** React commits since the page loaded, counted by the script in index.html. */
    reactCommits: number;
    e2e: {
      events: HarnessEvent[];
      /** Level in dBFS the fixture meter reads every frame. */
      level: number;
      /** Milliseconds from each pointermove to the start of the next frame. */
      inputLatencies: number[];
      measureFrames(durationMs: number): Promise<FrameStats>;
    };
  }
}

export function installHarness(): void {
  window.e2e = {
    events: [],
    level: -60,
    inputLatencies: [],
    measureFrames,
  };

  // Input latency: from the event's timestamp to the animation frame after its handlers ran.
  document.addEventListener(
    "pointermove",
    (event) => {
      const start = event.timeStamp;
      requestAnimationFrame(() => window.e2e.inputLatencies.push(performance.now() - start));
    },
    { capture: true },
  );
}

export function log(event: HarnessEvent): void {
  window.e2e.events.push(event);
}

/** Frame intervals and long animation frames (Chromium) over `durationMs`. */
function measureFrames(durationMs: number): Promise<FrameStats> {
  return new Promise((resolve) => {
    const intervals: number[] = [];
    let longAnimationFrames = 0;
    let observer: PerformanceObserver | undefined;
    if (PerformanceObserver.supportedEntryTypes.includes("long-animation-frame")) {
      observer = new PerformanceObserver((list) => (longAnimationFrames += list.getEntries().length));
      observer.observe({ type: "long-animation-frame" });
    }
    let last: number | undefined;
    let end: number | undefined;
    const tick = (now: number) => {
      if (last !== undefined) intervals.push(now - last);
      last = now;
      end ??= now + durationMs;
      if (now < end) requestAnimationFrame(tick);
      else {
        observer?.disconnect();
        resolve({ frames: intervals.length, intervals, longAnimationFrames });
      }
    };
    requestAnimationFrame(tick);
  });
}
