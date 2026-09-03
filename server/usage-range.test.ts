import { describe, expect, it } from "vitest";
import { getUsageByRange } from "./pi-reader";

// The usage-range response shape.
//
// This exists because of a false failure, not a product bug. /api/pi/usage nests
// its numbers under `totals`, /api/pi/usage-range returns them flat, and the API
// sweep asked both for `totals.requests`. Four ranges reported "? req" and were
// written up as four broken routes.
//
// The sweep now asserts the flat field names, but the sweep only runs against a
// packaged app on a developer machine. These cases pin the same names where CI
// can see them, so renaming a field here fails immediately rather than turning
// the end-to-end sweep red on someone else's laptop.

const RANGE_NUMBERS = [
  "totalTokens",
  "totalInput",
  "totalOutput",
  "totalCacheRead",
  "totalCacheWrite",
  "totalCost",
  "totalRequests",
  "cacheHitRate",
] as const;

const RANGE_ARRAYS = [
  "dailyBreakdown",
  "hourlyBreakdown",
  "requestLog",
  "providerStats",
  "modelStats",
] as const;

function record(over: Partial<Parameters<typeof getUsageByRange>[0][number]> = {}) {
  return {
    date: "2026-03-02",
    hour: 9,
    providerId: "openai",
    modelId: "gpt-5",
    inputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 5,
    cacheWriteTokens: 3,
    requests: 1,
    cost: 0.5,
    ...over,
  };
}

describe("getUsageByRange", () => {
  it("returns every documented field, flat and never nested under totals", () => {
    const result = getUsageByRange([record()], "2026-03-01", "2026-03-31") as Record<string, unknown>;

    for (const field of RANGE_NUMBERS) {
      expect(Number.isFinite(result[field]), `${field} should be a number`).toBe(true);
    }
    for (const field of RANGE_ARRAYS) {
      expect(Array.isArray(result[field]), `${field} should be an array`).toBe(true);
    }
    expect(result).not.toHaveProperty("totals");
  });

  it("sums the records inside the window and ignores the ones outside it", () => {
    const result = getUsageByRange(
      [
        record({ date: "2026-02-28" }),
        record({ date: "2026-03-02" }),
        record({ date: "2026-03-05", requests: 2, cost: 1 }),
        record({ date: "2026-04-01" }),
      ],
      "2026-03-01",
      "2026-03-31",
    );

    expect(result.totalRequests).toBe(3);
    expect(result.totalCost).toBeCloseTo(1.5, 10);
    expect(result.totalInput).toBe(200);
    expect(result.dailyBreakdown.map((d) => d.date)).toEqual(["2026-03-02", "2026-03-05"]);
  });

  it("counts cache reads and writes in totalTokens", () => {
    const result = getUsageByRange([record()], "2026-03-01", "2026-03-31");
    expect(result.totalTokens).toBe(128);
    expect(result.cacheHitRate).toBeCloseTo(6.3, 1);
  });

  it("is inclusive on both bounds", () => {
    const result = getUsageByRange(
      [record({ date: "2026-03-01" }), record({ date: "2026-03-31" })],
      "2026-03-01",
      "2026-03-31",
    );
    expect(result.totalRequests).toBe(2);
  });

  it("answers a window with no records with zeros rather than throwing", () => {
    const result = getUsageByRange([record()], "2020-01-01", "2020-01-02") as Record<string, unknown>;

    for (const field of RANGE_NUMBERS) {
      expect(result[field], field).toBe(0);
    }
    for (const field of RANGE_ARRAYS) {
      expect(result[field] as unknown[], field).toHaveLength(0);
    }
  });

  it("answers an inverted window the same way, with no records matched", () => {
    const result = getUsageByRange([record()], "2030-01-01", "2020-01-01");
    expect(result.totalRequests).toBe(0);
    expect(result.requestLog).toHaveLength(0);
  });

  it("keeps a wider window from ever holding fewer requests than a narrower one", () => {
    const records = [
      record({ date: "2026-03-01" }),
      record({ date: "2026-03-10" }),
      record({ date: "2026-03-20" }),
    ];
    const narrow = getUsageByRange(records, "2026-03-01", "2026-03-05").totalRequests;
    const wide = getUsageByRange(records, "2026-03-01", "2026-03-31").totalRequests;
    expect(narrow).toBeLessThanOrEqual(wide);
    expect(wide).toBe(3);
  });

  it("buckets by the hour the record carries, not by wall-clock time", () => {
    const result = getUsageByRange(
      [record({ hour: 9 }), record({ hour: 9 }), record({ hour: 14 })],
      "2026-03-01",
      "2026-03-31",
    );
    expect(result.hourlyBreakdown.map((h) => h.hour)).toEqual([
      "2026-03-02 09:00",
      "2026-03-02 14:00",
    ]);
    expect(result.hourlyBreakdown[0]?.requests).toBe(2);
  });
});
