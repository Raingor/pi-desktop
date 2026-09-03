import { useState, useRef, useEffect } from "react";
import { useConfigStore } from "@/store/config-store";
import { useTranslation } from "@/lib/i18n";
import { Modal } from "@/components/ui/Modal";
import {
  exportConfig,
  exportConfigToDirectory,
  importConfigFromFile,
  parseImportFile,
  saveLocalBackup,
} from "@/lib/config";
import type { PiConfig, PiSettings, UpdateCheckResult } from "@/types";
import { cn } from "@/lib/utils";
import { RECOMMENDED_PACKAGES } from "@/data/recommended-packages";
import { PackageBrowser } from "./PackageBrowser";
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
  Terminal,
  Sparkles,
  Command,
} from "lucide-react";
import { SkillsPage } from "./SkillsPage";
import { CommandsPage } from "./CommandsPage";
import { PiCliSettingsPage } from "./PiCliSettingsPage";

type SettingsTab =
  | "appearance"
  | "models"
  | "cli"
  | "skills"
  | "commands"
  | "advanced";

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
  children,
}: {
  icon: typeof Palette;
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-gray-800 bg-gray-900/50">
      <div className="flex items-center gap-3 border-b border-gray-800 px-6 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-700 bg-gray-800">
          <Icon className="h-4 w-4 text-blue-400" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-gray-300">{title}</h2>
          {desc && <p className="text-xs text-gray-500">{desc}</p>}
        </div>
      </div>
      <div className="p-6">{children}</div>
    </section>
  );
}

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-gray-800/60 py-3 last:border-b-0 last:pb-0 first:pt-0">
      <span className="text-sm text-gray-400">{label}</span>
      {children}
    </div>
  );
}

export function SettingsPage() {
  const { t } = useTranslation();
  const {
    settings,
    auth,
    modelsJson,
    allProviders,
    updateSettings,
    setTheme,
    addPackage,
    removePackage,
    importConfig: importConfigAction,
    resetToDefaults,
  } = useConfigStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<SettingsTab>("appearance");
  const [newPackage, setNewPackage] = useState("");
  const [importError, setImportError] = useState("");
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showPackageBrowser, setShowPackageBrowser] = useState(false);
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
  const [applyMessage, setApplyMessage] = useState<{ ok: number; failures: { name: string; message?: string }[] } | null>(null);

  const handleCheckUpdates = async () => {
    setCheckingUpdates(true);
    setUpdateError(false);
    setApplyMessage(null);
    try {
      const res = await fetch("/api/pi/check-updates");
      if (!res.ok) throw new Error("check failed");
      setUpdateResult(await res.json());
    } catch {
      setUpdateError(true);
    } finally {
      setCheckingUpdates(false);
    }
  };

  // Names of everything that can be updated: pi core (routed to `pi update`
  // server-side) plus every outdated extension.
  const updatableNames = [
    ...(updateResult?.pi?.hasUpdate ? [updateResult.pi.name] : []),
    ...(updateResult?.extensions ?? []).filter((e) => e.hasUpdate).map((e) => e.name),
  ];

  // One-click update, then re-check so the list reflects the new installed versions.
  const handleApplyUpdates = async () => {
    const names = updatableNames;
    if (names.length === 0) return;
    setApplying(true);
    setApplyMessage(null);
    try {
      const res = await fetch("/api/pi/apply-updates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ names }),
      });
      if (!res.ok) throw new Error("apply failed");
      const { results } = (await res.json()) as {
        results: { name: string; success: boolean; message?: string }[];
      };
      const failures = results.filter((r) => !r.success).map(({ name, message }) => ({ name, message }));
      setApplyMessage({ ok: results.length - failures.length, failures });
      const check = await fetch("/api/pi/check-updates");
      if (check.ok) setUpdateResult(await check.json());
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
    // Migrate away from the old browser zoom implementation. Keeping the
    // legacy `zoom` property would compound scaling with the new layout-aware
    // transform and make dense pages appear clipped or unexpectedly tiny.
    document.documentElement.style.zoom = "";
    document.documentElement.style.setProperty("--ui-zoom", String(uiZoom / 100));
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
  // Only providers that are actually usable belong in the defaults lists: a saved
  // API key (auth.json / models.json override) or a custom provider. A stale
  // saved value is kept so the selects don't render blank.
  const providerOptions = allProviders.filter(
    (p) =>
      p.type === "custom" ||
      p.hasAuth ||
      !!p.apiKey ||
      !!auth?.[p.id]?.key ||
      p.id === settings?.defaultProvider
  );
  const modelProviders = providerOptions.filter((p) => p.models.length > 0);
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

  const tabs: { key: SettingsTab; icon: typeof Palette; label: string }[] = [
    { key: "appearance", icon: Palette, label: t("settings.appearance") },
    { key: "models", icon: LayoutGrid, label: t("settings.tab_models") },
    { key: "cli", icon: Terminal, label: "CLI 设置" },
    { key: "skills", icon: Sparkles, label: "Skills" },
    { key: "commands", icon: Command, label: "命令" },
    { key: "advanced", icon: Wrench, label: t("settings.tab_advanced") },
  ];

  const selectCls =
    "rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white";

  return (
    <div className="space-y-6">
      {/* ── Hero ─────────────────────────────────────────── */}
      <header>
        <div className="text-[11px] font-semibold uppercase tracking-widest text-blue-400">
          pi · workspace
        </div>
        <h1 className="mt-1 text-2xl font-bold text-white">{t("settings.title")}</h1>
        <p className="mt-1 text-sm text-gray-400">{t("settings.subtitle")}</p>
      </header>

      {/* ── Tab nav ──────────────────────────────────────── */}
      <nav className="flex gap-2 border-b border-gray-800 pb-3">
        {tabs.map(({ key, icon: Icon, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={cn(
              "flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm transition-all",
              activeTab === key
                ? "border-blue-500 bg-blue-500/10 text-blue-400"
                : "border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </nav>

      {/* ── Appearance ───────────────────────────────────── */}
      {activeTab === "appearance" && (
        <div className="space-y-6">
          <Card icon={Palette} title={t("settings.theme")} desc={t("settings.theme_desc")}>
            <div className="grid grid-cols-3 gap-3 max-w-xl">
              {THEME_SWATCHES.map((s) => {
                const active = (settings?.theme ?? "light/dark") === s.value;
                return (
                  <button
                    key={s.value}
                    onClick={() => setTheme(s.value)}
                    className={cn(
                      "overflow-hidden rounded-xl border text-left transition-all",
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
              <label className="flex items-center gap-2 text-sm text-gray-400">
                <input
                  type="checkbox"
                  checked={settings?.expandRunSteps ?? true}
                  onChange={(e) =>
                    updateSettings({ expandRunSteps: e.target.checked })
                  }
                  className="rounded border-gray-600 bg-gray-800 text-blue-500"
                />
                {t("settings.expand_run_steps")}
              </label>
            </div>
          </Card>

          <Card icon={Type} title={t("settings.font_size")} desc={t("settings.font_size_desc")}>
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

          <Card icon={ZoomIn} title={t("settings.ui_zoom")} desc={t("settings.ui_zoom_desc")}>
            <div className="flex max-w-xl items-center gap-4">
              <input
                type="range"
                min={50}
                max={200}
                step={5}
                value={uiZoom}
                onInput={(e) => setUiZoom(Number(e.currentTarget.value))}
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
          <Card icon={SettingsIcon} title={t("settings.defaults")}>
            <SettingRow label={t("settings.default_provider")}>
              <select
                value={settings?.defaultProvider ?? ""}
                onChange={(e) => handleDefaultProviderChange(e.target.value)}
                className={cn(selectCls, "w-56")}
              >
                <option value="">{t("settings.none")}</option>
                {providerOptions.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </SettingRow>
            <SettingRow label={t("settings.default_model")}>
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
            <SettingRow label={t("settings.default_thinking")}>
              <select
                value={settings?.defaultThinkingLevel ?? "medium"}
                onChange={(e) => updateSettings({ defaultThinkingLevel: e.target.value as PiSettings["defaultThinkingLevel"] })}
                className={cn(selectCls, "w-56")}
              >
                {["off", "minimal", "low", "medium", "high", "xhigh"].map((l) => (
                  <option key={l} value={l}>{l.charAt(0).toUpperCase() + l.slice(1)}</option>
                ))}
              </select>
            </SettingRow>
            <SettingRow label={t("settings.project_trust")}>
              <select
                value={settings?.defaultProjectTrust ?? "ask"}
                onChange={(e) => updateSettings({ defaultProjectTrust: e.target.value as PiSettings["defaultProjectTrust"] })}
                className={cn(selectCls, "w-56")}
              >
                {["ask", "always", "never"].map((v) => (
                  <option key={v} value={v}>{v.charAt(0).toUpperCase() + v.slice(1)}</option>
                ))}
              </select>
            </SettingRow>
          </Card>
        </div>
      )}

      {/* ── Advanced ─────────────────────────────────────── */}
      {activeTab === "skills" && <SkillsPage />}
      {activeTab === "commands" && <CommandsPage />}
      {activeTab === "cli" && <PiCliSettingsPage />}
      {activeTab === "advanced" && (
        <div className="space-y-6">
          <Card icon={CloudDownload} title={t("settings.updates_title")} desc={t("settings.updates_desc")}>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={handleCheckUpdates}
                disabled={checkingUpdates || applying}
                className="flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 disabled:opacity-60"
              >
                <RefreshCw className={cn("h-4 w-4", checkingUpdates && "animate-spin")} />
                {t("settings.check_updates")}
              </button>
              {updatableNames.length > 0 && (
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
                {applyMessage.failures.length > 0 && (
                  <div className="space-y-1 text-sm text-red-400">
                    <p>{t("settings.update_failed_names", String(applyMessage.failures.length), applyMessage.failures.map((failure) => failure.name).join(", "))}</p>
                    {applyMessage.failures.map((failure) => failure.message && (
                      <p key={failure.name} className="break-words text-xs text-red-300">{failure.name}: {failure.message}</p>
                    ))}
                  </div>
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

          <Card icon={Package} title={t("settings.packages")}>
            <div className="mb-4">
              <button
                onClick={() => setShowPackageBrowser(true)}
                className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
              >
                <Plus className="h-4 w-4" />
                {t("settings.browse_packages")}
              </button>
            </div>
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

            {/* Recommended packages — one-click install */}
            {(() => {
              const installed = new Set(settings?.packages ?? []);
              const recommended = RECOMMENDED_PACKAGES.filter((p) => !installed.has(p.id));
              if (recommended.length === 0) return null;
              return (
                <div className="mb-4">
                  <p className="mb-2 text-xs font-medium" style={{ color: "var(--muted-text)" }}>
                    {t("settings.recommended_packages")}
                  </p>
                  <div className="space-y-1.5">
                    {recommended.map((pkg) => (
                      <div
                        key={pkg.id}
                        className="flex items-center gap-3 rounded-lg border border-gray-700 bg-gray-800/50 px-3 py-2"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-gray-200">{pkg.name}</p>
                          <p className="truncate text-xs text-gray-500">{t(pkg.descKey)}</p>
                        </div>
                        <button
                          onClick={() => addPackage(pkg.id)}
                          className="flex shrink-0 items-center gap-1 rounded-lg border border-blue-600/50 bg-blue-600/10 px-3 py-1.5 text-xs font-medium text-blue-400 hover:bg-blue-600/20"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          {t("settings.install")}
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => {
                      const list = settings?.packages ?? [];
                      const toAdd = recommended.map((p) => p.id);
                      updateSettings({ packages: [...list, ...toAdd] });
                    }}
                    className="mt-2 flex items-center gap-1.5 rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {t("settings.install_all_recommended")}
                  </button>
                </div>
              );
            })()}

            <details className="mb-1">
              <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-300">
                {t("settings.add_custom_package")}
              </summary>
              <div className="mt-2 flex max-w-md gap-2">
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
            </details>
          </Card>

          <Card icon={Download} title={t("settings.import_export")}>
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

      <PackageBrowser
        open={showPackageBrowser}
        onClose={() => setShowPackageBrowser(false)}
        installed={new Set(settings?.packages ?? [])}
        onInstall={(id) => addPackage(id)}
      />

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
  );
}
