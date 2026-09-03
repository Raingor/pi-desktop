import { Link, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  Globe,
  Loader2,
  MessageSquarePlus,
  MoreHorizontal,
  PanelLeftClose,
  Send,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation, LANGUAGES } from "@/lib/i18n";
import { usePolling } from "@/hooks/usePolling";
import { ChangelogButton } from "@/components/help/ChangelogButton";

const TELEGRAM_GROUP_URL = "https://t.me/+ODpy7_7NlOE4NzA1";
interface Session {
  id: string;
  filePath: string;
  name?: string;
  firstMessage?: string;
  timestamp?: string;
}
interface Group {
  projectPath: string;
  projectName: string;
  sessions: Session[];
}
interface SidebarProps {
  mobileOpen?: boolean;
  onClose?: () => void;
}

function sessionTitle(session: Session) {
  if (session.name?.trim()) return session.name.trim();
  if (session.firstMessage?.trim()) return session.firstMessage.trim();
  const date = session.timestamp ? new Date(session.timestamp) : null;
  return date && !Number.isNaN(date.getTime())
    ? `会话 · ${date.toLocaleDateString()}`
    : "新会话";
}

function dedupeSessionGroups(groups: Group[]): Group[] {
  const seenIds = new Set<string>();
  return groups
    .map((group) => ({
      ...group,
      sessions: group.sessions.filter((session) => {
        if (!session.id || seenIds.has(session.id)) return false;
        seenIds.add(session.id);
        return true;
      }),
    }))
    .filter((group) => group.sessions.length > 0);
}

export function Sidebar({ mobileOpen = false, onClose }: SidebarProps) {
  const { t, lang, setLang } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [langOpen, setLangOpen] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    new Set(),
  );
  const [menuSessionPath, setMenuSessionPath] = useState<string | null>(null);
  const [menuProjectPath, setMenuProjectPath] = useState<string | null>(null);
  const [removingProjectPath, setRemovingProjectPath] = useState<string | null>(
    null,
  );
  const [selectingSessions, setSelectingSessions] = useState(false);
  const [selectedSessionPaths, setSelectedSessionPaths] = useState<Set<string>>(
    new Set(),
  );
  const [removingSelection, setRemovingSelection] = useState(false);
  const [menuMessage, setMenuMessage] = useState("");
  // Session being renamed inline (file path) plus its draft title.
  const [renamingSessionPath, setRenamingSessionPath] = useState<string | null>(
    null,
  );
  const [renameDraft, setRenameDraft] = useState("");
  const [savingRename, setSavingRename] = useState(false);
  // Session ids with a pi run in flight, so the list can show a busy marker.
  const [runningSessions, setRunningSessions] = useState<Set<string>>(
    new Set(),
  );
  usePolling(() => {
    fetch("/api/pi/chat/active")
      .then((r) => (r.ok ? r.json() : { sessionIds: [] }))
      .then((data: { sessionIds?: string[] }) => setRunningSessions(new Set(data.sessionIds ?? [])))
      .catch(() => setRunningSessions(new Set()));
  }, 2000);
  useEffect(() => {
    const load = () =>
      fetch("/api/pi/sessions")
        .then((r) => (r.ok ? r.json() : []))
        .then((nextGroups: Group[]) =>
          setGroups(dedupeSessionGroups(nextGroups)),
        )
        .catch(() => setGroups([]));
    load();
    window.addEventListener("focus", load);
    window.addEventListener("pi-session-created", load);
    return () => {
      window.removeEventListener("focus", load);
      window.removeEventListener("pi-session-created", load);
    };
  }, []);
  const activeSession = useMemo(
    () => new URLSearchParams(location.search).get("session"),
    [location.search],
  );
  const selectedSessions = useMemo(
    () =>
      groups
        .flatMap((group) => group.sessions)
        .filter((session) => selectedSessionPaths.has(session.filePath)),
    [groups, selectedSessionPaths],
  );
  const startRename = (session: Session) => {
    setRenamingSessionPath(session.filePath);
    // Seed with the current display title so a small tweak is one keystroke away.
    setRenameDraft(sessionTitle(session));
    setMenuSessionPath(null);
    setMenuMessage("");
  };
  const cancelRename = () => {
    setRenamingSessionPath(null);
    setRenameDraft("");
    setSavingRename(false);
  };
  // Writes a session_info entry via the API; an empty name clears the custom
  // title and the list falls back to the first user message again.
  const submitRename = async (session: Session) => {
    const nextName = renameDraft.replace(/\s+/g, " ").trim();
    if (nextName === (session.name?.trim() ?? "") || nextName === sessionTitle(session)) {
      cancelRename();
      return;
    }
    setSavingRename(true);
    try {
      const response = await fetch("/api/pi/session-rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.id, name: nextName }),
      });
      const result = (await response.json()) as { success?: boolean };
      if (!result.success) throw new Error();
      setGroups((previous) =>
        previous.map((group) => ({
          ...group,
          sessions: group.sessions.map((item) =>
            item.filePath === session.filePath
              ? { ...item, name: nextName || undefined }
              : item,
          ),
        })),
      );
      cancelRename();
    } catch {
      setSavingRename(false);
      setMenuMessage("重命名失败");
    }
  };
  const moveToTrash = async (session: Session) => {
    if (
      !window.confirm(
        `将“${sessionTitle(session)}”移入回收站？可在会话管理中恢复。`,
      )
    )
      return;
    try {
      const response = await fetch(
        `/api/pi/session?path=${encodeURIComponent(session.filePath)}`,
        { method: "DELETE" },
      );
      const result = (await response.json()) as { success?: boolean };
      if (!result.success) throw new Error();
      setGroups((previous) =>
        previous
          .map((group) => ({
            ...group,
            sessions: group.sessions.filter(
              (item) => item.filePath !== session.filePath,
            ),
          }))
          .filter((group) => group.sessions.length > 0),
      );
      setMenuSessionPath(null);
      if (activeSession === session.id) navigate("/chat");
    } catch {
      setMenuMessage("移入回收站失败");
    }
  };
  const moveProjectToTrash = async (group: Group) => {
    if (
      !window.confirm(
        `将“${group.projectName}”目录中的 ${group.sessions.length} 个会话全部移入回收站？可在会话管理中恢复。`,
      )
    )
      return;
    setRemovingProjectPath(group.projectPath);
    try {
      const results = await Promise.all(
        group.sessions.map(async (session) => {
          const response = await fetch(
            `/api/pi/session?path=${encodeURIComponent(session.filePath)}`,
            { method: "DELETE" },
          );
          return (
            response.ok &&
            ((await response.json()) as { success?: boolean }).success === true
          );
        }),
      );
      const removedIds = new Set(
        group.sessions
          .filter((_, index) => results[index])
          .map((session) => session.id),
      );
      setGroups((previous) =>
        previous
          .map((item) =>
            item.projectPath === group.projectPath
              ? {
                  ...item,
                  sessions: item.sessions.filter(
                    (session) => !removedIds.has(session.id),
                  ),
                }
              : item,
          )
          .filter((item) => item.sessions.length > 0),
      );
      if (
        group.sessions.some(
          (session) =>
            removedIds.has(session.id) && session.id === activeSession,
        )
      )
        navigate("/chat");
      if (results.every(Boolean)) setMenuProjectPath(null);
      else
        window.alert(
          `已移入 ${removedIds.size} 个会话；其余会话移入失败，请稍后重试。`,
        );
    } catch {
      window.alert("移入回收站失败，请稍后重试。");
    } finally {
      setRemovingProjectPath(null);
    }
  };
  const toggleSessionSelection = (filePath: string) =>
    setSelectedSessionPaths((previous) => {
      const next = new Set(previous);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return next;
    });
  const toggleProjectSelection = (group: Group) =>
    setSelectedSessionPaths((previous) => {
      const next = new Set(previous);
      const selectAll = group.sessions.some(
        (session) => !next.has(session.filePath),
      );
      group.sessions.forEach((session) =>
        selectAll ? next.add(session.filePath) : next.delete(session.filePath),
      );
      return next;
    });
  const moveSelectedToTrash = async () => {
    if (
      !selectedSessions.length ||
      !window.confirm(
        `将选中的 ${selectedSessions.length} 个会话移入回收站？可在会话管理中恢复。`,
      )
    )
      return;
    setRemovingSelection(true);
    try {
      const results = await Promise.all(
        selectedSessions.map(async (session) => {
          const response = await fetch(
            `/api/pi/session?path=${encodeURIComponent(session.filePath)}`,
            { method: "DELETE" },
          );
          return (
            response.ok &&
            ((await response.json()) as { success?: boolean }).success === true
          );
        }),
      );
      const removedPaths = new Set(
        selectedSessions
          .filter((_, index) => results[index])
          .map((session) => session.filePath),
      );
      setGroups((previous) =>
        previous
          .map((group) => ({
            ...group,
            sessions: group.sessions.filter(
              (session) => !removedPaths.has(session.filePath),
            ),
          }))
          .filter((group) => group.sessions.length > 0),
      );
      setSelectedSessionPaths(
        (previous) =>
          new Set([...previous].filter((path) => !removedPaths.has(path))),
      );
      if (
        selectedSessions.some(
          (session) =>
            removedPaths.has(session.filePath) && session.id === activeSession,
        )
      )
        navigate("/chat");
      if (results.every(Boolean)) {
        setSelectingSessions(false);
        setSelectedSessionPaths(new Set());
      } else
        window.alert(
          `已移入 ${removedPaths.size} 个会话；其余会话移入失败，请稍后重试。`,
        );
    } catch {
      window.alert("移入回收站失败，请稍后重试。");
    } finally {
      setRemovingSelection(false);
    }
  };

  return (
    <aside className={cn("codex-sidebar", mobileOpen && "is-open")}>
      <div className="codex-sidebar-top">
        <Link
          to="/chat"
          onClick={onClose}
          className="codex-brand"
          aria-label="Pi Chat home"
        >
          <img src="/pi.svg" alt="" />
          <span>pi</span>
          <small>local</small>
        </Link>
        <button
          className="sidebar-close"
          aria-label="Close navigation"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <Link to="/chat" onClick={onClose} className="codex-new-chat">
        <MessageSquarePlus className="h-4 w-4" />
        <span>新建对话</span>
      </Link>
      <div className="codex-history-heading">
        <div className="codex-history-label">项目对话</div>
        {groups.length > 0 && (
          <button
            className="codex-selection-toggle"
            onClick={() => {
              setSelectingSessions((selecting) => !selecting);
              setSelectedSessionPaths(new Set());
              setMenuProjectPath(null);
              setMenuSessionPath(null);
            }}
          >
            {selectingSessions ? "取消" : "选择"}
          </button>
        )}
      </div>
      {selectingSessions && (
        <div className="codex-selection-bar">
          <span>已选 {selectedSessions.length} 项</span>
          <button
            className="codex-selection-delete"
            disabled={!selectedSessions.length || removingSelection}
            onClick={moveSelectedToTrash}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {removingSelection ? "移除中…" : "移除已选"}
          </button>
        </div>
      )}
      <nav
        className={cn("codex-history", selectingSessions && "is-selecting")}
        aria-label="Project conversations"
      >
        {groups.map((group) => {
          const collapsed = collapsedGroups.has(group.projectPath);
          const removing = removingProjectPath === group.projectPath;
          const allProjectSessionsSelected =
            group.sessions.length > 0 &&
            group.sessions.every((session) =>
              selectedSessionPaths.has(session.filePath),
            );
          return (
            <section key={group.projectPath} className="codex-project-group">
              <div className="codex-project-header">
                {selectingSessions && (
                  <input
                    className="codex-selection-checkbox"
                    type="checkbox"
                    aria-label={`选择目录：${group.projectName}`}
                    checked={allProjectSessionsSelected}
                    onChange={() => toggleProjectSelection(group)}
                  />
                )}
                <button
                  className="codex-project-title"
                  onClick={() =>
                    setCollapsedGroups((previous) => {
                      const next = new Set(previous);
                      if (next.has(group.projectPath))
                        next.delete(group.projectPath);
                      else next.add(group.projectPath);
                      return next;
                    })
                  }
                >
                  <ChevronRight
                    className={cn("h-3.5 w-3.5", !collapsed && "rotate-90")}
                  />
                  <Folder className="h-3.5 w-3.5" />
                  <span className="truncate">{group.projectName}</span>
                  <small>{group.sessions.length}</small>
                  {group.sessions.some((session) =>
                    runningSessions.has(session.id),
                  ) && (
                    <Loader2
                      className="codex-project-spinner h-3 w-3 animate-spin"
                      aria-label="该目录有任务进行中"
                    />
                  )}
                </button>
                {!selectingSessions && (
                  <button
                    className="project-more"
                    aria-label={`目录菜单：${group.projectName}`}
                    onClick={() => {
                      setMenuProjectPath((current) =>
                        current === group.projectPath
                          ? null
                          : group.projectPath,
                      );
                      setMenuSessionPath(null);
                    }}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                )}
                {menuProjectPath === group.projectPath && (
                  <div className="conversation-menu project-menu">
                    <Link
                      to={`/chat?project=${encodeURIComponent(group.projectPath)}`}
                      onClick={() => {
                        setMenuProjectPath(null);
                        setMenuSessionPath(null);
                        onClose?.();
                      }}
                    >
                      <MessageSquarePlus className="h-3.5 w-3.5" />
                      在此目录发起对话
                    </Link>
                    <button
                      className="conversation-menu-danger"
                      disabled={removing}
                      onClick={() => moveProjectToTrash(group)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {removing ? "正在移入回收站…" : "移除目录会话"}
                    </button>
                  </div>
                )}
              </div>
              {!collapsed &&
                group.sessions.map((session) => (
                  <div
                    key={session.filePath}
                    className={cn(
                      "codex-conversation-row",
                      activeSession === session.id && "is-active",
                      runningSessions.has(session.id) && "is-running",
                    )}
                  >
                    {selectingSessions && (
                      <input
                        className="codex-selection-checkbox"
                        type="checkbox"
                        aria-label={`选择会话：${sessionTitle(session)}`}
                        checked={selectedSessionPaths.has(session.filePath)}
                        onChange={() =>
                          toggleSessionSelection(session.filePath)
                        }
                      />
                    )}
                    {renamingSessionPath === session.filePath ? (
                      <input
                        className="conversation-rename-input"
                        value={renameDraft}
                        autoFocus
                        disabled={savingRename}
                        placeholder="会话名称（留空恢复默认）"
                        aria-label="重命名会话"
                        maxLength={200}
                        onChange={(event) => setRenameDraft(event.target.value)}
                        onBlur={() => submitRename(session)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            submitRename(session);
                          } else if (event.key === "Escape") {
                            event.preventDefault();
                            cancelRename();
                          }
                        }}
                      />
                    ) : (
                    <Link
                      to={`/chat?session=${encodeURIComponent(session.id)}`}
                      onClick={
                        selectingSessions
                          ? (event) => event.preventDefault()
                          : onClose
                      }
                      className="codex-conversation"
                      title={sessionTitle(session)}
                    >
                      {runningSessions.has(session.id) && (
                        <Loader2
                          className="codex-conversation-spinner h-3 w-3 animate-spin"
                          aria-label="任务进行中"
                        />
                      )}
                      <span className="truncate">{sessionTitle(session)}</span>
                    </Link>
                    )}
                    {!selectingSessions && renamingSessionPath !== session.filePath && (
                      <button
                        className="conversation-more"
                        aria-label={`会话菜单：${sessionTitle(session)}`}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setMenuSessionPath((current) =>
                            current === session.filePath
                              ? null
                              : session.filePath,
                          );
                          setMenuProjectPath(null);
                          setMenuMessage("");
                        }}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    )}
                    {menuSessionPath === session.filePath && (
                      <div className="conversation-menu">
                        <button onClick={() => startRename(session)}>
                          重命名
                        </button>
                        <button
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(session.id);
                              setMenuMessage("已复制");
                            } catch {
                              setMenuMessage("复制失败");
                            }
                          }}
                        >
                          复制会话 ID
                        </button>
                        <Link
                          to="/sessions"
                          onClick={() => setMenuSessionPath(null)}
                        >
                          打开会话管理
                        </Link>
                        <button
                          className="conversation-menu-danger"
                          onClick={() => moveToTrash(session)}
                        >
                          移入回收站
                        </button>
                        {menuMessage && <small>{menuMessage}</small>}
                      </div>
                    )}
                  </div>
                ))}
            </section>
          );
        })}
        {groups.length === 0 && (
          <p className="codex-history-empty">尚无本地对话</p>
        )}
      </nav>
      <div className="codex-sidebar-bottom">
        <Link
          to="/settings"
          onClick={onClose}
          className={cn(
            "codex-settings-link",
            location.pathname.startsWith("/settings") && "is-active",
          )}
        >
          <Settings2 className="h-4 w-4" />
          <span>{t("nav.settings")}</span>
        </Link>
        <a
          href={TELEGRAM_GROUP_URL}
          target="_blank"
          rel="noreferrer"
          className="codex-support-link"
        >
          <Send className="h-3.5 w-3.5" /> 社区支持
        </a>
        <div className="codex-language">
          <button onClick={() => setLangOpen((open) => !open)}>
            <Globe className="h-3.5 w-3.5" />
            <span>
              {LANGUAGES.find((item) => item.code === lang)?.nativeLabel ||
                "English"}
            </span>
            <ChevronDown
              className={cn("ml-auto h-3.5 w-3.5", langOpen && "rotate-180")}
            />
          </button>
          {langOpen && (
            <div className="language-menu">
              {LANGUAGES.map((item) => (
                <button
                  key={item.code}
                  onClick={() => {
                    setLang(item.code);
                    setLangOpen(false);
                  }}
                  className={cn(
                    "language-option",
                    lang === item.code && "is-selected",
                  )}
                >
                  {item.nativeLabel}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="codex-sidebar-version">
          <span>pi-desktop</span>
          <ChangelogButton />
          <PanelLeftClose className="h-3.5 w-3.5" />
        </div>
      </div>
    </aside>
  );
}
