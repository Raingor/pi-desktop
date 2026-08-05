import { useState, useEffect, useCallback, useMemo, memo } from "react";
import { useConfigStore } from "@/store/config-store";
import { useTranslation } from "@/lib/i18n";
import { useCurrency } from "@/lib/currency";
import { formatCost, formatNumber, cn, USD_TO_CNY } from "@/lib/utils";
import { piUsageRangeGet } from "@/lib/tauri";
import {
  Activity, DollarSign, BarChart3, ArrowUp, ArrowDown, Database, DollarSignIcon, RefreshCw, Download,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend,
} from "recharts";

// ─── Types ──────────────────────────────────────────────

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
}

type RangeKey = "today" | "7d" | "30d" | "custom";
type TabKey = "log" | "provider" | "model";
type SortDir = "asc" | "desc";

const RANGE_KEYS: RangeKey[] = ["today", "7d", "30d", "custom"];

const COLORS = ["#3b82f6", "#10b981", "#8b5cf6", "#f59e0b", "#ef4444"];

const CHART_LINE_COLORS: Record<string, string> = {
  input: "#3b82f6",
  output: "#10b981",
  cacheRead: "#8b5cf6",
  cacheWrite: "#f59e0b",
  cost: "#ef4444",
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
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Previous period of equal length, for period-over-period trends. */
function getPrevRange(range: RangeKey): { from: string; to: string } | null {
  const now = new Date();
  const shift = (days: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - days);
    return localDateStr(d);
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

// ─── Stat Card (memoized) ───────────────────────────────

const StatCard = memo(function StatCard({
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
    <div className={cn("rounded-xl border p-5", className)} style={{ borderColor: "var(--card-border)", backgroundColor: "var(--card-bg)" }}>
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
            style={{ width: `${Math.min(progress, 100)}%`, backgroundColor: progress > 90 ? "var(--ok)" : "var(--accent)" }}
          />
        </div>
      )}
      {children}
    </div>
  );
});

// ─── Breakdown Row (memoized) ───────────────────────────

const BreakdownRow = memo(function BreakdownRow({ label, value, total, color, lang = "en" }: { label: string; value: number; total: number; color: string; lang?: string }) {
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
});

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
      style={{ color: active ? "var(--accent)" : "var(--muted-text)" }}
      onClick={() => onSort(sortKey)}
    >
      <span className="inline-flex items-center gap-0.5">
        {label}
        {active && (sort.dir === "desc" ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
      </span>
    </th>
  );
}

// ─── Main Component ─────────────────────────────────────

export function DashboardPage() {
  const { t, lang } = useTranslation();
  const { currency, toggle: toggleCurrency } = useCurrency();
  const { initialized } = useConfigStore();
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

  const customInvalid = range === "custom" && !!customFrom && !!customTo && customFrom > customTo;

  const fetchData = useCallback(async () => {
    if (!initialized || customInvalid) return;
    // Don't set loading=true on range switch if we already have data
    if (!data) setLoading(true);
    setRefreshing(true);
    try {
      const to = (range === "custom" && customFrom) ? (customTo || customFrom) : "";
      const d = await piUsageRangeGet(range, customFrom || "", to);
      setData(d);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch {
      // Keep old data on error
    } finally {
      setLoading(false);
      setRefreshing(false);
    }

    // Previous period of equal length → period-over-period trend on stat cards
    const prev = getPrevRange(range);
    if (prev) {
      try {
        const p = await piUsageRangeGet("custom", prev.from, prev.to);
        setPrevTotals({ tokens: p.totalTokens ?? 0, cost: p.totalCost ?? 0 });
      } catch {
        setPrevTotals(null);
      }
    } else {
      setPrevTotals(null);
    }
  }, [initialized, range, customFrom, customTo, customInvalid]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Reset request-log pagination when the queried range changes
  useEffect(() => { setLogPage(1); }, [range, customFrom, customTo]);

  // Auto-refresh with configurable interval (seconds)
  useEffect(() => {
    if (!autoRefresh || refreshInterval <= 0) return;
    const id = setInterval(fetchData, refreshInterval * 1000);
    return () => clearInterval(id);
  }, [autoRefresh, refreshInterval, fetchData]);

  const today = new Date().toISOString().split("T")[0];

  // Chart data: hourly for "today", daily for 7d/30d/custom (memoized)
  const chartData = useMemo(() => {
    if (!data) return [];
    const rawBreakdown = range === "today" ? data.hourlyBreakdown : data.dailyBreakdown;
    return rawBreakdown.map((d) => {
      const label = "hour" in d ? d.hour : d.date;
      return {
        date: range === "today" ? label.slice(-5) : formatDateShort(label),
        rawDate: label,
        input: Math.round(d.input / 1000),
        output: Math.round(d.output / 1000),
        cacheRead: Math.round(d.cacheRead / 1000),
        cacheWrite: Math.round(d.cacheWrite / 1000),
        cost: parseFloat(d.cost.toFixed(4)),
        requests: d.requests,
      };
    });
  }, [data, range]);

  // Period-over-period trends (memoized)
  const tokenTrend = useMemo(() =>
    data && prevTotals && prevTotals.tokens > 0
      ? ((data.totalTokens - prevTotals.tokens) / prevTotals.tokens) * 100
      : undefined,
    [data, prevTotals]
  );
  const costTrend = useMemo(() =>
    data && prevTotals && prevTotals.cost > 0
      ? ((data.totalCost - prevTotals.cost) / prevTotals.cost) * 100
      : undefined,
    [data, prevTotals]
  );

  // Sorted stats + request-log pagination (memoized)
  const sortedProviders = useMemo(
    () => sortRows(data?.providerStats ?? [], providerSort.key, providerSort.dir),
    [data?.providerStats, providerSort.key, providerSort.dir]
  );
  const sortedModels = useMemo(
    () => sortRows(data?.modelStats ?? [], modelSort.key, modelSort.dir),
    [data?.modelStats, modelSort.key, modelSort.dir]
  );
  const providerTotalCost = useMemo(
    () => (data?.providerStats ?? []).reduce((s, p) => s + p.totalCost, 0),
    [data?.providerStats]
  );
  const totalLogPages = useMemo(
    () => Math.max(1, Math.ceil((data?.requestLog.length ?? 0) / LOG_PAGE_SIZE)),
    [data?.requestLog]
  );
  const currentLogPage = Math.min(logPage, totalLogPages);
  const pagedLog = useMemo(
    () => (data?.requestLog ?? []).slice((currentLogPage - 1) * LOG_PAGE_SIZE, currentLogPage * LOG_PAGE_SIZE),
    [data?.requestLog, currentLogPage]
  );

  const fmtCostCell = useCallback(
    (v: number) => (currency === "CNY" ? `¥${(v * USD_TO_CNY).toFixed(4)}` : formatCostShort(v)),
    [currency]
  );

  const toggleSort = useCallback(
    (setter: typeof setProviderSort) => (key: string) =>
      setter((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" })),
    []
  );

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
    <div className="space-y-5">
      {/* Title + Time Range Selector + Currency Toggle */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold" style={{ color: "var(--page-text)" }}>{t("dashboard.title")}</h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--muted-text)" }}>
            {data ? t("dashboard.requests_count", String(data.requestLog.length), formatCost(data.totalCost, currency)) : ""}
            {lastUpdated && <span className="ml-2">· {t("dashboard.last_updated", lastUpdated)}</span>}
          </p>
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
            onClick={() => { fetchData(); }}
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
                color: autoRefresh ? "#10b981" : "var(--muted-text)",
                backgroundColor: "var(--card-bg)",
              }}
            >
              <span className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: autoRefresh ? "#10b981" : "var(--subtle-text)" }} />
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
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth={3}>
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
              style={range === key ? { backgroundColor: "#3b82f6", color: "#fff" } : { color: "var(--muted-text)" }}
            >
              {t("dashboard.range." + key)}
            </button>
          ))}
            </div>
          </div>
        </div>

      {/* Custom Date Picker */}
      {range === "custom" && (
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="date"
            value={customFrom || today}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="rounded-lg border px-3 py-1.5 text-xs"
            style={{ backgroundColor: "var(--input-bg)", borderColor: customInvalid ? "#ef4444" : "var(--input-border)", color: "var(--input-text)" }}
          />
          <span className="text-xs" style={{ color: "var(--muted-text)" }}>{t("dashboard.to")}</span>
          <input
            type="date"
            value={customTo || today}
            onChange={(e) => setCustomTo(e.target.value)}
            className="rounded-lg border px-3 py-1.5 text-xs"
            style={{ backgroundColor: "var(--input-bg)", borderColor: customInvalid ? "#ef4444" : "var(--input-border)", color: "var(--input-text)" }}
          />
          {customInvalid && <span className="text-xs text-red-400">{t("dashboard.invalid_range")}</span>}
        </div>
      )}

      {/* Content — always render, show loading overlay if refreshing */}
      {data && (
        <div className={cn("space-y-5 transition-opacity", refreshing && "opacity-60")}>
          {/* Overview Cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              title={t("dashboard.total_tokens")}
              value={data.totalTokens.toLocaleString("en-US")}
              icon={<Activity className="h-4 w-4" style={{ color: "#3b82f6" }} />}
              subtitle={`≈ ${formatTokensShort(data.totalTokens, lang)}`}
              trend={tokenTrend}
              trendLabel={tokenTrend !== undefined ? t("dashboard.vs_prev") : undefined}
            >
              <div className="mt-3 space-y-0.5 border-t pt-3" style={{ borderColor: "var(--card-border)" }}>
                <BreakdownRow label={t("dashboard.input")} value={data.totalInput} total={data.totalTokens} color="#3b82f6" lang={lang} />
                <BreakdownRow label={t("dashboard.output")} value={data.totalOutput} total={data.totalTokens} color="#10b981" lang={lang} />
                <BreakdownRow label={t("dashboard.cache_create")} value={data.totalCacheWrite} total={data.totalTokens} color="#f59e0b" lang={lang} />
                <BreakdownRow label={t("dashboard.cache_hit")} value={data.totalCacheRead} total={data.totalTokens} color="#8b5cf6" lang={lang} />
              </div>
            </StatCard>

            <StatCard
              title={t("dashboard.total_requests")}
              value={formatNumber(data.totalRequests)}
              icon={<BarChart3 className="h-4 w-4" style={{ color: "#10b981" }} />}
              subtitle={t("dashboard.api_calls")}
            />

            <StatCard
              title={t("dashboard.total_cost")}
              value={formatCost(data.totalCost, currency)}
              icon={<DollarSign className="h-4 w-4" style={{ color: "#f59e0b" }} />}
              subtitle={`${currency === "CNY" ? `¥${(data.totalCost * USD_TO_CNY).toFixed(4)}` : `$${data.totalCost.toFixed(4)}`} ${currency}`}
              trend={costTrend}
              trendLabel={costTrend !== undefined ? t("dashboard.vs_prev") : undefined}
            />

            <StatCard
              title={t("dashboard.cache_hit_rate")}
              value={`${data.cacheHitRate}%`}
              icon={<Database className="h-4 w-4" style={{ color: "#8b5cf6" }} />}
              progress={data.cacheHitRate}
            />
          </div>

          {/* Usage Trend Chart */}
          <div className="rounded-xl border p-5" style={{ borderColor: "var(--card-border)", backgroundColor: "var(--card-bg)" }}>
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
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--card-border)", backgroundColor: "var(--card-bg)" }}>
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
                    color: tab === tabItem.key ? "#3b82f6" : "var(--muted-text)",
                    borderBottomColor: tab === tabItem.key ? "#3b82f6" : "transparent",
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
                                  <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: COLORS[i % COLORS.length] ?? "#3b82f6" }} />
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

      {/* No data state */}
      {!data && (
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="h-8 w-8 mx-auto mb-4 animate-spin rounded-full border-2 border-gray-600 border-t-blue-500" />
            <p className="text-sm" style={{ color: "var(--muted-text)" }}>Loading...</p>
          </div>
        </div>
      )}
    </div>
  );
}
