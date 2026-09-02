import { useState, useEffect, useMemo, useCallback } from "react";
import type { ReactNode } from "react";
import { useConfigStore } from "@/store/config-store";
import { useTranslation } from "@/lib/i18n";
import { Modal } from "@/components/ui/Modal";
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
  Sparkles,
  Settings2,
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
  "MEMORY.md": "var(--signal-cyan)",
  "USER.md": "var(--success-text)",
  "failures.md": "var(--danger-text)",
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
    // Tolerate extra fields after `last=` (e.g. `, project64=...`) before `-->`
    const markerMatch = trimmed.match(
      /<!--\s*created\s*=\s*([^,\s>]+)\s*,\s*last\s*=\s*([^,\s>]+)[^>]*-->\s*$/
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
          style={{ color: "var(--signal-cyan)" }}
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
      className="memory-entry-card group relative rounded-lg border px-3.5 py-2.5"
      style={{ backgroundColor: "var(--card-bg)", borderColor: "var(--card-border)" }}
    >
      <p
        className="whitespace-pre-wrap pr-14 text-[13px] leading-relaxed"
        style={{ color: "var(--page-text)" }}
      >
        {renderInline(entry.text, q)}
      </p>
      {/* Hover actions: copy / delete */}
      <div className="memory-entry-actions absolute right-2 top-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={handleCopy}
          className="rounded p-1 transition-colors hover:bg-black/10"
          style={{ color: copied ? "var(--success-text)" : "var(--muted-text)" }}
          title={copied ? t("memory.copied") : t("memory.copy")}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
        <button
          onClick={onDelete}
          className="rounded p-1 transition-colors hover:bg-black/10"
          style={{ color: "var(--danger-text)" }}
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
    <div className="memory-file-section">
      {/* File header */}
      <div
        className="memory-file-header flex items-center gap-2 pb-3"
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
                  <div className="memory-timeline space-y-1.5 pl-2">
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
  const { initialized, allModels, allProviders } = useConfigStore();
  const [files, setFiles] = useState<MemoryFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ filename: string; entry: MemoryEntry } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // One-click optimize (memory consolidation)
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeMsg, setOptimizeMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [optimizeElapsed, setOptimizeElapsed] = useState(0);

  // Auto-write memory model config
  const [showConfig, setShowConfig] = useState(false);
  const [cfg, setCfg] = useState<{ llmModelOverride: string; llmThinkingOverride: string; consolidationTimeoutMs: number; memoryCharLimit: number; userCharLimit: number; memoryOverflowStrategy: string }>(
    { llmModelOverride: "", llmThinkingOverride: "off", consolidationTimeoutMs: 600000, memoryCharLimit: 5000, userCharLimit: 5000, memoryOverflowStrategy: "auto-consolidate" }
  );
  const [cfgSaving, setCfgSaving] = useState(false);
  const [cfgMsg, setCfgMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Capacity status (per-target chars vs limit) for progress bars
  const [status, setStatus] = useState<{ filename: string; target: string; chars: number; limit: number }[]>([]);

  // Models eligible as the memory-write model: custom providers, plus built-in
  // providers that have an API key actually saved (hasAuth). Built-ins without
  // a key can't run, so they're excluded from the dropdown.
  const eligibleModels = useMemo(() => {
    const usableProviderIds = new Set(
      allProviders.filter((p) => p.type === "custom" || p.hasAuth).map((p) => p.id)
    );
    return allModels.filter((m) => usableProviderIds.has(m.providerId));
  }, [allModels, allProviders]);
  const loadStatus = useCallback(() => {
    fetch("/api/pi/memory/status")
      .then((r) => r.json())
      .then((s: { targets?: { filename: string; target: string; chars: number; limit: number }[] }) => setStatus(s.targets ?? []))
      .catch(() => {});
  }, []);

  const loadAll = useCallback(() => {
    if (!initialized) return;
    setRefreshing(true);
    fetch("/api/pi/memory")
      .then((r) => r.json())
      .then((data) => {
        setFiles(data);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, [initialized]);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { loadStatus(); }, [loadStatus]);

  // Load the hermes auto-write model config once.
  useEffect(() => {
    fetch("/api/pi/memory/config")
      .then((r) => r.json())
      .then((c: { llmModelOverride?: string; llmThinkingOverride?: string; consolidationTimeoutMs?: number; memoryCharLimit?: number; userCharLimit?: number; memoryOverflowStrategy?: string }) =>
        setCfg({
          llmModelOverride: c.llmModelOverride ?? "",
          llmThinkingOverride: c.llmThinkingOverride ?? "off",
          consolidationTimeoutMs: c.consolidationTimeoutMs ?? 600000,
          memoryCharLimit: c.memoryCharLimit ?? 5000,
          userCharLimit: c.userCharLimit ?? 5000,
          memoryOverflowStrategy: c.memoryOverflowStrategy ?? "auto-consolidate",
        })
      )
      .catch(() => {});
  }, []);

  const formatBytes = (n: number) => {
    const abs = Math.abs(n);
    if (abs >= 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${n} B`;
  };

  const handleOptimize = async () => {
    setOptimizing(true);
    setOptimizeMsg(null);
    setOptimizeElapsed(0);
    // While the consolidation child runs, poll capacity + elapsed so the user
    // sees the bars move and a running timer instead of a frozen spinner.
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setOptimizeElapsed(Math.round((Date.now() - startedAt) / 1000));
      loadStatus();
    }, 2000);
    try {
      const res = await fetch("/api/pi/memory/optimize", { method: "POST" });
      const result = (await res.json()) as { success: boolean; freedBytes?: number; message?: string };
      if (result.success) {
        const freed = result.freedBytes ?? 0;
        setOptimizeMsg({ ok: true, text: freed > 0 ? t("memory.optimize_done", formatBytes(freed)) : t("memory.optimize_none") });
        loadAll();
        loadStatus();
      } else {
        setOptimizeMsg({ ok: false, text: t("memory.optimize_failed", result.message ?? "") });
      }
    } catch (e) {
      setOptimizeMsg({ ok: false, text: t("memory.optimize_failed", e instanceof Error ? e.message : "") });
    } finally {
      window.clearInterval(timer);
      setOptimizing(false);
    }
  };

  const handleSaveConfig = async () => {
    setCfgSaving(true);
    setCfgMsg(null);
    try {
      const res = await fetch("/api/pi/memory/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          llmModelOverride: cfg.llmModelOverride.trim(),
          llmThinkingOverride: cfg.llmThinkingOverride,
          consolidationTimeoutMs: cfg.consolidationTimeoutMs,
          memoryCharLimit: cfg.memoryCharLimit,
          userCharLimit: cfg.userCharLimit,
          memoryOverflowStrategy: cfg.memoryOverflowStrategy,
        }),
      });
      const { success } = (await res.json()) as { success: boolean };
      setCfgMsg({ ok: !!success, text: success ? t("memory.config_saved") : t("memory.config_save_failed") });
      if (success) {
        loadStatus();
        // Close the modal shortly after showing the success message.
        setTimeout(() => setShowConfig(false), 600);
      }
    } catch {
      setCfgMsg({ ok: false, text: t("memory.config_save_failed") });
    } finally {
      setCfgSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/pi/memory/delete-entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: deleteTarget.filename, text: deleteTarget.entry.text }),
      });
      const result = await res.json();
      if (result.success) {
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
  const totalChars = parsed.reduce((sum, item) => sum + item.file.content.length, 0);
  const latestFile = [...parsed].sort((a, b) => (b.file.updatedAt || "").localeCompare(a.file.updatedAt || ""))[0]?.file;

  return (
    <div className="memory-page space-y-6">
      <div className="memory-command-header flex items-start justify-between">
        <div>
          <div className="page-kicker"><span /> {t("memory.knowledge_synced")}</div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--page-text)" }}>{t("memory.title")}</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--muted-text)" }}>
            {t("memory.summary", String(totalEntries), String(parsed.length))}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleOptimize}
            disabled={optimizing || parsed.length === 0}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
            style={{ borderColor: "var(--card-border)", color: "var(--muted-text)", backgroundColor: "var(--card-bg)" }}
            title={t("memory.optimize_hint")}
          >
            <Sparkles className={optimizing ? "h-3.5 w-3.5 animate-pulse" : "h-3.5 w-3.5"} />
            {optimizing ? t("memory.optimizing") : t("memory.optimize")}
          </button>
          <button
            onClick={() => { setCfgMsg(null); setShowConfig(true); }}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
            style={{ borderColor: "var(--card-border)", color: "var(--muted-text)", backgroundColor: "var(--card-bg)" }}
            title={t("memory.config")}
          >
            <Settings2 className="h-3.5 w-3.5" />
            {t("memory.config")}
          </button>
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
      </div>

      {(optimizing || optimizeMsg || status.length > 0) && (
        <div className="tech-panel space-y-3 rounded-xl border px-4 py-3" style={{ borderColor: "var(--card-border)", backgroundColor: "var(--card-bg)" }}>
          {/* Per-target capacity bars */}
          <div className="space-y-2">
            {status.map((s) => {
              const pct = s.limit > 0 ? Math.min(100, Math.round((s.chars / s.limit) * 100)) : 0;
              const over = s.chars > s.limit;
              const barColor = over ? "var(--danger-text)" : pct > 80 ? "var(--warn-text)" : "var(--success-text)";
              const label = FILE_LABEL_KEYS[s.filename] ? t(FILE_LABEL_KEYS[s.filename]!) : s.filename;
              return (
                <div key={s.filename}>
                  <div className="mb-1 flex items-center justify-between text-[11px]" style={{ color: "var(--muted-text)" }}>
                    <span>{label} <span style={{ color: "var(--subtle-text)" }}>· {s.filename}</span></span>
                    <span style={{ color: over ? "var(--danger-text)" : "var(--muted-text)" }}>
                      {s.chars} / {s.limit} ({pct}%)
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full" style={{ backgroundColor: "var(--page-bg)" }}>
                    <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: barColor }} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Optimize progress / result line */}
          {optimizing && (
            <div className="flex items-center gap-2 text-xs" style={{ color: "var(--muted-text)" }}>
              <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-500 border-t-transparent" />
              <span>{t("memory.optimizing")} · {optimizeElapsed}s</span>
            </div>
          )}
          {!optimizing && optimizeMsg && (
            <div className="text-xs" style={{ color: optimizeMsg.ok ? "var(--success-text)" : "var(--danger-text)" }}>
              {optimizeMsg.text}
            </div>
          )}
        </div>
      )}

      {parsed.length === 0 ? (
        <div className="memory-empty-state">
          <div className="memory-empty-radar"><Brain className="h-7 w-7" /></div>
          <p className="mt-4 text-sm" style={{ color: "var(--muted-text)" }}>{t("memory.no_memory")}</p>
          <p className="text-xs mt-1" style={{ color: "var(--subtle-text)" }}>{t("memory.no_memory_desc")}</p>
        </div>
      ) : (
        <>
          <div className="memory-readout-grid">
            <div className="tech-panel memory-readout-card"><span>{t("memory.files_indexed")}</span><strong>{parsed.length}</strong><small>{t("memory.summary", String(totalEntries), String(parsed.length))}</small></div>
            <div className="tech-panel memory-readout-card"><span>{t("memory.entry_count")}</span><strong>{totalEntries}</strong><small>{formatDate(latestFile?.updatedAt || "")}</small></div>
            <div className="tech-panel memory-readout-card"><span>{t("memory.text_volume")}</span><strong>{totalChars > 1000 ? `${(totalChars / 1000).toFixed(1)}K` : totalChars}</strong><small>{t("memory.characters_indexed")}</small></div>
          </div>

          <div className="memory-toolbar tech-panel">
            <div className="memory-file-jump">
              <span className="memory-toolbar-label">{t("memory.channels")}</span>
              {parsed.map(({ file, entries }) => {
                const Icon = FILE_ICONS[file.filename] || FileText;
                return <a key={file.filename} href={`#memory-${file.filename}`} className="memory-file-chip"><Icon className="h-3.5 w-3.5" />{file.filename}<b>{entries.length}</b></a>;
              })}
            </div>
            {/* Search */}
            <div className="relative memory-search">
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
          </div>

          {visible.length === 0 ? (
            <p className="py-8 text-center text-sm" style={{ color: "var(--muted-text)" }}>
              {t("memory.no_results")}
            </p>
          ) : (
            <div className="memory-sections">
              {visible.map(({ file, entries }) => (
                <div key={file.filename} id={`memory-${file.filename}`} className="memory-file-panel tech-panel">
                <MemoryFileSection
                  key={file.filename}
                  file={file}
                  entries={entries}
                  q={q}
                  onDeleteEntry={(entry) => setDeleteTarget({ filename: file.filename, entry })}
                />
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Auto-write memory model config */}
      <Modal
        open={showConfig}
        onClose={() => !cfgSaving && setShowConfig(false)}
        title={t("memory.config_title")}
        size="md"
      >
        <div className="space-y-4">
          <p className="text-xs" style={{ color: "var(--muted-text)" }}>{t("memory.config_desc")}</p>
          <div>
            <label className="mb-1 block text-xs" style={{ color: "var(--muted-text)" }}>{t("memory.config_model")}</label>
            <select
              value={cfg.llmModelOverride}
              onChange={(e) => setCfg({ ...cfg, llmModelOverride: e.target.value })}
              className="w-full rounded-lg border px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-blue-500"
              style={{ backgroundColor: "var(--card-bg)", borderColor: "var(--card-border)", color: "var(--page-text)" }}
            >
              <option value="">{t("memory.config_model_default")}</option>
              {/* If the saved model isn't in the current model list (e.g. a
                  provider was removed), still show it so it isn't silently lost. */}
              {cfg.llmModelOverride &&
                !eligibleModels.some((m) => `${m.providerId}/${m.id}` === cfg.llmModelOverride) && (
                  <option value={cfg.llmModelOverride}>{cfg.llmModelOverride}</option>
                )}
              {eligibleModels.map((m) => (
                <option key={`${m.providerId}/${m.id}`} value={`${m.providerId}/${m.id}`}>
                  {m.providerName} · {m.name ?? m.id}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="mb-1 block text-xs" style={{ color: "var(--muted-text)" }}>{t("memory.config_thinking")}</label>
              <select
                value={cfg.llmThinkingOverride}
                onChange={(e) => setCfg({ ...cfg, llmThinkingOverride: e.target.value })}
                className="w-full rounded-lg border px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-blue-500"
                style={{ backgroundColor: "var(--card-bg)", borderColor: "var(--card-border)", color: "var(--page-text)" }}
              >
                {["off", "minimal", "low", "medium", "high", "xhigh"].map((lvl) => (
                  <option key={lvl} value={lvl}>{lvl}</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-xs" style={{ color: "var(--muted-text)" }}>{t("memory.config_timeout")}</label>
              <input
                type="number"
                min={60}
                value={Math.round(cfg.consolidationTimeoutMs / 1000)}
                onChange={(e) => setCfg({ ...cfg, consolidationTimeoutMs: Math.max(60, Number(e.target.value) || 0) * 1000 })}
                className="w-full rounded-lg border px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-blue-500"
                style={{ backgroundColor: "var(--card-bg)", borderColor: "var(--card-border)", color: "var(--page-text)" }}
              />
            </div>
          </div>
          {/* Capacity limits */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="mb-1 block text-xs" style={{ color: "var(--muted-text)" }}>{t("memory.config_mem_limit")}</label>
              <input
                type="number"
                min={1000}
                step={500}
                value={cfg.memoryCharLimit}
                onChange={(e) => setCfg({ ...cfg, memoryCharLimit: Math.max(1000, Number(e.target.value) || 0) })}
                className="w-full rounded-lg border px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-blue-500"
                style={{ backgroundColor: "var(--card-bg)", borderColor: "var(--card-border)", color: "var(--page-text)" }}
              />
              <p className="mt-1 text-[10px]" style={{ color: "var(--subtle-text)" }}>{t("memory.config_mem_limit_hint", String(cfg.memoryCharLimit * 2))}</p>
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-xs" style={{ color: "var(--muted-text)" }}>{t("memory.config_user_limit")}</label>
              <input
                type="number"
                min={1000}
                step={500}
                value={cfg.userCharLimit}
                onChange={(e) => setCfg({ ...cfg, userCharLimit: Math.max(1000, Number(e.target.value) || 0) })}
                className="w-full rounded-lg border px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-blue-500"
                style={{ backgroundColor: "var(--card-bg)", borderColor: "var(--card-border)", color: "var(--page-text)" }}
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs" style={{ color: "var(--muted-text)" }}>{t("memory.config_overflow")}</label>
            <select
              value={cfg.memoryOverflowStrategy}
              onChange={(e) => setCfg({ ...cfg, memoryOverflowStrategy: e.target.value })}
              className="w-full rounded-lg border px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-blue-500"
              style={{ backgroundColor: "var(--card-bg)", borderColor: "var(--card-border)", color: "var(--page-text)" }}
            >
              <option value="auto-consolidate">{t("memory.config_overflow_auto")}</option>
              <option value="reject">{t("memory.config_overflow_reject")}</option>
              <option value="fifo-evict">{t("memory.config_overflow_fifo")}</option>
            </select>
          </div>
          <div className="flex items-center justify-end gap-3">
            {cfgMsg && (
              <span className="text-xs" style={{ color: cfgMsg.ok ? "var(--success-text)" : "var(--danger-text)" }}>{cfgMsg.text}</span>
            )}
            <button
              onClick={() => setShowConfig(false)}
              disabled={cfgSaving}
              className="rounded-lg border px-4 py-2 text-sm"
              style={{ borderColor: "var(--card-border)", color: "var(--muted-text)" }}
            >
              {t("memory.config_cancel")}
            </button>
            <button
              onClick={handleSaveConfig}
              disabled={cfgSaving}
              className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              style={{ backgroundColor: "var(--accent-solid)" }}
            >
              {cfgSaving ? t("memory.config_saving") : t("memory.config_save")}
            </button>
          </div>
        </div>
      </Modal>

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
