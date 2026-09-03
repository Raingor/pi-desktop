// Workspace tools backing the right-hand tool panel: a scoped file browser, a
// git review surface, and a registry of background commands.
//
// Every path-taking function is root-scoped. The API these back is reachable
// only from the app itself, but a panel that browses "the current project"
// must not become a way to read ~/.ssh/id_rsa by sending "../../.ssh" — so
// each request carries the project root and the resolved target has to stay
// inside it.

import { spawn, spawnSync, type ChildProcess } from "child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { homedir } from "os";
import { basename, join, relative, resolve, sep } from "path";

// ─── Path containment ───────────────────────────────────

/**
 * Resolve `relPath` inside `root`, or null when it escapes.
 * Symlinks are resolved by statSync at the call site; the string check here
 * stops the ".." class of escape before any filesystem access happens.
 */
function resolveInRoot(root: string, relPath: string): string | null {
  if (!root) return null;
  const base = resolve(root);
  if (!existsSync(base)) return null;
  const target = resolve(base, relPath || ".");
  if (target !== base && !target.startsWith(base + sep)) return null;
  return target;
}

// ─── File tree ──────────────────────────────────────────

export interface DirEntry {
  name: string;
  path: string; // relative to root, POSIX-ish (uses platform sep)
  kind: "dir" | "file";
  size: number;
  mtime: number;
}

export interface DirListing {
  root: string;
  rootName: string;
  path: string;
  parent: string | null;
  entries: DirEntry[];
  error?: string;
}

/** Directories that are never worth showing in a project file browser. */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".DS_Store",
  "dist",
  "dist-electron",
  "release",
  ".next",
  "__pycache__",
  ".venv",
  "vendor",
  ".idea",
]);

export function listDirectory(root: string, relPath = "."): DirListing {
  const rootAbs = resolve(root || homedir());
  const empty: DirListing = {
    root: rootAbs,
    rootName: basename(rootAbs) || rootAbs,
    path: "",
    parent: null,
    entries: [],
  };

  const target = resolveInRoot(rootAbs, relPath);
  if (!target) return { ...empty, error: "path outside project root" };

  let entries: DirEntry[];
  try {
    entries = readdirSync(target, { withFileTypes: true })
      .filter((d) => !d.name.startsWith(".") || d.name === ".env.example")
      .filter((d) => !(d.isDirectory() && SKIP_DIRS.has(d.name)))
      .map((d) => {
        const abs = join(target, d.name);
        let size = 0;
        let mtime = 0;
        try {
          const st = statSync(abs);
          size = st.isFile() ? st.size : 0;
          mtime = st.mtimeMs;
        } catch {
          // broken symlink — list it with zeroes rather than dropping it
        }
        return {
          name: d.name,
          path: relative(rootAbs, abs),
          kind: d.isDirectory() ? ("dir" as const) : ("file" as const),
          size,
          mtime,
        };
      })
      .sort((a, b) =>
        a.kind === b.kind
          ? a.name.localeCompare(b.name)
          : a.kind === "dir"
            ? -1
            : 1,
      );
  } catch (error) {
    return {
      ...empty,
      path: relative(rootAbs, target),
      error: error instanceof Error ? error.message : "cannot read directory",
    };
  }

  const rel = relative(rootAbs, target);
  return {
    root: rootAbs,
    rootName: basename(rootAbs) || rootAbs,
    path: rel,
    parent: rel ? relative(rootAbs, resolve(target, "..")) : null,
    entries,
  };
}

// ─── File preview ───────────────────────────────────────

const MAX_PREVIEW_BYTES = 512 * 1024;

export interface FilePreview {
  path: string;
  name: string;
  size: number;
  content: string;
  truncated: boolean;
  binary: boolean;
  error?: string;
}

export function readTextFile(root: string, relPath: string): FilePreview {
  const name = basename(relPath);
  const fail = (error: string): FilePreview => ({
    path: relPath,
    name,
    size: 0,
    content: "",
    truncated: false,
    binary: false,
    error,
  });

  const target = resolveInRoot(root, relPath);
  if (!target) return fail("path outside project root");

  try {
    const st = statSync(target);
    if (!st.isFile()) return fail("not a file");
    const buf = readFileSync(target);
    const slice = buf.subarray(0, MAX_PREVIEW_BYTES);
    // A NUL byte in the first block is the usual cheap binary test.
    const binary = slice.subarray(0, 8000).includes(0);
    return {
      path: relPath,
      name,
      size: st.size,
      content: binary ? "" : slice.toString("utf8"),
      truncated: buf.length > slice.length,
      binary,
    };
  } catch (error) {
    return fail(error instanceof Error ? error.message : "cannot read file");
  }
}

// ─── Git review ─────────────────────────────────────────

export interface GitFileChange {
  path: string;
  status: string; // two-char porcelain code, e.g. " M", "A ", "??"
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
}

export interface GitReview {
  repo: string | null;
  branch: string;
  ahead: number;
  behind: number;
  files: GitFileChange[];
  error?: string;
}

function git(cwd: string, args: string[], timeout = 10000) {
  return spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout,
    maxBuffer: 24 * 1024 * 1024,
  });
}

export function gitReview(cwd: string): GitReview {
  const empty: GitReview = {
    repo: null,
    branch: "",
    ahead: 0,
    behind: 0,
    files: [],
  };
  if (!cwd || !existsSync(cwd)) return { ...empty, error: "directory not found" };

  const top = git(cwd, ["rev-parse", "--show-toplevel"], 5000);
  if (top.status !== 0) return { ...empty, error: "not a git repository" };
  const repo = top.stdout.trim();

  // -b gives the branch header; -z avoids quoting surprises in paths.
  const status = git(repo, ["status", "--porcelain=v1", "-b", "-z"]);
  if (status.status !== 0) {
    return { ...empty, repo, error: status.stderr.trim() || "git status failed" };
  }

  const records = status.stdout.split("\0");
  let branch = "";
  let ahead = 0;
  let behind = 0;
  const files: GitFileChange[] = [];

  for (let i = 0; i < records.length; i += 1) {
    const line = records[i];
    if (!line) continue;
    if (line.startsWith("## ")) {
      const header = line.slice(3);
      branch = header.split(/\.{3}|\s/)[0] ?? "";
      ahead = Number(header.match(/ahead (\d+)/)?.[1] ?? 0);
      behind = Number(header.match(/behind (\d+)/)?.[1] ?? 0);
      continue;
    }
    const code = line.slice(0, 2);
    const path = line.slice(3);
    if (!path) continue;
    // Renames put the source path in the next NUL-separated record.
    if (code[0] === "R" || code[0] === "C") i += 1;
    files.push({
      path,
      status: code,
      staged: code[0] !== " " && code[0] !== "?",
      unstaged: code[1] !== " " && code[1] !== "?",
      untracked: code === "??",
    });
  }

  return { repo, branch, ahead, behind, files };
}

export interface GitDiff {
  path: string;
  diff: string;
  untracked: boolean;
  error?: string;
}

export function gitDiff(cwd: string, path: string, staged = false): GitDiff {
  if (!cwd || !existsSync(cwd)) {
    return { path, diff: "", untracked: false, error: "directory not found" };
  }
  const top = git(cwd, ["rev-parse", "--show-toplevel"], 5000);
  if (top.status !== 0) {
    return { path, diff: "", untracked: false, error: "not a git repository" };
  }
  const repo = top.stdout.trim();
  if (!resolveInRoot(repo, path)) {
    return { path, diff: "", untracked: false, error: "path outside repository" };
  }

  // An untracked file has no diff target; show it as an all-added block so the
  // review panel can render new files the same way as edits.
  const tracked = git(repo, ["ls-files", "--error-unmatch", "--", path], 5000);
  if (tracked.status !== 0) {
    const preview = readTextFile(repo, path);
    if (preview.error) return { path, diff: "", untracked: true, error: preview.error };
    if (preview.binary) return { path, diff: "", untracked: true, error: "binary file" };
    const body = preview.content
      .split("\n")
      .map((l) => `+${l}`)
      .join("\n");
    return { path, diff: `--- /dev/null\n+++ b/${path}\n${body}`, untracked: true };
  }

  const args = ["diff", "--no-color", "--no-ext-diff", "-U3"];
  if (staged) args.push("--cached");
  args.push("--", path);
  const out = git(repo, args);
  if (out.status !== 0 && !out.stdout) {
    return { path, diff: "", untracked: false, error: out.stderr.trim() || "git diff failed" };
  }
  return { path, diff: out.stdout, untracked: false };
}

// ─── Background tasks ───────────────────────────────────
// The terminal panel and any long command run through here so the tasks panel
// has one list to show. Output is kept in a capped ring so a runaway `yes`
// cannot grow the server's heap without bound; clients poll with the byte
// offset they have already consumed.

const MAX_TASK_OUTPUT = 256 * 1024;
const MAX_TASKS = 40;

export type TaskState = "running" | "exited" | "failed" | "killed";

interface TaskRecord {
  id: string;
  command: string;
  cwd: string;
  label: string;
  startedAt: number;
  endedAt: number | null;
  state: TaskState;
  exitCode: number | null;
  /** Total bytes ever produced, including bytes dropped from the ring. */
  produced: number;
  chunks: string[];
  bytes: number;
  proc: ChildProcess | null;
}

export interface TaskSummary {
  id: string;
  command: string;
  cwd: string;
  label: string;
  startedAt: number;
  endedAt: number | null;
  state: TaskState;
  exitCode: number | null;
  outputBytes: number;
}

const tasks = new Map<string, TaskRecord>();

function summarize(t: TaskRecord): TaskSummary {
  return {
    id: t.id,
    command: t.command,
    cwd: t.cwd,
    label: t.label,
    startedAt: t.startedAt,
    endedAt: t.endedAt,
    state: t.state,
    exitCode: t.exitCode,
    outputBytes: t.produced,
  };
}

function append(t: TaskRecord, text: string) {
  t.chunks.push(text);
  t.bytes += text.length;
  t.produced += text.length;
  while (t.bytes > MAX_TASK_OUTPUT && t.chunks.length > 1) {
    t.bytes -= t.chunks.shift()!.length;
  }
}

/** Drop the oldest finished tasks so the list stays bounded. */
function evictFinished() {
  if (tasks.size <= MAX_TASKS) return;
  const finished = [...tasks.values()]
    .filter((t) => t.state !== "running")
    .sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0));
  for (const t of finished) {
    if (tasks.size <= MAX_TASKS) break;
    tasks.delete(t.id);
  }
}

export function startTask(input: {
  command: string;
  cwd: string;
  label?: string;
}): { id: string } | { error: string } {
  const command = (input.command ?? "").trim();
  if (!command) return { error: "empty command" };
  const cwd = resolve(input.cwd || homedir());
  if (!existsSync(cwd)) return { error: "working directory not found" };

  const id = `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const record: TaskRecord = {
    id,
    command,
    cwd,
    label: input.label?.trim() || command.split(/\s+/)[0] || command,
    startedAt: Date.now(),
    endedAt: null,
    state: "running",
    exitCode: null,
    produced: 0,
    chunks: [],
    bytes: 0,
    proc: null,
  };

  // No PTY: this is a login-shell command runner, not a terminal emulator, so
  // programs see a pipe rather than a tty (no colors, no curses UIs). That is
  // the deliberate tradeoff for not shipping a native module — see task_plan.
  const shell = process.env.SHELL || "/bin/bash";
  let child: ChildProcess;
  try {
    child = spawn(shell, ["-lc", command], {
      cwd,
      env: { ...process.env, TERM: "dumb", NO_COLOR: "1", CI: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "spawn failed" };
  }

  record.proc = child;
  tasks.set(id, record);
  evictFinished();

  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => append(record, chunk));
  child.stderr?.on("data", (chunk: string) => append(record, chunk));
  child.on("error", (error: Error) => {
    append(record, `\n[spawn error] ${error.message}\n`);
    record.state = "failed";
    record.endedAt = Date.now();
    record.proc = null;
  });
  child.on("close", (code: number | null, signal: string | null) => {
    record.exitCode = code;
    record.endedAt = Date.now();
    record.proc = null;
    if (record.state === "running") {
      record.state = signal ? "killed" : code === 0 ? "exited" : "failed";
    }
    append(record, `\n[${record.state}${code === null ? "" : ` code=${code}`}${signal ? ` signal=${signal}` : ""}]\n`);
  });

  return { id };
}

export function listTasks(): TaskSummary[] {
  return [...tasks.values()]
    .sort((a, b) => b.startedAt - a.startedAt)
    .map(summarize);
}

export interface TaskOutput extends TaskSummary {
  /** Byte offset this chunk starts at, so the client can resume. */
  offset: number;
  output: string;
  /** True when `offset` skipped ahead because the ring dropped old bytes. */
  dropped: boolean;
}

export function readTaskOutput(id: string, since = 0): TaskOutput | null {
  const t = tasks.get(id);
  if (!t) return null;
  const buffered = t.chunks.join("");
  const firstBufferedOffset = t.produced - buffered.length;
  const from = Math.max(since, firstBufferedOffset);
  return {
    ...summarize(t),
    offset: from,
    output: buffered.slice(from - firstBufferedOffset),
    dropped: since < firstBufferedOffset,
  };
}

export function writeTaskInput(id: string, data: string): boolean {
  const t = tasks.get(id);
  if (!t?.proc?.stdin?.writable) return false;
  t.proc.stdin.write(data);
  return true;
}

export function killTask(id: string): boolean {
  const t = tasks.get(id);
  if (!t?.proc || t.state !== "running") return false;
  t.state = "killed";
  // Negative pid would need detached:true; without it kill the child directly
  // and let the shell tear down its own children.
  t.proc.kill("SIGTERM");
  const proc = t.proc;
  setTimeout(() => {
    if (!proc.killed) proc.kill("SIGKILL");
  }, 4000);
  return true;
}

export function clearFinishedTasks(): number {
  let removed = 0;
  for (const [id, t] of tasks) {
    if (t.state !== "running") {
      tasks.delete(id);
      removed += 1;
    }
  }
  return removed;
}
