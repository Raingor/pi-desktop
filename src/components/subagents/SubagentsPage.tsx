import { useEffect, useState, useMemo } from "react";
import { useTranslation } from "@/lib/i18n";
import { useConfigStore } from "@/store/config-store";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatTokens } from "@/lib/utils";
import type { AgentDef, ChainDef, ChainStep, RunRecord, SubagentsData } from "@/types";
import {
  Brain,
  GitBranch,
  History,
  Box,
  Users,
  FileCode,
  CheckCircle2,
  XCircle,
  Loader2,
  Search,
  ExternalLink,
  Pencil,
  Check,
  X,
} from "lucide-react";

const API_BASE = "/api/pi";

type Tab = "agents" | "chains" | "history";

export function SubagentsPage() {
  const { t } = useTranslation();
  const [data, setData] = useState<SubagentsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("agents");
  const [search, setSearch] = useState("");

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/subagents`);
      if (!res.ok) throw new Error(`API /subagents: ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (e: any) {
      setError(e.message || "Failed to load subagents data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const q = search.trim().toLowerCase();

  const filteredAgents = data?.agents.filter(
    (a) => !q || a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q)
  );

  const filteredChains = data?.chains.filter(
    (c) => !q || c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)
  );

  const filteredHistory = data?.runHistory.filter(
    (r) => !q || r.agent.toLowerCase().includes(q) || r.status.toLowerCase().includes(q)
  );

  if (loading && !data) {
    return (
      <div className="flex h-60 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-gray-500" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex h-60 flex-col items-center justify-center gap-3">
        <p className="text-sm text-red-400">{error}</p>
        <button
          onClick={loadData}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-500"
        >
          {t("loading.retry")}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--page-text)" }}>
            {t("nav.subagents")}
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--muted-text)" }}>
            {data && t("subagents.summary", String(data.agents.length), String(data.chains.length))}
          </p>
        </div>
        <button
          onClick={loadData}
          className="flex items-center gap-2 rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800"
        >
          <Loader2 className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          {t("dashboard.refresh_now")}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg bg-gray-900 p-1">
        {(["agents", "chains", "history"] as Tab[]).map((tKey) => (
          <button
            key={tKey}
            onClick={() => setTab(tKey)}
            className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              tab === tKey
                ? "bg-blue-600/10 text-blue-400"
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            {tKey === "agents" && <Brain className="h-4 w-4" />}
            {tKey === "chains" && <GitBranch className="h-4 w-4" />}
            {tKey === "history" && <History className="h-4 w-4" />}
            {t(`subagents.tab_${tKey}`)}
            {data && tKey === "agents" && (
              <span className={`rounded-full px-2 py-0.5 text-xs ${tab === "agents" ? "bg-blue-600/20 text-blue-300" : "bg-blue-600/10 text-blue-400"}`}>{data.agents.length}</span>
            )}
            {data && tKey === "chains" && (
              <span className={`rounded-full px-2 py-0.5 text-xs ${tab === "chains" ? "bg-blue-600/20 text-blue-300" : "bg-blue-600/10 text-blue-400"}`}>{data.chains.length}</span>
            )}
            {data && tKey === "history" && (
              <span className={`rounded-full px-2 py-0.5 text-xs ${tab === "history" ? "bg-blue-600/20 text-blue-300" : "bg-blue-600/10 text-blue-400"}`}>{data.runHistory.length}</span>
            )}
          </button>
        ))}
        {data && (data.agents.length > 5 || data.chains.length > 5) && (
          <div className="relative ml-auto">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("models.search_placeholder")}
              className="w-48 rounded-lg border border-gray-700 bg-gray-800 py-2 pl-9 pr-3 text-sm text-white"
            />
          </div>
        )}
      </div>

      {/* Tab Content */}
      <div>
        {tab === "agents" && (
          <AgentList
            agents={filteredAgents ?? []}
            onRefresh={loadData}
            searchActive={!!q}
          />
        )}
        {tab === "chains" && (
          <ChainList
            chains={filteredChains ?? []}
            searchActive={!!q}
          />
        )}
        {tab === "history" && (
          <RunHistoryList
            records={filteredHistory ?? []}
            searchActive={!!q}
          />
        )}
      </div>
    </div>
  );
}

// ─── Agent List ────────────────────────────────────────────

function AgentList({
  agents,
  onRefresh,
  searchActive,
}: {
  agents: AgentDef[];
  onRefresh: () => void;
  searchActive: boolean;
}) {
  const { t } = useTranslation();
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  // Resolve the selected agent from the live list so it reflects saved edits
  // after a refresh (matching by fileName), instead of a stale captured object.
  const selected = agents.find((a) => a.fileName === selectedFile) ?? null;

  if (agents.length === 0) {
    return (
      <EmptyState
        icon={<Brain className="h-8 w-8" />}
        title={t("subagents.no_agents")}
        description={t("subagents.no_agents_desc")}
      />
    );
  }

  return (
    <div className="flex overflow-hidden rounded-xl border border-gray-800 bg-gray-900/50">
      {/* Left: Agent cards */}
      <div className="w-72 shrink-0 border-r border-gray-800 p-3 space-y-2 overflow-y-auto max-h-[70vh]">
        {agents.map((agent) => (
          <button
            key={agent.fileName}
            onClick={() => setSelectedFile(agent.fileName)}
            className={`w-full rounded-lg border px-3 py-3 text-left transition-colors ${
              selected?.fileName === agent.fileName
                ? "border-blue-500/30 bg-gray-800 text-white"
                : "border-gray-700 text-gray-300 hover:bg-gray-800 hover:text-white"
            }`}
          >
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 shrink-0 text-blue-400" />
              <span className="truncate text-sm font-medium">{agent.name}</span>
              <Badge variant={agent.package === "custom" ? "default" : "info"}>
                {agent.package}
              </Badge>
            </div>
            <p className="mt-1 line-clamp-2 text-xs text-gray-500">{agent.description}</p>
          </button>
        ))}
      </div>

      {/* Right: Agent detail */}
      <div className="min-w-0 flex-1 p-6">
        {selected ? (
          <AgentDetail agent={selected} onSaved={onRefresh} />
        ) : (
          <div className="flex h-40 items-center justify-center text-sm text-gray-500">
            {t("providers_models.select_hint")}
          </div>
        )}
      </div>
    </div>
  );
}

function AgentDetail({ agent, onSaved }: { agent: AgentDef; onSaved: () => void }) {
  const { t } = useTranslation();
  const { allModels, allProviders } = useConfigStore();
  // Eligible = custom providers + built-in providers with an API key saved.
  const eligibleModels = useMemo(() => {
    const usable = new Set(
      allProviders.filter((p) => p.type === "custom" || p.hasAuth).map((p) => p.id)
    );
    return allModels.filter((m) => usable.has(m.providerId));
  }, [allModels, allProviders]);
  const [editing, setEditing] = useState(false);
  const [model, setModel] = useState(agent.model ?? "");
  const [thinking, setThinking] = useState(agent.thinking ?? "");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Reset the draft whenever a different agent is selected.
  useEffect(() => {
    setModel(agent.model ?? "");
    setThinking(agent.thinking ?? "");
    setEditing(false);
    setMsg(null);
  }, [agent.fileName]);

  const handleSave = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`${API_BASE}/subagents/update-agent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: agent.fileName, model: model.trim(), thinking: thinking.trim() }),
      });
      const { success } = (await res.json()) as { success: boolean };
      if (success) {
        setMsg({ ok: true, text: t("subagents.saved") });
        setEditing(false);
        onSaved();
      } else {
        setMsg({ ok: false, text: t("subagents.save_failed") });
      }
    } catch {
      setMsg({ ok: false, text: t("subagents.save_failed") });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold text-white">{agent.name}</h2>
        <Badge variant={agent.package === "custom" ? "default" : "info"}>
          {agent.package}
        </Badge>
        {agent.package === "custom" && !editing && (
          <button
            onClick={() => { setMsg(null); setEditing(true); }}
            className="ml-auto flex items-center gap-1.5 rounded-lg border border-gray-700 px-2.5 py-1 text-xs text-gray-300 hover:bg-gray-800"
          >
            <Pencil className="h-3.5 w-3.5" />
            {t("subagents.edit")}
          </button>
        )}
      </div>

      <p className="text-sm text-gray-400">{agent.description}</p>

      <div className="grid grid-cols-2 gap-4 rounded-lg border border-gray-800 bg-gray-900/70 p-4">
        {/* Model — editable for custom agents */}
        <div className={editing ? "col-span-2" : ""}>
          <span className="text-xs text-gray-500">{t("subagents.model")}</span>
          {editing ? (
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 font-mono text-sm text-gray-100 outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">{t("subagents.model_default")}</option>
              {/* Keep a saved-but-unavailable model selectable so it isn't lost. */}
              {model && !eligibleModels.some((m) => `${m.providerId}/${m.id}` === model) && (
                <option value={model}>{model}</option>
              )}
              {eligibleModels.map((m) => (
                <option key={`${m.providerId}/${m.id}`} value={`${m.providerId}/${m.id}`}>
                  {m.providerName} · {m.name ?? m.id}
                </option>
              ))}
            </select>
          ) : (
            <p className="mt-0.5 text-sm text-gray-200 font-mono">{agent.model || t("subagents.model_default")}</p>
          )}
        </div>

        {/* Thinking — editable for custom agents */}
        <div>
          <span className="text-xs text-gray-500">{t("subagents.thinking")}</span>
          {editing ? (
            <select
              value={thinking}
              onChange={(e) => setThinking(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-100 outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">{t("subagents.thinking_default")}</option>
              {["off", "minimal", "low", "medium", "high", "xhigh"].map((lvl) => (
                <option key={lvl} value={lvl}>{lvl}</option>
              ))}
            </select>
          ) : (
            <p className="mt-0.5 text-sm text-gray-200">{agent.thinking || t("subagents.thinking_default")}</p>
          )}
        </div>

        {editing && (
          <div className="col-span-2 flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              {saving ? t("subagents.saving") : t("subagents.save")}
            </button>
            <button
              onClick={() => { setEditing(false); setModel(agent.model ?? ""); setThinking(agent.thinking ?? ""); }}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg border border-gray-700 px-4 py-1.5 text-sm text-gray-300 hover:bg-gray-800"
            >
              <X className="h-3.5 w-3.5" />
              {t("subagents.cancel")}
            </button>
            {msg && (
              <span className={`text-xs ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>{msg.text}</span>
            )}
          </div>
        )}
        {!editing && msg && (
          <div className="col-span-2">
            <span className={`text-xs ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>{msg.text}</span>
          </div>
        )}

        {agent.tools && (
          <div className="col-span-2">
            <span className="text-xs text-gray-500">{t("subagents.tools")}</span>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {agent.tools.map((tool) => (
                <span
                  key={tool}
                  className="rounded-md border border-gray-700 bg-gray-800 px-2 py-0.5 font-mono text-xs text-gray-300"
                >
                  {tool}
                </span>
              ))}
            </div>
          </div>
        )}
        <div>
          <span className="text-xs text-gray-500">{t("subagents.system_prompt_mode")}</span>
          <p className="mt-0.5 text-sm text-gray-200">{agent.systemPromptMode || "replace"}</p>
        </div>
        <div>
          <span className="text-xs text-gray-500">{t("subagents.input")}</span>
          <p className="mt-0.5 text-sm text-gray-200">{(agent.input ?? ["text"]).join(", ")}</p>
        </div>
      </div>

      {/* Body (system prompt preview) */}
      <div>
        <span className="text-xs text-gray-500">{t("subagents.system_prompt")}</span>
        <pre className="mt-1.5 max-h-48 overflow-y-auto rounded-lg border border-gray-800 bg-gray-950 p-3 text-xs text-gray-400 whitespace-pre-wrap font-mono">
          {agent.body || t("subagents.empty_prompt")}
        </pre>
      </div>
    </div>
  );
}

// ─── Chain List ────────────────────────────────────────────

function ChainList({
  chains,
  searchActive,
}: {
  chains: ChainDef[];
  searchActive: boolean;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<ChainDef | null>(null);

  if (chains.length === 0) {
    return (
      <EmptyState
        icon={<GitBranch className="h-8 w-8" />}
        title={t("subagents.no_chains")}
        description={t("subagents.no_chains_desc")}
      />
    );
  }

  return (
    <div className="flex overflow-hidden rounded-xl border border-gray-800 bg-gray-900/50">
      <div className="w-72 shrink-0 border-r border-gray-800 p-3 space-y-2 overflow-y-auto max-h-[70vh]">
        {chains.map((chain) => (
          <button
            key={chain.fileName}
            onClick={() => setSelected(chain)}
            className={`w-full rounded-lg border px-3 py-3 text-left transition-colors ${
              selected?.fileName === chain.fileName
                ? "border-blue-500/30 bg-gray-800 text-white"
                : "border-gray-700 text-gray-300 hover:bg-gray-800 hover:text-white"
            }`}
          >
            <div className="flex items-center gap-2">
              <GitBranch className="h-4 w-4 shrink-0 text-emerald-400" />
              <span className="truncate text-sm font-medium">{chain.name}</span>
            </div>
            <p className="mt-1 line-clamp-2 text-xs text-gray-500">{chain.description}</p>
            <p className="mt-1 text-xs text-gray-600">
              {chain.steps.length} {t("subagents.steps_count").toLowerCase()}
            </p>
          </button>
        ))}
      </div>

      <div className="min-w-0 flex-1 p-6">
        {selected ? (
          <ChainDetail chain={selected} />
        ) : (
          <div className="flex h-40 items-center justify-center text-sm text-gray-500">
            {t("providers_models.select_hint")}
          </div>
        )}
      </div>
    </div>
  );
}

function StepIcon({ agent }: { agent: string }) {
  const isParallel = agent.includes("|");
  if (isParallel) return <Users className="h-4 w-4 text-purple-400" />;
  return <Box className="h-4 w-4 text-blue-400" />;
}

function ChainDetail({ chain }: { chain: ChainDef }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-white">{chain.name}</h2>
      <p className="text-sm text-gray-400">{chain.description}</p>

      <div className="space-y-3">
        <span className="text-xs font-medium text-gray-500">{t("subagents.pipeline")}</span>
        <div className="relative">
          {/* Vertical line connector */}
          <div className="absolute left-4 top-2 bottom-2 w-0.5 bg-gray-700" />

          {chain.steps.map((step, i) => (
            <div key={i} className="relative flex items-start gap-4 pb-4 last:pb-0">
              <div className="z-10 flex h-8 w-8 items-center justify-center rounded-full border border-gray-600 bg-gray-800">
                <StepIcon agent={step.agent} />
              </div>
              <div className="min-w-0 flex-1 pt-1">
                <p className="text-sm text-gray-200">
                  {step.agent.split("|").map((a, j) => (
                    <span key={j}>
                      {j > 0 && <span className="text-gray-500 mx-1">|</span>}
                      <code className="text-blue-300">{a.trim()}</code>
                    </span>
                  ))}
                </p>
                <div className="mt-1 flex flex-wrap gap-2 text-xs text-gray-500">
                  {step.phase && <span>{t("subagents.phase")}: {step.phase}</span>}
                  {step.label && <span>{t("subagents.label")}: {step.label}</span>}
                  {step.output && <span>{t("subagents.output")}: {step.output}</span>}
                </div>
              </div>
              <span className="shrink-0 text-xs text-gray-600">#{i + 1}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Run History ───────────────────────────────────────────

function RunHistoryList({
  records,
  searchActive,
}: {
  records: RunRecord[];
  searchActive: boolean;
}) {
  const { t } = useTranslation();

  if (records.length === 0) {
    return (
      <EmptyState
        icon={<History className="h-8 w-8" />}
        title={t("subagents.no_history")}
        description={t("subagents.no_history_desc")}
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-gray-800">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-800 bg-gray-900/70">
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">{t("subagents.agent")}</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">{t("subagents.time")}</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">{t("subagents.status")}</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">{t("subagents.duration")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800">
          {records.map((r, i) => (
            <tr key={`${r.taskHash}-${i}`} className="hover:bg-gray-800/40">
              <td className="px-4 py-3">
                <code className="text-sm text-blue-300">{r.agent}</code>
              </td>
              <td className="px-4 py-3 text-gray-400">
                {formatTimestamp(r.ts)}
              </td>
              <td className="px-4 py-3">
                {r.status === "ok" ? (
                  <span className="flex items-center gap-1 text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {t("subagents.status_ok")}
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-red-400">
                    <XCircle className="h-3.5 w-3.5" />
                    {t("subagents.status_error")}
                    {r.exit != null && <span className="text-xs text-gray-500">(exit {r.exit})</span>}
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-right text-gray-400">
                {r.duration != null ? formatDuration(r.duration) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {records.length >= 100 && (
        <p className="border-t border-gray-800 px-4 py-2 text-xs text-gray-500">
          {t("subagents.showing_recent")}
        </p>
      )}
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────

function formatTimestamp(ts: number): string {
  const d = new Date(ts * 1000);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return d.toLocaleDateString();
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return `${min}m ${rem}s`;
}
