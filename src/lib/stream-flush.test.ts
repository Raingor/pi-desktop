import { describe, it, expect } from "vitest";
import { flushDelayMs, MIN_FLUSH_MS, MAX_FLUSH_MS } from "./stream-flush";

describe("flushDelayMs", () => {
  it("repaints at the floor while the answer is still short", () => {
    // A 200-char turn parses in ~1.1ms, far under the budget, so nothing is
    // gained by waiting longer than the floor.
    expect(flushDelayMs(1)).toBe(MIN_FLUSH_MS);
    expect(flushDelayMs(200)).toBe(MIN_FLUSH_MS);
    expect(flushDelayMs(4000)).toBe(MIN_FLUSH_MS);
  });

  it("backs off once a parse would eat more than its share of the interval", () => {
    // ~5500 chars is where a parse (10ms) hits a third of the 33ms floor, so
    // this is the length at which the delay must start growing.
    expect(flushDelayMs(8000)).toBeGreaterThan(MIN_FLUSH_MS);
    expect(flushDelayMs(20000)).toBeGreaterThan(flushDelayMs(8000));
  });

  it("never exceeds the ceiling, so a huge answer still advances visibly", () => {
    expect(flushDelayMs(50_000)).toBe(MAX_FLUSH_MS);
    expect(flushDelayMs(5_000_000)).toBe(MAX_FLUSH_MS);
  });

  it("is non-decreasing, so growth never makes repaints more frequent", () => {
    let previous = 0;
    for (let chars = 0; chars <= 60_000; chars += 250) {
      const delay = flushDelayMs(chars);
      expect(delay).toBeGreaterThanOrEqual(previous);
      previous = delay;
    }
  });

  it("stays inside the bounds for every input, including invalid ones", () => {
    // The caller schedules with this value unconditionally, so a bad length
    // must degrade to a working delay rather than to NaN or a stalled stream.
    for (const chars of [0, -1, -99999, Number.NaN, Number.POSITIVE_INFINITY]) {
      const delay = flushDelayMs(chars);
      expect(delay).toBeGreaterThanOrEqual(MIN_FLUSH_MS);
      expect(delay).toBeLessThanOrEqual(MAX_FLUSH_MS);
    }
  });

  it("keeps parsing under a third of the interval it returns", () => {
    // The property the constants exist to guarantee: at the measured
    // ~550 chars/ms, the parse fits its budget at every length that has not
    // hit the ceiling. Beyond the ceiling the guarantee is deliberately
    // traded away — a 47ms parse cannot fit 200ms/3 — which is why the test
    // names the boundary instead of asserting it everywhere.
    for (const chars of [200, 1000, 4000, 12000, 25877]) {
      const delay = flushDelayMs(chars);
      const parseMs = chars / 550;
      if (delay < MAX_FLUSH_MS) expect(parseMs).toBeLessThanOrEqual(delay / 3 + 0.5);
    }
  });
});
