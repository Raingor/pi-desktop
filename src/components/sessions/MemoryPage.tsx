import { useState, useEffect, useMemo, useCallback } from "react";
import type { ReactNode } from "react";
import { useConfigStore } from "@/store/config-store";
import { useTranslation } from "@/lib/i18n";
import { Modal } from "@/components/ui/Modal";
import { piMemoryGet, piMemoryDeleteEntry } from "@/lib/tauri";
import {
  Brain,
  User,
  AlertTriangle,
  FileText,
  Calendar,
  RefreshCw,
  Search,
  Copy,
  Check,
  Trash2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

interface MemoryFile {
  name: string;
  filename: string;
  content: string;
  updatedAt: string;
}

interface MemoryEntry {
  text: string;
  created: string;
  last: string;
}

const FILE_ICONS: Record<string, typeof Brain> = {
  "MEMORY.md": Brain,
  "USER.md": User,
  "failures.md": AlertTriangle,
};

const FILE_COLORS: Record<string, string> = {
  "MEMORY.md": "#3b82f6",
  "USER.md": "#10b981",
  "failures.md": "#ef4444",
};

const FILE_LABEL_KEYS: Record<string, string> = {
  "MEMORY.md": "memory.project_memories",
  "USER.md": "memory.user_profile",
  "failures.md": "memory.failure_records",
};

/** Date groups expanded by default per file */
const DEFAULT_OPEN_GROUPS = 3;

/** Parse §-separated entries with `<!-- created=DATE, last=DATE -->` markers */
function parseMemoryEntries(content: string): MemoryEntry[] {
  const entries: MemoryEntry[] = [];
  const sections = content.split("§").filter((s) => s.trim().length > 0);

  for (const section of sections) {
    const trimmed = section.trim();
    // Match `<!-- created=DATE, last=DATE -->` at the end
    const markerMatch = trimmed.match(
      /<!--\s*created\s*=\s*([^,\s]+)\s*,\s*last\s*=\s*([^>\s]+)\s*-->\s*$/
    );
    if (markerMatch) {
      entries.push({
        text: trimmed.slice(0, markerMatch.index).trim(),
        created: markerMatch[1]?.trim() ?? "",
        last: markerMatch[2]?.trim() ?? "",
      });
    } else {
      // No date marker — treat as a standalone entry
      entries.push({ text: trimmed, created: "", last: "" });
    }
  }

  return entries;
}

/** Group entries by date (descending) */
function groupByDate(entries: MemoryEntry[]): Map<string, MemoryEntry[]> {
  const groups = new Map<string, MemoryEntry[]>();
  for (const entry of entries) {
    const dateKey = entry.created || entry.last || "other";
    if (!groups.has(dateKey)) groups.set(dateKey, []);
    groups.get(dateKey)!.push(entry);
  }
  return new Map(
    [...groups.entries()].sort((a, b) => {
      if (a[0] === "other") return 1;
      if (b[0] === "other") return -1;
      return b[0].localeCompare(a[0]);
    })
  );
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Highlight search matches inside a plain-text fragment */
function highlight(text: string, q: string): ReactNode {
  if (!q || !text) return text;
  const lower = text.toLowerCase();
  const parts: ReactNode[] = [];
  let pos = 0;
  let idx = lower.indexOf(q);
  while (idx !== -1) {
    if (idx > pos) parts.push(text.slice(pos, idx));
    parts.push(
      <mark
        key={`${idx}-${pos}`}
        className="rounded-sm px-0.5"
        style={{ backgroundColor: "rgba(250, 204, 21, 0.35)", color: "inherit" }}
      >
        {text.slice(idx, idx + q.length)}
      </mark>
    );
    pos = idx + q.length;
    idx = lower.indexOf(q, pos);
  }
  if (pos < text.length) parts.push(text.slice(pos));
  return parts;
}

/** Lightweight inline markdown: **bold**, `code`, [text](url). No external deps. */
function renderInline(text: string, q: string): ReactNode {
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\((?:https?:\/\/)[^)\s]+\))/g;
  const parts = text.split(re);
  return parts.map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) {
      return (
        <strong key={i} className="font-semibold">
          {highlight(part.slice(2, -2), q)}
        </strong>
      );
    }
    if (/^`[^`]+`$/.test(part)) {
      return (
        <code
          key={i}
          className="rounded border px-1 py-px text-[12px]"
          style={{
            borderColor: "var(--card-border)",
            backgroundColor: "var(--page-bg)",
            color: "var(--page-text)",
          }}
        >
          {highlight(part.slice(1, -1), q)}
        </code>
      );
    }
    const link = part.match(/^\[([^\]]+)\]\(((?:https?:\/\/)[^)\s]+)\)$/);
    if (link) {
      return (
        <a
          key={i}
          href={link[2]}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2"
          style={{ color: "#3b82f6" }}
        >
          {highlight(link[1] ?? "", q)}
        </a>
      );
    }
    return <span key={i}>{highlight(part, q)}</span>;
  });
}

function EntryCard({
  entry,
  q,
  onDelete,
}: {
  entry: MemoryEntry;
  q: string;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const markCopied = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    };
    navigator.clipboard.writeText(entry.text).then(markCopied).catch(() => {
      // Fallback for non-focused/insecure contexts
      const ta = document.createElement("textarea");
      ta.value = entry.text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        markCopied();
      } finally {
        document.body.removeChild(ta);
      }
    });
  };

  return (
    <div
      className="group relative rounded-lg border px-3.5 py-2.5"
      style={{ backgroundColor: "var(--card-bg)", borderColor: "var(--card-border)" }}
    >
      <p
        className="whitespace-pre-wrap pr-14 text-[13px] leading-relaxed"
        style={{ color: "var(--page-text)" }}
      >
        {renderInline(entry.text, q)}
      </p>
      {/* Hover actions: copy / delete */}
      <div className="absolute right-2 top-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={handleCopy}
          className="rounded p-1 transition-colors hover:bg-black/10"
          style={{ color: copied ? "#10b981" : "var(--muted-text)" }}
          title={copied ? t("memory.copied") : t("memory.copy")}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
        <button
          onClick={onDelete}
          className="rounded p-1 transition-colors hover:bg-black/10"
          style={{ color: "#ef4444" }}
          title={t("memory.delete")}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function MemoryFileSection({
  file,
  entries,
  q,
  onDeleteEntry,
}: {
  file: MemoryFile;
  entries: MemoryEntry[];
  q: string;
  onDeleteEntry: (entry: MemoryEntry) => void;
}) {
  const { t } = useTranslation();
  const Icon = FILE_ICONS[file.filename] || FileText;
  const color = FILE_COLORS[file.filename] || "#6b7280";
  // Collapse overrides: user toggles win over the default (first N groups open)
  const [openOverrides, setOpenOverrides] = useState<Record<string, boolean>>({});

  const grouped = useMemo(() => groupByDate(entries), [entries]);
  const labelKey = FILE_LABEL_KEYS[file.filename];

  const toggleGroup = (key: string, currentOpen: boolean) =>
    setOpenOverrides((prev) => ({ ...prev, [key]: !currentOpen }));

  return (
    <div>
      {/* File header */}
      <div
        className="flex items-center gap-2 pb-3"
        style={{ borderBottom: "1px solid var(--card-border)" }}
      >
        <Icon className="h-4 w-4" style={{ color }} />
        <h3 className="text-sm font-semibold" style={{ color: "var(--page-text)" }}>
          {labelKey ? t(labelKey) : file.name}
        </h3>
        <span
          className="rounded border px-1.5 py-0.5 text-[10px]"
          style={{
            borderColor: "var(--card-border)",
            color: "var(--muted-text)",
            backgroundColor: "var(--card-bg)",
          }}
        >
          {file.filename}
        </span>
        <span className="text-[11px]" style={{ color: "var(--muted-text)" }}>
          {t("memory.entries_count", String(entries.length))}
        </span>
        {file.updatedAt && (
          <span className="ml-auto text-[11px]" style={{ color: "var(--muted-text)" }}>
            {formatDate(file.updatedAt)}
          </span>
        )}
      </div>

      {/* Entries grouped by date */}
      {entries.length === 0 ? (
        <p className="mt-4 text-xs italic" style={{ color: "var(--muted-text)" }}>
          {t("memory.empty_file")}
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          {[...grouped.entries()].map(([dateKey, dateEntries], groupIdx) => {
            // Searching forces all matched groups open; otherwise first N open by default
            const open = q
              ? true
              : openOverrides[dateKey] ?? groupIdx < DEFAULT_OPEN_GROUPS;
            return (
              <div key={dateKey}>
                {/* Date header (click to collapse/expand) */}
                <button
                  onClick={() => toggleGroup(dateKey, open)}
                  className="mb-2.5 flex w-full items-center gap-2"
                  disabled={!!q}
                >
                  {open ? (
                    <ChevronDown className="h-3.5 w-3.5" style={{ color }} />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" style={{ color }} />
                  )}
                  <Calendar className="h-3.5 w-3.5" style={{ color }} />
                  <span
                    className="text-xs font-semibold uppercase tracking-wide"
                    style={{ color }}
                  >
                    {dateKey === "other" ? t("memory.other") : dateKey}
                  </span>
                  <div
                    className="h-px flex-1 opacity-50"
                    style={{ backgroundColor: "var(--card-border)" }}
                  />
                  <span
                    className="rounded border px-1.5 py-0.5 text-[10px]"
                    style={{
                      borderColor: "var(--card-border)",
                      color: "var(--muted-text)",
                      backgroundColor: "var(--card-bg)",
                    }}
                  >
                    {t("memory.entries_count", String(dateEntries.length))}
                  </span>
                </button>

                {/* Timeline entries */}
                {open && (
                  <div className="space-y-1.5 pl-2">
                    {dateEntries.map((entry, idx) => (
                      <EntryCard
                        key={`${dateKey}-${idx}`}
                        entry={entry}
                        q={q}
                        onDelete={() => onDeleteEntry(entry)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function MemoryPage() {
  const { t } = useTranslation();
  const { initialized } = useConfigStore();
  const [files, setFiles] = useState<MemoryFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ filename: string; entry: MemoryEntry } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadAll = useCallback(() => {
    if (!initialized) return;
    setRefreshing(true);
    piMemoryGet()
      .then((data) => {
        setFiles(data);
        setError(null);
      })
      .catch((e) => setError(String(e)))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, [initialized]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const success = await piMemoryDeleteEntry(deleteTarget.filename, deleteTarget.entry.text);
      if (success) {
        setDeleteTarget(null);
        loadAll();
      } else {
        alert(t("memory.delete_failed"));
      }
    } catch {
      alert(t("memory.delete_failed"));
    } finally {
      setDeleting(false);
    }
  };

  // Parse all files once; stats + search operate on parsed entries
  const parsed = useMemo(
    () =>
      files
        .filter((f) => f.content)
        .map((f) => ({ file: f, entries: parseMemoryEntries(f.content) })),
    [files]
  );

  const q = filter.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!q) return parsed;
    return parsed
      .map(({ file, entries }) => ({
        file,
        entries: entries.filter((e) => e.text.toLowerCase().includes(q)),
      }))
      .filter(({ entries }) => entries.length > 0);
  }, [parsed, q]);

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
        <p className="text-sm" style={{ color: "var(--error-text, #ef4444)" }}>
          {t("memory.load_failed")}: {error}
        </p>
      </div>
    );
  }

  const totalEntries = parsed.reduce((s, p) => s + p.entries.length, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--page-text)" }}>{t("memory.title")}</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--muted-text)" }}>
            {t("memory.summary", String(totalEntries), String(parsed.length))}
          </p>
        </div>
        <button
          onClick={loadAll}
          className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
          style={{ borderColor: "var(--card-border)", color: "var(--muted-text)", backgroundColor: "var(--card-bg)" }}
          title={t("memory.refresh")}
        >
          <RefreshCw className={refreshing ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
          {t("memory.refresh")}
        </button>
      </div>

      {parsed.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12">
          <Brain className="h-12 w-12" style={{ color: "var(--subtle-text)" }} />
          <p className="mt-4 text-sm" style={{ color: "var(--muted-text)" }}>{t("memory.no_memory")}</p>
          <p className="text-xs mt-1" style={{ color: "var(--subtle-text)" }}>{t("memory.no_memory_desc")}</p>
        </div>
      ) : (
        <>
          {/* Search */}
          <div className="relative max-w-md">
            <Search
              className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
              style={{ color: "var(--subtle-text)" }}
            />
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t("memory.search_placeholder")}
              className="w-full rounded-lg border py-2 pl-9 pr-3 text-sm outline-none focus:ring-1 focus:ring-blue-500"
              style={{
                backgroundColor: "var(--card-bg)",
                borderColor: "var(--card-border)",
                color: "var(--page-text)",
              }}
            />
          </div>

          {visible.length === 0 ? (
            <p className="py-8 text-center text-sm" style={{ color: "var(--muted-text)" }}>
              {t("memory.no_results")}
            </p>
          ) : (
            <div className="space-y-8">
              {visible.map(({ file, entries }) => (
                <MemoryFileSection
                  key={file.filename}
                  file={file}
                  entries={entries}
                  q={q}
                  onDeleteEntry={(entry) => setDeleteTarget({ filename: file.filename, entry })}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Delete entry confirm */}
      <Modal
        open={deleteTarget !== null}
        onClose={() => !deleting && setDeleteTarget(null)}
        title={t("memory.delete_title")}
        size="md"
      >
        {deleteTarget && (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
              <div className="min-w-0">
                <p className="text-sm text-gray-300">{t("memory.delete_confirm")}</p>
                <p className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap rounded border border-gray-700 bg-gray-800/60 px-3 py-2 text-xs text-gray-400">
                  {deleteTarget.entry.text.length > 300
                    ? deleteTarget.entry.text.slice(0, 300) + "…"
                    : deleteTarget.entry.text}
                </p>
                <p className="mt-2 text-xs text-red-400">{t("memory.delete_note")}</p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800"
              >
                {t("memory.cancel")}
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
              >
                {deleting ? t("memory.deleting") : t("memory.delete")}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
