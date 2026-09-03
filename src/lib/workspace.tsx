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
  /** Last path segment, for labels. */
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

  // Seed from the server's resolved default so the file panel has a root even
  // on a brand-new session with no project chosen yet.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/pi/chat/default-directory")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { path?: string } | null) => {
        if (!cancelled && data?.path) {
          setCwdState((current) => current || data.path!);
        }
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
      cwdName: cwd ? cwd.split("/").filter(Boolean).pop() ?? cwd : "",
      setCwd,
    }),
    [cwd, setCwd],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceValue {
  return useContext(WorkspaceContext);
}
