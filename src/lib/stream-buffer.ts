// Coalescing buffer for a streaming answer.
//
// pi emits one `delta` event per token. Committing each one to React state
// repainted the chat pane, and every repaint re-parses the growing turn through
// remark, so a long answer got quadratically slower — see stream-flush.ts for
// the measurements that fix the interval. This holds the deltas in between.
//
// It lives outside the component for the same reason the file readers do: the
// part worth getting right is a small state machine with a timer in it, and a
// timer is only testable if the caller can supply it.

import { flushDelayMs } from "./stream-flush";

/** The timer the buffer schedules on. */
export interface StreamTimer {
  set(run: () => void, delayMs: number): number;
  clear(handle: number): void;
}

/**
 * Real timers, via `window`.
 *
 * setTimeout rather than requestAnimationFrame: this app lives in the menu bar
 * and its window is usually hidden, where rAF never fires — an rAF-driven flush
 * would strand the answer half-written until the user looked at it. Timers are
 * throttled while hidden, which is the behaviour we want.
 */
export const windowTimer: StreamTimer = {
  set: (run, delayMs) => window.setTimeout(run, delayMs),
  clear: (handle) => window.clearTimeout(handle),
};

export interface StreamBuffer {
  /** Take one delta. Commits immediately if it opens a turn, else schedules. */
  push(chunk: string): void;
  /** Commit the pending tail now — call before anything rewrites the message. */
  flush(): void;
  /** Discard the pending tail, for endings that replace the message anyway. */
  drop(): void;
  /** Discard everything and forget the length, so a new turn starts fresh. */
  reset(): void;
  /** Characters committed plus pending in this turn; for tests. */
  readonly length: number;
}

/**
 * A buffer that commits streamed text on an interval scaled to its length.
 *
 * `commit` receives only the newly arrived text, never the whole answer, so the
 * caller appends rather than replaces.
 */
export function createStreamBuffer(
  commit: (chunk: string) => void,
  timer: StreamTimer = windowTimer,
): StreamBuffer {
  let pending = "";
  let length = 0;
  let handle: number | undefined;

  const clearTimer = () => {
    if (handle === undefined) return;
    timer.clear(handle);
    handle = undefined;
  };

  const flush = () => {
    clearTimer();
    if (!pending) return;
    const text = pending;
    pending = "";
    commit(text);
  };

  return {
    push(chunk: string) {
      if (!chunk) return;
      const opensTurn = length === 0;
      pending += chunk;
      length += chunk.length;
      // The first token lands immediately: waiting even one interval to show
      // that the model has started reads as latency, and there is nothing to
      // coalesce yet.
      if (opensTurn) {
        flush();
        return;
      }
      // A window is already open — this delta rides along with it. Rescheduling
      // per delta would let a fast stream postpone the commit indefinitely.
      if (handle !== undefined) return;
      handle = timer.set(flush, flushDelayMs(length));
    },

    flush,

    drop() {
      clearTimer();
      pending = "";
    },

    reset() {
      clearTimer();
      pending = "";
      length = 0;
    },

    get length() {
      return length;
    },
  };
}
