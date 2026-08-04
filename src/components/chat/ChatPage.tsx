// ChatPage — redesigned per reference image
// Layout: session list (left) + chat area (right)
// Chat area: top bar + stats bar + messages + input

import { useState, useCallback, useEffect, useRef } from "react";
import { ChatWindow } from "@/components/chat/ChatWindow";
import { ChatStatsBar } from "@/components/chat/ChatStatsBar";
import { ModelSelector } from "@/components/chat/ModelSelector";
import type { SessionInfo, SessionStatsInfo, ContextUsage, ChatInputHandle } from "@/types/chat";
import { useTranslation } from "@/lib/i18n";
import { chatListSessions, chatDeleteSession } from "@/lib/tauri";
import { ArrowLeft, Plus, ChevronDown, ChevronRight, Folder, Trash2 } from "lucide-react";

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
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
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

  // Load sessions
  useEffect(() => {
    chatListSessions()
      .then((data) => {
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

  const browse = useCallback(async (path: string) => {
    setBrowsePath(path);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<{ path: string; items: { name: string; isDirectory: boolean; path: string }[] }>(
        "fs_list_dir", { path }
      );
      setBrowseItems(result.items ?? []);
    } catch { setBrowseItems([]); }
  }, []);

  useEffect(() => {
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

  const handleSelectSession = useCallback((session: SessionInfo) => {
    setNewSessionCwd(null);
    setSelectedSession(session);
    setSessionStats(null);
    setContextUsage(null);
  }, []);

  const handleBack = useCallback(() => {
    setSelectedSession(null);
    setNewSessionCwd(null);
    setSessionStats(null);
    setContextUsage(null);
  }, []);

  const handleNewSession = useCallback(() => setShowCwdPicker(true), []);

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
  }, [cwdInput]);

  const handleSessionCreated = useCallback((session: SessionInfo) => {
    setSelectedSession(session);
    setNewSessionCwd(null);
    setRefreshKey((k) => k + 1);
  }, []);

  const handleAgentEnd = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  const handleDeleteSession = useCallback(async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this session?')) return;
    try {
      await chatDeleteSession(sessionId);
      setRefreshKey((k) => k + 1);
      if (selectedSession?.id === sessionId) setSelectedSession(null);
    } catch { /* ignore */ }
  }, [selectedSession]);

  const projectGroups = groupSessionsByProject(sessions);
  const effectiveCwd = selectedSession?.cwd ?? newSessionCwd;
  const showChat = selectedSession !== null || newSessionCwd !== null;

  // Compute stats for the stats bar
  const statsTokens = sessionStats?.tokens ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  const contextLimit = contextUsage?.contextWindow ?? 0;
  const contextPercent = contextUsage?.percent ?? 0;
  const contextTokens = contextLimit * (contextPercent / 100);

  return (
    <div className="flex h-full overflow-hidden">
      {/* ─── Session List (Left Sidebar) ──────────────────── */}
      <div
        className="flex flex-col overflow-hidden"
        style={{
          width: 260,
          flexShrink: 0,
          borderRight: '1px solid var(--border)',
          background: 'var(--bg-panel)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between"
          style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}
        >
          <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
            Sessions
          </span>
          <button
            onClick={handleNewSession}
            className="flex h-7 w-7 items-center justify-center rounded-md text-white"
            style={{ background: 'var(--accent)' }}
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <p className="p-4 text-xs" style={{ color: 'var(--text-muted)' }}>Loading...</p>
          ) : projectGroups.length === 0 ? (
            <p className="p-4 text-xs" style={{ color: 'var(--text-muted)' }}>No sessions yet</p>
          ) : (
            projectGroups.map((group) => {
              const isCollapsed = collapsedGroups.has(group.projectRoot);
              return (
                <div key={group.projectPath}>
                  {/* Project header */}
                  <button
                    onClick={() => {
                      setCollapsedGroups((prev) => {
                        const next = new Set(prev);
                        if (next.has(group.projectRoot)) next.delete(group.projectRoot);
                        else next.add(group.projectRoot);
                        return next;
                      });
                    }}
                    className="flex w-full items-center justify-between px-3 py-2 text-left"
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: 'var(--text-dim)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    <span className="flex items-center gap-1">
                      {isCollapsed ? (
                        <ChevronRight className="h-3 w-3" />
                      ) : (
                        <ChevronDown className="h-3 w-3" />
                      )}
                      {getProjectName(group.projectRoot)}
                    </span>
                    <span style={{ fontSize: 10, opacity: 0.6 }}>{group.sessions.length}</span>
                  </button>
                  {/* Sessions */}
                  {!isCollapsed && group.sessions.map((s) => (
                    <div
                      key={s.id}
                      onClick={() => handleSelectSession(s)}
                      className="group flex cursor-pointer items-center gap-2 px-3 py-2"
                      style={{
                        background: selectedSession?.id === s.id ? 'var(--bg-selected)' : 'transparent',
                        borderLeft: selectedSession?.id === s.id ? '3px solid var(--accent)' : '3px solid transparent',
                      }}
                    >
                      <Folder className="h-3.5 w-3.5 flex-shrink-0" style={{ color: 'var(--text-dim)' }} />
                      <div className="min-w-0 flex-1">
                        <div
                          className="truncate text-xs"
                          style={{ color: selectedSession?.id === s.id ? 'var(--text)' : 'var(--text-muted)' }}
                        >
                          {s.name || s.firstMessage?.slice(0, 40) || 'Untitled'}
                        </div>
                        <div className="flex items-center gap-1" style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                          <span>{formatRelativeTime(s.modified)}</span>
                          <span>·</span>
                          <span>{s.messageCount} msgs</span>
                        </div>
                      </div>
                      <button
                        onClick={(e) => handleDeleteSession(s.id, e)}
                        className="hidden group-hover:block"
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--text-dim)',
                          cursor: 'pointer',
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
      </div>

      {/* ─── Chat Area (Right) ────────────────────────────── */}
      <div className="relative flex flex-1 flex-col overflow-hidden">
        {showChat ? (
          <>
            {/* Top bar: Back + Session name + Model selector */}
            <div
              className="flex flex-shrink-0 items-center gap-3 px-4 py-2"
              style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-panel)' }}
            >
              <button
                onClick={handleBack}
                className="rounded p-1"
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium" style={{ color: 'var(--text)' }}>
                  {selectedSession?.name || newSessionCwd?.split('/').pop() || 'New Chat'}
                </div>
                <div className="truncate text-xs" style={{ color: 'var(--text-dim)' }}>
                  {selectedSession?.model || 'claude-sonnet-4-sonnet'}
                </div>
              </div>
              <ModelSelector
                models={[]}
                currentModel={null}
                onChange={() => {}}
              />
            </div>

            {/* Stats bar */}
            {sessionStats && (
              <ChatStatsBar
                contextTokens={contextTokens}
                contextLimit={contextLimit}
                contextPercent={contextPercent}
                cost={sessionStats.cost}
                inputTokens={statsTokens.input}
                outputTokens={statsTokens.output}
              />
            )}

            {/* Chat messages */}
            <div className="relative flex-1 overflow-hidden">
              <ChatWindow
                session={selectedSession}
                newSessionCwd={newSessionCwd}
                onAgentEnd={handleAgentEnd}
                onSessionCreated={handleSessionCreated}
                chatInputRef={chatInputRef}
                onSessionStatsChange={setSessionStats}
                onContextUsageChange={setContextUsage}
              />
            </div>
          </>
        ) : (
          /* Empty state */
          <div className="flex h-full flex-col items-center justify-center p-6" style={{ color: 'var(--text-muted)' }}>
            <div className="mb-4 text-5xl opacity-20">π</div>
            <div className="mb-2 text-lg font-semibold" style={{ color: 'var(--text)' }}>
              Select a session
            </div>
            <div className="max-w-sm text-center text-sm" style={{ opacity: 0.7 }}>
              Choose a session from the list or start a new one
            </div>
          </div>
        )}

        {/* CWD Picker Modal */}
        {showCwdPicker && (
          <div
            className="absolute inset-0 z-50 flex items-center justify-center"
            style={{ background: 'rgba(0,0,0,0.4)' }}
          >
            <div
              className="flex max-h-[80%] w-[560px] flex-col overflow-hidden rounded-xl"
              style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}
            >
              <div className="px-4 py-3 text-sm font-semibold" style={{ borderBottom: '1px solid var(--border)', color: 'var(--text)' }}>
                Select working directory
              </div>
              <div className="border-b px-4 py-3" style={{ borderColor: 'var(--border)' }}>
                <input
                  value={cwdInput}
                  onChange={(e) => { setCwdInput(e.target.value); setCwdError(null); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleConfirmCwd(); if (e.key === 'Escape') setShowCwdPicker(false); }}
                  placeholder="/path/to/project"
                  className="w-full rounded-lg px-3 py-2 text-xs outline-none"
                  style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)' }}
                />
                {cwdError && <p className="mt-2 text-xs" style={{ color: '#dc2626' }}>{cwdError}</p>}
              </div>
              <div className="flex-1 overflow-auto py-1">
                <div className="px-4 py-1 font-mono text-xs" style={{ color: 'var(--text-dim)', borderBottom: '1px solid var(--border)' }}>
                  {browsePath}
                </div>
                <div
                  onClick={() => { const p = browsePath.replace(/\/[^/]+\/?$/, '') || '/'; browse(p); setCwdInput(p); }}
                  className="cursor-pointer px-4 py-1.5 text-xs hover:bg-[var(--bg-hover)]"
                  style={{ color: 'var(--text-muted)' }}
                >
                  ../
                </div>
                {browseItems.filter((i) => i.isDirectory).map((item) => (
                  <div
                    key={item.path}
                    onClick={() => { browse(item.path); setCwdInput(item.path); }}
                    className="cursor-pointer px-4 py-1.5 text-xs hover:bg-[var(--bg-hover)]"
                    style={{ color: 'var(--text)' }}
                  >
                    <Folder className="mr-1.5 inline h-3 w-3" />
                    {item.name}
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-2 px-4 py-3" style={{ borderTop: '1px solid var(--border)' }}>
                <button
                  onClick={() => setShowCwdPicker(false)}
                  className="rounded-md px-3 py-1.5 text-xs"
                  style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmCwd}
                  className="rounded-md px-3 py-1.5 text-xs font-medium text-white"
                  style={{ background: 'var(--accent)', border: 'none' }}
                >
                  Start Chat
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
