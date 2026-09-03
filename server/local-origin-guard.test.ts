import { describe, expect, it } from "vitest";
import { rejectNonLocalRequest, type GuardableRequest } from "./local-origin-guard";

const req = (
  method: string,
  headers: Record<string, string | undefined> = {},
): GuardableRequest => ({ method, headers });

describe("rejectNonLocalRequest", () => {
  it("allows the app's own requests", () => {
    expect(rejectNonLocalRequest(req("GET", { host: "127.0.0.1:54321" }))).toBeNull();
    expect(
      rejectNonLocalRequest(
        req("POST", {
          host: "127.0.0.1:54321",
          origin: "http://127.0.0.1:54321",
          "content-type": "application/json",
        }),
      ),
    ).toBeNull();
  });

  it("allows non-browser clients that send no Origin", () => {
    // The Electron main process and curl never send Origin.
    expect(rejectNonLocalRequest(req("GET", { host: "localhost:5179" }))).toBeNull();
    expect(rejectNonLocalRequest(req("DELETE", { host: "[::1]:5179" }))).toBeNull();
  });

  it("allows a bodyless POST, which sends no Content-Type", () => {
    expect(rejectNonLocalRequest(req("POST", { host: "127.0.0.1:1" }))).toBeNull();
  });

  it("rejects a cross-site Origin", () => {
    expect(
      rejectNonLocalRequest(req("POST", { host: "127.0.0.1:1", origin: "https://evil.com" })),
    ).toBe("cross-origin request rejected");
    // An opaque origin (sandboxed iframe, file://) is not trusted either.
    expect(rejectNonLocalRequest(req("GET", { host: "127.0.0.1:1", origin: "null" }))).toBe(
      "cross-origin request rejected",
    );
  });

  it("rejects a non-loopback Host, which is how DNS rebinding presents", () => {
    expect(rejectNonLocalRequest(req("GET", { host: "evil.com" }))).toBe(
      "unexpected Host header",
    );
    expect(rejectNonLocalRequest(req("GET", { host: "evil.com:54321" }))).toBe(
      "unexpected Host header",
    );
    // A hostname that merely starts with a loopback name is still foreign.
    expect(rejectNonLocalRequest(req("GET", { host: "localhost.evil.com" }))).toBe(
      "unexpected Host header",
    );
  });

  it("rejects the preflight-free content types a cross-site POST can use", () => {
    for (const contentType of [
      "text/plain",
      "text/plain;charset=UTF-8",
      "application/x-www-form-urlencoded",
      "multipart/form-data",
    ]) {
      expect(
        rejectNonLocalRequest(req("POST", { host: "127.0.0.1:1", "content-type": contentType })),
      ).toBe("POST body must be application/json");
    }
  });

  it("accepts application/json with parameters", () => {
    expect(
      rejectNonLocalRequest(
        req("POST", { host: "127.0.0.1:1", "content-type": "application/json; charset=utf-8" }),
      ),
    ).toBeNull();
  });
});
