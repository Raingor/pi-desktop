// Shared Pi API route table — used by BOTH the Vite dev-server middleware
// (vite.config.ts) and the packaged Electron local API server
// (electron/api-routes.ts). Node-only module; keep it free of browser code.

import type { IncomingMessage, ServerResponse } from "node:http";
import { homedir } from "node:os";
import * as pi from "./pi-reader";
import * as builtins from "../src/data/builtin-providers";
import * as tools from "./workspace-tools";
import { rejectNonLocalRequest } from "./local-origin-guard";

export type PiApiNext = () => void;
export type PiApiMiddleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: PiApiNext,
) => void;

/** Reply with JSON. */
function json(res: ServerResponse, payload: unknown): void {
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

/** Collect a JSON request body, answering 400 on malformed input. */
function readJson<T>(
  req: IncomingMessage,
  res: ServerResponse,
  handle: (body: T) => void,
): void {
  let raw = "";
  req.on("data", (chunk: string) => (raw += chunk));
  req.on("end", () => {
    try {
      handle((raw ? JSON.parse(raw) : {}) as T);
    } catch {
      res.statusCode = 400;
      json(res, { error: "invalid JSON body" });
    }
  });
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
      const data = pi.readSettings();
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(data ?? {}));
    },
    "POST /api/pi/settings"(req, res) {
      let body = "";
      req.on("data", (chunk: string) => (body += chunk));
      req.on("end", () => {
        const ok = pi.writeSettings(JSON.parse(body));
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ success: ok }));
      });
    },
    "GET /api/pi/auth"(_, res) {
      const data = pi.readAuth();
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(data ?? {}));
    },
    "GET /api/pi/codex-usage-status"(req, res) {
      const force = new URL(req.url ?? "", "http://localhost").searchParams.get("refresh") === "1";
      pi.getCodexUsageStatus(force).then((status) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(status));
      });
    },
    "GET /api/pi/session-info"(req, res) {
      const sessionId = new URL(req.url ?? "", "http://localhost").searchParams.get("session") ?? "";
      const data = pi.readSessionInfo(sessionId);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(data));
    },
    "GET /api/pi/skills"(_, res) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ skills: pi.listLocalSkills() }));
    },
    "GET /api/pi/commands"(_, res) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ commands: pi.listPiBuiltinCommands() }));
    },
    "GET /api/pi/chat/active"(_, res) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ sessionIds: pi.listActiveWebChats() }));
    },
    "GET /api/pi/session-usage"(req, res) {
      const sessionId = new URL(req.url ?? "", "http://localhost").searchParams.get("session") ?? "";
      const usage = pi.readSessionUsage(sessionId);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(usage ?? {}));
    },
    "GET /api/pi/official-usage-config"(_, res) {
      const config = pi.readOfficialUsageConfig();
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({
        endpoint: config.endpoint,
        authMode: config.authMode,
        keyCount: config.apiKeys.length,
        maskedKeys: config.apiKeys.map((key: string) => key.length > 8 ? `${key.slice(0, 4)}••••${key.slice(-4)}` : "••••••••"),
      }));
    },
    "POST /api/pi/official-usage-refresh"(_, res) {
      pi.queryOfficialUsage(pi.readOfficialUsageConfig()).then((usage) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ success: true, usage }));
      }).catch((error) => {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Official usage query failed" }));
      });
    },
    "POST /api/pi/official-usage-query"(req, res) {
      let body = "";
      req.on("data", (chunk: string) => (body += chunk));
      req.on("end", async () => {
        try {
          const input = JSON.parse(body);
          const config = {
            endpoint: typeof input.endpoint === "string" ? input.endpoint : "",
            apiKeys: Array.isArray(input.apiKeys) ? input.apiKeys : [],
            authMode: input.authMode,
          };
          const usage = await pi.queryOfficialUsage(config);
          const saved = pi.writeOfficialUsageConfig(config);
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ success: saved, usage, error: saved ? undefined : "Failed to save configuration" }));
        } catch (error) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Official usage query failed" }));
        }
      });
    },
    "POST /api/pi/auth"(req, res) {
      let body = "";
      req.on("data", (chunk: string) => (body += chunk));
      req.on("end", () => {
        const ok = pi.writeAuth(JSON.parse(body));
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ success: ok }));
      });
    },
    "GET /api/pi/models"(_, res) {
      const data = pi.readModels();
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(data ?? { providers: {} }));
    },
    "POST /api/pi/models"(req, res) {
      let body = "";
      req.on("data", (chunk: string) => (body += chunk));
      req.on("end", () => {
        const ok = pi.writeModels(JSON.parse(body));
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ success: ok }));
      });
    },
    "GET /api/pi/builtin-providers"(_, res) {
      res.setHeader("Content-Type", "application/json");
      // Prefer the live catalog from the local pi install; fall back to
      // the hand-written static list when pi isn't found on this machine.
      const catalog = pi.readBuiltinCatalog();
      res.end(JSON.stringify(catalog ?? builtins.getBuiltinProviders()));
    },
    "GET /api/pi/usage"(_, res) {
      const records = pi.readAllUsage();
      const usage = {
        records,
        dailyAggregates: pi.getDailyAggregates(records),
        providerSummaries: pi.getProviderSummaries(records),
        modelSummaries: pi.getModelSummaries(records),
        totals: pi.getTotals(records),
      };
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(usage));
    },
    "GET /api/pi/sessions"(_, res) {
      const sessions = pi.listSessions();
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(sessions));
    },
    "POST /api/pi/chat"(req, res) {
      let body = "";
      req.on("data", (chunk: string) => (body += chunk));
      req.on("end", async () => {
        try {
          const { prompt, sessionId, projectPath, model, thinking } = JSON.parse(body) as { prompt?: string; sessionId?: string; projectPath?: string; model?: string; thinking?: string };
          if (typeof prompt !== "string" || !prompt.trim()) throw new Error("missing prompt");
          res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
          res.setHeader("Cache-Control", "no-cache, no-transform");
          res.setHeader("Connection", "keep-alive");
          const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
          const result = await pi.runWebChat(prompt.trim(), sessionId, (chunk) => send("delta", chunk), projectPath, model, thinking, (status) => send("status", status), (step) => send("step", step));
          if (result.error) send("error", result.error);
          else send("done", { sessionId: result.sessionId });
          res.end();
        } catch (error) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : "Invalid request" }));
        }
      });
    },
    "POST /api/pi/chat/stop"(req, res) {
      let body = "";
      req.on("data", (chunk: string) => (body += chunk));
      req.on("end", () => {
        try {
          const { sessionId } = JSON.parse(body) as { sessionId?: string };
          const stopped = typeof sessionId === "string" && pi.stopWebChat(sessionId);
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ stopped }));
        } catch {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ stopped: false }));
        }
      });
    },
    "POST /api/pi/chat/select-directory"(_, res) {
      pi.chooseChatDirectory().then((path) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ path }));
      });
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
      const memory = pi.readMemoryFiles();
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(memory));
    },
    "GET /api/pi/subagents"(_, res) {
      const data = pi.readSubagents();
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(data));
    },
    "GET /api/pi/packages/search"(req, res) {
      const parsed = new URL(req.url ?? "", "http://localhost");
      const q = parsed.searchParams.get("q") ?? "";
      pi.searchPackages(q).then((results: unknown) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ results }));
      }).catch(() => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ results: [] }));
      });
    },
    "POST /api/pi/subagents/update-agent"(req, res) {
      let body = "";
      req.on("data", (chunk: string) => (body += chunk));
      req.on("end", () => {
        try {
          const { fileName, model, thinking } = JSON.parse(body) as { fileName: string; model?: string; thinking?: string };
          const ok = pi.updateAgentFields(fileName, { model, thinking });
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ success: ok }));
        } catch {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ success: false, error: "Invalid request body" }));
        }
      });
    },
    "GET /api/pi/memory/config"(_, res) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(pi.readHermesMemoryConfig() ?? {}));
    },
    "GET /api/pi/memory/status"(_, res) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(pi.readMemoryStatus()));
    },
    "POST /api/pi/memory/config"(req, res) {
      let body = "";
      req.on("data", (chunk: string) => (body += chunk));
      req.on("end", () => {
        try {
          const patch = JSON.parse(body);
          const ok = pi.writeHermesMemoryConfig(patch);
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ success: ok }));
        } catch {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ success: false, error: "Invalid request body" }));
        }
      });
    },
    "POST /api/pi/memory/optimize"(_, res) {
      pi.optimizeMemory().then((result: unknown) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(result));
      }).catch((error: unknown) => {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Optimize failed" }));
      });
    },
    "POST /api/pi/memory/delete-entry"(req, res) {
      let body = "";
      req.on("data", (chunk: string) => (body += chunk));
      req.on("end", () => {
        try {
          const { filename, text } = JSON.parse(body) as { filename: string; text: string };
          const ok = pi.deleteMemoryEntry(filename, text);
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ success: ok }));
        } catch {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ success: false, error: "Invalid request body" }));
        }
      });
    },
    "GET /api/pi/trash"(_, res) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(pi.listTrash()));
    },
    "GET /api/pi/copilot-config"(_, res) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(pi.readCopilotConfig() ?? {}));
    },
    "POST /api/pi/copilot-config"(req, res) {
      let body = "";
      req.on("data", (chunk: string) => (body += chunk));
      req.on("end", () => {
        try {
          const cfg = JSON.parse(body) as { username?: string; token?: string };
          const ok = pi.writeCopilotConfig(cfg);
          // Config changed → drop cached usage so the next view refetches.
          pi.clearCopilotCaches();
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ success: ok }));
        } catch {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ success: false, error: "Invalid request body" }));
        }
      });
    },
    "POST /api/pi/session/trash"(req, res) {
      let body = "";
      req.on("data", (chunk: string) => (body += chunk));
      req.on("end", () => {
        try {
          const { path: p } = JSON.parse(body) as { path: string };
          const ok = pi.trashSessionFile(p);
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ success: ok }));
        } catch {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ success: false, error: "Invalid request body" }));
        }
      });
    },
    "POST /api/pi/session/restore"(req, res) {
      let body = "";
      req.on("data", (chunk: string) => (body += chunk));
      req.on("end", () => {
        try {
          const { trashPath } = JSON.parse(body) as { trashPath: string };
          const ok = pi.restoreFromTrash(trashPath);
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ success: ok }));
        } catch {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ success: false, error: "Invalid request body" }));
        }
      });
    },
    "GET /api/pi/session-preview"(req, res) {
      const parsedUrl = new URL(req.url!, "http://localhost");
      const p = parsedUrl.searchParams.get("path") || "";
      const preview = pi.readSessionPreview(decodeURIComponent(p));
      if (!preview) {
        res.statusCode = 404;
        res.setHeader("Content-Type", "application/json");
        return res.end(JSON.stringify({ error: "Session not found" }));
      }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(preview));
    },
    "GET /api/pi/session-history"(req, res) {
      const parsedUrl = new URL(req.url!, "http://localhost");
      const history = pi.readSessionHistory(parsedUrl.searchParams.get("id") || "");
      if (!history) {
        res.statusCode = 404;
        res.setHeader("Content-Type", "application/json");
        return res.end(JSON.stringify({ error: "Session not found" }));
      }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(history));
    },
    "POST /api/pi/session-rename"(req, res) {
      let body = "";
      req.on("data", (chunk: string) => (body += chunk));
      req.on("end", () => {
        try {
          const { sessionId, name } = JSON.parse(body) as { sessionId?: string; name?: string };
          const success = typeof sessionId === "string" && typeof name === "string" && pi.renameSession(sessionId, name);
          res.statusCode = success ? 200 : 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ success }));
        } catch {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ success: false }));
        }
      });
    },
    "POST /api/pi/session-message"(req, res) {
      let body = "";
      req.on("data", (chunk: string) => (body += chunk));
      req.on("end", () => {
        try {
          const { sessionId, messageId, text } = JSON.parse(body) as { sessionId?: string; messageId?: string; text?: string };
          const success = typeof sessionId === "string" && typeof messageId === "string" && typeof text === "string"
            && pi.updateSessionUserMessage(sessionId, messageId, text);
          res.statusCode = success ? 200 : 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ success }));
        } catch {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ success: false }));
        }
      });
    },
    "GET /api/pi/check-updates"(_, res) {
      pi.checkUpdates()
        .then((result) => {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(result));
        })
        .catch(() => {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Update check failed" }));
        });
    },
    "POST /api/pi/apply-updates"(req, res) {
      let body = "";
      req.on("data", (chunk: string) => (body += chunk));
      req.on("end", async () => {
        try {
          const { names } = JSON.parse(body) as { names: string[] };
          const results = await pi.applyExtensionUpdates(Array.isArray(names) ? names : []);
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ results }));
        } catch {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Invalid request body" }));
        }
      });
    },
    "POST /api/pi/provider-models"(req, res) {
      let body = "";
      req.on("data", (chunk: string) => (body += chunk));
      req.on("end", () => {
        try {
          const { baseUrl, apiKey, providerId } = JSON.parse(body) as {
            baseUrl: string;
            apiKey?: string;
            providerId?: string;
          };
          if (!baseUrl) throw new Error("missing baseUrl");
          pi.fetchProviderModels(baseUrl, apiKey, providerId).then((result) => {
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(result));
          });
        } catch {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ models: [], error: "Invalid request body" }));
        }
      });
    },
    "POST /api/pi/model-test"(req, res) {
      let body = "";
      req.on("data", (chunk: string) => (body += chunk));
      req.on("end", () => {
        try {
          const { baseUrl, modelId, apiKey, apiType } = JSON.parse(body) as { baseUrl: string; modelId: string; apiKey?: string; apiType?: string };
          if (!baseUrl || !modelId) throw new Error("missing baseUrl or modelId");
          pi.testModel(baseUrl, modelId, apiKey, apiType ?? "openai-completions").then((result) => {
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(result));
          });
        } catch {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ success: false, message: "Invalid request body" }));
        }
      });
    },
    "POST /api/pi/provider-test"(req, res) {
      let body = "";
      req.on("data", (chunk: string) => (body += chunk));
      req.on("end", () => {
        try {
          const { baseUrl, apiKey } = JSON.parse(body) as { baseUrl: string; apiKey?: string };
          if (!baseUrl) throw new Error("missing baseUrl");
          pi.testProviderConnection(baseUrl, apiKey).then((result) => {
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(result));
          });
        } catch {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ success: false, message: "Invalid request body" }));
        }
      });
    },

    // ─── Right-hand tool panel ──────────────────────────
    // Files and git are scoped to the project root the panel sends; see
    // server/workspace-tools.ts for the containment rules.
    "GET /api/pi/workspace/tree"(req, res) {
      const q = new URL(req.url ?? "", "http://localhost").searchParams;
      const listing = tools.listDirectory(q.get("root") ?? "", q.get("path") ?? ".");
      json(res, listing);
    },
    "GET /api/pi/workspace/file"(req, res) {
      const q = new URL(req.url ?? "", "http://localhost").searchParams;
      json(res, tools.readTextFile(q.get("root") ?? "", q.get("path") ?? ""));
    },
    "GET /api/pi/workspace/review"(req, res) {
      const q = new URL(req.url ?? "", "http://localhost").searchParams;
      json(res, tools.gitReview(q.get("cwd") ?? ""));
    },
    "GET /api/pi/workspace/diff"(req, res) {
      const q = new URL(req.url ?? "", "http://localhost").searchParams;
      json(
        res,
        tools.gitDiff(q.get("cwd") ?? "", q.get("path") ?? "", q.get("staged") === "1"),
      );
    },
    "GET /api/pi/workspace/tasks"(_, res) {
      json(res, { tasks: tools.listTasks() });
    },
    "GET /api/pi/workspace/task-output"(req, res) {
      const q = new URL(req.url ?? "", "http://localhost").searchParams;
      const out = tools.readTaskOutput(q.get("id") ?? "", Number(q.get("since") ?? 0) || 0);
      if (!out) {
        res.statusCode = 404;
        return json(res, { error: "task not found" });
      }
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
    if (rejection) {
      res.statusCode = 403;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ error: rejection }));
    }

    // Every response here is derived from live files or processes. Without this
    // Chromium may serve a repeated identical GET from its memory cache, which
    // silently froze the tool panel's task-output poll on its first (empty)
    // reply — the URL never changes while `since` stays 0.
    res.setHeader("Cache-Control", "no-store");

    // Strip query string
    const pathOnly = url.split("?")[0];

    // Automatically archive sessions that have been inactive for more
    // than two weeks. This is recoverable through the existing trash tab.
    if (method === "POST" && pathOnly === "/api/pi/sessions/auto-trash") {
      const result = pi.autoTrashStaleSessions(14);
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify(result));
    }

    // Handle DELETE /api/pi/session?path=... (move to trash) and /api/pi/trash?path=... (permanent)
    if (method === "DELETE" && (pathOnly === "/api/pi/session" || pathOnly === "/api/pi/trash")) {
      const parsedUrl = new URL(url, "http://localhost");
      const filePath = parsedUrl.searchParams.get("path");
      if (!filePath) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        return res.end(JSON.stringify({ success: false, error: "Missing path" }));
      }
      const decodedPath = decodeURIComponent(filePath);
      const ok = pathOnly === "/api/pi/session"
        ? pi.trashSessionFile(decodedPath)
        : pi.permanentlyDeleteTrash(decodedPath);
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ success: ok }));
    }

    // Handle GET /api/pi/usage-range?range=today|7d|30d|custom&from=...&to=...
    if (method === "GET" && pathOnly === "/api/pi/usage-range") {
      const parsedUrl = new URL(url, "http://localhost");
      const range = parsedUrl.searchParams.get("range") || "today";
      const fromParam = parsedUrl.searchParams.get("from") || "";
      const toParam = parsedUrl.searchParams.get("to") || "";
      if (parsedUrl.searchParams.get("refresh") === "1") {
        pi.clearUsageCache();
        pi.clearChatgptUsageCache();
      }
      const { fromDate, toDate } = resolveDateRange(range, fromParam, toParam);

      const allRecords = pi.readAllUsage();
      const usage = pi.getUsageByRange(allRecords, fromDate, toDate);
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify(usage));
    }

    // Helper: resolve date range params
    function resolveDateRange(range: string, fromParam: string, toParam: string) {
      // Convert to a China-time calendar date first, then use UTC date
      // arithmetic so a machine in another timezone cannot shift the range.
      const localDateStr = (dt: Date) =>
        new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Shanghai",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(dt);
      let toDate = localDateStr(new Date());
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

    // Handle GET /api/pi/chatgpt-usage-range using local Codex Desktop
    // rollout JSONL files under ~/.codex/sessions and archived_sessions.
    if (method === "GET" && pathOnly === "/api/pi/chatgpt-usage-range") {
      const parsedUrl = new URL(url, "http://localhost");
      const range = parsedUrl.searchParams.get("range") || "today";
      const fromParam = parsedUrl.searchParams.get("from") || "";
      const toParam = parsedUrl.searchParams.get("to") || "";
      if (parsedUrl.searchParams.get("refresh") === "1") {
        pi.clearChatgptUsageCache();
      }
      const { fromDate, toDate } = resolveDateRange(range, fromParam, toParam);
      const usage = pi.getUsageByRange(pi.readChatgptUsage(), fromDate, toDate);
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify(usage));
    }

    const key = `${method} ${pathOnly}`;
    const handler = routes[key];
    if (handler) {
      handler(req, res);
    } else {
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Not found" }));
    }
  };
}
