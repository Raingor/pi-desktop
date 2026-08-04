import { useState, useEffect, useCallback } from "react";
import { useConfigStore } from "@/store/config-store";
import { useTranslation } from "@/lib/i18n";
import {
  piSessionsList, piTrashList, piSessionTrash, piSessionRestore,
  piSessionDeletePermanent, piSessionPreview,
} from "@/lib/tauri";
import type { ProjectGroup, TrashEntry, SessionPreview } from "@/lib/tauri";
import {
  History, MessageSquare, Clock, ChevronDown, ChevronRight, Trash2, AlertTriangle,
  Shield, RefreshCw, Undo2, Eye, Folder, FolderOpen, FileText, Search,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";

function isRecent(isoDate: string): boolean {
  if (!isoDate) return false;
  const then = new Date(isoDate).getTime();
  const now = Date.now();
  const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
  return now - then < threeDaysMs;
}

interface SessionInfo {
  id: string;
  fileName: string;
  filePath: string;
  timestamp: string;
  lastActive: string;
  name?: string;
  provider?: string;
  model?: string;
  messageCount: number;
  duration?: number;
}

// ProjectGroup / TrashEntry / SessionPreview types are imported from @/lib/tauri

interface PreviewMessage {
  role: string;
  text: string;
  timestamp: string;
}

interface TreeNode {
  id: string;
  type: "directory" | "project" | "session";
  name: string;
  fullPath?: string; // For directory nodes, the path prefix
  data?: ProjectGroup | SessionInfo; // Only for project/session nodes
  children?: TreeNode[];
  sessionCount?: number; // Aggregate count for directory nodes
  lastActive?: string; // Latest activity for sorting
}

const SESSIONS_PER_GROUP = 50;

function formatDuration(ms?: number): string {
  if (!ms) return "—";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/** Relative date: today / yesterday / Nd ago / short date */
function formatRelativeDate(iso: string, t: (key: string, ...args: string[]) => string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return t("common.today");
  if (days === 1) return t("common.yesterday");
  if (days < 7) return t("common.days_ago", String(days));
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function sessionDisplayName(s: { name?: string; fileName: string; id?: string }): string {
  return s.name || s.fileName.replace(/\.jsonl$/, "").split("_").pop() || s.id?.slice(0, 12) || s.fileName;
}

/** Full timestamp for tooltips — accepts ISO strings, guards invalid dates */
function formatFullTimestamp(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

/** Build a proper directory tree from project groups */
function buildDirectoryTree(groups: ProjectGroup[]): TreeNode[] {
  const root: TreeNode[] = [];
  
  for (const group of groups) {
    // Split project path into segments
    // e.g., "Users-mac-2312-r-workspace-wwwroot-my-notes" -> ["Users", "mac-2312-r", "workspace", "wwwroot", "my-notes"]
    const segments = group.projectPath.split("-").filter(Boolean);
    
    // Insert into tree, creating intermediate directories as needed
    let currentLevel = root;
    let currentPath = "";
    
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const parentPath = currentPath;
      currentPath = currentPath ? `${currentPath}-${segment}` : segment;
      
      const isLastSegment = i === segments.length - 1;
      
      if (isLastSegment) {
        // This is the actual project node - add it with sessions as children
        currentLevel.push({
          id: group.projectPath,
          type: "project",
          name: segment, // Use just the last segment as display name
          data: group,
          children: group.sessions.map((session) => ({
            id: session.id || session.fileName,
            type: "session" as const,
            name: sessionDisplayName(session),
            data: session,
          })),
          sessionCount: group.totalSessions,
          lastActive: group.lastActive,
        });
      } else {
        // This is an intermediate directory - find or create it
        let dirNode = currentLevel.find(
          (node) => node.type === "directory" && node.name === segment && node.fullPath === currentPath
        );
        
        if (!dirNode) {
          dirNode = {
            id: currentPath,
            type: "directory",
            name: segment,
            fullPath: currentPath,
            children: [],
            sessionCount: 0,
            lastActive: "",
          };
          currentLevel.push(dirNode);
        }
        
        // Update aggregate stats
        dirNode.sessionCount = (dirNode.sessionCount || 0) + group.totalSessions;
        if (!dirNode.lastActive || group.lastActive > dirNode.lastActive) {
          dirNode.lastActive = group.lastActive;
        }
        
        currentLevel = dirNode.children!;
      }
    }
  }
  
  // Sort root level by lastActive descending
  return sortTreeByLastActive(root);
}

/** Recursively sort tree nodes by lastActive */
function sortTreeByLastActive(nodes: TreeNode[]): TreeNode[] {
  return nodes
    .sort((a, b) => (b.lastActive || "").localeCompare(a.lastActive || ""))
    .map((node) => {
      if (node.children && node.children.length > 0) {
        return { ...node, children: sortTreeByLastActive(node.children) };
      }
      return node;
    });
}

/** Filter directory tree by search query */
function filterDirectoryTree(nodes: TreeNode[], query: string): TreeNode[] {
  if (!query) return nodes;
  const q = query.toLowerCase();

  return nodes
    .map((node) => {
      // Check if this node name matches
      const nameMatches = node.name.toLowerCase().includes(q);
      
      if (nameMatches) {
        // Node matches, include all children and mark as expanded
        return { ...node, _forceExpanded: true } as TreeNode & { _forceExpanded?: boolean };
      }
      
      // If has children, recursively filter them
      if (node.children && node.children.length > 0) {
        const filteredChildren = filterDirectoryTree(node.children, q);
        if (filteredChildren.length > 0) {
          return {
            ...node,
            children: filteredChildren,
            _forceExpanded: true,
          } as TreeNode & { _forceExpanded?: boolean };
        }
      }
      
      // For project nodes, check sessions
      if (node.type === "project" && node.data) {
        const group = node.data as ProjectGroup;
        const matchingSessions = group.sessions.filter((s) =>
          sessionDisplayName(s).toLowerCase().includes(q)
        );
        
        if (matchingSessions.length > 0) {
          return {
            ...node,
            children: matchingSessions.map((session) => ({
              id: session.id || session.fileName,
              type: "session" as const,
              name: sessionDisplayName(session),
              data: session,
            })),
            _forceExpanded: true,
          } as TreeNode & { _forceExpanded?: boolean };
        }
      }
      
      return null;
    })
    .filter((n): n is TreeNode => n !== null);
}

/** Tree Node Component - supports directory, project, and session nodes */
function TreeNodeItem({
  node,
  level,
  expandedNodes,
  forceExpanded,
  onToggle,
  onDelete,
  onPreview,
  t,
}: {
  node: TreeNode & { _forceExpanded?: boolean };
  level: number;
  expandedNodes: Set<string>;
  forceExpanded?: boolean;
  onToggle: (id: string) => void;
  onDelete: (session: SessionInfo, groupPath: string) => void;
  onPreview: (session: SessionInfo) => void;
  t: (key: string, ...args: string[]) => string;
}) {
  const isExpanded = forceExpanded || node._forceExpanded || expandedNodes.has(node.id);
  const hasChildren = node.children && node.children.length > 0;
  const isDirectory = node.type === "directory";
  const isProject = node.type === "project";
  const isSession = node.type === "session";
  const session = isSession ? (node.data as SessionInfo) : null;
  const project = isProject ? (node.data as ProjectGroup) : null;

  // Directory and project nodes can be toggled; sessions cannot
  const canToggle = isDirectory || isProject;

  const paddingLeft = level * 16 + 12;

  return (
    <div>
      {/* Node Row */}
      <div
        className={`flex items-center gap-2 py-2 pr-3 transition-colors ${canToggle ? "cursor-pointer hover:bg-gray-500/5" : ""}`}
        style={{
          paddingLeft,
          backgroundColor: isSession ? "var(--page-bg)" : "transparent",
          borderBottom: "1px solid var(--card-border)",
        }}
        onClick={() => {
          if (canToggle) {
            onToggle(node.id);
          } else if (session) {
            onPreview(session);
          }
        }}
      >
        {/* Expand/Collapse Icon */}
        {canToggle && hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggle(node.id);
            }}
            className="flex items-center justify-center w-5 h-5 rounded hover:bg-gray-500/10"
            style={{ color: "var(--muted-text)" }}
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
        ) : (
          <span className="w-5" />
        )}

        {/* Icon */}
        <div
          className="flex items-center justify-center w-7 h-7 rounded-md shrink-0"
          style={{
            backgroundColor: (isDirectory || isProject) ? "var(--accent-bg)" : "transparent",
          }}
        >
          {isDirectory ? (
            isExpanded ? (
              <FolderOpen className="h-4 w-4" style={{ color: "#f59e0b" }} />
            ) : (
              <Folder className="h-4 w-4" style={{ color: "#f59e0b" }} />
            )
          ) : isProject ? (
            isExpanded ? (
              <FolderOpen className="h-4 w-4" style={{ color: "var(--sidebar-active-text)" }} />
            ) : (
              <Folder className="h-4 w-4" style={{ color: "var(--sidebar-active-text)" }} />
            )
          ) : (
            <FileText className="h-4 w-4" style={{ color: "var(--muted-text)" }} />
          )}
        </div>

        {/* Name and Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`truncate ${isDirectory ? "font-semibold text-sm" : "font-medium text-sm"}`}
              style={{ 
                color: isDirectory ? "#d97706" : "var(--page-text)",
              }}
            >
              {node.name}
            </span>
            {(isDirectory || isProject) && node.sessionCount !== undefined && node.sessionCount > 0 && (
              <span
                className="text-xs px-1.5 py-0.5 rounded-full"
                style={{
                  backgroundColor: isDirectory ? "rgba(245,158,11,0.15)" : "var(--accent-bg)",
                  color: isDirectory ? "#d97706" : "var(--sidebar-active-text)",
                }}
              >
                {node.sessionCount}
              </span>
            )}
          </div>
          {isSession && session && (
            <div className="flex items-center gap-2 text-xs" style={{ color: "var(--muted-text)" }}>
              <span title={formatFullTimestamp(session.timestamp)}>
                {formatRelativeDate(session.timestamp, t)}
              </span>
              <span className="flex items-center gap-0.5">
                <MessageSquare className="h-3 w-3" />
                {session.messageCount}
              </span>
              {session.duration && (
                <span className="flex items-center gap-0.5">
                  <Clock className="h-3 w-3" />
                  {formatDuration(session.duration)}
                </span>
              )}
            </div>
          )}
          {isProject && project && (
            <div className="text-xs" style={{ color: "var(--muted-text)" }}>
              {t("sessions.last_active", formatRelativeDate(project.lastActive, t))}
            </div>
          )}
          {isDirectory && node.lastActive && (
            <div className="text-xs" style={{ color: "var(--subtle-text)" }}>
              {t("sessions.last_active", formatRelativeDate(node.lastActive, t))}
            </div>
          )}
        </div>

        {/* Actions - only for sessions */}
        {isSession && session && (
          <div className="flex items-center gap-1 shrink-0">
            {session.provider && session.provider !== "unknown" && (
              <span
                className="text-xs rounded-md px-2 py-0.5 hidden sm:block"
                style={{
                  backgroundColor: "var(--accent-bg)",
                  color: "var(--sidebar-active-text)",
                }}
              >
                {session.provider}/{session.model?.split("-").slice(0, 2).join("-") || session.model}
              </span>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onPreview(session);
              }}
              className="rounded-lg p-1.5 transition-colors hover:bg-gray-500/10"
              style={{ color: "var(--subtle-text)" }}
              title={t("sessions.preview_title")}
            >
              <Eye className="h-3.5 w-3.5" />
            </button>
            {isRecent(session.lastActive) ? (
              <span
                className="rounded-lg p-1.5"
                style={{ color: "var(--subtle-text)" }}
                title={t("sessions.protected")}
              >
                <Shield className="h-3.5 w-3.5" />
              </span>
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  // Find parent project path for this session
                  onDelete(session, findParentProjectPath(node));
                }}
                className="rounded-lg p-1.5 transition-colors hover:bg-gray-500/10"
                style={{ color: "var(--subtle-text)" }}
                title={t("sessions.delete")}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Children */}
      {(isDirectory || isProject) && isExpanded && hasChildren && (
        <div>
          {node.children!.map((child) => (
            <TreeNodeItem
              key={child.id}
              node={child as TreeNode & { _forceExpanded?: boolean }}
              level={level + 1}
              expandedNodes={expandedNodes}
              forceExpanded={!!node._forceExpanded}
              onToggle={onToggle}
              onDelete={onDelete}
              onPreview={onPreview}
              t={t}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Find the parent project path for a session node */
function findParentProjectPath(node: TreeNode): string {
  // Walk up to find the nearest project ancestor
  // Note: In our current structure, the parent should be a project or directory
  // We need to pass this info differently - for now return empty string
  // The actual fix would require restructuring how we track parent paths
  return "";
}

export function SessionsPage() {
  const { t } = useTranslation();
  const { initialized } = useConfigStore();
  const [tab, setTab] = useState<"sessions" | "trash">("sessions");
  const [groups, setGroups] = useState<ProjectGroup[]>([]);
  const [trash, setTrash] = useState<TrashEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ session: SessionInfo; groupPath: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Trash tab state
  const [selectedTrash, setSelectedTrash] = useState<Set<string>>(new Set());
  const [purgeTarget, setPurgeTarget] = useState<"batch" | TrashEntry | null>(null);
  const [purging, setPurging] = useState(false);
  // Preview modal state
  const [previewTarget, setPreviewTarget] = useState<SessionInfo | null>(null);
  const [preview, setPreview] = useState<{ messages: PreviewMessage[]; total: number } | null>(null);
  const [previewError, setPreviewError] = useState(false);
  // Tree state
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  const loadAll = useCallback(() => {
    if (!initialized) return;
    setRefreshing(true);
    Promise.all([piSessionsList(), piTrashList()])
      .then(([sessionData, trashData]) => {
        setGroups(sessionData);
        setTrash(trashData);
        setError(null);
        const firstThree = sessionData.slice(0, 3).map((g) => g.projectPath);
        setExpandedNodes(new Set(firstThree));
      })
      .catch((e) => setError(String(e)))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, [initialized]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Move session to trash (recoverable)
  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const success = await piSessionTrash(deleteTarget.session.filePath);
      if (success) {
        setDeleteTarget(null);
        loadAll();
      } else {
        alert(t("sessions.delete_failed"));
      }
    } catch {
      alert(t("sessions.delete_error"));
    } finally {
      setDeleting(false);
    }
  };

  const handleRestore = async (trashPath: string) => {
    try {
      await piSessionRestore(trashPath);
    } catch { /* reload below reflects the actual state */ }
    setSelectedTrash((prev) => { const next = new Set(prev); next.delete(trashPath); return next; });
    loadAll();
  };

  const handlePurge = async () => {
    if (!purgeTarget) return;
    setPurging(true);
    const paths = purgeTarget === "batch" ? [...selectedTrash] : [purgeTarget.trashPath];
    for (const p of paths) {
      try {
        await piSessionDeletePermanent(p);
      } catch { /* continue */ }
    }
    setPurging(false);
    setPurgeTarget(null);
    setSelectedTrash(new Set());
    loadAll();
  };

  const handleBatchRestore = async () => {
    for (const p of selectedTrash) {
      try {
        await piSessionRestore(p);
      } catch { /* continue */ }
    }
    setSelectedTrash(new Set());
    loadAll();
  };

  const openPreview = (session: SessionInfo) => {
    setPreviewTarget(session);
    setPreview(null);
    setPreviewError(false);
    piSessionPreview(session.filePath)
      .then(setPreview)
      .catch(() => setPreviewError(true));
  };

  // Toggle node expansion
  const toggleNode = (id: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Expand/collapse all - collect all directory and project node IDs
  const expandAll = () => {
    const allIds: string[] = [];
    const collectIds = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        if (node.type === "directory" || node.type === "project") {
          allIds.push(node.id);
        }
        if (node.children) {
          collectIds(node.children);
        }
      }
    };
    collectIds(buildDirectoryTree(groups));
    setExpandedNodes(new Set(allIds));
  };

  const collapseAll = () => {
    setExpandedNodes(new Set());
  };

  // Build and filter tree
  const tree = buildDirectoryTree(groups);
  const filteredTree = filterDirectoryTree(tree, filter.trim());

  const toggleTrashSelect = (path: string) => {
    setSelectedTrash((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };
  const allTrashSelected = trash.length > 0 && trash.every((e) => selectedTrash.has(e.trashPath));

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-600 border-t-blue-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-sm" style={{ color: "var(--error-text, #ef4444)" }}>{t("sessions.load_failed")}: {error}</p>
      </div>
    );
  }

const totalSessions = groups.reduce((s, g) => s + g.totalSessions, 0);
// Check if all expandable nodes (directories and projects) are expanded
const allExpanded = (() => {
  if (groups.length === 0) return false;
  const totalExpandable = countExpandableNodes(tree);
  return expandedNodes.size >= totalExpandable && totalExpandable > 0;
})();

/** Count all directory and project nodes in tree */
function countExpandableNodes(nodes: TreeNode[]): number {
  let count = 0;
  for (const node of nodes) {
    if (node.type === "directory" || node.type === "project") {
      count++;
    }
    if (node.children) {
      count += countExpandableNodes(node.children);
    }
  }
  return count;
}

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--page-text)" }}>{t("sessions.title")}</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--muted-text)" }}>
            {t("sessions.summary", String(totalSessions), String(groups.length))}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Expand/Collapse All button */}
          {tab === "sessions" && groups.length > 0 && (
            <button
              onClick={() => allExpanded ? collapseAll() : expandAll()}
              className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
              style={{ borderColor: "var(--card-border)", color: "var(--muted-text)", backgroundColor: "var(--card-bg)" }}
              title={allExpanded ? t("sessions.collapse_all") : t("sessions.expand_all")}
            >
              {allExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              {allExpanded ? t("sessions.collapse_all") : t("sessions.expand_all")}
            </button>
          )}
          <button
            onClick={loadAll}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
            style={{ borderColor: "var(--card-border)", color: "var(--muted-text)", backgroundColor: "var(--card-bg)" }}
            title={t("sessions.refresh")}
          >
            <RefreshCw className={refreshing ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
            {t("sessions.refresh")}
          </button>
        </div>
      </div>

      {/* Tabs: Sessions / Trash */}
      <div className="flex items-center gap-1 border-b" style={{ borderColor: "var(--card-border)" }}>
        {([
          { key: "sessions" as const, label: t("sessions.tab_sessions"), count: totalSessions },
          { key: "trash" as const, label: t("sessions.tab_trash"), count: trash.length },
        ]).map((item) => (
          <button
            key={item.key}
            onClick={() => setTab(item.key)}
            className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors"
            style={{
              color: tab === item.key ? "#3b82f6" : "var(--muted-text)",
              borderBottomColor: tab === item.key ? "#3b82f6" : "transparent",
            }}
          >
            {item.key === "trash" && <Trash2 className="h-3.5 w-3.5" />}
            {item.label}
            {item.count > 0 && (
              <span
                className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                style={{
                  backgroundColor: item.key === "trash" && item.count > 0 ? "rgba(239,68,68,0.15)" : "var(--accent-bg)",
                  color: item.key === "trash" && item.count > 0 ? "#ef4444" : "var(--sidebar-active-text)",
                }}
              >
                {item.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "sessions" && (
        <>
          {/* Search */}
          <div className="relative">
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t("sessions.filter_placeholder")}
              className="w-full rounded-lg border px-4 py-2.5 pl-10 text-sm"
              style={{
                backgroundColor: "var(--input-bg)",
                borderColor: "var(--input-border)",
                color: "var(--input-text)",
              }}
            />
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: "var(--muted-text)" }} />
          </div>

          {/* Tree View */}
          <div
            className="rounded-xl border overflow-hidden"
            style={{ borderColor: "var(--card-border)" }}
          >
            {filteredTree.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12">
                <History className="h-12 w-12" style={{ color: "var(--subtle-text)" }} />
                <p className="mt-4 text-sm" style={{ color: "var(--muted-text)" }}>
                  {filter ? t("sessions.no_search_results") : t("sessions.no_sessions")}
                </p>
              </div>
            ) : (
              <div>
                {filteredTree.map((node) => (
                  <TreeNodeItem
                    key={node.id}
                    node={node}
                    level={0}
                    expandedNodes={expandedNodes}
                    onToggle={toggleNode}
                    onDelete={(session, groupPath) => setDeleteTarget({ session, groupPath })}
                    onPreview={openPreview}
                    t={t}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {tab === "trash" && (
        <div className="space-y-3">
          <p className="text-xs" style={{ color: "var(--muted-text)" }}>{t("sessions.trash_desc")}</p>

          {/* Batch action bar */}
          {trash.length > 0 && (
            <div className="flex items-center gap-3 rounded-lg border px-4 py-2.5" style={{ borderColor: "var(--card-border)", backgroundColor: "var(--card-bg)" }}>
              <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: "var(--muted-text)" }}>
                <input
                  type="checkbox"
                  checked={allTrashSelected}
                  onChange={() => setSelectedTrash(allTrashSelected ? new Set() : new Set(trash.map((e) => e.trashPath)))}
                />
                {t("sessions.select_all")}
              </label>
              {selectedTrash.size > 0 && (
                <>
                  <span className="text-xs" style={{ color: "var(--page-text)" }}>{t("sessions.selected_count", String(selectedTrash.size))}</span>
                  <button
                    onClick={handleBatchRestore}
                    className="flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium"
                    style={{ borderColor: "#10b981", color: "#10b981" }}
                  >
                    <Undo2 className="h-3 w-3" />
                    {t("sessions.restore_selected")}
                  </button>
                  <button
                    onClick={() => setPurgeTarget("batch")}
                    className="flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium"
                    style={{ borderColor: "#ef4444", color: "#ef4444" }}
                  >
                    <Trash2 className="h-3 w-3" />
                    {t("sessions.delete_selected")}
                  </button>
                </>
              )}
            </div>
          )}

          {trash.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Trash2 className="h-12 w-12" style={{ color: "var(--subtle-text)" }} />
              <p className="mt-4 text-sm" style={{ color: "var(--muted-text)" }}>{t("sessions.trash_empty")}</p>
            </div>
          ) : (
            trash.map((entry) => (
              <div
                key={entry.trashPath}
                className="flex items-center gap-3 rounded-lg border px-4 py-3"
                style={{
                  borderColor: selectedTrash.has(entry.trashPath) ? "#3b82f6" : "var(--card-border)",
                  backgroundColor: "var(--card-bg)",
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedTrash.has(entry.trashPath)}
                  onChange={() => toggleTrashSelect(entry.trashPath)}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate" style={{ color: "var(--page-text)" }}>
                    {entry.sessionName || entry.fileName.replace(/\.jsonl$/, "")}
                  </p>
                  <div className="flex items-center gap-3 text-xs mt-0.5" style={{ color: "var(--muted-text)" }}>
                    <span style={{ color: "#ef4444" }}>{t("sessions.trashed_at", formatRelativeDate(entry.trashedAt, t))}</span>
                    <span className="flex items-center gap-1">
                      <MessageSquare className="h-3 w-3" />
                      {entry.messageCount}
                    </span>
                    <span className="truncate">{entry.fileName}</span>
                  </div>
                </div>
                <button
                  onClick={() => handleRestore(entry.trashPath)}
                  className="flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium shrink-0"
                  style={{ borderColor: "#10b981", color: "#10b981" }}
                >
                  <Undo2 className="h-3 w-3" />
                  {t("sessions.restore")}
                </button>
                <button
                  onClick={() => setPurgeTarget(entry)}
                  className="flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium shrink-0"
                  style={{ borderColor: "#ef4444", color: "#ef4444" }}
                >
                  <Trash2 className="h-3 w-3" />
                  {t("sessions.delete_forever")}
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* Move-to-Trash Confirmation Modal */}
      <Modal
        open={!!deleteTarget}
        onClose={() => !deleting && setDeleteTarget(null)}
        title={t("sessions.delete_title")}
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" style={{ color: "#f59e0b" }} />
            <div>
              <p className="text-sm" style={{ color: "var(--page-text)" }}>
                {t("sessions.delete_confirm")}
              </p>
              <p className="text-xs mt-1" style={{ color: "var(--muted-text)" }}>
                {deleteTarget?.session.name || deleteTarget?.session.fileName}
              </p>
              {deleteTarget?.session.messageCount && (
                <p className="text-xs mt-1" style={{ color: "var(--subtle-text)" }}>
                  {t("sessions.messages", String(deleteTarget.session.messageCount))} · {formatFullTimestamp(deleteTarget.session.lastActive || deleteTarget.session.timestamp)}
                </p>
              )}
              <p className="text-xs mt-2" style={{ color: "var(--subtle-text)" }}>
                {t("sessions.delete_to_trash_note")}
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
              className="rounded-lg px-4 py-2 text-sm"
              style={{ color: "var(--muted-text)" }}
            >
              {t("sessions.cancel")}
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white"
              style={{ backgroundColor: "#dc2626" }}
            >
              {deleting ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  {t("sessions.deleting")}
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" />
                  {t("sessions.delete")}
                </>
              )}
            </button>
          </div>
        </div>
      </Modal>

      {/* Permanent-Delete Confirmation Modal */}
      <Modal
        open={!!purgeTarget}
        onClose={() => !purging && setPurgeTarget(null)}
        title={t("sessions.delete_forever")}
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" style={{ color: "#ef4444" }} />
            <div>
              <p className="text-sm" style={{ color: "var(--page-text)" }}>
                {t("sessions.delete_forever_confirm")}
              </p>
              <p className="text-xs mt-1" style={{ color: "var(--muted-text)" }}>
                {purgeTarget === "batch"
                  ? t("sessions.selected_count", String(selectedTrash.size))
                  : purgeTarget?.sessionName || purgeTarget?.fileName}
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setPurgeTarget(null)}
              disabled={purging}
              className="rounded-lg px-4 py-2 text-sm"
              style={{ color: "var(--muted-text)" }}
            >
              {t("sessions.cancel")}
            </button>
            <button
              onClick={handlePurge}
              disabled={purging}
              className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white"
              style={{ backgroundColor: "#dc2626" }}
            >
              {purging ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  {t("sessions.deleting")}
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" />
                  {t("sessions.delete_forever")}
                </>
              )}
            </button>
          </div>
        </div>
      </Modal>

      {/* Session Preview Modal */}
      <Modal
        open={!!previewTarget}
        onClose={() => setPreviewTarget(null)}
        title={previewTarget ? sessionDisplayName(previewTarget) : t("sessions.preview_title")}
        size="lg"
      >
        <div className="max-h-[60vh] overflow-y-auto space-y-2.5">
          {previewError ? (
            <p className="text-sm py-6 text-center" style={{ color: "#ef4444" }}>{t("sessions.preview_failed")}</p>
          ) : !preview ? (
            <div className="flex items-center justify-center py-10">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-600 border-t-blue-500" />
            </div>
          ) : preview.messages.length === 0 ? (
            <p className="text-sm py-6 text-center" style={{ color: "var(--muted-text)" }}>{t("sessions.preview_empty")}</p>
          ) : (
            <>
              <p className="text-xs" style={{ color: "var(--subtle-text)" }}>
                {t("sessions.preview_total", String(preview.total), String(preview.messages.length))}
              </p>
              {preview.messages.map((m, i) => (
                <div
                  key={i}
                  className="rounded-lg border px-3.5 py-2.5"
                  style={{
                    backgroundColor: "var(--card-bg)",
                    borderColor: m.role === "user" ? "rgba(59,130,246,0.4)" : "var(--card-border)",
                  }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase"
                      style={{
                        backgroundColor: m.role === "user" ? "rgba(59,130,246,0.15)" : "var(--accent-bg)",
                        color: m.role === "user" ? "#3b82f6" : "var(--sidebar-active-text)",
                      }}
                    >
                      {m.role}
                    </span>
                    {m.timestamp && (
                      <span className="text-[10px]" style={{ color: "var(--subtle-text)" }}>
                        {new Date(m.timestamp).toLocaleString()}
                      </span>
                    )}
                  </div>
                  <p className="whitespace-pre-wrap text-xs leading-relaxed break-words" style={{ color: "var(--page-text)" }}>
                    {m.text || "—"}
                  </p>
                </div>
              ))}
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
