import { describe, expect, it, afterAll, beforeAll, beforeEach } from "vitest";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { clearSlashCommandCache, listSlashCommands } from "./slash-commands";

// The registry comes from `pi --mode rpc` + get_commands. Starting the real pi
// takes ~16s, so these stubs answer the same protocol instead. What is under
// test is the normalization, ordering, caching and failure handling.

let dir: string;
let counter = 0;

function stub(body: string): string {
  const path = join(dir, `pi-${++counter}.sh`);
  writeFileSync(path, `#!/bin/bash\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

const COMMANDS = [
  { name: "skill:frontend-design", description: "Design UIs", source: "skill", location: "user" },
  { name: "websearch", description: "Search the web", source: "extension" },
  { name: "review-loop", description: "Review until clean", source: "prompt", location: "project" },
  { name: "skill:commit-context", description: "Trace a commit", source: "skill" },
  { name: "browser", description: "Drive a browser", source: "extension" },
];

/** Stub that answers get_commands with `payload`, then idles. */
function answering(payload: unknown): string {
  const body = JSON.stringify({
    type: "response",
    command: "get_commands",
    success: true,
    data: { commands: payload },
  });
  return stub(`read -r line\necho '${body}'\ncat > /dev/null`);
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "pi-slash-"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));
beforeEach(() => clearSlashCommandCache());

describe("listSlashCommands", () => {
  it("returns commands grouped extension → prompt → skill", async () => {
    const list = await listSlashCommands({ binary: answering(COMMANDS), readyMs: 100 });
    expect(list.error).toBeUndefined();
    expect(list.commands.map((c) => c.source)).toEqual([
      "extension",
      "extension",
      "prompt",
      "skill",
      "skill",
    ]);
    // Alphabetical inside each group.
    expect(list.commands.map((c) => c.name)).toEqual([
      "browser",
      "websearch",
      "review-loop",
      "skill:commit-context",
      "skill:frontend-design",
    ]);
    expect(list.fetchedAt).toBeGreaterThan(0);
  });

  it("keeps description, location and path", async () => {
    const list = await listSlashCommands({
      binary: answering([
        { name: "x", description: "d", source: "prompt", location: "project", path: "/tmp/x.md" },
      ]),
      readyMs: 100,
    });
    expect(list.commands[0]).toEqual({
      name: "x",
      description: "d",
      source: "prompt",
      location: "project",
      path: "/tmp/x.md",
    });
  });

  it("drops entries with no name or an unknown source", async () => {
    const list = await listSlashCommands({
      binary: answering([
        { name: "", source: "extension" },
        { name: "  ", source: "extension" },
        { name: "builtin", source: "tui" },
        { name: "ok", source: "extension" },
        "not an object",
        null,
      ]),
      readyMs: 100,
    });
    expect(list.commands.map((c) => c.name)).toEqual(["ok"]);
  });

  it(
    "tolerates a missing or malformed commands array",
    async () => {
      for (const payload of [undefined, null, "nope", 42]) {
        clearSlashCommandCache();
        const list = await listSlashCommands({ binary: answering(payload), readyMs: 100 });
        expect(list.commands).toEqual([]);
      }
    },
    // Four stub processes in one case; each bash spawn costs ~1s.
    20000,
  );

  it("reports pi's failure and does not cache it", async () => {
    const failing = stub(
      `read -r line\necho '{"type":"response","command":"get_commands","success":false,"error":"boom"}'\ncat > /dev/null`,
    );
    const first = await listSlashCommands({ binary: failing, readyMs: 100 });
    expect(first.commands).toEqual([]);
    expect(first.error).toBe("boom");

    // A failure must not poison the cache: the next call retries and succeeds.
    const second = await listSlashCommands({ binary: answering(COMMANDS), readyMs: 100 });
    expect(second.commands.length).toBe(5);
    expect(second.error).toBeUndefined();
  });

  it("serves a second call from cache without starting pi again", async () => {
    // The stub records each invocation, so a cache hit leaves the count at 1.
    const marker = join(dir, "runs.log");
    const counting = stub(
      `echo run >> '${marker}'\nread -r line\n` +
        `echo '{"type":"response","command":"get_commands","success":true,"data":{"commands":[{"name":"a","source":"extension"}]}}'\n` +
        `cat > /dev/null`,
    );
    await listSlashCommands({ binary: counting, readyMs: 100 });
    await listSlashCommands({ binary: counting, readyMs: 100 });
    const runs = (await import("fs")).readFileSync(marker, "utf8").trim().split("\n").length;
    expect(runs).toBe(1);
  });

  it("re-reads when force is set", async () => {
    const marker = join(dir, "runs-force.log");
    const counting = stub(
      `echo run >> '${marker}'\nread -r line\n` +
        `echo '{"type":"response","command":"get_commands","success":true,"data":{"commands":[{"name":"a","source":"extension"}]}}'\n` +
        `cat > /dev/null`,
    );
    await listSlashCommands({ binary: counting, readyMs: 100 });
    await listSlashCommands({ binary: counting, readyMs: 100, force: true });
    const runs = (await import("fs")).readFileSync(marker, "utf8").trim().split("\n").length;
    expect(runs).toBe(2);
  });

  it("coalesces concurrent misses into one pi run", async () => {
    const marker = join(dir, "runs-concurrent.log");
    const counting = stub(
      `echo run >> '${marker}'\nread -r line\nsleep 0.4\n` +
        `echo '{"type":"response","command":"get_commands","success":true,"data":{"commands":[{"name":"a","source":"extension"}]}}'\n` +
        `cat > /dev/null`,
    );
    const [a, b, c] = await Promise.all([
      listSlashCommands({ binary: counting, readyMs: 100 }),
      listSlashCommands({ binary: counting, readyMs: 100 }),
      listSlashCommands({ binary: counting, readyMs: 100 }),
    ]);
    expect(a.commands.length).toBe(1);
    expect(b).toBe(a);
    expect(c).toBe(a);
    const runs = (await import("fs")).readFileSync(marker, "utf8").trim().split("\n").length;
    expect(runs).toBe(1);
  });

  it("reports a missing binary instead of throwing", async () => {
    const list = await listSlashCommands({
      binary: join(dir, "no-such-pi"),
      readyMs: 100,
      timeoutMs: 5000,
    });
    expect(list.commands).toEqual([]);
    expect(list.error).toBeTruthy();
  });

  it("times out rather than hanging", async () => {
    const list = await listSlashCommands({
      binary: stub("cat > /dev/null"),
      readyMs: 100,
      timeoutMs: 700,
    });
    expect(list.commands).toEqual([]);
    expect(list.error).toMatch(/did not answer/);
  });
});
