// Manual session compaction.
//
// pi summarizes older turns to free context. It exposes this two ways: the
// `/compact` slash command in the TUI, and a `{"type":"compact"}` RPC command.
// Only the second is reachable from here — a slash command sent as a `--print`
// prompt is treated as ordinary user text and answered by the model instead of
// being executed (verified against pi 0.84).
//
// So this spawns `pi --mode rpc --session <file>`, issues one compact command,
// waits for its response, and exits. pi does the work: it picks the cut point,
// calls the LLM for a summary, and appends a `compaction` entry to the session
// file. Nothing here parses or rewrites session content.
//
// Compaction is not free. On a 5.9MB session it billed 366k tokens ($0.53) and
// took minutes, so callers must confirm with the user first.

import { spawn, type ChildProcess } from "child_process";
import { existsSync, statSync } from "fs";
import { dirname, resolve } from "path";

/** Fallback grace before the compact command is written, if pi says nothing. */
const READY_MS = 4000;
/** A summary over a large session runs for minutes; cap it well above that. */
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

export interface CompactUsage {
  totalTokens?: number;
  cost?: { total?: number };
}

export interface CompactResult {
  success: boolean;
  error?: string;
  summary?: string;
  firstKeptEntryId?: string;
  tokensBefore?: number;
  estimatedTokensAfter?: number;
  usage?: CompactUsage;
  /** Wall-clock duration of the whole spawn, for the UI to report. */
  durationMs?: number;
}

/** Sessions currently being compacted, keyed by resolved file path. */
const inFlight = new Set<string>();

export function isCompacting(sessionPath: string): boolean {
  return inFlight.has(resolve(sessionPath));
}

interface CompactOptions {
  /** Focus the summary, forwarded as the RPC command's customInstructions. */
  instructions?: string;
  /** Working directory for the pi process; defaults to the session's own cwd. */
  cwd?: string;
  binary: string;
  timeoutMs?: number;
  /** Upper bound on the wait for pi to come up. Tests shorten this. */
  readyMs?: number;
}

export function compactSession(
  sessionPath: string,
  options: CompactOptions,
): Promise<CompactResult> {
  const file = resolve(sessionPath);
  if (!file.endsWith(".jsonl") || !existsSync(file) || !statSync(file).isFile()) {
    return Promise.resolve({ success: false, error: "session file not found" });
  }
  // One at a time per session: two concurrent compactions would each summarize
  // a span the other is about to invalidate, and both would append an entry.
  if (inFlight.has(file)) {
    return Promise.resolve({ success: false, error: "compaction already running for this session" });
  }

  const cwd = options.cwd && existsSync(options.cwd) ? options.cwd : dirname(file);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const startedAt = Date.now();

  inFlight.add(file);
  return new Promise<CompactResult>((resolvePromise) => {
    let child: ChildProcess;
    try {
      child = spawn(options.binary, ["--mode", "rpc", "--session", file], {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      inFlight.delete(file);
      resolvePromise({
        success: false,
        error: error instanceof Error ? error.message : "failed to start pi",
      });
      return;
    }

    let settled = false;
    let stderr = "";
    let buffer = "";
    let commandSent = false;
    let readyTimer: NodeJS.Timeout | undefined;

    /**
     * Issue the compact command, once. The agent has to finish loading the
     * session and its extensions before it accepts commands, and a command
     * written too early is dropped. Its first stdout line proves it is up, so
     * that is the trigger; `readyMs` is only the fallback for a run that stays
     * silent until it is ready.
     */
    const sendCompact = () => {
      if (commandSent || settled) return;
      commandSent = true;
      clearTimeout(readyTimer);
      const command: Record<string, unknown> = { id: "compact-1", type: "compact" };
      const instructions = options.instructions?.trim();
      if (instructions) command.customInstructions = instructions;
      try {
        child.stdin?.write(`${JSON.stringify(command)}\n`);
      } catch (error) {
        finish({
          success: false,
          error: error instanceof Error ? error.message : "failed to send compact command",
        });
      }
    };

    const finish = (result: CompactResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(readyTimer);
      clearTimeout(deadline);
      inFlight.delete(file);
      // Ask for a clean exit, then make sure the process is gone either way.
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
      finish({ success: false, error: `compaction timed out after ${Math.round(timeoutMs / 1000)}s` });
    }, timeoutMs);

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      buffer += chunk;
      // pi is talking, so it is past startup: ask for the compaction now rather
      // than sitting out the rest of the fallback delay.
      sendCompact();
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
        if (event.type !== "response" || event.command !== "compact") continue;
        const data = (event.data ?? {}) as Record<string, unknown>;
        finish({
          success: event.success === true,
          error: typeof event.error === "string" ? event.error : undefined,
          summary: typeof data.summary === "string" ? data.summary : undefined,
          firstKeptEntryId:
            typeof data.firstKeptEntryId === "string" ? data.firstKeptEntryId : undefined,
          tokensBefore: typeof data.tokensBefore === "number" ? data.tokensBefore : undefined,
          estimatedTokensAfter:
            typeof data.estimatedTokensAfter === "number" ? data.estimatedTokensAfter : undefined,
          usage: (data.usage ?? undefined) as CompactUsage | undefined,
        });
      }
    });

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      // Keep only the tail; a failing run can be chatty.
      stderr = `${stderr}${chunk}`.slice(-2000);
    });

    child.on("error", (error: Error) => finish({ success: false, error: error.message }));
    child.on("close", (code) =>
      finish({
        success: false,
        error: stderr.trim() || `pi exited with code ${code} before answering`,
      }),
    );

    // Fallback for a run that emits nothing before it is ready to take input.
    readyTimer = setTimeout(sendCompact, options.readyMs ?? READY_MS);
  });
}
