// Shared Pi API route table — used by BOTH the Vite dev-server middleware
// (vite.config.ts) and the packaged Electron local API server
// (electron/api-routes.ts). Node-only module; keep it free of browser code.

import type { IncomingMessage, ServerResponse } from "node:http";
import { homedir } from "node:os";
import * as pi from "./pi-reader";
import * as builtins from "../src/data/builtin-providers";
import * as tools from "./workspace-tools";
import { compactSession, isCompacting } from "./session-compact";
import { listSlashCommands } from "./slash-commands";
import { rejectNonLocalRequest } from "./local-origin-guard";
import { fail, json, readJsonBody } from "./http-json";

export type PiApiNext = () => void;
export type PiApiMiddleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: PiApiNext,
) => void;

// Every handler replies through json()/fail() and reads its body through
// readJson(). Hand-rolling `setHeader` + `end(JSON.stringify(...))` per route
// is what let a few handlers drift out of sync with the rest — three of them
// ended up parsing the request body with no error handling at all, which is
// fatal in the packaged app. See server/http-json.ts for the body reader.

/** Query parameters of the request. */
function query(req: IncomingMessage): URLSearchParams {
  return new URL(req.url ?? "", "http://localhost").searchParams;
}

/**
 * The session id a request is asking about, under either parameter name.
 *
 * `session-history` shipped reading `id` while `session-info` and
 * `session-usage` read `session`. Nothing was broken — each caller in the
 * renderer matched the route it was written against — but the three routes take
 * the same kind of argument, so which spelling a given one wants was pure
 * memory, and getting it wrong returns an empty result rather than an error.
 * Both names work on all three now; the renderer keeps its existing calls.
 *
 * Exported for the test that pins this down: the invariant is that the two
 * spellings are indistinguishable, which is easy to break again by adding a
 * fourth route that reads `query(req).get(...)` directly.
 */
export function sessionIdFromUrl(url: string): string {
  const params = new URL(url || "", "http://localhost").searchParams;
  return params.get("session") ?? params.get("id") ?? "";
}

function sessionId(req: IncomingMessage): string {
  return sessionIdFromUrl(req.url ?? "");
}

/** Collect a JSON request body, answering 400 on malformed input. */
function readJson<T>(
  req: IncomingMessage,
  res: ServerResponse,
  handle: (body: T) => void | Promise<void>,
): void {
  readJsonBody<T>(req, res, handle);
}

/**
 * Resolve a usage date range to calendar dates.
 *
 * Usage records are bucketed by calendar day in the same timezone (see
 * `reportDateParts` in pi-reader.ts), so both sides must agree or "today"
 * silently selects the wrong bucket.
 */
function resolveDateRange(range: string, fromParam: string, toParam: string) {
  let toDate = pi.reportDateParts(Date.now()).date;
  const shiftDate = (date: string, days: number) => {
    const [year, month, day] = date.split("-").map(Number) as [number, number, number];
    const shifted = new Date(Date.UTC(year, (month ?? 1) - 1, day) - days * 86400000);
    return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
  };
  let fromDate: string;
  if (range === "today") fromDate = toDate;
  else if (range === "7d") fromDate = shiftDate(toDate, 6);
  else if (range === "30d") fromDate = shiftDate(toDate, 29);
  else if (range === "custom" && fromParam) { fromDate = fromParam; if (toParam) toDate = toParam; }
  else fromDate = toDate;
  return { fromDate, toDate };
}

export function createPiApiMiddleware(): PiApiMiddleware {
  // Warm the usage cache in the background so the dashboard's first
  // request doesn't block on scanning ~150MB of session JSONL.
  setTimeout(() => {
    try {
      pi.readAllUsage();
    } catch {
      /* ignore warm-up failure */
    }
    try {
      pi.readChatgptUsage();
    } catch {
      /* ignore warm-up failure */
    }
  }, 0);

  const routes: Record<string, (req: IncomingMessage, res: ServerResponse) => void> = {
    "GET /api/pi/settings"(_, res) {
      json(res, pi.readSettings() ?? {});
    },
    "POST /api/pi/settings"(req, res) {
      readJson<unknown>(req, res, (body) => {
        json(res, { success: pi.writeSettings(body) });
      });
    },
    "GET /api/pi/auth"(_, res) {
      json(res, pi.readAuth() ?? {});
    },
    "GET /api/pi/codex-usage-status"(req, res) {
      const force = query(req).get("refresh") === "1";
      pi.getCodexUsageStatus(force)
        .then((status) => json(res, status))
        .catch(() => fail(res, 500, { error: "Codex usage status failed" }));
    },
    "GET /api/pi/session-info"(req, res) {
      json(res, pi.readSessionInfo(sessionId(req)));
    },
    "GET /api/pi/skills"(_, res) {
      json(res, { skills: pi.listLocalSkills() });
    },
    // What "/" in the composer can actually run: extension commands, prompt
    // templates and skills, straight from pi. Built-in TUI commands are
    // excluded by pi itself because they do not execute outside the terminal.
    "GET /api/pi/slash-commands"(req, res) {
      const binary = pi.resolvePiBinary()?.bin;
      if (!binary) {
        return json(res, { commands: [], fetchedAt: Date.now(), error: "pi executable not found" });
      }
      const force = new URL(req.url ?? "", "http://localhost").searchParams.get("refresh") === "1";
      listSlashCommands({ binary, cwd: pi.resolveDefaultChatCwd(), force })
        .then((list) => json(res, list))
        .catch((error: unknown) =>
          json(res, {
            commands: [],
            fetchedAt: Date.now(),
            error: error instanceof Error ? error.message : "failed to read commands",
          }),
        );
    },
    "GET /api/pi/commands"(_, res) {
      json(res, { commands: pi.listPiBuiltinCommands() });
    },
    "GET /api/pi/chat/active"(_, res) {
      json(res, { sessionIds: pi.listActiveWebChats() });
    },
    "GET /api/pi/session-usage"(req, res) {
      json(res, pi.readSessionUsage(sessionId(req)) ?? {});
    },
    "GET /api/pi/official-usage-config"(_, res) {
      const config = pi.readOfficialUsageConfig();
      json(res, {
        endpoint: config.endpoint,
        authMode: config.authMode,
        keyCount: config.apiKeys.length,
        maskedKeys: config.apiKeys.map((key: string) => key.length > 8 ? `${key.slice(0, 4)}••••${key.slice(-4)}` : "••••••••"),
      });
    },
    "POST /api/pi/official-usage-refresh"(_, res) {
      pi.queryOfficialUsage(pi.readOfficialUsageConfig())
        .then((usage) => json(res, { success: true, usage }))
        .catch((error) => fail(res, 400, {
          success: false,
          error: error instanceof Error ? error.message : "Official usage query failed",
        }));
    },
    "POST /api/pi/official-usage-query"(req, res) {
      readJson<{ endpoint?: unknown; apiKeys?: unknown; authMode?: pi.OfficialUsageConfig["authMode"] }>(req, res, async (input) => {
        const config: pi.OfficialUsageConfig = {
          endpoint: typeof input.endpoint === "string" ? input.endpoint : "",
          apiKeys: Array.isArray(input.apiKeys) ? input.apiKeys.filter((key): key is string => typeof key === "string") : [],
          authMode: input.authMode ?? "auto",
        };
        try {
          const usage = await pi.queryOfficialUsage(config);
          const saved = pi.writeOfficialUsageConfig(config);
          json(res, { success: saved, usage, error: saved ? undefined : "Failed to save configuration" });
        } catch (error) {
          fail(res, 400, {
            success: false,
            error: error instanceof Error ? error.message : "Official usage query failed",
          });
        }
      });
    },
    "POST /api/pi/auth"(req, res) {
      readJson<unknown>(req, res, (body) => {
        json(res, { success: pi.writeAuth(body) });
      });
    },
    "GET /api/pi/models"(_, res) {
      json(res, pi.readModels() ?? { providers: {} });
    },
    "POST /api/pi/models"(req, res) {
      readJson<unknown>(req, res, (body) => {
        json(res, { success: pi.writeModels(body) });
      });
    },
    "GET /api/pi/builtin-providers"(_, res) {
      // Prefer the live catalog from the local pi install; fall back to
      // the hand-written static list when pi isn't found on this machine.
      json(res, pi.readBuiltinCatalog() ?? builtins.getBuiltinProviders());
    },
    "GET /api/pi/usage"(_, res) {
      const records = pi.readAllUsage();
      json(res, {
        records,
        dailyAggregates: pi.getDailyAggregates(records),
        providerSummaries: pi.getProviderSummaries(records),
        modelSummaries: pi.getModelSummaries(records),
        totals: pi.getTotals(records),
      });
    },
    "GET /api/pi/sessions"(req, res) {
      json(res, pi.listSessions(query(req).get("refresh") === "1"));
    },
    "POST /api/pi/chat"(req, res) {
      readJson<{ prompt?: string; sessionId?: string; projectPath?: string; model?: string; thinking?: string }>(req, res, async (body) => {
        const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
        if (!prompt) return fail(res, 400, { error: "missing prompt" });
        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        const result = await pi.runWebChat(
          prompt,
          body.sessionId,
          (chunk) => send("delta", chunk),
          body.projectPath,
          body.model,
          body.thinking,
          (status) => send("status", status),
          (step) => send("step", step),
        );
        if (result.error) send("error", result.error);
        else send("done", { sessionId: result.sessionId });
        res.end();
      });
    },
    "POST /api/pi/chat/stop"(req, res) {
      readJson<{ sessionId?: string }>(req, res, (body) => {
        json(res, { stopped: typeof body.sessionId === "string" && pi.stopWebChat(body.sessionId) });
      });
    },
    "POST /api/pi/chat/select-directory"(_, res) {
      pi.chooseChatDirectory()
        .then((path) => json(res, { path }))
        .catch(() => json(res, { path: null }));
    },
    "GET /api/pi/chat/default-directory"(_, res) {
      // What a prompt without an explicit project directory actually runs in.
      const path = pi.resolveDefaultChatCwd();
      // Home reads better as "~" than as the account's folder name.
      const home = homedir();
      const name = path === home ? "~" : (path.split("/").filter(Boolean).pop() ?? path);
      json(res, { path, name });
    },
    "GET /api/pi/memory"(_, res) {
      json(res, pi.readMemoryFiles());
    },
    "GET /api/pi/subagents"(_, res) {
      json(res, pi.readSubagents());
    },
    "GET /api/pi/packages/search"(req, res) {
      pi.searchPackages(query(req).get("q") ?? "")
        .then((results: unknown) => json(res, { results }))
        .catch(() => json(res, { results: [] }));
    },
    "POST /api/pi/subagents/update-agent"(req, res) {
      readJson<{ fileName?: string; model?: string; thinking?: string }>(req, res, (body) => {
        if (typeof body.fileName !== "string" || !body.fileName) {
          return fail(res, 400, { success: false, error: "Invalid request body" });
        }
        json(res, { success: pi.updateAgentFields(body.fileName, { model: body.model, thinking: body.thinking }) });
      });
    },
    "GET /api/pi/memory/config"(_, res) {
      json(res, pi.readHermesMemoryConfig() ?? {});
    },
    "GET /api/pi/memory/status"(_, res) {
      json(res, pi.readMemoryStatus());
    },
    "POST /api/pi/memory/config"(req, res) {
      readJson<pi.HermesMemoryConfig>(req, res, (patch) => {
        json(res, { success: pi.writeHermesMemoryConfig(patch) });
      });
    },
    "POST /api/pi/memory/optimize"(_, res) {
      pi.optimizeMemory()
        .then((result: unknown) => json(res, result))
        .catch((error: unknown) => fail(res, 500, {
          success: false,
          error: error instanceof Error ? error.message : "Optimize failed",
        }));
    },
    "POST /api/pi/memory/delete-entry"(req, res) {
      readJson<{ filename?: string; text?: string }>(req, res, (body) => {
        if (typeof body.filename !== "string" || typeof body.text !== "string") {
          return fail(res, 400, { success: false, error: "Invalid request body" });
        }
        json(res, { success: pi.deleteMemoryEntry(body.filename, body.text) });
      });
    },
    "GET /api/pi/trash"(_, res) {
      json(res, pi.listTrash());
    },
    "GET /api/pi/copilot-config"(_, res) {
      json(res, pi.readCopilotConfig() ?? {});
    },
    "POST /api/pi/copilot-config"(req, res) {
      readJson<{ username?: string; token?: string }>(req, res, (cfg) => {
        const ok = pi.writeCopilotConfig(cfg);
        // Config changed → drop cached usage so the next view refetches.
        pi.clearCopilotCaches();
        json(res, { success: ok });
      });
    },
    "POST /api/pi/session/trash"(req, res) {
      readJson<{ path?: string }>(req, res, (body) => {
        if (typeof body.path !== "string" || !body.path) {
          return fail(res, 400, { success: false, error: "Invalid request body" });
        }
        json(res, { success: pi.trashSessionFile(body.path) });
      });
    },
    "POST /api/pi/session/restore"(req, res) {
      readJson<{ trashPath?: string }>(req, res, (body) => {
        if (typeof body.trashPath !== "string" || !body.trashPath) {
          return fail(res, 400, { success: false, error: "Invalid request body" });
        }
        json(res, { success: pi.restoreFromTrash(body.trashPath) });
      });
    },
    "GET /api/pi/session-preview"(req, res) {
      const preview = pi.readSessionPreview(query(req).get("path") ?? "");
      if (!preview) return fail(res, 404, { error: "Session not found" });
      json(res, preview);
    },
    "GET /api/pi/session-history"(req, res) {
      const history = pi.readSessionHistory(sessionId(req));
      if (!history) return fail(res, 404, { error: "Session not found" });
      json(res, history);
    },
    "POST /api/pi/session-rename"(req, res) {
      readJson<{ sessionId?: string; name?: string }>(req, res, (body) => {
        const success = typeof body.sessionId === "string" && typeof body.name === "string"
          && pi.renameSession(body.sessionId, body.name);
        res.statusCode = success ? 200 : 400;
        json(res, { success });
      });
    },
    // Summarize older turns to free context. pi does the work over RPC; this
    // only resolves the session and forwards the result. Minutes-long and
    // billed, so the UI confirms before calling it.
    "POST /api/pi/session-compact"(req, res) {
      readJson<{ sessionId?: string; instructions?: string }>(req, res, (body) => {
        const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
        const target = sessionId ? pi.resolveSessionTarget(sessionId) : null;
        if (!target) {
          res.statusCode = 404;
          return json(res, { success: false, error: "session not found" });
        }
        if (isCompacting(target.filePath)) {
          res.statusCode = 409;
          return json(res, { success: false, error: "compaction already running for this session" });
        }
        const binary = pi.resolvePiBinary()?.bin;
        if (!binary) {
          res.statusCode = 503;
          return json(res, { success: false, error: "pi executable not found" });
        }
        compactSession(target.filePath, {
          binary,
          cwd: target.cwd,
          instructions: typeof body.instructions === "string" ? body.instructions : undefined,
        })
          .then((result) => {
            // The session file changed, so cached usage totals for it are stale.
            pi.clearSessionUsageCache();
            res.statusCode = result.success ? 200 : 400;
            json(res, result);
          })
          .catch((error: unknown) => {
            res.statusCode = 500;
            json(res, {
              success: false,
              error: error instanceof Error ? error.message : "compaction failed",
            });
          });
      });
    },
    "POST /api/pi/session-message"(req, res) {
      readJson<{ sessionId?: string; messageId?: string; text?: string }>(req, res, (body) => {
        const success = typeof body.sessionId === "string" && typeof body.messageId === "string"
          && typeof body.text === "string"
          && pi.updateSessionUserMessage(body.sessionId, body.messageId, body.text);
        res.statusCode = success ? 200 : 400;
        json(res, { success });
      });
    },
    "GET /api/pi/check-updates"(_, res) {
      pi.checkUpdates()
        .then((result) => json(res, result))
        .catch(() => fail(res, 500, { error: "Update check failed" }));
    },
    "POST /api/pi/apply-updates"(req, res) {
      readJson<{ names?: unknown }>(req, res, async (body) => {
        const results = await pi.applyExtensionUpdates(Array.isArray(body.names) ? body.names : []);
        json(res, { results });
      });
    },
    "POST /api/pi/provider-models"(req, res) {
      readJson<{ baseUrl?: string; apiKey?: string; providerId?: string }>(req, res, async (body) => {
        if (!body.baseUrl) return fail(res, 400, { models: [], error: "Invalid request body" });
        json(res, await pi.fetchProviderModels(body.baseUrl, body.apiKey, body.providerId));
      });
    },
    "POST /api/pi/model-test"(req, res) {
      readJson<{ baseUrl?: string; modelId?: string; apiKey?: string; apiType?: string }>(req, res, async (body) => {
        if (!body.baseUrl || !body.modelId) {
          return fail(res, 400, { success: false, message: "Invalid request body" });
        }
        json(res, await pi.testModel(body.baseUrl, body.modelId, body.apiKey, body.apiType ?? "openai-completions"));
      });
    },
    "POST /api/pi/provider-test"(req, res) {
      readJson<{ baseUrl?: string; apiKey?: string }>(req, res, async (body) => {
        if (!body.baseUrl) return fail(res, 400, { success: false, message: "Invalid request body" });
        json(res, await pi.testProviderConnection(body.baseUrl, body.apiKey));
      });
    },

    "POST /api/pi/sessions/auto-trash"(_, res) {
      // Automatically archive sessions that have been inactive for more
      // than two weeks. This is recoverable through the existing trash tab.
      json(res, pi.autoTrashStaleSessions(14));
    },

    // ─── Usage ranges ───────────────────────────────────
    "GET /api/pi/usage-range"(req, res) {
      const q = query(req);
      if (q.get("refresh") === "1") {
        pi.clearUsageCache();
        pi.clearChatgptUsageCache();
      }
      const { fromDate, toDate } = resolveDateRange(
        q.get("range") || "today",
        q.get("from") || "",
        q.get("to") || "",
      );
      json(res, pi.getUsageByRange(pi.readAllUsage(), fromDate, toDate));
    },
    // Local Codex Desktop rollout JSONL under ~/.codex/sessions.
    "GET /api/pi/chatgpt-usage-range"(req, res) {
      const q = query(req);
      if (q.get("refresh") === "1") pi.clearChatgptUsageCache();
      const { fromDate, toDate } = resolveDateRange(
        q.get("range") || "today",
        q.get("from") || "",
        q.get("to") || "",
      );
      json(res, pi.getUsageByRange(pi.readChatgptUsage(), fromDate, toDate));
    },

    // ─── Right-hand tool panel ──────────────────────────
    // Files and git are scoped to the project root the panel sends; see
    // server/workspace-tools.ts for the containment rules.
    "GET /api/pi/workspace/tree"(req, res) {
      const q = query(req);
      json(res, tools.listDirectory(q.get("root") ?? "", q.get("path") ?? "."));
    },
    "GET /api/pi/workspace/file"(req, res) {
      const q = query(req);
      json(res, tools.readTextFile(q.get("root") ?? "", q.get("path") ?? ""));
    },
    "GET /api/pi/workspace/review"(req, res) {
      json(res, tools.gitReview(query(req).get("cwd") ?? ""));
    },
    "GET /api/pi/workspace/diff"(req, res) {
      const q = query(req);
      json(res, tools.gitDiff(q.get("cwd") ?? "", q.get("path") ?? "", q.get("staged") === "1"));
    },
    "GET /api/pi/workspace/tasks"(_, res) {
      json(res, { tasks: tools.listTasks() });
    },
    "GET /api/pi/workspace/task-output"(req, res) {
      const q = query(req);
      const out = tools.readTaskOutput(q.get("id") ?? "", Number(q.get("since") ?? 0) || 0);
      if (!out) return fail(res, 404, { error: "task not found" });
      json(res, out);
    },
    "POST /api/pi/workspace/task-run"(req, res) {
      readJson<{ command?: string; cwd?: string; label?: string }>(req, res, (body) => {
        const result = tools.startTask({
          command: body.command ?? "",
          cwd: body.cwd ?? "",
          label: body.label,
        });
        if ("error" in result) res.statusCode = 400;
        json(res, result);
      });
    },
    "POST /api/pi/workspace/task-input"(req, res) {
      readJson<{ id?: string; data?: string }>(req, res, (body) => {
        json(res, { ok: tools.writeTaskInput(body.id ?? "", body.data ?? "") });
      });
    },
    "POST /api/pi/workspace/task-stop"(req, res) {
      readJson<{ id?: string }>(req, res, (body) => {
        json(res, { stopped: tools.killTask(body.id ?? "") });
      });
    },
    "POST /api/pi/workspace/tasks-clear"(_, res) {
      json(res, { removed: tools.clearFinishedTasks() });
    },
  };

  return (req, res, next) => {
    const method = req.method!;
    const url = req.url!;
    // Only handle /api/pi/* paths
    if (!url.startsWith("/api/pi/")) return next();

    const rejection = rejectNonLocalRequest(req);
    if (rejection) return fail(res, 403, { error: rejection });

    // Every response here is derived from live files or processes. Without this
    // Chromium may serve a repeated identical GET from its memory cache, which
    // silently froze the tool panel's task-output poll on its first (empty)
    // reply — the URL never changes while `since` stays 0.
    res.setHeader("Cache-Control", "no-store");

    // Strip query string
    const pathOnly = url.split("?")[0];

    // DELETE /api/pi/session?path=... (move to trash) and
    // DELETE /api/pi/trash?path=... (permanent).
    if (method === "DELETE" && (pathOnly === "/api/pi/session" || pathOnly === "/api/pi/trash")) {
      const filePath = query(req).get("path");
      if (!filePath) return fail(res, 400, { success: false, error: "Missing path" });
      const ok = pathOnly === "/api/pi/session"
        ? pi.trashSessionFile(filePath)
        : pi.permanentlyDeleteTrash(filePath);
      return json(res, { success: ok });
    }

    const handler = routes[`${method} ${pathOnly}`];
    if (!handler) return fail(res, 404, { error: "Not found" });

    // A synchronous throw inside a handler would otherwise reach the process,
    // and in the packaged app that means the whole window disappears.
    try {
      handler(req, res);
    } catch (error) {
      const message = error instanceof Error ? error.message : "request failed";
      if (res.headersSent) res.end();
      else fail(res, 500, { error: message });
    }
  };
}
