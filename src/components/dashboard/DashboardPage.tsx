import { useState, useEffect, useCallback, useMemo } from "react";
import { useConfigStore } from "@/store/config-store";
import { useTranslation } from "@/lib/i18n";
import { useCurrency } from "@/lib/currency";
import { usePolling } from "@/hooks/usePolling";
import { formatCost, formatNumber, cn, USD_TO_CNY } from "@/lib/utils";
import {
  Activity, DollarSign, BarChart3, ArrowUp, ArrowDown, Database, DollarSignIcon, RefreshCw, Download,
  Gauge, Layers3, Clock3, Zap, CircleDollarSign, Cpu, PieChart as PieChartIcon,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend, BarChart, Bar, PieChart, Pie, Cell,
} from "recharts";

// ─── Types ──────────────────────────────────────────────

interface CodexUsageStatus {
  loggedIn: boolean;
  provider: "openai-codex";
  planType?: string;
  primary?: { windowSeconds: number; usedPercent: number; remainingPercent: number; resetAfterSeconds: number | null; resetAt: number | null };
  secondary?: { windowSeconds: number; usedPercent: number; remainingPercent: number; resetAfterSeconds: number | null; resetAt: number | null };
  checkedAt: string;
  error?: string;
}

function formatRemainingTime(seconds: number | null | undefined): string | null {
  if (typeof seconds !== "number" || seconds < 0) return null;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function formatResetAt(unixSeconds: number | null | undefined, lang: string): string | null {
  if (typeof unixSeconds !== "number" || unixSeconds <= 0) return null;
  return new Intl.DateTimeFormat(lang, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(unixSeconds * 1000));
}

interface UsageRangeData {
  totalTokens: number;
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  totalCacheWrite: number;
  totalCost: number;
  totalRequests: number;
  cacheHitRate: number;
  dailyBreakdown: {
    date: string;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost: number;
    requests: number;
  }[];
  hourlyBreakdown: {
    hour: string;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost: number;
    requests: number;
  }[];
  requestLog: {
    timestamp: string;
    providerId: string;
    modelId: string;
    input: number;
    output: number;
    cost: number;
    requests: number;
  }[];
  providerStats: {
    providerId: string;
    totalTokens: number;
    totalInput: number;
    totalOutput: number;
    totalCost: number;
    totalRequests: number;
    modelCount: number;
  }[];
  modelStats: {
    modelId: string;
    providerId: string;
    totalTokens: number;
    totalInput: number;
    totalOutput: number;
    totalCost: number;
    totalRequests: number;
  }[];
  notice?: "no-config" | "api-error";
}

type SourceKey = "pi" | "chatgpt";
type RangeKey = "today" | "7d" | "30d" | "custom";
type TabKey = "log" | "provider" | "model";
type SortDir = "asc" | "desc";

const RANGE_KEYS: RangeKey[] = ["today", "7d", "30d", "custom"];

const COLORS = ["#3f6fd8", "#9dc47a", "#e0a94e", "#a89af0", "#e87a7a"];

const CHART_LINE_COLORS: Record<string, string> = {
  input: "#3f6fd8",
  output: "#9dc47a",
  cacheRead: "#a89af0",
  cacheWrite: "#e0a94e",
  cost: "#e87a7a",
};

const LOG_PAGE_SIZE = 20;

// ─── Helpers ────────────────────────────────────────────

function formatTokensShort(n: number, lang: string = "en"): string {
  // 中文：亿 / 万
  if (lang.startsWith("zh")) {
    if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(2)}亿`;
    if (n >= 10_000) return `${(n / 10_000).toFixed(1)}万`;
    return n.toLocaleString("zh-CN");
  }
  // 日文：億 / 万
  if (lang.startsWith("ja")) {
    if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(2)}億`;
    if (n >= 10_000) return `${(n / 10_000).toFixed(1)}万`;
    return n.toLocaleString("ja-JP");
  }
  // 英文：M / K
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function formatCostShort(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `¢${(n * 100).toFixed(1)}`;
  return `$${n.toFixed(4)}`;
}

function formatDateShort(dateStr: string): string {
  // The date is already a calendar date in the reporting timezone, so read it
  // back as UTC and format it as UTC — anything else re-shifts it by a day.
  const [y, m, dNum] = dateStr.split("-").map(Number);
  if (!y || !m || !dNum) return dateStr;
  const d = new Date(Date.UTC(y, m - 1, dNum));
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * "YYYY-MM-DD" for today in the machine's timezone.
 *
 * Must agree with the server's bucketing (`reportDateParts` in
 * server/pi-reader.ts), which also uses the machine's timezone. Both sides
 * were pinned to Asia/Shanghai before, which put anyone outside UTC+8 in the
 * wrong day.
 */
function todayStr(): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Previous period of equal length, for period-over-period trends. */
function getPrevRange(range: RangeKey): { from: string; to: string } | null {
  const shift = (days: number) => {
    // Start from today's calendar date and shift by whole days using UTC math.
    const [y, m, dNum] = todayStr().split("-").map(Number);
    const t = Date.UTC(y ?? 0, (m ?? 1) - 1, dNum ?? 1) - days * 86400000;
    const d = new Date(t);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  };
  if (range === "today") return { from: shift(1), to: shift(1) };
  if (range === "7d") return { from: shift(13), to: shift(7) };
  if (range === "30d") return { from: shift(59), to: shift(30) };
  return null; // custom: no comparable previous period
}

function sortRows<T extends Record<string, unknown>>(rows: T[], key: string, dir: SortDir): T[] {
  return [...rows].sort((a, b) => {
    const av = Number(a[key] ?? 0);
    const bv = Number(b[key] ?? 0);
    return dir === "desc" ? bv - av : av - bv;
  });
}

function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers, ...rows].map((r) => r.map(esc).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ─── Stat Card ──────────────────────────────────────────

function StatCard({
  title,
  value,
  subtitle,
  icon,
  trend,
  trendLabel,
  progress,
  children,
  className,
}: {
  title: string;
  value: string;
  subtitle?: string;
  icon: React.ReactNode;
  trend?: number;
  trendLabel?: string;
  progress?: number;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("tech-panel dashboard-stat-card p-5", className)} style={{ borderColor: "var(--card-border)", backgroundColor: "var(--card-bg)" }}>
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--muted-text)" }}>{title}</p>
        <div className="rounded-lg p-2" style={{ backgroundColor: "var(--accent-bg)" }}>
          {icon}
        </div>
      </div>
      <p className="text-2xl font-bold tracking-tight" style={{ color: "var(--page-text)" }}>{value}</p>
      {subtitle && <p className="text-xs mt-1" style={{ color: "var(--subtle-text)" }}>{subtitle}</p>}
      {trend !== undefined && (
        <div className="flex items-center gap-1 mt-2">
          {trend >= 0 ? (
            <ArrowUp className="h-3 w-3 text-emerald-400" />
          ) : (
            <ArrowDown className="h-3 w-3 text-red-400" />
          )}
          <span className={cn("text-xs font-medium", trend >= 0 ? "text-emerald-400" : "text-red-400")}>
            {Math.abs(trend).toFixed(1)}%
          </span>
          {trendLabel && <span className="text-xs" style={{ color: "var(--subtle-text)" }}>{trendLabel}</span>}
        </div>
      )}
      {progress !== undefined && (
        <div className="mt-2 h-1.5 w-full rounded-full" style={{ backgroundColor: "var(--card-border)" }}>
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${Math.min(progress, 100)}%`, backgroundColor: progress > 90 ? "var(--success-text)" : "var(--signal-cyan)" }}
          />
        </div>
      )}
      {children}
    </div>
  );
}

// ─── Breakdown Row ──────────────────────────────────────

function BreakdownRow({ label, value, total, color, lang = "en" }: { label: string; value: number; total: number; color: string; lang?: string }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div className="flex items-center justify-between py-1.5">
      <div className="flex items-center gap-2">
        <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-xs" style={{ color: "var(--muted-text)" }}>{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium" style={{ color: "var(--page-text)" }}>{formatTokensShort(value, lang)}</span>
        <span className="text-xs" style={{ color: "var(--subtle-text)" }}>({pct.toFixed(1)}%)</span>
      </div>
    </div>
  );
}

// ─── Sortable Table Header ──────────────────────────────

function SortableTh({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  sortKey: string;
  sort: { key: string; dir: SortDir };
  onSort: (key: string) => void;
}) {
  const active = sort.key === sortKey;
  return (
    <th
      className="px-4 py-3 text-right font-medium cursor-pointer select-none"
      style={{ color: active ? "var(--signal-cyan)" : "var(--muted-text)" }}
      onClick={() => onSort(sortKey)}
    >
      <span className="inline-flex items-center gap-0.5">
        {label}
        {active && (sort.dir === "desc" ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
      </span>
    </th>
  );
}

// ─── Analytics Components ───────────────────────────────

function AnalyticsMetric({
  label,
  value,
  detail,
  icon,
  accent = "var(--signal-cyan)",
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
  accent?: string;
}) {
  return (
    <div className="analytics-metric">
      <div className="analytics-metric-icon" style={{ color: accent, borderColor: `${accent}38`, backgroundColor: `${accent}12` }}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="analytics-metric-label">{label}</p>
        <p className="analytics-metric-value">{value}</p>
        <p className="analytics-metric-detail">{detail}</p>
      </div>
    </div>
  );
}

function DistributionRow({
  name,
  meta,
  percentage,
  color,
  valueLabel,
}: {
  name: string;
  meta: string;
  percentage: number;
  color: string;
  valueLabel: string;
}) {
  return (
    <div className="distribution-row">
      <div className="distribution-row-head">
        <div className="min-w-0">
          <span className="distribution-name">{name}</span>
          <span className="distribution-meta">{meta}</span>
        </div>
        <span className="distribution-value">{valueLabel}</span>
      </div>
      <div className="distribution-track">
        <span style={{ width: `${Math.max(percentage, percentage > 0 ? 1.5 : 0)}%`, backgroundColor: color }} />
      </div>
      <span className="distribution-percent">{percentage.toFixed(1)}%</span>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────

export function DashboardPage() {
  const { t, lang } = useTranslation();
  const { currency, toggle: toggleCurrency } = useCurrency();
  const { initialized } = useConfigStore();
  const [source, setSource] = useState<SourceKey>("pi");
  const [range, setRange] = useState<RangeKey>("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [tab, setTab] = useState<TabKey>("log");
  const [data, setData] = useState<UsageRangeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshInterval, setRefreshInterval] = useState(30);
  const [showIntervalPicker, setShowIntervalPicker] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [logPage, setLogPage] = useState(1);
  const [providerSort, setProviderSort] = useState<{ key: string; dir: SortDir }>({ key: "totalCost", dir: "desc" });
  const [modelSort, setModelSort] = useState<{ key: string; dir: SortDir }>({ key: "totalCost", dir: "desc" });
  const [prevTotals, setPrevTotals] = useState<{ tokens: number; cost: number } | null>(null);
  const [codexUsage, setCodexUsage] = useState<CodexUsageStatus | null>(null);

  const customInvalid = range === "custom" && !!customFrom && !!customTo && customFrom > customTo;

  const fetchData = useCallback((force = false) => {
    if (!initialized || customInvalid) return;
    const baseUrl = source === "chatgpt"
      ? "/api/pi/chatgpt-usage-range"
      : "/api/pi/usage-range";
    // force=true adds refresh=1 so the API rescan bypasses its 30s session cache
    let url = `${baseUrl}?range=${range}${force ? "&refresh=1" : ""}`;
    if (range === "custom" && customFrom) {
      url += `&from=${customFrom}&to=${customTo || customFrom}`;
    }
    setRefreshing(true);
    fetch(url)
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
        setRefreshing(false);
        setLastUpdated(new Date().toLocaleTimeString());
      })
      .catch(() => { setLoading(false); setRefreshing(false); });

    // Previous period of equal length → period-over-period trend on stat cards
    const prev = getPrevRange(range);
    if (prev) {
      fetch(`${baseUrl}?range=custom&from=${prev.from}&to=${prev.to}`)
        .then((r) => r.json())
        .then((p) => setPrevTotals({ tokens: p.totalTokens ?? 0, cost: p.totalCost ?? 0 }))
        .catch(() => setPrevTotals(null));
    } else {
      setPrevTotals(null);
    }
  }, [initialized, source, range, customFrom, customTo, customInvalid]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Official Codex quotas use the locally logged-in OAuth session. The API
  // returns only a sanitized summary; OAuth credentials never reach the UI.
  usePolling(() => {
    fetch("/api/pi/codex-usage-status")
      .then((r) => r.json())
      .then((status: CodexUsageStatus) => setCodexUsage(status))
      .catch(() => setCodexUsage(null));
  }, 30_000);

  // Reset request-log pagination when the queried range or source changes
  useEffect(() => { setLogPage(1); }, [range, customFrom, customTo, source]);

  // Reset loading state when source changes
  useEffect(() => { setLoading(true); }, [source]);

  // Auto-refresh with configurable interval (seconds)
  // The initial fetch is handled above; this only adds the repeat, so a hidden
  // window does not keep re-scanning session files behind the user's back.
  usePolling(fetchData, refreshInterval * 1000, autoRefresh && refreshInterval > 0);

  const today = todayStr();

  // Chart data: hourly for "today", daily for 7d/30d/custom
  const rawBreakdown = range === "today" ? data?.hourlyBreakdown : data?.dailyBreakdown;
  const chartData = (rawBreakdown ?? []).map((d: any) => ({
    date: range === "today" ? d.hour?.slice(-5) : formatDateShort(d.date || d.hour),
    rawDate: d.date || d.hour,
    input: Math.round(d.input / 1000),
    output: Math.round(d.output / 1000),
    cacheRead: Math.round(d.cacheRead / 1000),
    cacheWrite: Math.round(d.cacheWrite / 1000),
    cost: parseFloat(d.cost.toFixed(4)),
    requests: d.requests,
  }));

  // Period-over-period trends (undefined → hidden)
  const tokenTrend = data && prevTotals && prevTotals.tokens > 0
    ? ((data.totalTokens - prevTotals.tokens) / prevTotals.tokens) * 100
    : undefined;
  const costTrend = data && prevTotals && prevTotals.cost > 0
    ? ((data.totalCost - prevTotals.cost) / prevTotals.cost) * 100
    : undefined;

  // Sorted stats + request-log pagination
  const sortedProviders = sortRows(data?.providerStats ?? [], providerSort.key, providerSort.dir);
  const sortedModels = sortRows(data?.modelStats ?? [], modelSort.key, modelSort.dir);
  const providerTotalCost = (data?.providerStats ?? []).reduce((s, p) => s + p.totalCost, 0);
  const totalLogPages = Math.max(1, Math.ceil((data?.requestLog.length ?? 0) / LOG_PAGE_SIZE));
  const currentLogPage = Math.min(logPage, totalLogPages);
  const pagedLog = (data?.requestLog ?? []).slice((currentLogPage - 1) * LOG_PAGE_SIZE, currentLogPage * LOG_PAGE_SIZE);

  const analytics = useMemo(() => {
    const current = data ?? {
      totalTokens: 0,
      totalInput: 0,
      totalOutput: 0,
      totalCacheRead: 0,
      totalCacheWrite: 0,
      totalCost: 0,
      totalRequests: 0,
      cacheHitRate: 0,
      dailyBreakdown: [],
      hourlyBreakdown: [],
      requestLog: [],
      providerStats: [],
      modelStats: [],
    };
    const totalTokens = Math.max(current.totalTokens, 0);
    const totalRequests = Math.max(current.totalRequests, 0);
    const cacheTokens = current.totalCacheRead + current.totalCacheWrite;
    const activitySource = range === "today" ? current.hourlyBreakdown : current.dailyBreakdown;
    const peak = activitySource.reduce<{ label: string; requests: number; tokens: number } | null>((best, row: any) => {
      const requests = row.requests ?? 0;
      const tokens = (row.input ?? 0) + (row.output ?? 0) + (row.cacheRead ?? 0) + (row.cacheWrite ?? 0);
      const label = range === "today" ? String(row.hour ?? "").slice(-5) : formatDateShort(row.date || row.hour || "");
      if (!best || requests > best.requests || (requests === best.requests && tokens > best.tokens)) {
        return { label, requests, tokens };
      }
      return best;
    }, null);
    const providers = current.providerStats.filter((provider) => provider.totalRequests > 0).sort((a, b) => b.totalTokens - a.totalTokens);
    const models = current.modelStats.filter((model) => model.totalRequests > 0).sort((a, b) => b.totalTokens - a.totalTokens);
    const providerTokenTotal = providers.reduce((sum, provider) => sum + provider.totalTokens, 0);
    const composition = [
      { key: "input", value: current.totalInput, color: CHART_LINE_COLORS.input },
      { key: "output", value: current.totalOutput, color: CHART_LINE_COLORS.output },
      { key: "cacheRead", value: current.totalCacheRead, color: CHART_LINE_COLORS.cacheRead },
      { key: "cacheWrite", value: current.totalCacheWrite, color: CHART_LINE_COLORS.cacheWrite },
    ];
    return {
      totalTokens,
      avgTokens: totalRequests > 0 ? totalTokens / totalRequests : 0,
      avgCost: totalRequests > 0 ? current.totalCost / totalRequests : 0,
      cacheTokens,
      cacheShare: totalTokens > 0 ? (cacheTokens / totalTokens) * 100 : 0,
      activeProviders: providers.length,
      activeModels: models.length,
      peak,
      providers,
      models,
      providerTokenTotal,
      composition,
      activity: activitySource.map((row: any) => ({
        label: range === "today" ? String(row.hour ?? "").slice(-5) : formatDateShort(row.date || row.hour || ""),
        requests: row.requests ?? 0,
        tokens: Math.round(((row.input ?? 0) + (row.output ?? 0) + (row.cacheRead ?? 0) + (row.cacheWrite ?? 0)) / 1000),
      })),
    };
  }, [data, range]);

  const fmtCostCell = (v: number) => (currency === "CNY" ? `¥${(v * USD_TO_CNY).toFixed(4)}` : formatCostShort(v));

  const toggleSort = (setter: typeof setProviderSort) => (key: string) =>
    setter((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));

  const handleExport = () => {
    if (!data) return;
    if (tab === "log") {
      downloadCsv(`pi-usage-log-${range}.csv`,
        ["time", "provider", "model", "input", "output", "cost_usd", "requests"],
        data.requestLog.map((r) => [r.timestamp, r.providerId, r.modelId, r.input, r.output, r.cost, r.requests]));
    } else if (tab === "provider") {
      downloadCsv(`pi-usage-provider-${range}.csv`,
        ["provider", "tokens", "input", "output", "cost_usd", "requests", "models"],
        sortedProviders.map((p) => [p.providerId, p.totalTokens, p.totalInput, p.totalOutput, p.totalCost, p.totalRequests, p.modelCount]));
    } else {
      downloadCsv(`pi-usage-model-${range}.csv`,
        ["model", "provider", "tokens", "input", "output", "cost_usd", "requests"],
        sortedModels.map((m) => [m.modelId, m.providerId, m.totalTokens, m.totalInput, m.totalOutput, m.totalCost, m.totalRequests]));
    }
  };

  return (
    <div className="dashboard-page space-y-5">
      {/* Title + Time Range Selector + Currency Toggle */}
      <div className="dashboard-command-header flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="page-kicker"><span /> TELEMETRY // LIVE OPERATIONS</div>
          <h1 className="text-xl font-bold" style={{ color: "var(--page-text)" }}>{t("dashboard.title")}</h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--muted-text)" }}>
            {data ? t("dashboard.requests_count", String(data.requestLog.length), formatCost(data.totalCost, currency)) : ""}
            {lastUpdated && <span className="ml-2">· {t("dashboard.last_updated", lastUpdated)}</span>}
          </p>
          {data?.notice && (
            <p
              className="mt-1 inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs"
              style={{
                borderColor: data.notice === "no-config" ? "var(--warn-text)" : "var(--danger-text)",
                color: data.notice === "no-config" ? "var(--warn-text)" : "#f87171",
                backgroundColor: data.notice === "no-config" ? "#f59e0b11" : "#ef444411",
              }}
            >
              {data.notice === "no-config" ? t("dashboard.copilot_not_configured") : t("dashboard.copilot_api_error")}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleCurrency}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
            style={{ borderColor: "var(--card-border)", color: "var(--muted-text)", backgroundColor: "var(--card-bg)" }}
            title={t("dashboard.switch_currency")}
          >
            <DollarSignIcon className="h-3.5 w-3.5" />
            {currency}
          </button>
          <button
            onClick={() => { fetchData(true); }}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-gray-800/30"
            style={{ borderColor: "var(--card-border)", color: "var(--muted-text)", backgroundColor: "var(--card-bg)" }}
            title={t("dashboard.refresh_now")}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
          </button>
          <div className="relative">
            <button
              onClick={() => setShowIntervalPicker(!showIntervalPicker)}
              onBlur={() => setTimeout(() => setShowIntervalPicker(false), 200)}
              className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
              style={{
                borderColor: "var(--card-border)",
                color: autoRefresh ? "var(--success-text)" : "var(--muted-text)",
                backgroundColor: "var(--card-bg)",
              }}
            >
              <span className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: autoRefresh ? "var(--success-text)" : "var(--subtle-text)" }} />
              {autoRefresh ? `${refreshInterval}s` : t("dashboard.off")}
            </button>
            {showIntervalPicker && (
              <div
                className="absolute right-0 top-full mt-1 z-50 w-24 rounded-xl border shadow-2xl overflow-hidden"
                style={{
                  backgroundColor: "var(--card-bg)",
                  borderColor: "var(--card-border)",
                }}
              >
                <div className="px-4 py-2 text-xs font-medium border-b" style={{ color: "var(--muted-text)", borderColor: "var(--card-border)" }}>
                  {t("dashboard.refresh_interval")}
                </div>
                {[5, 10, 30, 60].map((s) => (
                  <button
                    key={s}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setRefreshInterval(s);
                      setAutoRefresh(true);
                      setShowIntervalPicker(false);
                    }}
                    className="flex w-full items-center justify-between px-4 py-2 text-xs transition-colors"
                    style={{
                      backgroundColor: refreshInterval === s && autoRefresh ? "var(--hover-bg)" : "transparent",
                      color: "var(--page-text)",
                    }}
                  >
                    <span className={refreshInterval === s && autoRefresh ? "font-medium" : ""}>{s}s</span>
                    {refreshInterval === s && autoRefresh && (
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="var(--success-text)" strokeWidth={3}>
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 rounded-lg border p-0.5" style={{ borderColor: "var(--card-border)", backgroundColor: "var(--page-bg)" }}>
          {RANGE_KEYS.map((key) => (
            <button
              key={key}
              onClick={() => setRange(key)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                range === key
                  ? "text-white"
                  : "hover:bg-gray-800/30"
              )}
              style={range === key ? { backgroundColor: "var(--accent-solid)", color: "#fff" } : { color: "var(--muted-text)" }}
            >
              {t("dashboard.range." + key)}
            </button>
          ))}
            </div>
          </div>
        </div>

      <div className="dashboard-source-strip tech-panel">
        <span className="dashboard-source-label">{t("dashboard.data_source")}</span>
        <div className="dashboard-source-options">
          {([
            ["pi", "dashboard.source_pi"],
            ["chatgpt", "dashboard.source_chatgpt"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setSource(key)}
              className={cn("dashboard-source-option", source === key && "is-active")}
            >
              <span className="dashboard-source-dot" />
              {t(label)}
            </button>
          ))}
        </div>
        {codexUsage && (
          <div className="ml-auto flex flex-wrap items-center gap-2 text-xs" style={{ color: "var(--muted-text)" }}>
            <span className={cn("inline-flex items-center gap-1 font-medium", codexUsage.loggedIn ? "text-emerald-400" : "text-gray-500")}>
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {codexUsage.loggedIn ? t("dashboard.codex_logged_in") : t("dashboard.codex_not_logged_in")}
            </span>
            {codexUsage.loggedIn && codexUsage.primary && codexUsage.secondary && (
              <>
                <span className="rounded border border-gray-700 px-2 py-1 font-mono">
                  {t("dashboard.codex_5h")}: {t("dashboard.codex_remaining", `${codexUsage.primary.remainingPercent}%`)}
                  {formatRemainingTime(codexUsage.primary.resetAfterSeconds) && ` · ${formatRemainingTime(codexUsage.primary.resetAfterSeconds)}`}
                  {formatResetAt(codexUsage.primary.resetAt, lang) && ` · ${t("dashboard.codex_resets", formatResetAt(codexUsage.primary.resetAt, lang)!)}`}
                </span>
                <span className="rounded border border-gray-700 px-2 py-1 font-mono">
                  {t("dashboard.codex_7d")}: {t("dashboard.codex_remaining", `${codexUsage.secondary.remainingPercent}%`)}
                  {formatRemainingTime(codexUsage.secondary.resetAfterSeconds) && ` · ${formatRemainingTime(codexUsage.secondary.resetAfterSeconds)}`}
                  {formatResetAt(codexUsage.secondary.resetAt, lang) && ` · ${t("dashboard.codex_resets", formatResetAt(codexUsage.secondary.resetAt, lang)!)}`}
                </span>
              </>
            )}
            {codexUsage.error && <span className="text-amber-400">{t("dashboard.codex_quota_unavailable")}</span>}
          </div>
        )}
      </div>

      {/* Custom Date Picker */}
      {range === "custom" && (
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="date"
            value={customFrom || today}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="rounded-lg border px-3 py-1.5 text-xs"
            style={{ backgroundColor: "var(--input-bg)", borderColor: customInvalid ? "var(--danger-text)" : "var(--input-border)", color: "var(--input-text)" }}
          />
          <span className="text-xs" style={{ color: "var(--muted-text)" }}>{t("dashboard.to")}</span>
          <input
            type="date"
            value={customTo || today}
            onChange={(e) => setCustomTo(e.target.value)}
            className="rounded-lg border px-3 py-1.5 text-xs"
            style={{ backgroundColor: "var(--input-bg)", borderColor: customInvalid ? "var(--danger-text)" : "var(--input-border)", color: "var(--input-text)" }}
          />
          {customInvalid && <span className="text-xs text-red-400">{t("dashboard.invalid_range")}</span>}
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="flex items-center justify-center h-64">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-600 border-t-blue-500" />
        </div>
      )}

      {!loading && data && (
        <div className={cn("space-y-5 transition-opacity", refreshing && "opacity-60")}>
          {/* Overview Cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              title={t("dashboard.total_tokens")}
              value={data.totalTokens.toLocaleString("en-US")}
              icon={<Activity className="h-4 w-4" style={{ color: "var(--signal-cyan)" }} />}
              subtitle={`≈ ${formatTokensShort(data.totalTokens, lang)}`}
              trend={tokenTrend}
              trendLabel={tokenTrend !== undefined ? t("dashboard.vs_prev") : undefined}
            >
              <div className="mt-3 space-y-0.5 border-t pt-3" style={{ borderColor: "var(--card-border)" }}>
                <BreakdownRow label={t("dashboard.input")} value={data.totalInput} total={data.totalTokens} color="var(--signal-cyan)" lang={lang} />
                <BreakdownRow label={t("dashboard.output")} value={data.totalOutput} total={data.totalTokens} color="var(--success-text)" lang={lang} />
                <BreakdownRow label={t("dashboard.cache_create")} value={data.totalCacheWrite} total={data.totalTokens} color="var(--warn-text)" lang={lang} />
                <BreakdownRow label={t("dashboard.cache_hit")} value={data.totalCacheRead} total={data.totalTokens} color="var(--signal-violet)" lang={lang} />
              </div>
            </StatCard>

            <StatCard
              title={t("dashboard.total_requests")}
              value={formatNumber(data.totalRequests)}
              icon={<BarChart3 className="h-4 w-4" style={{ color: "var(--success-text)" }} />}
              subtitle={t("dashboard.api_calls")}
            />

            <StatCard
              title={t("dashboard.total_cost")}
              value={formatCost(data.totalCost, currency)}
              icon={<DollarSign className="h-4 w-4" style={{ color: "var(--warn-text)" }} />}
              subtitle={`${currency === "CNY" ? `¥${(data.totalCost * USD_TO_CNY).toFixed(4)}` : `$${data.totalCost.toFixed(4)}`} ${currency}`}
              trend={costTrend}
              trendLabel={costTrend !== undefined ? t("dashboard.vs_prev") : undefined}
            />

            <StatCard
              title={t("dashboard.cache_hit_rate")}
              value={`${data.cacheHitRate}%`}
              icon={<Database className="h-4 w-4" style={{ color: "var(--signal-violet)" }} />}
              progress={data.cacheHitRate}
            />
          </div>

          {/* Rich analytics overview */}
          <div className="dashboard-analytics-grid">
            <section className="tech-panel analytics-overview-panel">
              <div className="analytics-panel-header">
                <div>
                  <span className="analytics-panel-kicker">SYSTEM READOUT // 01</span>
                  <h3>{t("dashboard.operational_overview")}</h3>
                </div>
                <Gauge className="h-4 w-4" style={{ color: "var(--signal-cyan)" }} />
              </div>
              <div className="analytics-metrics-grid">
                <AnalyticsMetric
                  label={t("dashboard.avg_tokens_request")}
                  value={formatTokensShort(Math.round(analytics.avgTokens), lang)}
                  detail={t("dashboard.avg_tokens_request_detail", String(analytics.activeModels))}
                  icon={<Activity className="h-4 w-4" />}
                />
                <AnalyticsMetric
                  label={t("dashboard.avg_cost_request")}
                  value={fmtCostCell(analytics.avgCost)}
                  detail={t("dashboard.avg_cost_request_detail", String(analytics.activeProviders))}
                  icon={<CircleDollarSign className="h-4 w-4" />}
                  accent="var(--signal-amber)"
                />
                <AnalyticsMetric
                  label={t("dashboard.peak_activity")}
                  value={analytics.peak?.label || "—"}
                  detail={analytics.peak ? t("dashboard.peak_activity_detail", String(analytics.peak.requests)) : t("dashboard.no_data")}
                  icon={<Zap className="h-4 w-4" />}
                  accent="var(--signal-lime)"
                />
                <AnalyticsMetric
                  label={t("dashboard.active_models")}
                  value={String(analytics.activeModels)}
                  detail={t("dashboard.active_models_detail", String(analytics.activeProviders))}
                  icon={<Cpu className="h-4 w-4" />}
                  accent="var(--signal-violet)"
                />
              </div>
            </section>

            <section className="tech-panel composition-panel">
              <div className="analytics-panel-header">
                <div>
                  <span className="analytics-panel-kicker">TOKEN FLOW // 02</span>
                  <h3>{t("dashboard.token_composition")}</h3>
                </div>
                <PieChartIcon className="h-4 w-4" style={{ color: "var(--signal-violet)" }} />
              </div>
              <div className="composition-layout">
                <div className="composition-chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={analytics.composition}
                        dataKey="value"
                        nameKey="key"
                        innerRadius="62%"
                        outerRadius="86%"
                        paddingAngle={3}
                        stroke="none"
                      >
                        {analytics.composition.map((entry) => <Cell key={entry.key} fill={entry.color} />)}
                      </Pie>
                      <Tooltip
                        formatter={(value: any) => formatTokensShort(Number(Array.isArray(value) ? value[0] : value ?? 0), lang)}
                        contentStyle={{ backgroundColor: "var(--card-bg-solid)", border: "1px solid var(--card-border)", borderRadius: "8px", fontSize: "11px" }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="composition-center">
                    <strong>{formatTokensShort(analytics.cacheTokens, lang)}</strong>
                    <span>{t("dashboard.cache_total")}</span>
                  </div>
                </div>
                <div className="composition-legend">
                  {analytics.composition.map((entry) => {
                    const pct = analytics.totalTokens > 0 ? (entry.value / analytics.totalTokens) * 100 : 0;
                    const labels: Record<string, string> = {
                      input: t("dashboard.input"),
                      output: t("dashboard.output"),
                      cacheRead: t("dashboard.cache_hit"),
                      cacheWrite: t("dashboard.cache_create"),
                    };
                    return (
                      <div key={entry.key} className="composition-legend-row">
                        <span className="legend-dot" style={{ backgroundColor: entry.color }} />
                        <span>{labels[entry.key]}</span>
                        <strong>{pct.toFixed(1)}%</strong>
                      </div>
                    );
                  })}
                  <div className="composition-summary">
                    <span>{t("dashboard.cache_hit_rate")}</span>
                    <strong>{analytics.cacheShare.toFixed(1)}%</strong>
                  </div>
                </div>
              </div>
            </section>

            <section className="tech-panel distribution-panel">
              <div className="analytics-panel-header">
                <div>
                  <span className="analytics-panel-kicker">ROUTING MATRIX // 03</span>
                  <h3>{t("dashboard.provider_mix")}</h3>
                </div>
                <Layers3 className="h-4 w-4" style={{ color: "var(--signal-amber)" }} />
              </div>
              <div className="distribution-list">
                {analytics.providers.length === 0 ? (
                  <p className="analytics-no-data">{t("dashboard.no_data")}</p>
                ) : analytics.providers.slice(0, 5).map((provider, index) => (
                  <DistributionRow
                    key={provider.providerId}
                    name={provider.providerId}
                    meta={t("dashboard.provider_models", String(provider.modelCount))}
                    percentage={analytics.providerTokenTotal > 0 ? (provider.totalTokens / analytics.providerTokenTotal) * 100 : 0}
                    valueLabel={formatTokensShort(provider.totalTokens, lang)}
                    color={COLORS[index % COLORS.length] ?? COLORS[0]!}
                  />
                ))}
              </div>
            </section>

            <section className="tech-panel activity-panel">
              <div className="analytics-panel-header">
                <div>
                  <span className="analytics-panel-kicker">REQUEST PULSE // 04</span>
                  <h3>{t("dashboard.request_activity")}</h3>
                </div>
                <Clock3 className="h-4 w-4" style={{ color: "var(--signal-lime)" }} />
              </div>
              <div className="activity-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={analytics.activity} margin={{ top: 8, right: 4, left: -22, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--card-border)" strokeDasharray="3 3" />
                    <XAxis dataKey="label" tick={{ fontSize: 9, fill: "var(--muted-text)" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                    <YAxis allowDecimals={false} tick={{ fontSize: 9, fill: "var(--muted-text)" }} axisLine={false} tickLine={false} />
                    <Tooltip
                      cursor={{ fill: "color-mix(in srgb, var(--signal-cyan) 6%, transparent)" }}
                      formatter={(value: any) => [Number(Array.isArray(value) ? value[0] : value ?? 0), t("dashboard.requests")]}
                      contentStyle={{ backgroundColor: "var(--card-bg-solid)", border: "1px solid var(--card-border)", borderRadius: "8px", fontSize: "11px" }}
                    />
                    <Bar dataKey="requests" fill="var(--signal-cyan)" radius={[3, 3, 0, 0]} maxBarSize={18} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="activity-footer">
                <span>{t("dashboard.total_requests")}</span>
                <strong>{formatNumber(data.totalRequests)}</strong>
              </div>
            </section>

            <section className="tech-panel model-leaderboard-panel">
              <div className="analytics-panel-header">
                <div>
                  <span className="analytics-panel-kicker">MODEL LOAD // 05</span>
                  <h3>{t("dashboard.model_leaderboard")}</h3>
                </div>
                <Cpu className="h-4 w-4" style={{ color: "var(--signal-violet)" }} />
              </div>
              <div className="leaderboard-list">
                {analytics.models.length === 0 ? (
                  <p className="analytics-no-data">{t("dashboard.no_data")}</p>
                ) : analytics.models.slice(0, 5).map((model, index) => (
                  <div key={`${model.providerId}/${model.modelId}`} className="leaderboard-row">
                    <span className="leaderboard-rank">0{index + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="leaderboard-name">{model.modelId}</div>
                      <div className="leaderboard-meta">{model.providerId} · {formatNumber(model.totalRequests)} {t("dashboard.requests")}</div>
                    </div>
                    <span className="leaderboard-value">{formatTokensShort(model.totalTokens, lang)}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* Usage Trend Chart */}
          <div className="tech-panel telemetry-chart p-5" style={{ borderColor: "var(--card-border)", backgroundColor: "var(--card-bg)" }}>
            <h3 className="text-sm font-semibold mb-1" style={{ color: "var(--page-text)" }}>{t("dashboard.usage_trend")}</h3>
            <p className="text-xs mb-4" style={{ color: "var(--muted-text)" }}>
              {range === "today" ? t("dashboard.range.today") : `${formatDateShort(chartData[0]?.rawDate || "")} - ${formatDateShort(chartData[chartData.length - 1]?.rawDate || "")}`}
            </p>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--muted-text)" }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="tokens" tick={{ fontSize: 11, fill: "var(--muted-text)" }} axisLine={false} tickLine={false} label={{ value: t("dashboard.tokens_k"), angle: -90, position: "insideLeft", style: { fill: "var(--muted-text)", fontSize: 11 } }} />
                <YAxis yAxisId="cost" orientation="right" tick={{ fontSize: 11, fill: "var(--muted-text)" }} axisLine={false} tickLine={false} label={{ value: t("dashboard.cost_label"), angle: 90, position: "insideRight", style: { fill: "var(--muted-text)", fontSize: 11 } }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "var(--card-bg)",
                    border: "1px solid var(--card-border)",
                    borderRadius: "8px",
                    color: "var(--page-text)",
                    fontSize: "12px",
                  }}
                />
                <Area yAxisId="tokens" type="monotone" dataKey="input" stroke={CHART_LINE_COLORS.input} fill="none" strokeWidth={2} dot={false} name={t("dashboard.input")} />
                <Area yAxisId="tokens" type="monotone" dataKey="output" stroke={CHART_LINE_COLORS.output} fill="none" strokeWidth={2} dot={false} name={t("dashboard.output")} />
                <Area yAxisId="tokens" type="monotone" dataKey="cacheRead" stroke={CHART_LINE_COLORS.cacheRead} fill="none" strokeWidth={2} strokeDasharray="4 2" dot={false} name={t("dashboard.cache_hit")} />
                <Area yAxisId="tokens" type="monotone" dataKey="cacheWrite" stroke={CHART_LINE_COLORS.cacheWrite} fill="none" strokeWidth={2} strokeDasharray="2 2" dot={false} name={t("dashboard.cache_create")} />
                <Area yAxisId="cost" type="monotone" dataKey="cost" stroke={CHART_LINE_COLORS.cost} fill="none" strokeWidth={2} strokeDasharray="6 3" dot={false} name={t("dashboard.cost")} />
                <Legend
                  wrapperStyle={{ fontSize: "11px", color: "var(--muted-text)", paddingTop: "8px" }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Tabs: Request Log / Provider / Model */}
          <div className="tech-panel data-console overflow-hidden" style={{ borderColor: "var(--card-border)", backgroundColor: "var(--card-bg)" }}>
            {/* Tab Header */}
            <div className="flex items-center border-b" style={{ borderColor: "var(--card-border)" }}>
              {([
                { key: "log" as TabKey, label: "dashboard.request_log" },
                { key: "provider" as TabKey, label: "dashboard.provider_stats" },
                { key: "model" as TabKey, label: "dashboard.model_stats" },
              ]).map((tabItem) => (
                <button
                  key={tabItem.key}
                  onClick={() => setTab(tabItem.key)}
                  className={cn(
                    "px-5 py-3 text-xs font-medium border-b-2 transition-colors",
                    tab === tabItem.key ? "" : "border-transparent"
                  )}
                  style={{
                    color: tab === tabItem.key ? "var(--signal-cyan)" : "var(--muted-text)",
                    borderBottomColor: tab === tabItem.key ? "var(--signal-cyan)" : "transparent",
                  }}
                >
                  {t(tabItem.label)}
                </button>
              ))}
              <button
                onClick={handleExport}
                className="ml-auto mr-3 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors hover:bg-gray-800/30"
                style={{ color: "var(--muted-text)" }}
              >
                <Download className="h-3.5 w-3.5" />
                {t("dashboard.export_csv")}
              </button>
            </div>

            {/* Tab Content */}
            <div className="overflow-x-auto">
              {tab === "log" && (
                <>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b" style={{ borderColor: "var(--card-border)" }}>
                        <th className="px-4 py-3 text-left font-medium" style={{ color: "var(--muted-text)" }}>{t("dashboard.time")}</th>
                        <th className="px-4 py-3 text-left font-medium" style={{ color: "var(--muted-text)" }}>{t("dashboard.provider")}</th>
                        <th className="px-4 py-3 text-left font-medium" style={{ color: "var(--muted-text)" }}>{t("dashboard.model")}</th>
                        <th className="px-4 py-3 text-right font-medium" style={{ color: "var(--muted-text)" }}>{t("dashboard.input")}</th>
                        <th className="px-4 py-3 text-right font-medium" style={{ color: "var(--muted-text)" }}>{t("dashboard.output")}</th>
                        <th className="px-4 py-3 text-right font-medium" style={{ color: "var(--muted-text)" }}>{t("dashboard.cost")}</th>
                        <th className="px-4 py-3 text-right font-medium" style={{ color: "var(--muted-text)" }}>{t("dashboard.requests")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedLog.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-4 py-8 text-center" style={{ color: "var(--subtle-text)" }}>
                            {t("dashboard.no_data")}
                          </td>
                        </tr>
                      ) : (
                        pagedLog.map((r, i) => (
                          <tr key={i} className="border-b" style={{ borderColor: "var(--card-border)" }}>
                            <td className="px-4 py-2.5 whitespace-nowrap" style={{ color: "var(--page-text)" }}>{r.timestamp}</td>
                            <td className="px-4 py-2.5" style={{ color: "var(--page-text)" }}>{r.providerId}</td>
                            <td className="px-4 py-2.5" style={{ color: "var(--page-text)" }}>{r.modelId}</td>
                            <td className="px-4 py-2.5 text-right font-mono" style={{ color: "var(--page-text)" }}>{formatTokensShort(r.input, lang)}</td>
                            <td className="px-4 py-2.5 text-right font-mono" style={{ color: "var(--page-text)" }}>{formatTokensShort(r.output, lang)}</td>
                            <td className="px-4 py-2.5 text-right font-mono" style={{ color: "var(--page-text)" }}>{fmtCostCell(r.cost)}</td>
                            <td className="px-4 py-2.5 text-right font-mono" style={{ color: "var(--page-text)" }}>{r.requests}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                  {data.requestLog.length > LOG_PAGE_SIZE && (
                    <div className="flex items-center justify-between px-4 py-3">
                      <span className="text-xs" style={{ color: "var(--subtle-text)" }}>
                        {t("dashboard.total_items", String(data.requestLog.length))}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setLogPage((p) => Math.max(1, p - 1))}
                          disabled={currentLogPage <= 1}
                          className="rounded-lg border px-3 py-1 text-xs disabled:opacity-40"
                          style={{ borderColor: "var(--card-border)", color: "var(--muted-text)" }}
                        >
                          {t("dashboard.prev_page")}
                        </button>
                        <span className="text-xs" style={{ color: "var(--muted-text)" }}>
                          {currentLogPage} / {totalLogPages}
                        </span>
                        <button
                          onClick={() => setLogPage((p) => Math.min(totalLogPages, p + 1))}
                          disabled={currentLogPage >= totalLogPages}
                          className="rounded-lg border px-3 py-1 text-xs disabled:opacity-40"
                          style={{ borderColor: "var(--card-border)", color: "var(--muted-text)" }}
                        >
                          {t("dashboard.next_page")}
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}

              {tab === "provider" && (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b" style={{ borderColor: "var(--card-border)" }}>
                      <th className="px-4 py-3 text-left font-medium" style={{ color: "var(--muted-text)" }}>{t("dashboard.provider")}</th>
                      <SortableTh label={t("dashboard.tokens")} sortKey="totalTokens" sort={providerSort} onSort={toggleSort(setProviderSort)} />
                      <SortableTh label={t("dashboard.input")} sortKey="totalInput" sort={providerSort} onSort={toggleSort(setProviderSort)} />
                      <SortableTh label={t("dashboard.output")} sortKey="totalOutput" sort={providerSort} onSort={toggleSort(setProviderSort)} />
                      <SortableTh label={t("dashboard.cost")} sortKey="totalCost" sort={providerSort} onSort={toggleSort(setProviderSort)} />
                      <SortableTh label={t("dashboard.requests")} sortKey="totalRequests" sort={providerSort} onSort={toggleSort(setProviderSort)} />
                      <SortableTh label={t("dashboard.models_count")} sortKey="modelCount" sort={providerSort} onSort={toggleSort(setProviderSort)} />
                      <th className="px-4 py-3 text-left font-medium w-44" style={{ color: "var(--muted-text)" }}>{t("dashboard.cost_share")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedProviders.length === 0 ? (
                      <tr><td colSpan={8} className="px-4 py-8 text-center" style={{ color: "var(--subtle-text)" }}>{t("dashboard.no_data")}</td></tr>
                    ) : (
                      sortedProviders.map((p, i) => {
                        const pct = providerTotalCost > 0 ? (p.totalCost / providerTotalCost) * 100 : 0;
                        return (
                          <tr key={p.providerId} className="border-b" style={{ borderColor: "var(--card-border)" }}>
                            <td className="px-4 py-2.5 font-medium" style={{ color: "var(--page-text)" }}>{p.providerId}</td>
                            <td className="px-4 py-2.5 text-right font-mono" style={{ color: "var(--page-text)" }}>{formatTokensShort(p.totalTokens, lang)}</td>
                            <td className="px-4 py-2.5 text-right font-mono" style={{ color: "var(--page-text)" }}>{formatTokensShort(p.totalInput, lang)}</td>
                            <td className="px-4 py-2.5 text-right font-mono" style={{ color: "var(--page-text)" }}>{formatTokensShort(p.totalOutput, lang)}</td>
                            <td className="px-4 py-2.5 text-right font-mono" style={{ color: "var(--page-text)" }}>{fmtCostCell(p.totalCost)}</td>
                            <td className="px-4 py-2.5 text-right font-mono" style={{ color: "var(--page-text)" }}>{p.totalRequests}</td>
                            <td className="px-4 py-2.5 text-right font-mono" style={{ color: "var(--page-text)" }}>{p.modelCount}</td>
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-2">
                                <div className="h-1.5 flex-1 rounded-full" style={{ backgroundColor: "var(--card-border)" }}>
                                  <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: COLORS[i % COLORS.length] ?? "var(--signal-cyan)" }} />
                                </div>
                                <span className="text-xs w-11 text-right" style={{ color: "var(--subtle-text)" }}>{pct.toFixed(1)}%</span>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              )}

              {tab === "model" && (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b" style={{ borderColor: "var(--card-border)" }}>
                      <th className="px-4 py-3 text-left font-medium" style={{ color: "var(--muted-text)" }}>{t("dashboard.model")}</th>
                      <th className="px-4 py-3 text-left font-medium" style={{ color: "var(--muted-text)" }}>{t("dashboard.provider")}</th>
                      <SortableTh label={t("dashboard.tokens")} sortKey="totalTokens" sort={modelSort} onSort={toggleSort(setModelSort)} />
                      <SortableTh label={t("dashboard.input")} sortKey="totalInput" sort={modelSort} onSort={toggleSort(setModelSort)} />
                      <SortableTh label={t("dashboard.output")} sortKey="totalOutput" sort={modelSort} onSort={toggleSort(setModelSort)} />
                      <SortableTh label={t("dashboard.cost")} sortKey="totalCost" sort={modelSort} onSort={toggleSort(setModelSort)} />
                      <SortableTh label={t("dashboard.requests")} sortKey="totalRequests" sort={modelSort} onSort={toggleSort(setModelSort)} />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedModels.length === 0 ? (
                      <tr><td colSpan={7} className="px-4 py-8 text-center" style={{ color: "var(--subtle-text)" }}>{t("dashboard.no_data")}</td></tr>
                    ) : (
                      sortedModels.map((m) => (
                        <tr key={`${m.providerId}/${m.modelId}`} className="border-b" style={{ borderColor: "var(--card-border)" }}>
                          <td className="px-4 py-2.5 font-medium" style={{ color: "var(--page-text)" }}>{m.modelId}</td>
                          <td className="px-4 py-2.5" style={{ color: "var(--page-text)" }}>{m.providerId}</td>
                          <td className="px-4 py-2.5 text-right font-mono" style={{ color: "var(--page-text)" }}>{formatTokensShort(m.totalTokens, lang)}</td>
                          <td className="px-4 py-2.5 text-right font-mono" style={{ color: "var(--page-text)" }}>{formatTokensShort(m.totalInput, lang)}</td>
                          <td className="px-4 py-2.5 text-right font-mono" style={{ color: "var(--page-text)" }}>{formatTokensShort(m.totalOutput, lang)}</td>
                          <td className="px-4 py-2.5 text-right font-mono" style={{ color: "var(--page-text)" }}>{fmtCostCell(m.totalCost)}</td>
                          <td className="px-4 py-2.5 text-right font-mono" style={{ color: "var(--page-text)" }}>{m.totalRequests}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
