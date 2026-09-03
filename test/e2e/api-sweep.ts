// API sweep against the packaged app's local HTTP server.
//
// Run it with the packaged app already running:
//
//   env -u ELECTRON_RUN_AS_NODE ./release/mac-arm64/pi-desktop.app/Contents/MacOS/pi-desktop &
//   npm run test:api
//
// Scope is deliberate. Read-only GETs and non-destructive POSTs only: the routes
// that rewrite real configuration (settings / auth / models), trash or restore
// sessions, delete memory entries or install updates are exercised by hand,
// because this runs against the developer's actual ~/.pi/agent and a failed
// sweep must not be able to damage it. Model speed tests are excluded for the
// same reason in a different currency — they spend real tokens.

import { ApiClient, type Reply } from "./http-client.ts";
import { Runner, clip } from "./runner.ts";

const HOST = process.env.PI_E2E_HOST ?? "127.0.0.1";
const PORT = Number(process.env.PI_E2E_PORT ?? 51799);

const api = new ApiClient(HOST, PORT);
const run = new Runner(`API sweep · ${api.origin}`);

/** Assert a 200 with a JSON body, reporting the size so an empty shell shows. */
async function ok(path: string, expectation?: (json: any) => [boolean, string]) {
  const reply = await api.get(path);
  if (reply.status !== 200) {
    return run.check(path, false, `status ${reply.status} ${clip(reply.body, 60)}`);
  }
  if (reply.json === undefined) {
    return run.check(path, false, `non-JSON body ${clip(reply.body, 60)}`);
  }
  if (expectation) {
    const [pass, detail] = expectation(reply.json as any);
    return run.check(path, pass, detail);
  }
  return run.check(path, true, `200 ${reply.bytes}B`);
}

/** Assert an exact status and a substring of the body. */
async function status(name: string, reply: Reply, expected: number, contains?: string) {
  const statusOk = reply.status === expected;
  const bodyOk = contains === undefined || reply.body.includes(contains);
  return run.check(
    name,
    statusOk && bodyOk,
    `${reply.status} ${clip(reply.body, 60)}`,
  );
}

function count(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

// The usage-range contract, read off `getUsageByRange` rather than guessed.
//
// This is the assertion that failed the first time this sweep ran: /api/pi/usage
// nests its numbers under `totals`, /api/pi/usage-range does not, and the sweep
// asked both for `totals.requests`. Every range then reported "? req" and read as
// four broken routes. Naming the fields here — and pinning the same names in
// server/usage-range.test.ts, which runs in CI without the app — means a rename
// on either side fails loudly instead of degrading to a question mark.
const RANGE_NUMBERS = [
  "totalTokens",
  "totalInput",
  "totalOutput",
  "totalCacheRead",
  "totalCacheWrite",
  "totalCost",
  "totalRequests",
  "cacheHitRate",
] as const;

const RANGE_ARRAYS = [
  "dailyBreakdown",
  "hourlyBreakdown",
  "requestLog",
  "providerStats",
  "modelStats",
] as const;

/** Full shape check. A missing field names itself instead of printing "?". */
function rangeShape(j: any): [boolean, string] {
  const missing = [
    ...RANGE_NUMBERS.filter((f) => !Number.isFinite(j?.[f])),
    ...RANGE_ARRAYS.filter((f) => !Array.isArray(j?.[f])),
  ];
  if (missing.length > 0) return [false, `missing or mistyped: ${missing.join(", ")}`];
  return [
    true,
    `${j.totalRequests} req · $${j.totalCost.toFixed(4)} · ${j.dailyBreakdown.length} days`,
  ];
}

/** Same shape, plus the requirement that the window really is empty. */
function emptyRangeShape(j: any): [boolean, string] {
  const [shapeOk, detail] = rangeShape(j);
  if (!shapeOk) return [false, detail];
  const zeroed = RANGE_NUMBERS.every((f) => j[f] === 0);
  const empty = RANGE_ARRAYS.every((f) => j[f].length === 0);
  return [zeroed && empty, zeroed && empty ? `all zero · ${detail}` : `not empty: ${detail}`];
}

async function main() {
  await api.waitUntilReady();

  // ─── Read-only GETs ───────────────────────────────────
  // Every one of these reads real files. The size assertions matter: a reader
  // that silently returns {} still answers 200.
  await ok("/api/pi/settings");
  await ok("/api/pi/auth");
  await ok("/api/pi/models");
  await ok("/api/pi/builtin-providers", (j) => {
    const n = count(j);
    return [n > 0, `${n} providers`];
  });
  await ok("/api/pi/codex-usage-status");
  await ok("/api/pi/skills", (j) => [Array.isArray(j?.skills), `${count(j?.skills)} skills`]);
  await ok("/api/pi/commands", (j) => [Array.isArray(j?.commands), `${count(j?.commands)} commands`]);
  await ok("/api/pi/chat/active", (j) => [Array.isArray(j?.sessionIds), `${count(j?.sessionIds)} active`]);
  await ok("/api/pi/chat/default-directory", (j) => [
    typeof j?.path === "string" && j.path.length > 0,
    `${j?.name} → ${clip(String(j?.path), 40)}`,
  ]);
  await ok("/api/pi/official-usage-config");
  await ok("/api/pi/memory", (j) => [Array.isArray(j), `${count(j)} files`]);
  await ok("/api/pi/memory/config");
  await ok("/api/pi/memory/status");
  await ok("/api/pi/subagents");
  await ok("/api/pi/trash", (j) => [Array.isArray(j), `${count(j)} entries`]);
  await ok("/api/pi/copilot-config");
  await ok("/api/pi/check-updates");
  await ok("/api/pi/workspace/tasks", (j) => [Array.isArray(j?.tasks), `${count(j?.tasks)} tasks`]);
  await ok("/api/pi/packages/search?q=pi-hermes");
  await ok("/api/pi/usage", (j) => [
    Array.isArray(j?.records) && typeof j?.totals === "object",
    `${count(j?.records)} records`,
  ]);

  // ─── Usage ranges ─────────────────────────────────────
  // The timezone change lives here: the same records bucketed three ways.
  const rangeTotals: Record<string, number> = {};
  for (const range of ["today", "7d", "30d"]) {
    const reply = await api.get(`/api/pi/usage-range?range=${range}`);
    const body = reply.json as any;
    await ok(`/api/pi/usage-range?range=${range}`, rangeShape);
    if (Number.isFinite(body?.totalRequests)) rangeTotals[range] = body.totalRequests;
  }

  // A wider window cannot contain fewer requests. This is the one range
  // assertion that does not depend on how much usage the machine happens to
  // have, so it is the one that would catch a bucketing bug on a quiet day —
  // when every individual range legitimately reads zero.
  const today = rangeTotals["today"] ?? 0;
  const week = rangeTotals["7d"] ?? 0;
  const month = rangeTotals["30d"] ?? 0;
  run.check(
    "usage ranges nest: today <= 7d <= 30d",
    today <= week && week <= month,
    `${today} · ${week} · ${month}`,
  );

  // A window that predates the install. Asserting "all zero" rather than "has a
  // totals object" is what makes this case able to fail.
  await ok("/api/pi/usage-range?range=custom&from=2020-01-01&to=2020-01-02", emptyRangeShape);
  await ok("/api/pi/chatgpt-usage-range?range=7d", rangeShape);

  // A range whose bounds are inverted must not throw. It used to be the kind of
  // input only the UI could produce, and the UI now blocks it — which is exactly
  // why the server needs its own answer.
  await ok("/api/pi/usage-range?range=custom&from=2030-01-01&to=2020-01-01", emptyRangeShape);

  // ─── Parameterised GETs ───────────────────────────────
  // Ids come from the live session list rather than being hardcoded, so this
  // keeps working on any machine.
  const sessions = await api.get("/api/pi/sessions");
  const groups = (sessions.json as any[]) ?? [];
  const firstSession = groups.flatMap((g) => g?.sessions ?? [])[0];
  run.check(
    "/api/pi/sessions",
    sessions.status === 200 && groups.length > 0 && Boolean(firstSession),
    `${groups.length} projects · ${groups.reduce((n, g) => n + count(g?.sessions), 0)} sessions`,
  );

  if (firstSession) {
    const id = String(firstSession.id);
    const filePath = String(firstSession.filePath);

    // Both parameter names on all three routes. This is the fix for the sweep's
    // own earlier failure: it guessed `?session=` on session-history, got a 404,
    // and that read as an app bug. Now the two spellings must agree.
    for (const param of ["session", "id"]) {
      await ok(`/api/pi/session-info?${param}=${encodeURIComponent(id)}`, (j) => [
        j?.sessionId === id,
        `cwd ${clip(String(j?.cwd ?? "-"), 40)}`,
      ]);
      await ok(`/api/pi/session-usage?${param}=${encodeURIComponent(id)}`, (j) => [
        j?.sessionId === id || typeof j?.requests === "number",
        `${j?.requests ?? "?"} req · ${j?.totalTokens ?? "?"} tok`,
      ]);
      await ok(`/api/pi/session-history?${param}=${encodeURIComponent(id)}`, (j) => [
        Array.isArray(j?.messages),
        `${count(j?.messages)} of ${j?.total ?? "?"} turns`,
      ]);
    }

    await ok(`/api/pi/session-preview?path=${encodeURIComponent(filePath)}`, (j) => [
      Array.isArray(j?.messages),
      `${count(j?.messages)} messages`,
    ]);

    const root = String(firstSession.projectPath ?? process.cwd());
    await ok(`/api/pi/workspace/tree?root=${encodeURIComponent(root)}&path=.`, (j) => [
      Array.isArray(j?.entries),
      `${j?.rootName} · ${count(j?.entries)} entries`,
    ]);
    await ok(`/api/pi/workspace/review?cwd=${encodeURIComponent(root)}`);
  }

  await ok(`/api/pi/workspace/tree?root=${encodeURIComponent(process.cwd())}&path=.`);
  await ok(
    `/api/pi/workspace/file?root=${encodeURIComponent(process.cwd())}&path=package.json`,
    (j) => [typeof j?.content === "string" && j.content.includes("pi-desktop"), `${j?.content?.length ?? 0} chars`],
  );

  // ─── Path containment ─────────────────────────────────
  // The panel sends the project root with every request, so traversal is the
  // obvious attack on it. Both of these must be refused, not answered.
  await ok(
    `/api/pi/workspace/file?root=${encodeURIComponent(process.cwd())}&path=../../../etc/passwd`,
    (j) => [
      typeof j?.error === "string" && !j?.content,
      `refused: ${clip(String(j?.error ?? "LEAKED CONTENT"), 40)}`,
    ],
  );
  await ok(
    `/api/pi/workspace/tree?root=${encodeURIComponent(process.cwd())}&path=../..`,
    (j) => [typeof j?.error === "string" && count(j?.entries) === 0, `refused: ${clip(String(j?.error), 40)}`],
  );

  // ─── Negative cases and guards ────────────────────────
  await status("404 unknown route", await api.get("/api/pi/definitely-not-a-route"), 404, "Not found");
  await status("404 unknown task id", await api.get("/api/pi/workspace/task-output?id=nope"), 404, "task not found");
  await status(
    "403 cross-site Origin",
    await api.get("/api/pi/settings", { Origin: "https://attacker.example" }),
    403,
    "cross-origin",
  );
  // Host forgery is DNS rebinding. `fetch` cannot set Host at all and curl would
  // route this through http_proxy, which is why the client here is node:http.
  await status(
    "403 non-loopback Host",
    await api.get("/api/pi/settings", { Host: "attacker.example" }),
    403,
    "unexpected Host",
  );
  await status(
    "403 non-loopback Host with port",
    await api.get("/api/pi/settings", { Host: `attacker.example:${PORT}` }),
    403,
    "unexpected Host",
  );
  await status(
    "200 loopback Host with port",
    await api.get("/api/pi/settings", { Host: `localhost:${PORT}` }),
    200,
  );
  await status(
    "403 non-JSON POST body",
    await api.send("/api/pi/workspace/tasks-clear", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "hello",
    }),
    403,
    "application/json",
  );

  // The P0 fix, verified end to end: a bare JSON.parse throw here used to reach
  // the process, and in the packaged app that means the window disappears. The
  // follow-up request is the actual assertion — 400 is only interesting if the
  // server is still there afterwards.
  await status(
    "400 malformed JSON body",
    await api.send("/api/pi/workspace/task-run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    }),
    400,
    "invalid JSON body",
  );
  await status("server alive after malformed body", await api.get("/api/pi/settings"), 200);
  await status(
    "400 empty command",
    await api.post("/api/pi/workspace/task-run", { command: "", cwd: process.cwd() }),
    400,
  );

  // ─── Long multi-byte round trip ───────────────────────
  // The other P0 fix. Chunk boundaries land mid-character in a body this size,
  // and decoding per chunk replaces those characters with U+FFFD while
  // JSON.parse still succeeds — silent corruption, detectable only by comparing
  // what comes back. The odd padding length guarantees a straddle.
  const label = "汉字测试".repeat(7777) + "汉";
  const started = await api.post("/api/pi/workspace/task-run", {
    command: "printf ok",
    cwd: process.cwd(),
    label,
  });
  const taskId = (started.json as any)?.id;
  run.check(
    "task-run accepts a 90KB Chinese label",
    started.status === 200 && typeof taskId === "string",
    `${started.status} ${clip(started.body, 40)}`,
  );

  if (typeof taskId === "string") {
    await run.waitFor(
      "long Chinese label round-trips intact",
      async () => {
        const tasks = await api.get("/api/pi/workspace/tasks");
        const task = ((tasks.json as any)?.tasks ?? []).find((t: any) => t?.id === taskId);
        if (!task) return [false, "task not listed yet"];
        const echoed = String(task.label ?? "");
        if (echoed === label) {
          return [true, `${echoed.length} chars intact, no U+FFFD`];
        }
        const bad = (echoed.match(/\uFFFD/g) ?? []).length;
        return [false, `length ${echoed.length} vs ${label.length}, ${bad} replacement chars`];
      },
      { timeoutMs: 8_000 },
    );
    await status("task-stop", await api.post("/api/pi/workspace/task-stop", { id: taskId }), 200);
  }

  // ─── Non-destructive POSTs ────────────────────────────
  await status(
    "chat/stop on an unknown session",
    await api.post("/api/pi/chat/stop", { sessionId: "no-such-session" }),
    200,
    "false",
  );
  // An unreachable provider must come back as a failed result, not a throw:
  // this path runs inside the main process.
  await status(
    "provider-test survives an unreachable base URL",
    await api.post("/api/pi/provider-test", { baseUrl: "http://127.0.0.1:9/v1", apiKey: "x" }),
    200,
  );
  await status(
    "provider-models rejects a missing base URL",
    await api.post("/api/pi/provider-models", {}),
    400,
  );
  await status(
    "model-test rejects a missing model id",
    await api.post("/api/pi/model-test", { baseUrl: "http://127.0.0.1:9/v1" }),
    400,
  );
  await status(
    "subagents/update-agent rejects a missing filename",
    await api.post("/api/pi/subagents/update-agent", {}),
    400,
  );
  await status("workspace/tasks-clear", await api.post("/api/pi/workspace/tasks-clear", {}), 200);

  // Empty body where a JSON object is expected: readJsonBody turns "" into {},
  // so this exercises the validation branch rather than the parser.
  await status(
    "empty body treated as an empty object",
    await api.send("/api/pi/session/trash", {
      method: "POST",
      headers: { "content-type": "application/json" },
    }),
    400,
    "Invalid request body",
  );

  process.exit(run.report());
}

main().catch((error) => {
  process.stderr.write(`\nsweep aborted: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
