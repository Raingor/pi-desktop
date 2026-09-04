// Manual session compaction.
//
// pi summarizes older turns to free context. It exposes this two ways: the
// `/compact` slash command in the TUI, and a `{"type":"compact"}` RPC command.
// Only the second is reachable from here — a slash command sent as a `--print`
// prompt is treated as ordinary user text and answered by the model instead of
// being executed (verified against pi 0.84).
//
// pi does the work: it picks the cut point, calls the LLM for a summary, and
// appends a `compaction` entry to the session file. Nothing here parses or
// rewrites session content.
//
// Compaction is not free. On a 5.9MB session it billed 366k tokens ($0.53) and
// took minutes, so callers must confirm with the user first.

import { existsSync, statSync } from "fs";
import { dirname, resolve } from "path";
import { runRpcCommand } from "./pi-rpc";

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

export async function compactSession(
  sessionPath: string,
  options: CompactOptions,
): Promise<CompactResult> {
  const file = resolve(sessionPath);
  if (!file.endsWith(".jsonl") || !existsSync(file) || !statSync(file).isFile()) {
    return { success: false, error: "session file not found" };
  }
  // One at a time per session: two concurrent compactions would each summarize
  // a span the other is about to invalidate, and both would append an entry.
  if (inFlight.has(file)) {
    return { success: false, error: "compaction already running for this session" };
  }

  const command: Record<string, unknown> & { type: string } = { id: "compact-1", type: "compact" };
  const instructions = options.instructions?.trim();
  if (instructions) command.customInstructions = instructions;

  inFlight.add(file);
  try {
    const result = await runRpcCommand<{
      summary?: unknown;
      firstKeptEntryId?: unknown;
      tokensBefore?: unknown;
      estimatedTokensAfter?: unknown;
      usage?: unknown;
    }>(command, {
      binary: options.binary,
      args: ["--session", file],
      cwd: options.cwd && existsSync(options.cwd) ? options.cwd : dirname(file),
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      readyMs: options.readyMs,
      // Never retry: a second compact would bill a second summary.
      retry: false,
    });

    const data = result.data ?? {};
    return {
      success: result.success,
      error: result.error,
      summary: typeof data.summary === "string" ? data.summary : undefined,
      firstKeptEntryId:
        typeof data.firstKeptEntryId === "string" ? data.firstKeptEntryId : undefined,
      tokensBefore: typeof data.tokensBefore === "number" ? data.tokensBefore : undefined,
      estimatedTokensAfter:
        typeof data.estimatedTokensAfter === "number" ? data.estimatedTokensAfter : undefined,
      usage: (data.usage ?? undefined) as CompactUsage | undefined,
      durationMs: result.durationMs,
    };
  } finally {
    inFlight.delete(file);
  }
}
