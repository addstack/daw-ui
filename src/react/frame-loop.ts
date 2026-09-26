type FrameCallback = (now: number) => void;

const callbacks = new Set<FrameCallback>();
let handle: number | null = null;

function tick(now: number) {
  handle = requestAnimationFrame(tick);
  for (const callback of callbacks) {
    try {
      callback(now);
    } catch (error) {
      // One failing meter must not stop the others; report the error without breaking the loop.
      queueMicrotask(() => {
        throw error;
      });
    }
  }
}

/**
 * Runs `callback` on every animation frame until the returned function is
 * called. All callers share one `requestAnimationFrame` loop, which stops
 * when nobody listens.
 */
export function onEveryFrame(callback: FrameCallback): () => void {
  callbacks.add(callback);
  if (handle === null) handle = requestAnimationFrame(tick);
  return () => {
    callbacks.delete(callback);
    if (callbacks.size === 0 && handle !== null) {
      cancelAnimationFrame(handle);
      handle = null;
    }
  };
}
