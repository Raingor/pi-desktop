import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { aggregateUsage, formatUsageSummary, parseSessionText, readUsageSummary } from "../src/usage.js";

const timeZone = "UTC";
const now = new Date("2026-09-02T12:00:00.000Z");

function assistant(timestamp, { provider = "openai", model = "gpt-5", input = 10, output = 20, cacheRead = 5, cacheWrite = 0, cost = 0.012 } = {}) {
  return JSON.stringify({
    type: "message",
    timestamp,
    message: {
      role: "assistant",
      timestamp,
      provider,
      model,
      usage: { input, output, cacheRead, cacheWrite, cost: { total: cost } },
    },
  });
}

test("parseSessionText reads assistant usage, ignores malformed lines, and falls back to model changes", () => {
  const text = [
    JSON.stringify({ type: "model_change", provider: "anthropic", modelId: "claude-sonnet" }),
    JSON.stringify({ type: "message", timestamp: "2026-09-02T10:00:00.000Z", message: { role: "assistant", usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, cost: { total: 0.5 } } } }),
    "not json",
    JSON.stringify({ type: "message", timestamp: "2026-09-02T10:01:00.000Z", message: { role: "user" } }),
  ].join("\n");

  const records = parseSessionText(text, { sessionFile: "a.jsonl", timeZone });
  assert.deepEqual(records, [{
    sessionFile: "a.jsonl",
    date: "2026-09-02",
    provider: "anthropic",
    model: "claude-sonnet",
    input: 1,
    output: 2,
    cacheRead: 3,
    cacheWrite: 4,
    tokens: 10,
    cost: 0.5,
  }]);
});

test("aggregateUsage calculates inclusive seven-day sessions, daily buckets, and models", () => {
  const records = [
    ...parseSessionText(assistant("2026-09-02T01:00:00.000Z"), { sessionFile: "one.jsonl", timeZone }),
    ...parseSessionText(assistant("2026-08-27T01:00:00.000Z", { model: "gpt-4.1", input: 1, output: 2, cacheRead: 0, cost: 0.001 }), { sessionFile: "two.jsonl", timeZone }),
    ...parseSessionText(assistant("2026-08-26T01:00:00.000Z"), { sessionFile: "old.jsonl", timeZone }),
  ];

  const summary = aggregateUsage(records, { now, timeZone });
  assert.deepEqual(summary.today, { sessions: 1, requests: 1, tokens: 35, cost: 0.012 });
  assert.equal(summary.lastSevenDays.sessions, 2);
  assert.equal(summary.lastSevenDays.requests, 2);
  assert.equal(summary.lastSevenDays.tokens, 38);
  assert.ok(Math.abs(summary.lastSevenDays.cost - 0.013) < 1e-9);
  assert.equal(summary.daily.length, 7);
  assert.equal(summary.daily[0].date, "2026-08-27");
  assert.equal(summary.daily.at(-1).date, "2026-09-02");
  assert.deepEqual(summary.models.map((model) => model.name), ["openai/gpt-5", "openai/gpt-4.1"]);
  assert.match(formatUsageSummary(summary), /Last 7 days \(2026-08-27 to 2026-09-02\)/);
});

test("readUsageSummary recursively reads JSONL files and reports unreadable roots", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-usage-"));
  const nested = join(root, "--project--");
  await mkdir(nested);
  await writeFile(join(nested, "session.jsonl"), assistant("2026-09-02T02:00:00.000Z"));
  await writeFile(join(root, "ignore.txt"), "not a session");

  const summary = await readUsageSummary({ sessionsDir: root, now, timeZone });
  assert.equal(summary.scannedFiles, 1);
  assert.equal(summary.skippedPaths, 0);
  assert.equal(summary.today.requests, 1);

  const missing = await readUsageSummary({ sessionsDir: join(root, "missing"), now, timeZone });
  assert.equal(missing.scannedFiles, 0);
  assert.equal(missing.skippedPaths, 1);
});
