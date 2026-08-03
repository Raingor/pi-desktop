// ChatPage — full chat interface with session sidebar.
// Combines a session list sidebar with the ChatWindow.

import { useState, useCallback, useEffect, useRef } from "react";
import { ChatWindow } from "@/components/chat/ChatWindow";
import type { SessionInfo, SessionStatsInfo, ContextUsage, ChatInputHandle } from "@/types/chat";
import { useTranslation } from "@/lib/i18n";
import { chatListSessions, chatDeleteSession } from "@/lib/tauri";

interface ProjectGroup {
  projectRoot: string;
  sessions: SessionInfo[];
}

function groupSessionsByProject(sessions: SessionInfo[]): ProjectGroup[] {
  const groups = new Map<string, SessionInfo[]>();
  for (const s of sessions) {
    const key = s.projectRoot ?? s.cwd ?? "Unknown";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }
  return [...groups.entries()].map(([projectRoot, sessions]) => ({
    projectRoot,
    sessions: sessions.sort((a, b) => b.modified.localeCompare(a.modified)),
  }));
}

function getProjectName(projectRoot: string): string {
  const parts = projectRoot.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || projectRoot;
}

function formatRelativeTime(iso: string, t: (key: string, ...args: string[]) => string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);
  if (diffMin < 1) return t("chat.just_now");
  if (diffMin < 60) return t("chat.min_ago", String(diffMin));
  if (diffHr < 24) return t("chat.hr_ago", String(diffHr));
  if (diffDay < 7) return t("chat.day_ago", String(diffDay));
  return d.toLocaleDateString();
}

export function ChatPage() {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [selectedSession, setSelectedSession] = useState<SessionInfo | null>(null);
  const [newSessionCwd, setNewSessionCwd] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showCwdPicker, setShowCwdPicker] = useState(false);
  const [cwdInput, setCwdInput] = useState("");
  const [cwdError, setCwdError] = useState<string | null>(null);
  const [browsePath, setBrowsePath] = useState("");
  const [browseItems, setBrowseItems] = useState<{ name: string; isDirectory: boolean; path: string }[]>([]);
  const [sessionStats, setSessionStats] = useState<SessionStatsInfo | null>(null);
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const chatInputRef = useRef<ChatInputHandle | null>(null);

  // ─── Load sessions ─────────────────────────────────────

  useEffect(() => {
    chatListSessions()
      .then((data) => {
        // Map bridge SessionInfo to chat.ts SessionInfo format
        const mapped: SessionInfo[] = data.map((s) => ({
          ...s,
          messageCount: s.message_count,
          firstMessage: s.first_message,
        }));
        setSessions(mapped);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [refreshKey]);

  // ─── Browse directories (uses fs_read_dir from Tauri) ───

  const browse = useCallback(async (path: string) => {
    setBrowsePath(path);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<{ path: string; items: { name: string; isDirectory: boolean; path: string }[] }>(
        "fs_list_dir",
        { path }
      );
      setBrowseItems(result.items ?? []);
    } catch {
      setBrowseItems([]);
    }
  }, []);

  useEffect(() => {
    // Load home directory on mount
    const loadHome = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const home = await invoke<string>("system_get_home_dir");
        setCwdInput(home);
        browse(home);
      } catch { /* ignore */ }
    };
    loadHome();
  }, [browse]);

  // ─── Session selection ─────────────────────────────────

  const handleSelectSession = useCallback((session: SessionInfo) => {
    setNewSessionCwd(null);
    setSelectedSession(session);
    setSessionStats(null);
    setContextUsage(null);
  }, []);

  const handleNewSession = useCallback(() => {
    setShowCwdPicker(true);
  }, []);

  const handleConfirmCwd = useCallback(async () => {
    setCwdError(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const validated = await invoke<string>("fs_validate_dir", { path: cwdInput });
      setSelectedSession(null);
      setNewSessionCwd(validated);
      setShowCwdPicker(false);
      setSessionStats(null);
      setContextUsage(null);
    } catch (e) {
      setCwdError(String(e));
    }
  }, [cwdInput, t]);

  const handleSessionCreated = useCallback((session: SessionInfo) => {
    setSelectedSession(session);
    setNewSessionCwd(null);
    setRefreshKey((k) => k + 1);
  }, []);

  const handleAgentEnd = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  // ─── Delete session ────────────────────────────────────

  const handleDeleteSession = useCallback(async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(t("chat.delete_confirm"))) return;
    try {
      await chatDeleteSession(sessionId);
      setRefreshKey((k) => k + 1);
      if (selectedSession?.id === sessionId) {
        setSelectedSession(null);
      }
    } catch {
      // ignore
    }
  }, [selectedSession]);

  // ─── Render ────────────────────────────────────────────

  const projectGroups = groupSessionsByProject(sessions);

  // ─── Expand / Collapse all groups ──────────────────────

  const expandAll = useCallback(() => {
    setCollapsedGroups(new Set());
  }, []);

  const collapseAll = useCallback(() => {
    setCollapsedGroups(new Set(projectGroups.map((g) => g.projectRoot)));
  }, [projectGroups]);

  const effectiveCwd = selectedSession?.cwd ?? newSessionCwd;
  const showChat = selectedSession !== null || newSessionCwd !== null;

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* Session Sidebar */}
      <div style={{
        width: 280,
        flexShrink: 0,
        borderRight: "1px solid var(--border)",
        background: "var(--bg-panel)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          padding: "12px 14px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{t("chat.sessions")}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {projectGroups.length > 0 && (() => {
              const allExpanded = collapsedGroups.size === 0;
              return (
                <button
                  onClick={allExpanded ? collapseAll : expandAll}
                  title={allExpanded ? t("chat.collapse_all") : t("chat.expand_all")}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 3,
                    height: 26,
                    padding: "0 8px",
                    borderRadius: 6,
                    border: "1px solid var(--border)",
                    background: "var(--bg)",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    fontSize: 11,
                    fontWeight: 500,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "var(--bg)"; }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: allExpanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                  {allExpanded ? t("chat.collapse_all") : t("chat.expand_all")}
                </button>
              );
            })()}
            <button
              onClick={handleNewSession}
              title={t("chat.new_session")}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 28,
                height: 28,
                borderRadius: 6,
                border: "none",
                background: "var(--accent)",
                color: "#fff",
                cursor: "pointer",
                fontSize: 18,
              }}
            >
              +
            </button>
          </div>
        </div>

        {/* Session list */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {loading ? (
            <div style={{ padding: 16, fontSize: 13, color: "var(--text-muted)" }}>{t("chat.loading")}</div>
          ) : projectGroups.length === 0 ? (
            <div style={{ padding: 16, fontSize: 13, color: "var(--text-muted)" }}>
              {t("chat.no_sessions")}
            </div>
          ) : (
            projectGroups.map((group) => {
                const isCollapsed = collapsedGroups.has(group.projectRoot);
                return (
              <div key={group.projectRoot}>
                {/* Project header - clickable to collapse/expand */}
                <button
                  onClick={() => {
                    setCollapsedGroups((prev) => {
                      const next = new Set(prev);
                      if (next.has(group.projectRoot)) {
                        next.delete(group.projectRoot);
                      } else {
                        next.add(group.projectRoot);
                      }
                      return next;
                    });
                  }}
                  style={{
                    padding: "6px 14px",
                    fontSize: 11,
                    fontWeight: 600,
                    color: "var(--text-dim)",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    background: "var(--bg)",
                    width: "100%",
                    border: "none",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    textAlign: "left",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "var(--bg)"; }}
                >
                  <span>{getProjectName(group.projectRoot)}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ fontSize: 10, opacity: 0.7 }}>{group.sessions.length}</span>
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{
                        transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
                        transition: "transform 0.2s",
                      }}
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </span>
                </button>
                {/* Sessions */}
                {!isCollapsed && group.sessions.map((s) => (
                  <div
                    key={s.id}
                    onClick={() => handleSelectSession(s)}
                    style={{
                      padding: "8px 14px",
                      cursor: "pointer",
                      background: selectedSession?.id === s.id ? "var(--bg-selected)" : "transparent",
                      borderLeft: selectedSession?.id === s.id ? "3px solid var(--accent)" : "3px solid transparent",
                      transition: "background 0.1s",
                    }}
                    onMouseEnter={(e) => {
                      if (selectedSession?.id !== s.id) e.currentTarget.style.background = "var(--bg-hover)";
                    }}
                    onMouseLeave={(e) => {
                      if (selectedSession?.id !== s.id) e.currentTarget.style.background = "transparent";
                    }}
                  >
                    <div style={{
                      fontSize: 13,
                      color: selectedSession?.id === s.id ? "var(--text)" : "var(--text-muted)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}>
                      {s.name || s.firstMessage?.slice(0, 50) || t("chat.untitled")}
                    </div>
                    <div style={{
                      fontSize: 11,
                      color: "var(--text-dim)",
                      marginTop: 2,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}>
                      <span>{formatRelativeTime(s.modified, t)}</span>
                      <span>·</span>
                      <span>{t("chat.msg_count", String(s.messageCount))}</span>
                      <button
                        onClick={(e) => handleDeleteSession(s.id, e)}
                        title={t("chat.delete")}
                        style={{
                          marginLeft: "auto",
                          background: "none",
                          border: "none",
                          color: "var(--text-dim)",
                          cursor: "pointer",
                          fontSize: 12,
                          padding: 0,
                        }}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            );
            })
          )}
        </div>
      </div>

      {/* Chat area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
        {/* Top bar */}
        {showChat && (
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "8px 16px",
            borderBottom: "1px solid var(--border)",
            background: "var(--bg-panel)",
            flexShrink: 0,
          }}>
            <span style={{ fontSize: 13, color: "var(--text-muted)", fontFamily: "var(--font-mono, monospace)" }}>
              {effectiveCwd}
            </span>
            {/* Session stats */}
            {sessionStats && (
              <div style={{ marginLeft: "auto", display: "flex", gap: 12, fontSize: 11, color: "var(--text-muted)" }}>
                {sessionStats.tokens.input > 0 && (
                  <span title="Input tokens">↑{sessionStats.tokens.input.toLocaleString()}</span>
                )}
                {sessionStats.tokens.output > 0 && (
                  <span title="Output tokens">↓{sessionStats.tokens.output.toLocaleString()}</span>
                )}
                {sessionStats.cost > 0 && (
                  <span title="Cost">${sessionStats.cost.toFixed(4)}</span>
                )}
                {contextUsage?.contextWindow && (
                  <span
                    title="Context usage"
                    style={{
                      color: contextUsage.percent && contextUsage.percent > 90 ? "#ef4444"
                        : contextUsage.percent && contextUsage.percent > 70 ? "rgba(234,179,8,0.95)"
                        : undefined,
                    }}
                  >
                    {contextUsage.percent ? `${contextUsage.percent.toFixed(0)}%` : "?"} / {contextUsage.contextWindow.toLocaleString()}
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Chat window or placeholder */}
        <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
          {showChat ? (
            <ChatWindow
              session={selectedSession}
              newSessionCwd={newSessionCwd}
              onAgentEnd={handleAgentEnd}
              onSessionCreated={handleSessionCreated}
              chatInputRef={chatInputRef}
              onSessionStatsChange={setSessionStats}
              onContextUsageChange={setContextUsage}
            />
          ) : (
            <div style={{
              height: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: 24,
              color: "var(--text-muted)",
            }}>
              <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>π</div>
              <div style={{ fontSize: 18, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>
                {t("chat.welcome_title")}
              </div>
              <div style={{ fontSize: 14, textAlign: "center", maxWidth: 400, lineHeight: 1.6 }}>
                {t("chat.welcome_desc")}
              </div>
            </div>
          )}
        </div>

        {/* CWD Picker Modal */}
        {showCwdPicker && (
          <div style={{
            position: "absolute",
            inset: 0,
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.3)",
          }}>
            <div style={{
              width: "min(560px, 90%)",
              maxHeight: "80%",
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
            }}>
              {/* Header */}
              <div style={{
                padding: "12px 16px",
                borderBottom: "1px solid var(--border)",
                fontSize: 14,
                fontWeight: 600,
                color: "var(--text)",
              }}>
                {t("chat.select_cwd")}
              </div>

              {/* CWD input */}
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
                <input
                  value={cwdInput}
                  onChange={(e) => {
                    setCwdInput(e.target.value);
                    setCwdError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleConfirmCwd();
                    if (e.key === "Escape") setShowCwdPicker(false);
                  }}
                  placeholder="/path/to/project"
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "var(--bg)",
                    color: "var(--text)",
                    fontSize: 13,
                    fontFamily: "var(--font-mono, monospace)",
                    outline: "none",
                  }}
                />
                {cwdError && (
                  <div style={{ marginTop: 6, fontSize: 12, color: "#dc2626" }}>{cwdError}</div>
                )}
              </div>

              {/* Directory browser */}
              <div style={{ flex: 1, overflow: "auto", padding: "4px 0" }}>
                {/* Current path breadcrumb */}
                <div style={{
                  padding: "4px 16px",
                  fontSize: 11,
                  color: "var(--text-dim)",
                  fontFamily: "var(--font-mono, monospace)",
                  borderBottom: "1px solid var(--border)",
                }}>
                  {browsePath}
                </div>
                {/* Parent directory */}
                <div
                  onClick={() => {
                    const parent = browsePath.replace(/\/[^/]+\/?$/, "") || "/";
                    browse(parent);
                    setCwdInput(parent);
                  }}
                  style={{
                    padding: "6px 16px",
                    cursor: "pointer",
                    fontSize: 13,
                    color: "var(--text-muted)",
                  }}
                >
                  ../
                </div>
                {/* Items */}
                {browseItems.filter((item) => item.isDirectory).map((item) => (
                  <div
                    key={item.path}
                    onClick={() => {
                      browse(item.path);
                      setCwdInput(item.path);
                    }}
                    style={{
                      padding: "6px 16px",
                      cursor: "pointer",
                      fontSize: 13,
                      color: "var(--text)",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                  >
                    <span style={{ marginRight: 6 }}>📁</span>
                    {item.name}
                  </div>
                ))}
              </div>

              {/* Footer */}
              <div style={{
                padding: "10px 16px",
                borderTop: "1px solid var(--border)",
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
              }}>
                <button
                  onClick={() => setShowCwdPicker(false)}
                  style={{
                    padding: "6px 14px",
                    borderRadius: 6,
                    border: "1px solid var(--border)",
                    background: "var(--bg)",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    fontSize: 13,
                  }}
                >
                  {t("chat.cancel")}
                </button>
                <button
                  onClick={handleConfirmCwd}
                  style={{
                    padding: "6px 14px",
                    borderRadius: 6,
                    border: "none",
                    background: "var(--accent)",
                    color: "#fff",
                    cursor: "pointer",
                    fontSize: 13,
                    fontWeight: 500,
                  }}
                >
                  {t("chat.start_chat")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
