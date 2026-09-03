// JSON request/response helpers for the local Pi API.
//
// Extracted from api-routes.ts so the body reader can be tested directly: it
// is the one piece of that file where a subtle mistake corrupts user data
// instead of just returning the wrong shape.

/** The parts of `http.IncomingMessage` the body reader uses. */
export interface JsonBodyRequest {
  on(event: "data", listener: (chunk: Buffer) => void): unknown;
  on(event: "end", listener: () => void): unknown;
}

/** The parts of `http.ServerResponse` these helpers use. */
export interface JsonBodyResponse {
  statusCode: number;
  headersSent: boolean;
  setHeader(name: string, value: string): unknown;
  end(chunk?: string): unknown;
}

/** Reply with JSON. */
export function json(res: JsonBodyResponse, payload: unknown): void {
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

/** Reply with a JSON error body under the given status code. */
export function fail(res: JsonBodyResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  json(res, payload);
}

/**
 * Collect a JSON request body, answering 400 on malformed input.
 *
 * Chunks are kept as Buffers and decoded once at the end. Appending them to a
 * string instead (`raw += chunk`) decodes each chunk independently, so a
 * multi-byte character straddling a chunk boundary becomes replacement
 * characters on both sides. Node splits request bodies at around 16KB, meaning
 * any longer non-ASCII payload — a long Chinese prompt, a memory file — was
 * corrupted at every boundary. JSON.parse still succeeds on the mangled text,
 * so the damage landed silently in whatever file the handler wrote.
 *
 * Handler errors are contained too. This runs inside the Electron main process
 * in a packaged build, where an uncaught throw takes down the whole app rather
 * than just reloading a renderer.
 */
export function readJsonBody<T>(
  req: JsonBodyRequest,
  res: JsonBodyResponse,
  handle: (body: T) => void | Promise<void>,
): void {
  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  req.on("end", () => {
    const raw = Buffer.concat(chunks).toString("utf8");
    let parsed: T;
    try {
      parsed = (raw.trim() ? JSON.parse(raw) : {}) as T;
    } catch {
      // Both keys: callers of these endpoints check `success`, `error`, or
      // just `res.ok`, depending on when they were written.
      return fail(res, 400, { success: false, error: "invalid JSON body" });
    }
    const onError = (error: unknown) => {
      const message = error instanceof Error ? error.message : "request failed";
      if (res.headersSent) res.end();
      else fail(res, 500, { success: false, error: message });
    };
    try {
      // An async handler must not leak an unhandled rejection either.
      void Promise.resolve(handle(parsed)).catch(onError);
    } catch (error) {
      onError(error);
    }
  });
}
