// HTTP client for the API sweep.
//
// Deliberately `node:http` rather than curl or fetch, for two reasons that both
// come from the previous run:
//
//   1. curl honours `http_proxy` even for 127.0.0.1. This shell exports one, so
//      the Host-header guard case came back 502 — the proxy's own error, before
//      the app ever saw the request — and read as an app failure. `http.request`
//      talks to the address it is given and consults no proxy environment.
//   2. `fetch` refuses to set Host, and silently normalises Origin. Those two
//      headers *are* the guard test; a client that cannot forge them cannot
//      test the thing.
//
// Everything is pinned to an explicit host and port, so there is no name
// resolution and no ambient configuration in the path.

import { request as httpRequest } from "node:http";

export interface Reply {
  status: number;
  /** Decoded as UTF-8 once, from the concatenated buffers. */
  body: string;
  bytes: number;
  json: unknown;
}

export interface RequestOptions {
  method?: string;
  /** Extra headers. `Host` and `Origin` are passed through verbatim. */
  headers?: Record<string, string>;
  /** Request body. A string is sent as UTF-8. */
  body?: string;
  timeoutMs?: number;
}

export class ApiClient {
  private readonly host: string;
  private readonly port: number;

  // Written out as fields rather than constructor parameter properties: this
  // file runs under `node test/e2e/api-sweep.ts`, and Node's strip-only
  // TypeScript mode rejects parameter properties because erasing them would
  // require emitting assignments rather than deleting types.
  constructor(host: string, port: number) {
    this.host = host;
    this.port = port;
  }

  get origin(): string {
    return `http://${this.host}:${this.port}`;
  }

  /** Send a request and read the whole reply. Never throws on 4xx/5xx. */
  send(path: string, options: RequestOptions = {}): Promise<Reply> {
    const { method = "GET", headers = {}, body, timeoutMs = 30_000 } = options;
    return new Promise<Reply>((resolve, reject) => {
      const payload = body === undefined ? undefined : Buffer.from(body, "utf8");
      const req = httpRequest(
        {
          host: this.host,
          port: this.port,
          path,
          method,
          headers: {
            ...(payload ? { "content-type": "application/json", "content-length": String(payload.byteLength) } : {}),
            ...headers,
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            const buffer = Buffer.concat(chunks);
            // One decode of the joined buffer, the same reason the server does
            // it that way: per-chunk decoding mangles multi-byte characters at
            // the boundaries, which would make the round-trip case unable to
            // tell a client bug from a server bug.
            const text = buffer.toString("utf8");
            let parsed: unknown = undefined;
            try {
              parsed = text.trim() ? JSON.parse(text) : undefined;
            } catch {
              /* not JSON — the caller checks `body` in that case */
            }
            resolve({ status: res.statusCode ?? 0, body: text, bytes: buffer.byteLength, json: parsed });
          });
        },
      );
      req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout after ${timeoutMs}ms: ${method} ${path}`)));
      req.on("error", reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  get(path: string, headers?: Record<string, string>): Promise<Reply> {
    return this.send(path, { headers });
  }

  post(path: string, body: unknown, headers?: Record<string, string>): Promise<Reply> {
    return this.send(path, {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  /** Resolve once the server answers, or throw after `timeoutMs`. */
  async waitUntilReady(timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let last = "";
    while (Date.now() < deadline) {
      try {
        const reply = await this.send("/api/pi/settings", { timeoutMs: 2_000 });
        if (reply.status === 200) return;
        last = `status ${reply.status}`;
      } catch (error) {
        last = error instanceof Error ? error.message : String(error);
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`API server not ready at ${this.origin}: ${last}`);
  }
}
