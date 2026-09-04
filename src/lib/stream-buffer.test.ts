import { describe, expect, it } from "vitest";
import { createStreamBuffer, type StreamTimer } from "./stream-buffer";
import { MIN_FLUSH_MS, flushDelayMs } from "./stream-flush";

// The buffer between pi's per-token deltas and React state. What has to hold:
// the first token is never delayed, no delta is ever lost or duplicated, and a
// fast stream cannot postpone the commit by rescheduling on every delta.

/** A timer whose scheduled callback only runs when the test says so. */
function fakeTimer() {
  const scheduled: { handle: number; run: () => void; delayMs: number }[] = [];
  let next = 1;

  const timer: StreamTimer = {
    set(run, delayMs) {
      const handle = next++;
      scheduled.push({ handle, run, delayMs });
      return handle;
    },
    clear(handle) {
      const index = scheduled.findIndex((entry) => entry.handle === handle);
      if (index >= 0) scheduled.splice(index, 1);
    },
  };

  return {
    timer,
    /** Delays the buffer asked for, in order. */
    delays: () => scheduled.map((entry) => entry.delayMs),
    pending: () => scheduled.length,
    /** Fire everything currently scheduled, as the event loop would. */
    fire() {
      const due = scheduled.splice(0, scheduled.length);
      for (const entry of due) entry.run();
    },
  };
}

/** A buffer plus the chunks it has committed. */
function harness() {
  const clock = fakeTimer();
  const committed: string[] = [];
  const buffer = createStreamBuffer((chunk) => committed.push(chunk), clock.timer);
  return { buffer, committed, clock, text: () => committed.join("") };
}

describe("createStreamBuffer", () => {
  it("commits the first delta immediately", () => {
    const { buffer, committed, clock } = harness();

    buffer.push("Hel");

    // Time to first token is the one latency a reader actually notices.
    expect(committed).toEqual(["Hel"]);
    expect(clock.pending()).toBe(0);
  });

  it("holds later deltas until the interval elapses", () => {
    const { buffer, committed, clock, text } = harness();

    buffer.push("a");
    buffer.push("b");
    buffer.push("c");

    expect(committed).toEqual(["a"]);
    expect(clock.pending()).toBe(1);

    clock.fire();

    expect(committed).toEqual(["a", "bc"]);
    expect(text()).toBe("abc");
  });

  it("does not reschedule while a window is open", () => {
    // The bug this guards: rescheduling per delta means a stream that never
    // pauses never commits, so the answer appears all at once at the end.
    const { buffer, clock } = harness();
    buffer.push("a");
    for (let i = 0; i < 50; i++) buffer.push("x");

    expect(clock.pending()).toBe(1);
  });

  it("reproduces the stream exactly across many deltas", () => {
    const { buffer, clock, text } = harness();
    const tokens = Array.from({ length: 500 }, (_, i) => `t${i} `);

    tokens.forEach((token, i) => {
      buffer.push(token);
      // Let a window close every so often, the way real timing would.
      if (i % 7 === 0) clock.fire();
    });
    buffer.flush();

    expect(text()).toBe(tokens.join(""));
    expect(clock.pending()).toBe(0);
  });

  it("scales the delay with the length of the answer", () => {
    const { buffer, clock } = harness();
    buffer.push("a");
    buffer.push("b");
    expect(clock.delays()).toEqual([flushDelayMs(2)]);
    clock.fire();

    // A long answer costs more per parse, so it repaints less often.
    buffer.push("x".repeat(20_000));
    expect(clock.delays()).toEqual([flushDelayMs(20_002)]);
    expect(flushDelayMs(20_002)).toBeGreaterThan(MIN_FLUSH_MS);
  });

  it("flushes the tail on demand and cancels the timer", () => {
    const { buffer, committed, clock } = harness();
    buffer.push("a");
    buffer.push("tail");

    buffer.flush();

    expect(committed).toEqual(["a", "tail"]);
    expect(clock.pending()).toBe(0);
    // Firing a stale timer must not commit the tail twice.
    clock.fire();
    expect(committed).toEqual(["a", "tail"]);
  });

  it("flushing with nothing pending commits nothing", () => {
    const { buffer, committed } = harness();
    buffer.push("a");
    buffer.flush();
    buffer.flush();
    expect(committed).toEqual(["a"]);
  });

  it("drops the tail without committing it", () => {
    // The error path replaces the message wholesale, so a pending tail would
    // only flash in and vanish.
    const { buffer, committed, clock } = harness();
    buffer.push("a");
    buffer.push("doomed");

    buffer.drop();
    clock.fire();

    expect(committed).toEqual(["a"]);
    expect(clock.pending()).toBe(0);
  });

  it("keeps its length after a drop, and clears it on reset", () => {
    const { buffer, clock } = harness();
    buffer.push("a".repeat(30_000));
    buffer.push("b");
    const longDelay = clock.delays()[0]!;
    buffer.drop();

    // drop() ends one message, reset() starts a new turn: the next turn must
    // not inherit the previous answer's slow interval.
    expect(buffer.length).toBe(30_001);
    buffer.reset();
    expect(buffer.length).toBe(0);

    buffer.push("x");
    buffer.push("y");
    expect(clock.delays()[0]).toBe(MIN_FLUSH_MS);
    expect(longDelay).toBeGreaterThan(MIN_FLUSH_MS);
  });

  it("treats an empty delta as nothing at all", () => {
    // pi can emit an empty text_delta; it must not consume the first-token
    // fast path, or the real first token would be delayed instead.
    const { buffer, committed, clock } = harness();

    buffer.push("");

    expect(committed).toEqual([]);
    expect(clock.pending()).toBe(0);
    expect(buffer.length).toBe(0);

    buffer.push("real");
    expect(committed).toEqual(["real"]);
  });
});
