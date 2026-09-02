import { useMemo, useState, useEffect } from "react";
import { Gauge, Loader2, Zap, Check, X, RotateCcw, Download, Plus, ListPlus } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { useConfigStore } from "@/store/config-store";
import { cn } from "@/lib/utils";
import type { Provider, Model } from "@/types";

// Model returned by /api/pi/provider-models. Kept local to this page — these
// are stored separately from the provider's configured/enabled models.
interface FetchedModel {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  vision?: boolean;
  audio?: boolean;
  cost?: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
  source?: string;
}

// Per-model speed-test result.
interface ModelResult {
  status: "idle" | "testing" | "done";
  runs: number;
  success: number;
  latencies: number[];
  lastMessage?: string;
}

const RUNS_PER_MODEL = 3; // sequential calls per model to derive a rate
// Two speed profiles. Slow mode spaces requests out and retries harder to
// avoid tripping upstream rate limits (HTTP 429).
const SPEED_PROFILES = {
  normal: { betweenCalls: 600,  betweenModels: 800,  maxRetries: 2, backoff: 3000 },
  slow:   { betweenCalls: 2000, betweenModels: 4000, maxRetries: 4, backoff: 6000 },
} as const;
type SpeedMode = keyof typeof SPEED_PROFILES;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// LocalStorage key: the speed-test model catalog is kept entirely separate
// from the app's configured models (models.json / enabledModels).
const STORE_KEY = "speedtest:model-catalog";

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

// Load/save the fetched-model catalog (map of providerId → FetchedModel[]).
function loadCatalog(): Record<string, FetchedModel[]> {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function saveCatalog(catalog: Record<string, FetchedModel[]>) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(catalog));
  } catch {
    /* ignore quota errors */
  }
}

// LocalStorage key: per-provider speed-test results, so they survive
// navigating away and back (the route unmounts this page).
const RESULTS_KEY = "speedtest:model-results";
// LocalStorage key: last selected provider on this page.
const LAST_PROVIDER_KEY = "speedtest:last-provider";

type AllResults = Record<string, Record<string, ModelResult>>;

function loadResults(): AllResults {
  try {
    const raw = localStorage.getItem(RESULTS_KEY);
    if (!raw) return {};
    const all = JSON.parse(raw) as AllResults;
    // Drop entries stuck in "testing" (page left mid-run) — they never finished.
    for (const pid of Object.keys(all)) {
      const kept = Object.fromEntries(
        Object.entries(all[pid] ?? {}).filter(([, r]) => r.status === "done")
      );
      if (Object.keys(kept).length === 0) delete all[pid];
      else all[pid] = kept;
    }
    return all;
  } catch {
    return {};
  }
}

function saveResults(all: AllResults) {
  try {
    localStorage.setItem(RESULTS_KEY, JSON.stringify(all));
  } catch {
    /* ignore quota errors */
  }
}

export function ModelSpeedTestPage() {
  const { t } = useTranslation();
  const { allProviders, auth } = useConfigStore();

  // Resolve a usable API key for a provider (models.json apiKey or auth.json).
  const keyOf = (p: Provider) => p.apiKey ?? auth?.[p.id]?.key ?? "";

  // Custom providers only (built-in providers are excluded from speed tests).
  // A provider is listed once it has an endpoint — models come from the
  // locally-stored speed-test catalog, not the configured model list.
  const testableProviders = useMemo(
    () => allProviders.filter((p) => p.type === "custom" && (p.baseUrl ?? "").trim() !== ""),
    [allProviders]
  );

  const [selectedId, setSelectedId] = useState<string | null>(
    () => localStorage.getItem(LAST_PROVIDER_KEY) ?? testableProviders[0]?.id ?? null
  );
  const selected = testableProviders.find((p) => p.id === selectedId) ?? testableProviders[0] ?? null;
  useEffect(() => {
    if (selected?.id) localStorage.setItem(LAST_PROVIDER_KEY, selected.id);
  }, [selected?.id]);

  // Speed-test model catalog, persisted in localStorage.
  const [catalog, setCatalog] = useState<Record<string, FetchedModel[]>>({});
  useEffect(() => { setCatalog(loadCatalog()); }, []);
  const models = selected ? (catalog[selected.id] ?? []) : [];

  // Results persisted per provider so they survive route changes; the map
  // below is the current provider's slice.
  const [allResults, setAllResults] = useState<AllResults>(() => loadResults());
  useEffect(() => { saveResults(allResults); }, [allResults]);
  const results = useMemo(
    () => new Map(Object.entries(allResults[selected?.id ?? ""] ?? {})),
    [allResults, selected]
  );
  // setResults scoped to the selected provider (drop-in for the old state setter).
  const setResults = (
    next: Map<string, ModelResult> | ((prev: Map<string, ModelResult>) => Map<string, ModelResult>)
  ) => {
    const pid = selected?.id ?? "";
    setAllResults((prevAll) => {
      const prevMap = new Map(Object.entries(prevAll[pid] ?? {}));
      const nextMap = typeof next === "function" ? next(prevMap) : next;
      return { ...prevAll, [pid]: Object.fromEntries(nextMap) };
    });
  };
  const [running, setRunning] = useState(false);
  const [speedMode, setSpeedMode] = useState<SpeedMode>("normal");
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetchInfo, setFetchInfo] = useState<string | null>(null);

  // Add-to-provider support: models already configured under this provider.
  const { addModel } = useConfigStore();
  const configuredIds = useMemo(
    () => new Set((selected?.models ?? []).map((m) => m.id)),
    [selected]
  );

  const toModelDef = (m: FetchedModel): Model => {
    const input: Model["input"] = ["text"];
    if (m.vision) input.push("image");
    if (m.audio) input.push("audio");
    return {
      id: m.id,
      name: m.name,
      reasoning: m.reasoning ?? false,
      input,
      contextWindow: m.contextWindow ?? 262144,
      maxTokens: m.maxTokens ?? 32768,
      cost: m.cost
        ? {
            input: m.cost.input ?? 0,
            output: m.cost.output ?? 0,
            cacheRead: m.cost.cacheRead ?? 0,
            cacheWrite: m.cost.cacheWrite ?? 0,
          }
        : { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    };
  };

  // Models that passed 100% and are not configured yet — the batch-add set.
  const passedNew = useMemo(
    () =>
      models.filter((m) => {
        const r = results.get(m.id);
        return !!r && r.runs > 0 && r.success === r.runs && !configuredIds.has(m.id);
      }),
    [models, results, configuredIds]
  );

  const addToProvider = async (m: FetchedModel) => {
    if (!selected || configuredIds.has(m.id)) return;
    // Added disabled by default — the user enables it on the providers page.
    addModel(selected.id, toModelDef(m));
  };

  const addAllPassed = async () => {
    if (!selected || running || passedNew.length === 0) return;
    passedNew.forEach((m) => addModel(selected.id, toModelDef(m)));
  };

  const setResult = (modelId: string, patch: Partial<ModelResult>) => {
    setResults((prev) => {
      const next = new Map(prev);
      const cur = next.get(modelId) ?? { status: "idle", runs: 0, success: 0, latencies: [] };
      next.set(modelId, { ...cur, ...patch });
      return next;
    });
  };

  // One-click: fetch all models from the provider endpoint, store locally.
  const fetchModels = async () => {
    if (!selected || fetching) return;
    setFetching(true);
    setFetchError(null);
    setFetchInfo(null);
    try {
      const res = await fetch("/api/pi/provider-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: (selected.baseUrl ?? "").trim(),
          apiKey: keyOf(selected),
          providerId: selected.id,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setFetchError(data.error);
        return;
      }
      const fetched: FetchedModel[] = data.models ?? [];
      const next = { ...loadCatalog(), [selected.id]: fetched };
      saveCatalog(next);
      setCatalog(next);
      setResults(new Map()); // stale results no longer match the new list
      setFetchInfo(t("speed_test.fetched_count", String(fetched.length)));
    } catch {
      setFetchError(t("speed_test.fetch_failed"));
    } finally {
      setFetching(false);
    }
  };

  const clearModels = () => {
    if (!selected || fetching || running) return;
    const next = { ...loadCatalog() };
    delete next[selected.id];
    saveCatalog(next);
    setCatalog(next);
    setResults(new Map());
    setFetchInfo(null);
  };

  const testModelOnce = async (provider: Provider, model: FetchedModel) => {
    const res = await fetch("/api/pi/model-test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseUrl: (provider.baseUrl ?? "").trim(),
        modelId: model.id,
        apiKey: keyOf(provider),
        apiType: provider.api ?? undefined,
      }),
    });
    return res.json() as Promise<{ success: boolean; latencyMs?: number; message?: string; status?: number }>;
  };

  // Returns true when a result indicates a rate-limit response.
  const isRateLimited = (r: { status?: number; message?: string }) =>
    r.status === 429 || /\b429\b|rate.?limit|too many/i.test(r.message ?? "");

  const testOneModel = async (provider: Provider, model: FetchedModel) => {
    const profile = SPEED_PROFILES[speedMode];
    setResults((prev) => {
      const next = new Map(prev);
      next.set(model.id, { status: "testing", runs: 0, success: 0, latencies: [] });
      return next;
    });
    let success = 0;
    const latencies: number[] = [];
    let lastMessage: string | undefined;
    for (let i = 0; i < RUNS_PER_MODEL; i++) {
      if (i > 0) await sleep(profile.betweenCalls);
      let data: { success: boolean; latencyMs?: number; message?: string; status?: number };
      let attempt = 0;
      // Retry with backoff specifically on 429 so bursty limits recover.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        try {
          data = await testModelOnce(provider, model);
        } catch {
          data = { success: false, message: "network error" };
        }
        if (data.success || !isRateLimited(data) || attempt >= profile.maxRetries) break;
        attempt++;
        await sleep(profile.backoff * attempt);
      }
      if (data!.success) {
        success++;
        if (typeof data!.latencyMs === "number") latencies.push(data!.latencyMs);
      } else {
        lastMessage = data!.message;
      }
      setResult(model.id, { status: "testing", runs: i + 1, success, latencies, lastMessage });
    }
    setResult(model.id, { status: "done", runs: RUNS_PER_MODEL, success, latencies, lastMessage });
  };

  const runAll = async () => {
    if (!selected || running || models.length === 0) return;
    const profile = SPEED_PROFILES[speedMode];
    setRunning(true);
    setResults(new Map());
    try {
      for (let i = 0; i < models.length; i++) {
        if (i > 0) await sleep(profile.betweenModels);
        const model = models[i];
        if (model) await testOneModel(selected, model);
      }
    } finally {
      setRunning(false);
    }
  };

  const resetResults = () => {
    if (running) return;
    setResults(new Map());
  };

  return (
    <div className="space-y-6 providers-page">
      <div className="providers-command-header">
        <div>
          <div className="page-kicker"><span /> MODEL BENCHMARK // LATENCY MATRIX</div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--page-text)" }}>
            {t("speed_test.title")}
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--muted-text)" }}>
            {t("speed_test.subtitle")}
          </p>
        </div>
        <div className="providers-header-signal"><span /> {t("speed_test.runs_note", String(RUNS_PER_MODEL))}</div>
      </div>

      {testableProviders.length === 0 ? (
        <div className="tech-panel flex flex-col items-center gap-2 rounded-xl p-10 text-center">
          <Gauge className="h-8 w-8" style={{ color: "var(--muted-text)" }} />
          <h2 className="text-lg font-semibold" style={{ color: "var(--page-text)" }}>{t("speed_test.no_provider")}</h2>
          <p className="text-sm" style={{ color: "var(--muted-text)" }}>{t("speed_test.no_provider_desc")}</p>
        </div>
      ) : (
        <div className="providers-console flex overflow-hidden rounded-xl border border-gray-800 bg-gray-900/50">
          {/* Left: provider picker */}
          <div className="provider-rail w-60 shrink-0 border-r border-gray-800 p-3">
            <p className="px-2 pb-2 pt-1 text-xs font-medium uppercase tracking-wider text-gray-500">
              {t("speed_test.providers")} ({testableProviders.length})
            </p>
            <div className="space-y-0.5">
              {testableProviders.map((p) => {
                const count = (catalog[p.id] ?? []).length;
                return (
                  <button
                    key={p.id}
                    disabled={running || fetching}
                    onClick={() => setSelectedId(p.id)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors disabled:opacity-50",
                      selected?.id === p.id
                        ? "border-blue-500 bg-blue-500/10 text-white"
                        : "border-transparent text-gray-300 hover:bg-gray-800 hover:text-white"
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    <span className="shrink-0 rounded border border-gray-700 bg-gray-800 px-1.5 py-0.5 text-[10px] font-mono text-gray-400">
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right: fetch + speed results */}
          <div className="flex-1 space-y-4 p-4">
            {selected && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-white">{selected.name}</h2>
                    <p className="text-xs text-gray-500">{models.length} {t("speed_test.models")}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-1.5 rounded-lg border border-gray-700 px-2.5 py-2 text-xs text-gray-300">
                      <input
                        type="checkbox"
                        checked={speedMode === "slow"}
                        disabled={running || fetching}
                        onChange={(e) => setSpeedMode(e.target.checked ? "slow" : "normal")}
                        className="rounded border-gray-600 bg-gray-800 text-blue-500"
                      />
                      {t("speed_test.slow_mode")}
                    </label>
                    <button
                      onClick={fetchModels}
                      disabled={fetching || running}
                      className="flex items-center gap-2 rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-300 transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {fetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                      {fetching ? t("speed_test.fetching") : t("speed_test.fetch_models")}
                    </button>
                    <button
                      onClick={resetResults}
                      disabled={running || fetching || results.size === 0}
                      className="flex items-center gap-1.5 rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-300 transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <RotateCcw className="h-4 w-4" />
                      {t("speed_test.reset")}
                    </button>
                    <button
                      onClick={addAllPassed}
                      disabled={running || fetching || passedNew.length === 0}
                      className="flex items-center gap-1.5 rounded-lg border border-emerald-600/40 bg-emerald-600/10 px-3 py-2 text-sm text-emerald-300 transition-colors hover:bg-emerald-600/20 disabled:cursor-not-allowed disabled:opacity-50"
                      title={t("speed_test.add_all_passed_desc")}
                    >
                      <ListPlus className="h-4 w-4" />
                      {t("speed_test.add_all_passed")} ({passedNew.length})
                    </button>
                    <button
                      onClick={runAll}
                      disabled={running || fetching || models.length === 0}
                      className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                      style={{ backgroundColor: "var(--accent-solid)" }}
                    >
                      {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                      {running ? t("speed_test.testing") : t("speed_test.run_all")}
                    </button>
                  </div>
                </div>

                {fetchError && (
                  <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
                    <X className="mt-0.5 h-4 w-4 shrink-0" />{fetchError}
                  </div>
                )}
                {fetchInfo && !fetchError && (
                  <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-300">
                    <Check className="h-4 w-4 shrink-0" />{fetchInfo}
                    <button onClick={clearModels} className="ml-auto text-xs text-gray-400 underline hover:text-gray-200">
                      {t("speed_test.clear")}
                    </button>
                  </div>
                )}

                {models.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-gray-700 p-10 text-center">
                    <Download className="h-7 w-7 text-gray-600" />
                    <p className="text-sm text-gray-400">{t("speed_test.empty_catalog")}</p>
                    <p className="text-xs text-gray-600">{t("speed_test.empty_catalog_desc")}</p>
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-gray-800">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-800 text-left text-xs uppercase tracking-wider text-gray-500">
                          <th className="px-3 py-2 font-medium">{t("speed_test.col_model")}</th>
                          <th className="px-3 py-2 font-medium text-right">{t("speed_test.col_success_rate")}</th>
                          <th className="px-3 py-2 font-medium text-right">{t("speed_test.col_avg_latency")}</th>
                          <th className="px-3 py-2 font-medium text-right">{t("speed_test.col_range")}</th>
                          <th className="px-3 py-2 font-medium">{t("speed_test.col_status")}</th>
                          <th className="px-3 py-2 font-medium text-right">{t("speed_test.col_action")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {models.map((m) => {
                          const r = results.get(m.id);
                          const rate = r && r.runs > 0 ? Math.round((r.success / r.runs) * 100) : null;
                          const avgMs = r ? avg(r.latencies) : 0;
                          const minMs = r && r.latencies.length ? Math.min(...r.latencies) : 0;
                          const maxMs = r && r.latencies.length ? Math.max(...r.latencies) : 0;
                          return (
                            <tr key={m.id} className="border-b border-gray-800/60 last:border-0">
                              <td className="px-3 py-2">
                                <span className="font-mono text-gray-200">{m.id}</span>
                              </td>
                              <td className="px-3 py-2 text-right">
                                {rate === null ? (
                                  <span className="text-gray-600">—</span>
                                ) : (
                                  <span className={cn(
                                    "font-mono",
                                    rate >= 100 ? "text-emerald-400" : rate > 0 ? "text-amber-400" : "text-red-400"
                                  )}>
                                    {rate}% ({r!.success}/{r!.runs})
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-right font-mono text-gray-300">
                                {avgMs > 0 ? `${avgMs} ms` : <span className="text-gray-600">—</span>}
                              </td>
                              <td className="px-3 py-2 text-right font-mono text-xs text-gray-500">
                                {minMs > 0 ? `${minMs}–${maxMs}` : "—"}
                              </td>
                              <td className="px-3 py-2">
                                {!r || r.status === "idle" ? (
                                  <span className="text-xs text-gray-600">{t("speed_test.pending")}</span>
                                ) : r.status === "testing" ? (
                                  <span className="flex items-center gap-1 text-xs text-gray-400">
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    {t("speed_test.testing")} {r.runs}/{RUNS_PER_MODEL}
                                  </span>
                                ) : r.success === r.runs ? (
                                  <span className="flex items-center gap-1 text-xs text-emerald-400">
                                    <Check className="h-3.5 w-3.5" />
                                    {t("speed_test.ok")}
                                  </span>
                                ) : r.success > 0 ? (
                                  <span className="flex items-center gap-1 text-xs text-amber-400">
                                    <Check className="h-3.5 w-3.5" />
                                    {t("speed_test.partial")}
                                  </span>
                                ) : (
                                  <span className="flex items-center gap-1 text-xs text-red-400" title={r.lastMessage}>
                                    <X className="h-3.5 w-3.5" />
                                    {r.lastMessage ? r.lastMessage.slice(0, 40) : t("speed_test.fail")}
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-right">
                                {rate === 100 &&
                                  (configuredIds.has(m.id) ? (
                                    <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                                      <Check className="h-3.5 w-3.5" />
                                      {t("speed_test.exists")}
                                    </span>
                                  ) : (
                                    <button
                                      onClick={() => addToProvider(m)}
                                      disabled={running || fetching}
                                      className="inline-flex items-center gap-1 rounded-md border border-blue-600/50 bg-blue-600/10 px-2 py-1 text-xs font-medium text-blue-400 transition-colors hover:bg-blue-600/20 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                      <Plus className="h-3.5 w-3.5" />
                                      {t("speed_test.add_to_provider")}
                                    </button>
                                  ))}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
