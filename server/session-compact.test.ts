import { describe, expect, it, afterAll, beforeAll } from "vitest";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { compactSession, isCompacting } from "./session-compact";

// The real pi binary is not used here: compaction costs money and takes
// minutes. These stubs speak the same RPC protocol, so what is under test is
// this module's half of it — framing, the response match, timeouts, the
// concurrency lock and process teardown.
//
// Every case gets its own session file. The lock is keyed by path, so sharing
// one file would let a slow case leak "already running" into the next.

let dir: string;
let counter = 0;

/** A fresh session file, so each case locks a different path. */
function newSession(): string {
  const path = join(dir, `session-${++counter}.jsonl`);
  writeFileSync(path, `${JSON.stringify({ type: "session", id: `s${counter}` })}\n`);
  return path;
}

/** Write an executable stub that plays the role of `pi --mode rpc`. */
function stub(name: string, body: string): string {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/bash\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

const RESPONSE = JSON.stringify({
  type: "response",
  command: "compact",
  success: true,
  data: {
    summary: "## Goal\nship the thing",
    firstKeptEntryId: "abc123",
    tokensBefore: 422463,
    estimatedTokensAfter: 24675,
    usage: { totalTokens: 366384, cost: { total: 0.5281446 } },
  },
});

/** Stub that answers with RESPONSE, after recording the command it received. */
function recordingStub(name: string, capturePath: string): string {
  return stub(
    name,
    `read -r line\nprintf '%s' "$line" > '${capturePath}'\necho '${RESPONSE}'\ncat > /dev/null`,
  );
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "pi-compact-"));
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("compactSession", () => {
  it("rejects a missing session file", async () => {
    const result = await compactSession(join(dir, "nope.jsonl"), { binary: "/bin/true" });
    expect(result).toMatchObject({ success: false, error: "session file not found" });
  });

  it("rejects a path that is not a .jsonl", async () => {
    const other = join(dir, "notes.txt");
    writeFileSync(other, "hi");
    const result = await compactSession(other, { binary: "/bin/true" });
    expect(result.success).toBe(false);
  });

  it("parses a successful compact response", async () => {
    const bin = stub(
      "ok.sh",
      `echo '{"type":"compaction_start"}'\nread -r line\necho '${RESPONSE}'\ncat > /dev/null`,
    );
    const result = await compactSession(newSession(), { binary: bin, timeoutMs: 20000, readyMs: 150 });
    expect(result.success).toBe(true);
    expect(result.tokensBefore).toBe(422463);
    expect(result.estimatedTokensAfter).toBe(24675);
    expect(result.firstKeptEntryId).toBe("abc123");
    expect(result.summary).toContain("ship the thing");
    expect(result.usage?.cost?.total).toBeCloseTo(0.5281446);
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it("forwards pi's own failure reason", async () => {
    const bin = stub(
      "fail.sh",
      `read -r line\necho '{"type":"response","command":"compact","success":false,` +
        `"error":"Nothing to compact (session too small)"}'\ncat > /dev/null`,
    );
    const result = await compactSession(newSession(), { binary: bin, timeoutMs: 20000, readyMs: 150 });
    expect(result.success).toBe(false);
    expect(result.error).toBe("Nothing to compact (session too small)");
  });

  it("ignores unrelated events, other commands and non-JSON noise", async () => {
    const bin = stub(
      "noise.sh",
      `echo '{"type":"extension_ui_request"}'\n` +
        `echo '{"type":"response","command":"get_state","success":true}'\n` +
        `read -r line\n` +
        `echo 'not json at all'\n` +
        `echo '${RESPONSE}'\ncat > /dev/null`,
    );
    const result = await compactSession(newSession(), { binary: bin, timeoutMs: 20000, readyMs: 150 });
    expect(result.success).toBe(true);
    expect(result.tokensBefore).toBe(422463);
  });

  it("reassembles a response split across chunks", async () => {
    const half = RESPONSE.slice(0, 40);
    const rest = RESPONSE.slice(40);
    const bin = stub(
      "split.sh",
      `read -r line\nprintf '%s' '${half}'\nsleep 0.3\nprintf '%s\\n' '${rest}'\ncat > /dev/null`,
    );
    const result = await compactSession(newSession(), { binary: bin, timeoutMs: 20000, readyMs: 150 });
    expect(result.success).toBe(true);
    expect(result.summary).toContain("ship the thing");
  });

  it("tolerates CRLF framing", async () => {
    const bin = stub("crlf.sh", `read -r line\nprintf '%s\\r\\n' '${RESPONSE}'\ncat > /dev/null`);
    const result = await compactSession(newSession(), { binary: bin, timeoutMs: 20000, readyMs: 150 });
    expect(result.success).toBe(true);
  });

  it("reports a timeout instead of hanging", async () => {
    const bin = stub("hang.sh", `cat > /dev/null`);
    const result = await compactSession(newSession(), { binary: bin, timeoutMs: 600, readyMs: 150 });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/timed out/);
  });

  it("reports an early exit with pi's stderr", async () => {
    const bin = stub("die.sh", `echo 'session is locked' >&2\nexit 3`);
    const result = await compactSession(newSession(), { binary: bin, timeoutMs: 20000, readyMs: 150 });
    expect(result.success).toBe(false);
    expect(result.error).toContain("session is locked");
  });

  it("reports a missing binary", async () => {
    const result = await compactSession(newSession(), {
      binary: join(dir, "does-not-exist"),
      timeoutMs: 20000,
      readyMs: 150,
    });
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("refuses a second concurrent run on the same session", async () => {
    const session = newSession();
    const bin = stub("slow.sh", `read -r line\nsleep 0.6\necho '${RESPONSE}'\ncat > /dev/null`);
    const first = compactSession(session, { binary: bin, timeoutMs: 20000, readyMs: 150 });
    // The lock is taken synchronously, so the rejection needs no delay.
    const second = await compactSession(session, { binary: bin, timeoutMs: 20000, readyMs: 150 });
    expect(second).toMatchObject({
      success: false,
      error: "compaction already running for this session",
    });
    expect(isCompacting(session)).toBe(true);
    expect((await first).success).toBe(true);
    expect(isCompacting(session)).toBe(false);
  });

  it("allows a different session while one is running", async () => {
    const bin = stub("slow2.sh", `read -r line\nsleep 0.6\necho '${RESPONSE}'\ncat > /dev/null`);
    const a = compactSession(newSession(), { binary: bin, timeoutMs: 20000, readyMs: 150 });
    const b = compactSession(newSession(), { binary: bin, timeoutMs: 20000, readyMs: 150 });
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.success).toBe(true);
    expect(rb.success).toBe(true);
  });

  it("sends a compact command carrying customInstructions", async () => {
    const capture = join(dir, "cmd-with.json");
    const bin = recordingStub("record-with.sh", capture);
    const result = await compactSession(newSession(), {
      binary: bin,
      timeoutMs: 20000,
      readyMs: 150,
      instructions: "Focus on code changes",
    });
    expect(result.success).toBe(true);
    expect(existsSync(capture)).toBe(true);
    const sent = JSON.parse(readFileSync(capture, "utf8"));
    expect(sent.type).toBe("compact");
    expect(sent.customInstructions).toBe("Focus on code changes");
  });

  it("omits customInstructions when none is given", async () => {
    const capture = join(dir, "cmd-without.json");
    const bin = recordingStub("record-without.sh", capture);
    await compactSession(newSession(), { binary: bin, timeoutMs: 20000, readyMs: 150 });
    const sent = JSON.parse(readFileSync(capture, "utf8"));
    expect(sent.type).toBe("compact");
    expect("customInstructions" in sent).toBe(false);
  });

  it("omits customInstructions that are only whitespace", async () => {
    const capture = join(dir, "cmd-blank.json");
    const bin = recordingStub("record-blank.sh", capture);
    await compactSession(newSession(), { binary: bin, timeoutMs: 20000, readyMs: 150, instructions: "   " });
    const sent = JSON.parse(readFileSync(capture, "utf8"));
    expect("customInstructions" in sent).toBe(false);
  });
});
