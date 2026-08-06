import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useConfigStore } from "@/store/config-store";
import { useTranslation } from "@/lib/i18n";
import { Modal } from "@/components/ui/Modal";
import { DashboardPage } from "@/components/dashboard/DashboardPage";
import { SessionsPage } from "@/components/sessions/SessionsPage";
import { MemoryPage } from "@/components/sessions/MemoryPage";
import {
  exportConfig,
  exportConfigToDirectory,
  importConfigFromFile,
  parseImportFile,
  saveLocalBackup,
} from "@/lib/config";
import type { PiConfig, UpdateCheckResult } from "@/types";
import { cn } from "@/lib/utils";
import { piCheckUpdates, piApplyUpdates, piBuiltinCatalogGet, piTestProvider, piFetchProviderModels, piTestModel } from "@/lib/tauri";
import { piSubagentsGet } from "@/lib/tauri";
import type { Model } from "@/types";
import {
  Download,
  Upload,
  RotateCcw,
  Package,
  Plus,
  X,
  Check,
  Palette,
  Type,
  LayoutGrid,
  Wrench,
  Settings as SettingsIcon,
  CloudDownload,
  RefreshCw,
  ZoomIn,
  Plug,
  Users,
  LayoutDashboard,
  History,
  Brain,
  ArrowLeft,
} from "lucide-react";

type SettingsTab = "dashboard" | "sessions" | "memory" | "general" | "providers" | "models" | "subagents" | "about";

// Visual palette previews for the theme swatch picker (mirrors pi-desktop).
const THEME_SWATCHES: {
  value: "dark" | "light" | "light/dark";
  labelKey: string;
  bg: string;
  dots: string[];
}[] = [
  { value: "dark", labelKey: "settings.dark", bg: "linear-gradient(145deg, #14141c, #0a0a0f)", dots: ["#00d4aa", "#7c5cfc", "#2a2a35"] },
  { value: "light", labelKey: "settings.light", bg: "linear-gradient(145deg, #ffffff, #e9ecf2)", dots: ["#00b894", "#7c5cfc", "#c9ced8"] },
  { value: "light/dark", labelKey: "settings.system", bg: "linear-gradient(105deg, #0a0a0f 49.5%, #f1f2f6 50.5%)", dots: ["#00d4aa", "#7c5cfc", "#9aa0ab"] },
];

const FONT_SIZE_KEY = "pi-font-size";
const UI_ZOOM_KEY = "pi-ui-zoom";

function Card({
  icon: Icon,
  title,
  desc,
  kicker,
  children,
  index,
}: {
  icon: typeof Palette;
  title: string;
  desc?: string;
  kicker?: string;
  index?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="theme-card rise overflow-hidden">
      <div
        className="flex items-center gap-3 px-6 py-4"
        style={{ borderBottom: "1px solid var(--card-border)" }}
      >
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px]"
          style={{ backgroundColor: "var(--accent-soft)", color: "var(--accent)" }}
        >
          <Icon className="h-[18px] w-[18px]" strokeWidth={1.7} />
        </div>
        <div className="min-w-0 flex-1">
          {kicker && (
            <div className="label mb-0.5 truncate" style={{ color: "var(--accent)" }}>
              {kicker}
            </div>
          )}
          <h2 className="truncate text-[15px] font-semibold tracking-tight" style={{ color: "var(--page-text)" }}>
            {title}
          </h2>
          {desc && <p className="mt-0.5 truncate text-xs" style={{ color: "var(--muted-text)" }}>{desc}</p>}
        </div>
        {index !== undefined && (
          <span className="num text-xs font-medium" style={{ color: "var(--subtle-text)" }}>
            {String(index).padStart(2, "0")}
          </span>
        )}
      </div>
      <div className="p-6">{children}</div>
    </section>
  );
}

function SettingRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div
      className="flex items-center justify-between gap-6 py-3.5 first:pt-0 last:pb-0"
      style={{ borderBottom: "1px solid var(--card-border)" }}
    >
      <div className="min-w-0">
        <span className="block text-sm font-medium" style={{ color: "var(--page-text)" }}>{label}</span>
        {hint && <span className="label mt-0.5 block" style={{ color: "var(--subtle-text)" }}>{hint}</span>}
      </div>
      <div className="flex shrink-0 items-center">{children}</div>
    </div>
  );
}

export function SettingsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    settings,
    auth,
    modelsJson,
    allProviders,
    allModels,
    updateSettings,
    setTheme,
    addPackage,
    removePackage,
    importConfig: importConfigAction,
    resetToDefaults,
  } = useConfigStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [newPackage, setNewPackage] = useState("");
  const [importError, setImportError] = useState("");
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [fontSize, setFontSize] = useState(() => {
    const saved = Number(localStorage.getItem(FONT_SIZE_KEY));
    return saved >= 12 && saved <= 24 ? saved : 16;
  });
  const [uiZoom, setUiZoom] = useState(() => {
    const saved = Number(localStorage.getItem(UI_ZOOM_KEY));
    return saved >= 50 && saved <= 200 ? saved : 100;
  });
  // pi core / extensions update check (Advanced tab).
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updateError, setUpdateError] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyMessage, setApplyMessage] = useState<{ ok: number; failNames: string[] } | null>(null);

  const handleCheckUpdates = async () => {
    setCheckingUpdates(true);
    setUpdateError(false);
    setApplyMessage(null);
    try {
      const result = await piCheckUpdates();
      setUpdateResult(result);
    } catch {
      setUpdateError(true);
    } finally {
      setCheckingUpdates(false);
    }
  };

  // One-click update: npm install <name>@latest for every updatable extension,
  // then re-check so the list reflects the new installed versions.
  const handleApplyUpdates = async () => {
    const names = (updateResult?.extensions ?? []).filter((e) => e.hasUpdate).map((e) => e.name);
    if (names.length === 0) return;
    setApplying(true);
    setApplyMessage(null);
    try {
      const results = await piApplyUpdates(names);
      const failNames = results.filter((r) => !r.success).map((r) => r.name);
      setApplyMessage({ ok: results.length - failNames.length, failNames });
      const check = await piCheckUpdates();
      setUpdateResult(check);
    } catch {
      setUpdateError(true);
    } finally {
      setApplying(false);
    }
  };

  // Apply + persist UI font size (root rem scaling).
  useEffect(() => {
    document.documentElement.style.fontSize = `${fontSize}px`;
    localStorage.setItem(FONT_SIZE_KEY, String(fontSize));
  }, [fontSize]);

  // Apply + persist UI zoom (whole-interface percentage scaling).
  useEffect(() => {
    document.documentElement.style.zoom = `${uiZoom}%`;
    localStorage.setItem(UI_ZOOM_KEY, String(uiZoom));
  }, [uiZoom]);

  const handleImportFromInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const result = parseImportFile(text);
    if (result) {
      await importConfigAction(result);
      setImportError("");
    } else {
      setImportError(t("settings.import_error"));
    }
    // Reset input so the same file can be selected again
    e.target.value = "";
  };

  const handleImportClick = async () => {
    const { config, cancelled } = await importConfigFromFile();
    if (config) {
      await importConfigAction(config);
      setImportError("");
      return;
    }
    if (!cancelled) {
      // API unavailable or parse failed → fallback to hidden file input
      fileInputRef.current?.click();
    }
  };

  const handleExport = async () => {
    const cfg: PiConfig = {
      settings: settings ?? { theme: "dark", packages: [], enabledModels: [] },
      auth: auth ?? {},
      modelsJson: modelsJson ?? { providers: {} },
    };
    saveLocalBackup(cfg);
    const { ok, cancelled } = await exportConfigToDirectory(cfg);
    if (!ok && !cancelled) {
      // API unavailable or write failed → fallback to download
      exportConfig(cfg);
    }
  };

  // ── Default model select: composite `providerId/modelId` values, but the
  // settings file stores the bare model id (that's what pi expects on disk).
  const modelValue = (providerId: string, modelId: string) => `${providerId}/${modelId}`;
  const modelProviders = allProviders.filter((p) => p.models.length > 0);
  const scopedId = settings?.defaultProvider;
  const groupedModelOptions = scopedId
    ? [...modelProviders.filter((p) => p.id === scopedId), ...modelProviders.filter((p) => p.id !== scopedId)]
    : modelProviders;

  const selectedModelValue = (() => {
    const id = settings?.defaultModel;
    if (!id) return "";
    const dp = settings?.defaultProvider;
    if (dp && allProviders.find((p) => p.id === dp)?.models.some((m) => m.id === id)) {
      return modelValue(dp, id);
    }
    const owner = allProviders.find((p) => p.models.some((m) => m.id === id));
    return owner ? modelValue(owner.id, id) : id; // stale ids display as-is
  })();

  const handleDefaultModelChange = (v: string) => {
    if (!v) {
      updateSettings({ defaultModel: undefined });
      return;
    }
    const idx = v.indexOf("/"); // model ids may themselves contain '/'
    const providerId = idx >= 0 ? v.slice(0, idx) : "";
    const modelId = idx >= 0 ? v.slice(idx + 1) : v;
    // Keep the provider in sync so the (provider, model) pair stays consistent.
    updateSettings(providerId ? { defaultProvider: providerId, defaultModel: modelId } : { defaultModel: modelId });
  };

  const handleDefaultProviderChange = (v: string) => {
    // Drop a default model that doesn't belong to the newly picked provider.
    let clearModel = false;
    if (v && settings?.defaultModel) {
      const provider = allProviders.find((p) => p.id === v);
      if (provider && !provider.models.some((m) => m.id === settings.defaultModel)) {
        clearModel = true;
      }
    }
    updateSettings(clearModel ? { defaultProvider: v, defaultModel: undefined } : { defaultProvider: v || undefined });
  };

  const enabledModels = settings?.enabledModels ?? [];
  const themeLabelKey: Record<string, string> = {
    light: "settings.light",
    dark: "settings.dark",
    "light/dark": "settings.system",
  };

  const tabs: { key: SettingsTab; icon: typeof Palette; label: string }[] = [
    { key: "dashboard", icon: LayoutDashboard, label: t("settings.tab_dashboard") },
    { key: "sessions", icon: History, label: t("settings.tab_sessions") },
    { key: "memory", icon: Brain, label: t("settings.tab_memory") },
    { key: "general", icon: SettingsIcon, label: t("settings.tab_general") },
    { key: "providers", icon: Plug, label: t("settings.tab_providers") },
    { key: "models", icon: LayoutGrid, label: t("settings.tab_models") },
    { key: "subagents", icon: Users, label: t("settings.tab_subagents") },
    { key: "about", icon: Package, label: t("settings.tab_about") },
  ];

  const selectCls =
    "rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white";

  return (
    <div className="space-y-8">
      {/* ── Back to chat ──────────────────────────────────── */}
      <button
        onClick={() => navigate("/chat")}
        className="group flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-colors"
        style={{ color: "var(--sidebar-text)" }}
      >
        <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
        {t("chat.back_to_chat")}
      </button>

      {/* ── Hero ─────────────────────────────────────────── */}
      <header>
        <div className="label" style={{ color: "var(--accent)", letterSpacing: "0.18em" }}>
          pi · workspace · configuration
        </div>
        <h1 className="mt-1.5 text-[28px] font-semibold tracking-tight" style={{ color: "var(--page-text)" }}>
          {t("settings.title")}
        </h1>
        <p className="mt-1.5 max-w-xl text-sm" style={{ color: "var(--muted-text)" }}>{t("settings.subtitle")}</p>

        {/* Instrument readouts */}
        <div
          className="mt-5 grid max-w-2xl grid-cols-3 overflow-hidden rounded-2xl"
          style={{ border: "1px solid var(--card-border)", backgroundColor: "var(--card-bg)" }}
        >
          {[
            { v: String(allProviders.length), l: t("settings.stat_providers") },
            { v: `${enabledModels.length}/${allModels.length}`, l: t("settings.stat_enabled") },
            { v: t(themeLabelKey[settings?.theme ?? "light/dark"] ?? "settings.system"), l: t("settings.stat_theme") },
          ].map((s, i) => (
            <div
              key={s.l}
              className="px-5 py-4"
              style={{ borderLeft: i === 0 ? "none" : "1px solid var(--card-border)" }}
            >
              <div className="num text-2xl font-semibold leading-none tracking-tight" style={{ color: "var(--page-text)" }}>
                {s.v}
              </div>
              <div className="label mt-1.5">{s.l}</div>
            </div>
          ))}
        </div>
      </header>

      {/* ── Settings panel: left index rail + right content ── */}
      <div className="flex gap-10">
        {/* Left: indexed rail */}
        <nav className="w-60 shrink-0">
          <div className="label mb-3 px-3" style={{ color: "var(--subtle-text)" }}>// sections</div>
          <div
            className="overflow-hidden rounded-2xl"
            style={{ border: "1px solid var(--card-border)", backgroundColor: "var(--card-bg)" }}
          >
            {tabs.map(({ key, icon: Icon, label }, i) => {
              const active = activeTab === key;
              return (
                <button
                  key={key}
                  onClick={() => setActiveTab(key)}
                  className="group relative flex w-full items-center gap-3 px-4 py-3 text-left transition-colors"
                  style={{
                    borderTop: i === 0 ? "none" : "1px solid var(--card-border)",
                    backgroundColor: active ? "var(--accent-soft)" : "transparent",
                    color: active ? "var(--accent)" : "var(--sidebar-text)",
                  }}
                >
                  {active && (
                    <span
                      className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r"
                      style={{ backgroundColor: "var(--accent)" }}
                    />
                  )}
                  <span className="num w-6 shrink-0 text-[11px] font-medium opacity-70">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <Icon size={16} strokeWidth={1.8} className="shrink-0" />
                  <span className="flex-1 text-sm font-medium leading-none">{label}</span>
                  {active && <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "var(--accent)" }} />}
                </button>
              );
            })}
          </div>
        </nav>

        {/* Right: content */}
        <div className="min-w-0 flex-1 space-y-6">
          {/* Breadcrumb / section subhead */}
          <div className="flex items-baseline gap-2">
            <span className="label" style={{ color: "var(--subtle-text)" }}>settings</span>
            <span style={{ color: "var(--subtle-text)" }}>/</span>
            <span className="text-sm font-medium" style={{ color: "var(--page-text)" }}>
              {tabs.find((x) => x.key === activeTab)?.label}
            </span>
          </div>

          {/* ── Dashboard ─────────────────────────────────────── */}
          {activeTab === "dashboard" && (
            <DashboardPage />
          )}

      {/* ── Sessions ──────────────────────────────────────── */}
      {activeTab === "sessions" && (
        <SessionsPage />
      )}

      {/* ── Memory ────────────────────────────────────────── */}
      {activeTab === "memory" && (
        <MemoryPage />
      )}

      {/* ── General ───────────────────────────────────────── */}
      {activeTab === "general" && (
        <div className="space-y-6">
          <Card icon={Palette} title={t("settings.theme")} desc={t("settings.theme_desc")} kicker="// appearance">
            <div className="grid grid-cols-3 gap-3 max-w-xl">
              {THEME_SWATCHES.map((s) => {
                const active = (settings?.theme ?? "light/dark") === s.value;
                return (
                  <button
                    key={s.value}
                    onClick={() => setTheme(s.value)}
                    className={cn(
                      "group overflow-hidden rounded-xl border text-left transition-all",
                      active ? "border-blue-500 ring-1 ring-blue-500/40" : "border-gray-700 hover:border-gray-600"
                    )}
                  >
                    <div
                      className="flex h-16 items-end gap-1.5 p-2.5"
                      style={{ background: s.bg }}
                    >
                      {s.dots.map((d) => (
                        <span key={d} className="h-2.5 w-2.5 rounded-full" style={{ background: d }} />
                      ))}
                    </div>
                    <div className="flex items-center justify-between bg-gray-800 px-3 py-2">
                      <span className={cn("text-xs font-medium", active ? "text-blue-400" : "text-gray-400")}>
                        {t(s.labelKey)}
                      </span>
                      {active && <Check className="h-3.5 w-3.5 text-blue-400" />}
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="mt-5 flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-gray-400">
                <input
                  type="checkbox"
                  checked={settings?.hideThinkingBlock ?? false}
                  onChange={(e) => updateSettings({ hideThinkingBlock: e.target.checked })}
                  className="rounded border-gray-600 bg-gray-800 text-blue-500"
                />
                {t("settings.hide_thinking")}
              </label>
            </div>
          </Card>

          <Card icon={Type} title={t("settings.font_size")} desc={t("settings.font_size_desc")} kicker="// typography">
            <div className="flex max-w-xl items-center gap-4">
              <input
                type="range"
                min={12}
                max={24}
                step={1}
                value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value))}
                className="flex-1 accent-blue-500"
              />
              <span className="w-12 rounded-lg border border-gray-700 bg-gray-800 px-2 py-1 text-center text-xs text-gray-300">
                {fontSize}px
              </span>
            </div>
          </Card>

          <Card icon={ZoomIn} title={t("settings.ui_zoom")} desc={t("settings.ui_zoom_desc")} kicker="// layout">
            <div className="flex max-w-xl items-center gap-4">
              <input
                type="range"
                min={50}
                max={200}
                step={5}
                value={uiZoom}
                onChange={(e) => setUiZoom(Number(e.target.value))}
                className="flex-1 accent-blue-500"
              />
              <span className="w-14 rounded-lg border border-gray-700 bg-gray-800 px-2 py-1 text-center text-xs text-gray-300">
                {uiZoom}%
              </span>
              <button
                onClick={() => setUiZoom(100)}
                className="rounded-lg border border-gray-700 px-3 py-1 text-xs text-gray-300 transition-colors hover:bg-gray-800"
              >
                {t("settings.ui_zoom_reset")}
              </button>
            </div>
          </Card>
        </div>
      )}

      {/* ── Models ───────────────────────────────────────── */}
      {activeTab === "models" && (
        <div className="space-y-6">
          <Card icon={SettingsIcon} title={t("settings.defaults")} kicker="// defaults">
            <SettingRow label={t("settings.default_provider")} hint="provider namespace">
              <select
                value={settings?.defaultProvider ?? ""}
                onChange={(e) => handleDefaultProviderChange(e.target.value)}
                className={cn(selectCls, "w-56")}
              >
                <option value="">{t("settings.none")}</option>
                {allProviders.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </SettingRow>
            <SettingRow label={t("settings.default_model")} hint="model identifier">
              <select
                value={selectedModelValue}
                onChange={(e) => handleDefaultModelChange(e.target.value)}
                className={cn(selectCls, "w-56")}
              >
                <option value="">{t("settings.none")}</option>
                {groupedModelOptions.map((p) => (
                  <optgroup key={p.id} label={p.name}>
                    {p.models.map((m) => (
                      <option key={modelValue(p.id, m.id)} value={modelValue(p.id, m.id)}>
                        {(m.name || m.id) + " · " + p.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </SettingRow>
            <SettingRow label={t("settings.default_thinking")} hint="reasoning depth">
              <select
                value={settings?.defaultThinkingLevel ?? "medium"}
                onChange={(e) => updateSettings({ defaultThinkingLevel: e.target.value })}
                className={cn(selectCls, "w-56")}
              >
                {["off", "minimal", "low", "medium", "high", "xhigh"].map((l) => (
                  <option key={l} value={l}>{l.charAt(0).toUpperCase() + l.slice(1)}</option>
                ))}
              </select>
            </SettingRow>
            <SettingRow label={t("settings.project_trust")} hint="auto-approve scope">
              <select
                value={settings?.defaultProjectTrust ?? "prompt"}
                onChange={(e) => updateSettings({ defaultProjectTrust: e.target.value })}
                className={cn(selectCls, "w-56")}
              >
                {["prompt", "always", "never"].map((v) => (
                  <option key={v} value={v}>{v.charAt(0).toUpperCase() + v.slice(1)}</option>
                ))}
              </select>
            </SettingRow>
          </Card>
        </div>
      )}

      {/* ── Providers ─────────────────────────────────────── */}
      {activeTab === "providers" && (
        <ProvidersTab />
      )}

      {/* ── Subagents ─────────────────────────────────────── */}
      {activeTab === "subagents" && (
        <SubagentsTab />
      )}

      {/* ── About / Updates ───────────────────────────────── */}
      {activeTab === "about" && (
        <div className="space-y-6">
          <Card icon={CloudDownload} title={t("settings.updates_title")} desc={t("settings.updates_desc")} kicker="// updates">
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={handleCheckUpdates}
                disabled={checkingUpdates || applying}
                className="flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 disabled:opacity-60"
              >
                <RefreshCw className={cn("h-4 w-4", checkingUpdates && "animate-spin")} />
                {t("settings.check_updates")}
              </button>
              {(updateResult?.extensions ?? []).some((e) => e.hasUpdate) && (
                <button
                  onClick={handleApplyUpdates}
                  disabled={applying || checkingUpdates}
                  className="flex items-center gap-2 rounded-lg border border-amber-500 bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-400 hover:bg-amber-500/20 disabled:opacity-60"
                >
                  <CloudDownload className={cn("h-4 w-4", applying && "animate-pulse")} />
                  {applying ? t("settings.updating") : t("settings.update_all")}
                </button>
              )}
            </div>
            {updateError && <p className="mt-3 text-sm text-red-400">{t("settings.updates_failed")}</p>}
            {applyMessage && (
              <div className="mt-3 space-y-1">
                {applyMessage.ok > 0 && (
                  <p className="text-sm text-emerald-400">{t("settings.update_success", String(applyMessage.ok))}</p>
                )}
                {applyMessage.failNames.length > 0 && (
                  <p className="text-sm text-red-400">
                    {t("settings.update_failed_names", String(applyMessage.failNames.length), applyMessage.failNames.join(", "))}
                  </p>
                )}
              </div>
            )}
            {updateResult && (() => {
              const rows = [...(updateResult.pi ? [updateResult.pi] : []), ...updateResult.extensions];
              const updatable = rows.filter((r) => r.hasUpdate).length;
              return (
                <div className="mt-4 space-y-1.5">
                  <p className={cn("text-xs font-semibold", updatable > 0 ? "text-amber-400" : "text-emerald-400")}>
                    {updatable > 0
                      ? t("settings.updates_summary", String(updatable))
                      : t("settings.updates_all_latest")}
                  </p>
                  {rows.map((r) => (
                    <div
                      key={r.name}
                      className={cn(
                        "flex items-center justify-between gap-3 rounded-lg border bg-gray-800/30 px-3 py-2",
                        r.hasUpdate ? "border-amber-500/60" : "border-gray-800"
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-mono text-xs text-gray-200">{r.name}</span>
                        {updateResult.pi && r.name === updateResult.pi.name && (
                          <span className="rounded border border-gray-700 bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-500">
                            core
                          </span>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="font-mono text-[11px] text-gray-500">
                          {r.latest === null ? `${r.installed} → ?` : r.hasUpdate ? `${r.installed} → ${r.latest}` : r.installed}
                        </span>
                        {r.latest === null ? (
                          <span className="rounded border border-gray-700 px-1.5 py-0.5 text-[10px] text-gray-500">
                            {t("settings.updates_lookup_failed")}
                          </span>
                        ) : r.hasUpdate ? (
                          <span className="rounded border border-amber-500 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
                            {t("settings.update_available")}
                          </span>
                        ) : (
                          <span className="rounded border border-emerald-600/60 px-1.5 py-0.5 text-[10px] text-emerald-400">
                            {t("settings.updates_up_to_date")}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                  {updatable > 0 && (
                    <p className="pt-1 text-[11px] text-gray-500">{t("settings.updates_hint")}</p>
                  )}
                </div>
              );
            })()}
          </Card>

          <Card icon={Package} title={t("settings.packages")} kicker="// extensions">
            {(settings?.packages ?? []).length > 0 && (
              <div className="mb-4 flex flex-wrap gap-1.5">
                {(settings?.packages ?? []).map((pkg) => (
                  <span
                    key={pkg}
                    className="flex items-center gap-1.5 rounded-md border border-gray-700 bg-gray-800 px-2.5 py-1 text-xs text-gray-300"
                  >
                    {pkg}
                    <button
                      onClick={() => removePackage(pkg)}
                      className="text-gray-500 hover:text-red-400"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {(settings?.packages ?? []).length === 0 && (
              <p className="mb-4 text-sm text-gray-500">{t("settings.no_packages")}</p>
            )}
            <div className="flex max-w-md gap-2">
              <input
                type="text"
                value={newPackage}
                onChange={(e) => setNewPackage(e.target.value)}
                placeholder={t("settings.package_placeholder")}
                className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white placeholder-gray-500"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newPackage.trim()) {
                    addPackage(newPackage.trim());
                    setNewPackage("");
                  }
                }}
              />
              <button
                onClick={() => {
                  if (newPackage.trim()) {
                    addPackage(newPackage.trim());
                    setNewPackage("");
                  }
                }}
                className="flex items-center gap-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700"
              >
                <Plus className="h-3.5 w-3.5" />
                {t("settings.add")}
              </button>
            </div>
          </Card>

          <Card icon={Download} title={t("settings.import_export")} kicker="// data">
            <div className="flex flex-wrap gap-3">
              <button
                onClick={handleExport}
                className="flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm text-gray-300 hover:bg-gray-700"
              >
                <Download className="h-4 w-4" />
                {t("settings.export")}
              </button>
              <button
                onClick={handleImportClick}
                className="flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm text-gray-300 hover:bg-gray-700"
              >
                <Upload className="h-4 w-4" />
                {t("settings.import")}
              </button>
              <button
                onClick={() => setShowResetConfirm(true)}
                className="flex items-center gap-2 rounded-lg border border-red-700 bg-red-900/30 px-4 py-2 text-sm text-red-400 hover:bg-red-900/50"
              >
                <RotateCcw className="h-4 w-4" />
                {t("settings.reset")}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                className="hidden"
                onChange={handleImportFromInput}
              />
            </div>
            {importError && <p className="mt-3 text-sm text-red-400">{importError}</p>}
          </Card>
        </div>
      )}

      {/* Reset Confirm */}
      <Modal
        open={showResetConfirm}
        onClose={() => setShowResetConfirm(false)}
        title={t("settings.reset_title")}
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-400">{t("settings.reset_confirm")}</p>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setShowResetConfirm(false)}
              className="rounded-lg px-4 py-2 text-sm text-gray-400 hover:bg-gray-800"
            >
              {t("settings.cancel")}
            </button>
            <button
              onClick={() => {
                resetToDefaults();
                setShowResetConfirm(false);
              }}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500"
            >
              {t("settings.reset_action")}
            </button>
          </div>
        </div>
      </Modal>
        </div>
      </div>
    </div>
  );
}

// ─── Providers Tab ───────────────────────────────────────

function ProvidersTab() {
  const { t } = useTranslation();
  const { allProviders, builtinProviders } = useConfigStore();
  const [testing, setTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; message?: string }>>({});

  const handleTest = async (providerId: string, baseUrl: string, apiKey?: string) => {
    setTesting(providerId);
    try {
      const result = await piTestProvider(baseUrl, apiKey);
      setTestResults((prev) => ({ ...prev, [providerId]: { success: result.success, message: result.message } }));
    } catch {
      setTestResults((prev) => ({ ...prev, [providerId]: { success: false, message: 'Connection failed' } }));
    } finally {
      setTesting(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Built-in Providers */}
      <Card icon={Plug} title={t("settings.builtin_providers")} desc={t("settings.builtin_providers_desc")} kicker="// built-in">
        <div className="space-y-2">
          {builtinProviders.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between rounded-xl border px-4 py-3 transition-colors hover:border-[var(--accent)]"
              style={{ borderColor: 'var(--card-border)', backgroundColor: 'var(--bg)' }}
            >
              <div className="flex items-center gap-3">
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-[11px] text-sm font-bold"
                  style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                >
                  {p.name?.charAt(0) || p.id.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="text-sm font-medium" style={{ color: 'var(--page-text)' }}>{p.name || p.id}</div>
                  <div className="label mt-0.5">{p.baseUrl || p.api || 'Built-in'}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {testResults[p.id] && (
                  <span className="label text-xs" style={{ color: testResults[p.id].success ? 'var(--ok)' : 'var(--danger)' }}>
                    {testResults[p.id].success ? '✓' : '✗'} {testResults[p.id].message || ''}
                  </span>
                )}
                {p.baseUrl && (
                  <button
                    onClick={() => handleTest(p.id, p.baseUrl!, undefined)}
                    disabled={testing === p.id}
                    className="rounded-md border px-2.5 py-1 text-xs font-medium transition-colors"
                    style={{ borderColor: 'var(--card-border)', color: 'var(--muted-text)' }}
                  >
                    {testing === p.id ? '...' : t("settings.test")}
                  </button>
                )}
                {p.hasAuth && (
                  <span className="rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ backgroundColor: 'color-mix(in srgb, var(--ok) 14%, transparent)', color: 'var(--ok)' }}>Auth</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Custom Providers */}
      <Card icon={Plug} title={t("settings.custom_providers")} desc={t("settings.custom_providers_desc")} kicker="// custom">
        {allProviders.filter((p) => p.type === 'custom').length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--muted-text)' }}>{t("settings.no_custom_providers")}</p>
        ) : (
          <div className="space-y-2">
            {allProviders.filter((p) => p.type === 'custom').map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between rounded-xl border px-4 py-3 transition-colors hover:border-[var(--accent)]"
                style={{ borderColor: 'var(--card-border)', backgroundColor: 'var(--bg)' }}
              >
                <div>
                  <div className="text-sm font-medium" style={{ color: 'var(--page-text)' }}>{p.name || p.id}</div>
                  <div className="label mt-0.5">{p.baseUrl}</div>
                </div>
                <div className="flex items-center gap-2">
                  {testResults[p.id] && (
                    <span className="label text-xs" style={{ color: testResults[p.id].success ? 'var(--ok)' : 'var(--danger)' }}>
                      {testResults[p.id].success ? '✓' : '✗'}
                    </span>
                  )}
                  <button
                    onClick={() => handleTest(p.id, p.baseUrl || '', p.apiKey)}
                    disabled={testing === p.id}
                    className="rounded-md border px-2.5 py-1 text-xs font-medium transition-colors"
                    style={{ borderColor: 'var(--card-border)', color: 'var(--muted-text)' }}
                  >
                    {testing === p.id ? '...' : t("settings.test")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ─── Subagents Tab ───────────────────────────────────────

function SubagentsTab() {
  const { t } = useTranslation();
  const [data, setData] = useState<{ agents: Array<{ name: string; description: string; file_name: string }>; chains: Array<{ name: string; description: string; steps: Array<{ agent: string }> }> } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    piSubagentsGet()
      .then((d) => setData({
        agents: d.agents.map((a) => ({ name: a.name, description: a.description, file_name: a.fileName })),
        chains: d.chains,
      }))
      .catch(() => setData({ agents: [], chains: [] }))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      {/* Agents */}
      <Card icon={Users} title={t("settings.agents")} desc={t("settings.agents_desc")} kicker="// agents">
        {loading ? (
          <p className="text-sm" style={{ color: 'var(--muted-text)' }}>Loading...</p>
        ) : data?.agents.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--muted-text)' }}>{t("settings.no_agents")}</p>
        ) : (
          <div className="space-y-2">
            {data?.agents.map((agent) => (
              <div
                key={agent.name}
                className="rounded-xl border px-4 py-3 transition-colors hover:border-[var(--accent)]"
                style={{ borderColor: 'var(--card-border)', backgroundColor: 'var(--bg)' }}
              >
                <div className="text-sm font-medium" style={{ color: 'var(--page-text)' }}>{agent.name}</div>
                {agent.description && <div className="text-xs mt-1" style={{ color: 'var(--muted-text)' }}>{agent.description}</div>}
                <div className="label mt-1.5">{agent.file_name}</div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Chains */}
      <Card icon={Users} title={t("settings.chains")} desc={t("settings.chains_desc")} kicker="// chains">
        {loading ? (
          <p className="text-sm" style={{ color: 'var(--muted-text)' }}>Loading...</p>
        ) : data?.chains.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--muted-text)' }}>{t("settings.no_chains")}</p>
        ) : (
          <div className="space-y-2">
            {data?.chains.map((chain) => (
              <div
                key={chain.name}
                className="rounded-xl border px-4 py-3 transition-colors hover:border-[var(--accent)]"
                style={{ borderColor: 'var(--card-border)', backgroundColor: 'var(--bg)' }}
              >
                <div className="text-sm font-medium" style={{ color: 'var(--page-text)' }}>{chain.name}</div>
                {chain.description && <div className="text-xs mt-1" style={{ color: 'var(--muted-text)' }}>{chain.description}</div>}
                {chain.steps.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2.5">
                    {chain.steps.map((step, i) => (
                      <span
                        key={i}
                        className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                        style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                      >
                        {step.agent}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
