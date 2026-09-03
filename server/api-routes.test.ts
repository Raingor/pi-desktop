import { describe, expect, it } from "vitest";
import { sessionIdFromUrl } from "./api-routes.ts";

// `session-history` reads its session id from `id`, while `session-info` and
// `session-usage` read `session`. Each renderer call site matched the route it
// was written against, so nothing was broken — but three routes taking the same
// argument under two names is a trap: guessing wrong yields an empty result or a
// 404, never an error that says which name to use. Both spellings work now, and
// these tests are what keep the two indistinguishable.
describe("sessionIdFromUrl", () => {
  it("reads the id under either parameter name", () => {
    expect(sessionIdFromUrl("/api/pi/session-info?session=abc123")).toBe("abc123");
    expect(sessionIdFromUrl("/api/pi/session-history?id=abc123")).toBe("abc123");
    // The point of the change: neither route cares which one it gets.
    expect(sessionIdFromUrl("/api/pi/session-history?session=abc123")).toBe("abc123");
    expect(sessionIdFromUrl("/api/pi/session-usage?id=abc123")).toBe("abc123");
  });

  it("prefers session when a caller sends both", () => {
    // Arbitrary but fixed. Worth pinning so the behaviour is a decision rather
    // than whatever URLSearchParams happens to yield first.
    expect(sessionIdFromUrl("/x?session=first&id=second")).toBe("first");
  });

  it("returns an empty string when neither is present", () => {
    // The readers validate the id themselves and answer null for a bad one, so
    // "" is the right thing to hand them — not a throw at the route layer.
    expect(sessionIdFromUrl("/api/pi/session-info")).toBe("");
    expect(sessionIdFromUrl("/api/pi/session-info?other=1")).toBe("");
    expect(sessionIdFromUrl("")).toBe("");
  });

  it("preserves an empty explicit value", () => {
    expect(sessionIdFromUrl("/x?session=")).toBe("");
    expect(sessionIdFromUrl("/x?session=&id=fallback")).toBe("");
  });

  it("decodes percent-encoded ids", () => {
    // Session ids are [A-Za-z0-9_-] in practice, but the renderer sends them
    // through encodeURIComponent, so decoding has to happen for the id to match.
    expect(sessionIdFromUrl("/x?session=a%2Db%5Fc")).toBe("a-b_c");
  });

  it("ignores the path and any other parameters", () => {
    expect(sessionIdFromUrl("/api/pi/session-preview?path=/tmp/x.jsonl&session=s1")).toBe("s1");
    expect(sessionIdFromUrl("/deep/path/segments?id=s2&refresh=1")).toBe("s2");
  });
});
