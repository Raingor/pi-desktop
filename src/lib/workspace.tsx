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

interface WorkspaceValue {
  /** Absolute path the tool panels operate on, or "" while unknown. */
  cwd: string;
  /** Short label for headings — "~" for home, otherwise the last segment. */
  cwdName: string;
  /** Called by the chat page whenever its project selection changes. */
  setCwd: (path: string) => void;
}

const WorkspaceContext = createContext<WorkspaceValue>({
  cwd: "",
  cwdName: "",
  setCwd: () => {},
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
    // An empty selection means "use the default", which is already seeded.
    if (next) setCwdState(next);
  }, []);

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
    }),
    [cwd, defaultDir, setCwd],
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
