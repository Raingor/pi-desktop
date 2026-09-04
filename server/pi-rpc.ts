// One-shot client for pi's RPC mode.
//
// `pi --mode rpc` speaks JSONL over stdin/stdout. Two things here need it:
// manual compaction and the slash-command registry. Both follow the same shape
// — start pi, send one command, wait for the matching response, exit — so that
// sequence lives here rather than twice.
//
// This is deliberately not a long-lived connection. Each call is a fresh
// process, which keeps failures contained and needs no lifecycle management;
// the callers cache what they get back instead.

import { spawn, type ChildProcess } from "child_process";

/** Fallback grace before the command is written, if pi says nothing first. */
const DEFAULT_READY_MS = 4000;
/** Re-send interval: a command written before pi is listening is dropped. */
const RETRY_MS = 2500;
const DEFAULT_TIMEOUT_MS = 60_000;

export interface RpcResult<T = Record<string, unknown>> {
  success: boolean;
  error?: string;
  data?: T;
  /** Wall-clock duration of the whole spawn, for callers that report it. */
  durationMs?: number;
}

export interface RpcOptions {
  binary: string;
  /** Extra CLI args, e.g. ["--session", file] or ["--no-session"]. */
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
  /** Upper bound on the wait for pi to come up. Tests shorten this. */
  readyMs?: number;
  /** Keep re-sending until the response arrives. Off for billed commands. */
  retry?: boolean;
}

/**
 * Run a single RPC command and resolve with its response.
 *
 * Resolves rather than rejects on failure: every caller wants to report the
 * reason to the user, and pi's own wording ("Nothing to compact…") is usually
 * the most useful thing to show.
 */
export function runRpcCommand<T = Record<string, unknown>>(
  command: Record<string, unknown> & { type: string },
  options: RpcOptions,
): Promise<RpcResult<T>> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const startedAt = Date.now();

  return new Promise<RpcResult<T>>((resolvePromise) => {
    let child: ChildProcess;
    try {
      child = spawn(options.binary, ["--mode", "rpc", ...(options.args ?? [])], {
        cwd: options.cwd,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      resolvePromise({
        success: false,
        error: error instanceof Error ? error.message : "failed to start pi",
      });
      return;
    }

    let settled = false;
    let stderr = "";
    let buffer = "";
    let sent = false;
    let readyTimer: NodeJS.Timeout | undefined;
    let retryTimer: NodeJS.Timeout | undefined;

    const finish = (result: RpcResult<T>) => {
      if (settled) return;
      settled = true;
      clearTimeout(readyTimer);
      clearInterval(retryTimer);
      clearTimeout(deadline);
      try {
        child.stdin?.write(`${JSON.stringify({ type: "exit" })}\n`);
        child.stdin?.end();
      } catch {
        /* stdin already closed */
      }
      setTimeout(() => {
        if (child.exitCode === null && !child.killed) child.kill("SIGTERM");
      }, 1500);
      resolvePromise({ ...result, durationMs: Date.now() - startedAt });
    };

    const deadline = setTimeout(() => {
      child.kill("SIGTERM");
      finish({
        success: false,
        error: `pi did not answer ${command.type} within ${Math.round(timeoutMs / 1000)}s`,
      });
    }, timeoutMs);

    const write = () => {
      if (settled) return;
      try {
        child.stdin?.write(`${JSON.stringify(command)}\n`);
      } catch (error) {
        finish({
          success: false,
          error: error instanceof Error ? error.message : "failed to send command",
        });
      }
    };

    /**
     * Send the command, once pi has proven it is up by writing something. The
     * agent loads the session, extensions and skills before it reads stdin,
     * and anything written before that is dropped.
     */
    const send = () => {
      if (sent || settled) return;
      sent = true;
      clearTimeout(readyTimer);
      write();
      // Some startups emit nothing at all, so a single well-timed write is not
      // enough to rely on. Repeat until the response lands (read-only
      // commands only — a billed command must never run twice).
      if (options.retry) retryTimer = setInterval(write, RETRY_MS);
    };

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      buffer += chunk;
      send();
      // Strict JSONL: split on LF only. Node's readline also breaks on U+2028
      // and U+2029, which are legal inside JSON strings, so it is not
      // protocol-compliant here.
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const text = line.endsWith("\r") ? line.slice(0, -1) : line;
        if (!text.trim()) continue;
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(text);
        } catch {
          continue;
        }
        if (event.type !== "response" || event.command !== command.type) continue;
        finish({
          success: event.success === true,
          error: typeof event.error === "string" ? event.error : undefined,
          data: (event.data ?? undefined) as T | undefined,
        });
      }
    });

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-2000);
    });

    child.on("error", (error: Error) => finish({ success: false, error: error.message }));
    child.on("close", (code) =>
      finish({
        success: false,
        error: stderr.trim() || `pi exited with code ${code} before answering`,
      }),
    );

    readyTimer = setTimeout(send, options.readyMs ?? DEFAULT_READY_MS);
  });
}
