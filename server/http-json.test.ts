import { describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { readJsonBody } from "./http-json";

/**
 * Round-trip a body through a real HTTP server using readJsonBody.
 *
 * A real socket matters here: the bug being guarded against only appears once
 * Node splits the body across multiple `data` events, which no hand-rolled
 * fake stream reproduces faithfully.
 */
async function post(
  body: string,
  handle: (parsed: unknown) => void,
): Promise<{ status: number; payload: unknown }> {
  const server: Server = createServer((req, res) => {
    readJsonBody<unknown>(req, res, (parsed) => {
      handle(parsed);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true }));
    });
  });
  try {
    const port = await new Promise<number>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        resolve(typeof address === "object" && address ? address.port : 0);
      });
    });
    const response = await fetch(`http://127.0.0.1:${port}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    return { status: response.status, payload: await response.json() };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("readJsonBody", () => {
  it("reads a small ASCII body", async () => {
    let seen: unknown;
    const { status } = await post(JSON.stringify({ a: 1 }), (parsed) => (seen = parsed));
    expect(status).toBe(200);
    expect(seen).toEqual({ a: 1 });
  });

  it("treats an empty body as an empty object", async () => {
    let seen: unknown;
    const { status } = await post("", (parsed) => (seen = parsed));
    expect(status).toBe(200);
    expect(seen).toEqual({});
  });

  // The regression this file exists for. Chunk boundaries land mid-character
  // with multi-byte text, and decoding each chunk separately replaced those
  // characters with U+FFFD — silently, because JSON.parse still succeeded.
  it("preserves multi-byte text that spans chunk boundaries", async () => {
    // ~440KB: comfortably more than Node's ~16KB chunk size, so the body
    // arrives in several `data` events.
    const text = "中文提示词内容".repeat(20_000);
    let seen: { text?: string } = {};
    const { status } = await post(JSON.stringify({ text }), (parsed) => {
      seen = parsed as { text?: string };
    });
    expect(status).toBe(200);
    expect(seen.text).toBe(text);
    expect(seen.text).not.toContain("\uFFFD");
  });

  it("preserves astral-plane characters across chunk boundaries", async () => {
    // Emoji are surrogate pairs in UTF-16 and four bytes in UTF-8 — the same
    // hazard as CJK text, one byte wider.
    const text = "🙂🚀🌏".repeat(30_000);
    let seen: { text?: string } = {};
    await post(JSON.stringify({ text }), (parsed) => {
      seen = parsed as { text?: string };
    });
    expect(seen.text).toBe(text);
  });

  it("answers 400 on malformed JSON instead of throwing", async () => {
    let called = false;
    const { status, payload } = await post('{"broken":', () => (called = true));
    expect(status).toBe(400);
    expect(payload).toEqual({ success: false, error: "invalid JSON body" });
    // The handler must never see a half-parsed body.
    expect(called).toBe(false);
  });

  it("answers 500 when a handler throws synchronously", async () => {
    const server = createServer((req, res) => {
      readJsonBody<unknown>(req, res, () => {
        throw new Error("handler exploded");
      });
    });
    try {
      const port = await new Promise<number>((resolve) => {
        server.listen(0, "127.0.0.1", () => {
          const address = server.address();
          resolve(typeof address === "object" && address ? address.port : 0);
        });
      });
      const response = await fetch(`http://127.0.0.1:${port}/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ success: false, error: "handler exploded" });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("answers 500 when an async handler rejects", async () => {
    const server = createServer((req, res) => {
      readJsonBody<unknown>(req, res, async () => {
        await Promise.resolve();
        throw new Error("async exploded");
      });
    });
    try {
      const port = await new Promise<number>((resolve) => {
        server.listen(0, "127.0.0.1", () => {
          const address = server.address();
          resolve(typeof address === "object" && address ? address.port : 0);
        });
      });
      const response = await fetch(`http://127.0.0.1:${port}/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ success: false, error: "async exploded" });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
