// Which directory the right-hand tool panel is pointed at.
//
// The chat page owns the notion of "current project" (it is the cwd a pi run
// would use), and the tool panel lives outside it in AppShell, so the value is
// shared here instead of being threaded through props. Falling back to the
// server's default chat directory keeps the panel useful before the user has
// picked anything.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Which directory the tool panel should point at for the current chat.
 *
 * Opening a conversation from the sidebar navigates to `/chat?session=<id>`
 * only — it never fills the project picker — so the session's own recorded cwd
 * is the sole signal of which project is on screen and has to win. The picker
 * value is next (it is the cwd a prompt would use for a brand-new chat), and
 * the server-resolved default is the last resort.
 *
 * Returns "" to mean "no answer yet, keep showing the current directory",
 * which is what `setCwd` does with an empty value.
 */
export function resolveWorkspaceCwd({
  sessionPending,
  sessionCwd,
  projectPath,
  defaultCwd,
}: {
  /** An opened session whose recorded cwd has not been fetched yet. */
  sessionPending?: boolean;
  sessionCwd?: string;
  projectPath?: string;
  defaultCwd?: string;
}): string {
  const session = sessionCwd?.trim();
  if (session) return session;
  const picked = projectPath?.trim();
  if (picked) return picked;
  // Holding the previous directory for the one render it takes session-info to
  // arrive beats flashing the home directory on every conversation switch.
  if (sessionPending) return "";
  return defaultCwd?.trim() ?? "";
}

/** One prompt sent in the conversation, for the prompt-log tool panel. */
export interface PromptLogEntry {
  id?: string;
  /** "HH:MM" when the turn came from history, otherwise a sequence number. */
  time: string;
  text: string;
}

interface WorkspaceValue {
  /** Absolute path the tool panels operate on, or "" while unknown. */
  cwd: string;
  /** Short label for headings — "~" for home, otherwise the last segment. */
  cwdName: string;
  /** Called by the chat page whenever its project selection changes. */
  setCwd: (path: string) => void;
  /** Prompts sent in the conversation on screen, newest first. */
  promptLog: PromptLogEntry[];
  /** Whether a pi run is in flight for that conversation. */
  chatRunning: boolean;
  /** Called by the chat page as its own state changes. */
  setPromptLog: (entries: PromptLogEntry[]) => void;
  setChatRunning: (running: boolean) => void;
}

const WorkspaceContext = createContext<WorkspaceValue>({
  cwd: "",
  cwdName: "",
  setCwd: () => {},
  promptLog: [],
  chatRunning: false,
  setPromptLog: () => {},
  setChatRunning: () => {},
});

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [cwd, setCwdState] = useState("");
  // The server's default is the home directory, and it labels that "~" — far
  // clearer in a heading than the account's folder name.
  const [defaultDir, setDefaultDir] = useState<{ path: string; name: string } | null>(null);

  // Seed from the server's resolved default so the file panel has a root even
  // on a brand-new session with no project chosen yet.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/pi/chat/default-directory")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { path?: string; name?: string } | null) => {
        if (cancelled || !data?.path) return;
        setDefaultDir({ path: data.path, name: data.name || data.path });
        setCwdState((current) => current || data.path!);
      })
      .catch(() => {
        /* panel falls back to an empty root */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setCwd = useCallback((path: string) => {
    const next = path.trim();
    // An empty value means the caller has not resolved a directory yet (the
    // default is still in flight), so keep whatever the panel is showing.
    if (next) setCwdState(next);
  }, []);

  const [promptLog, setPromptLog] = useState<PromptLogEntry[]>([]);
  const [chatRunning, setChatRunning] = useState(false);

  const value = useMemo<WorkspaceValue>(
    () => ({
      cwd,
      cwdName:
        cwd && cwd === defaultDir?.path
          ? defaultDir.name
          : cwd
            ? cwd.split("/").filter(Boolean).pop() ?? cwd
            : "",
      setCwd,
      promptLog,
      chatRunning,
      setPromptLog,
      setChatRunning,
    }),
    [cwd, defaultDir, setCwd, promptLog, chatRunning],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceValue {
  return useContext(WorkspaceContext);
}

/**
 * Localize the workspace-tools error strings. They are kept stable in English
 * on the server (tests assert on them), so the mapping lives here.
 */
export function toolErrorText(error: string): string {
  const map: Record<string, string> = {
    "not a git repository": "此目录不是 git 仓库",
    "path outside project root": "路径超出项目目录范围",
    "path outside repository": "路径超出仓库范围",
    "directory not found": "目录不存在",
    "cannot read directory": "无法读取目录",
    "cannot read file": "无法读取文件",
    "not a file": "不是文件",
    "binary file": "二进制文件",
    "git status failed": "git status 执行失败",
    "git diff failed": "git diff 执行失败",
    "empty command": "命令为空",
    "working directory not found": "工作目录不存在",
  };
  return map[error] ?? error;
}
