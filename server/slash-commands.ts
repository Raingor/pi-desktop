// The slash-command registry behind the chat composer's "/" menu.
//
// pi is the only authority on what "/" can actually run: extension commands
// registered by installed packages, prompt templates, and skills. Scanning
// node_modules for `registerCommand(` finds some of them and silently misses
// the rest (4 of 9 installed packages, measured), so this asks pi over RPC
// instead.
//
// One thing the registry deliberately excludes: pi's built-in TUI commands
// (/settings, /hotkeys, /model…). Those only work in the interactive terminal,
// and pi's own docs note they "would not execute if sent via prompt" — which is
// exactly how this app sends messages. Offering them here would be offering
// dead buttons.
//
// Enumerating means starting pi, which takes several seconds, so the result is
// cached until the things it is derived from change.

import { existsSync, statSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { runRpcCommand } from "./pi-rpc";

export type SlashCommandSource = "extension" | "prompt" | "skill";

export interface SlashCommand {
  /** Invoke with "/" + name. Skills arrive already prefixed as "skill:name". */
  name: string;
  description: string;
  source: SlashCommandSource;
  /** "user" | "project" | "path" — absent for extension commands. */
  location?: string;
  path?: string;
}

export interface SlashCommandList {
  commands: SlashCommand[];
  /** When this snapshot was taken, so the UI can show staleness if it wants. */
  fetchedAt: number;
  error?: string;
}

/** Inputs whose mtime invalidates the cache: what pi loads commands from. */
function cacheStamp(): string {
  const agent = join(homedir(), ".pi", "agent");
  const watched = [
    join(agent, "settings.json"),
    join(agent, "extensions"),
    join(agent, "skills"),
    join(agent, "prompts"),
    join(agent, "npm", "node_modules"),
  ];
  return watched
    .map((p) => {
      try {
        return existsSync(p) ? String(statSync(p).mtimeMs) : "0";
      } catch {
        return "0";
      }
    })
    .join(":");
}

let cache: { stamp: string; value: SlashCommandList } | null = null;
/** Coalesce concurrent misses: the composer may ask from several places. */
let pending: Promise<SlashCommandList> | null = null;

export function clearSlashCommandCache(): void {
  cache = null;
  pending = null;
}

interface Options {
  binary: string;
  cwd?: string;
  timeoutMs?: number;
  readyMs?: number;
  force?: boolean;
}

function normalize(raw: unknown): SlashCommand[] {
  if (!Array.isArray(raw)) return [];
  const out: SlashCommand[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const name = typeof rec.name === "string" ? rec.name.trim() : "";
    if (!name) continue;
    const source = rec.source;
    if (source !== "extension" && source !== "prompt" && source !== "skill") continue;
    out.push({
      name,
      description: typeof rec.description === "string" ? rec.description : "",
      source,
      location: typeof rec.location === "string" ? rec.location : undefined,
      path: typeof rec.path === "string" ? rec.path : undefined,
    });
  }
  // Skills last: they are the longest list and the least often wanted first.
  const rank: Record<SlashCommandSource, number> = { extension: 0, prompt: 1, skill: 2 };
  return out.sort(
    (a, b) => rank[a.source] - rank[b.source] || a.name.localeCompare(b.name, "en"),
  );
}

export function listSlashCommands(options: Options): Promise<SlashCommandList> {
  const stamp = cacheStamp();
  if (!options.force && cache?.stamp === stamp) return Promise.resolve(cache.value);
  if (pending) return pending;

  pending = runRpcCommand<{ commands?: unknown }>({ type: "get_commands" }, {
    binary: options.binary,
    // No session: this is a read-only query and must not leave a session file.
    args: ["--no-session"],
    cwd: options.cwd,
    timeoutMs: options.timeoutMs ?? 45_000,
    readyMs: options.readyMs,
    // Safe to repeat — get_commands has no side effects, and some startups
    // emit nothing before they are ready to read stdin.
    retry: true,
  })
    .then((result) => {
      const value: SlashCommandList = {
        commands: normalize(result.data?.commands),
        fetchedAt: Date.now(),
        error: result.success ? undefined : (result.error ?? "failed to read commands"),
      };
      // Only cache a real answer; a failure should be retried on next open.
      if (value.commands.length > 0) cache = { stamp, value };
      return value;
    })
    .catch((error: unknown) => ({
      commands: [],
      fetchedAt: Date.now(),
      error: error instanceof Error ? error.message : "failed to read commands",
    }))
    .finally(() => {
      pending = null;
    });

  return pending;
}
