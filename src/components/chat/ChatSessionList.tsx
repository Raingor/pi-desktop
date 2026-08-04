// ChatSessionList — DIAGNOSTIC STEP A: full render, minimal selectors
import { useEffect, useRef } from "react";
import { useChatUI } from "@/store/chat-ui";
import type { SessionInfo } from "@/types/chat";
import { ChevronDown, ChevronRight, Folder, Trash2 } from "lucide-react";

interface ProjectGroup {
  projectPath: string;
  sessions: SessionInfo[];
}

function groupSessionsByProject(sessions: SessionInfo[]): ProjectGroup[] {
  const groups = new Map<string, SessionInfo[]>();
  for (const s of sessions) {
    const key = s.projectRoot ?? s.cwd ?? "Unknown";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }
  return [...groups.entries()].map(([projectPath, sessions]) => ({
    projectPath,
    sessions: sessions.sort((a, b) => b.modified.localeCompare(a.modified)),
  }));
}

function getProjectName(projectRoot: string): string {
  const parts = projectRoot.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || projectRoot;
}

function formatRelativeTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return d.toLocaleDateString();
}

export function ChatSessionList() {
  const sessions = useChatUI((s) => s.sessions);
  const loading = useChatUI((s) => s.loading);
  const selectedSession = useChatUI((s) => s.selectedSession);
  const collapsedGroups = useChatUI((s) => s.collapsedGroups);
  const toggleGroup = useChatUI((s) => s.toggleGroup);
  const selectSession = useChatUI((s) => s.selectSession);
  const deleteSession = useChatUI((s) => s.deleteSession);
  const loadSessions = useChatUI((s) => s.loadSessions);

  const loadedRef = useRef(false);
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    void loadSessions();
  }, [loadSessions]);

  const projectGroups = groupSessionsByProject(sessions);

  return (
    <div className="flex-1 overflow-y-auto">
      {loading ? (
        <p className="p-4 text-xs" style={{ color: "var(--text-muted)" }}>Loading...</p>
      ) : projectGroups.length === 0 ? (
        <p className="p-4 text-xs" style={{ color: "var(--text-muted)" }}>No sessions yet</p>
      ) : (
        projectGroups.map((group) => {
          const isCollapsed = collapsedGroups.has(group.projectPath);
          return (
            <div key={group.projectPath}>
              {/* Project header */}
              <button
                onClick={() => toggleGroup(group.projectPath)}
                className="flex w-full items-center justify-between px-3 py-2 text-left"
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--text-dim)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                <span className="flex items-center gap-1">
                  {isCollapsed ? (
                    <ChevronRight className="h-3 w-3" />
                  ) : (
                    <ChevronDown className="h-3 w-3" />
                  )}
                  {getProjectName(group.projectPath)}
                </span>
                <span style={{ fontSize: 10, opacity: 0.6 }}>{group.sessions.length}</span>
              </button>
              {/* Sessions */}
              {!isCollapsed && group.sessions.map((s) => (
                <div
                  key={s.id}
                  onClick={() => selectSession(s)}
                  className="group mx-2 flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2"
                  style={{
                    background: selectedSession?.id === s.id ? "var(--bg-selected)" : "transparent",
                  }}
                >
                  <Folder className="h-3.5 w-3.5 flex-shrink-0" style={{ color: "var(--text-dim)" }} />
                  <div className="min-w-0 flex-1">
                    <div
                      className="truncate text-xs"
                      style={{ color: selectedSession?.id === s.id ? "var(--text)" : "var(--text-muted)" }}
                    >
                      {s.name || s.firstMessage?.slice(0, 40) || "Untitled"}
                    </div>
                    <div className="flex items-center gap-1" style={{ fontSize: 10, color: "var(--text-dim)" }}>
                      <span>{formatRelativeTime(s.modified)}</span>
                      <span>·</span>
                      <span>{s.messageCount} msgs</span>
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); void deleteSession(s.id); }}
                    className="hidden group-hover:block"
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--text-dim)",
                      cursor: "pointer",
                      padding: 2,
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          );
        })
      )}
    </div>
  );
}
