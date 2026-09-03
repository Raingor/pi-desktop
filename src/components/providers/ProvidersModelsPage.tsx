import { useEffect, useMemo, useRef, useState } from "react";
import { useConfigStore } from "@/store/config-store";
import { useTranslation } from "@/lib/i18n";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { formatTokens, cn, formatCost } from "@/lib/utils";
import {
  formatImportedApiKeys,
  parseImportedApiKeys,
  parseProviderImport,
  type ImportedApiKey,
} from "@/lib/provider-import";
import { useCurrency } from "@/lib/currency";
import type { ApiType, CustomProviderConfig, Model, PiModelsJson, Provider, ProviderApiKey } from "@/types";
import { MODEL_CATALOG, searchCatalog, catalogToModel, catalogEntryId, findCatalogEntry, guessModelMeta } from "@/data/model-catalog";
import {
  Plus,
  Trash2,
  Edit3,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Server,
  Shield,
  Box,
  Brain,
  Image as ImageIcon,
  Search,
  Check,
  X,
  Loader2,
  Zap,
  ClipboardPaste,
  Download,
  SquareCheck,
  Copy,
  Sparkles,
  Mic,
  Wand2,
} from "lucide-react";

const API_TYPES: { value: ApiType; label: string }[] = [
  { value: "openai-completions", label: "Chat Completions (/chat/completions)" },
  { value: "openai-responses", label: "OpenAI Responses" },
  { value: "openai-codex-responses", label: "OpenAI Codex Responses" },
  { value: "azure-openai-responses", label: "Azure OpenAI Responses" },
  { value: "anthropic-messages", label: "Anthropic Messages" },
  { value: "google-generative-ai", label: "Google Generative AI" },
  { value: "google-vertex", label: "Google Vertex AI" },
  { value: "bedrock-converse-stream", label: "AWS Bedrock" },
  { value: "mistral-conversations", label: "Mistral" },
];

// Shape returned by /api/pi/provider-models (see server/pi-reader.ts FetchedModel)
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

function isValidHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// Defaults for models without explicit limits: 256K context, 32K output
// (32K matches the common max-output ceiling of current mainstream models)
const DEFAULT_CONTEXT_WINDOW = 262144;
const DEFAULT_MAX_TOKENS = 32768;

// Last-resort output cap when neither the catalog nor the id heuristic knows one.
function fallbackMaxTokens(contextWindow?: number): number {
  if (!contextWindow) return DEFAULT_MAX_TOKENS;
  if (contextWindow >= 1_000_000) return 65_536;
  if (contextWindow >= 200_000) return 32_768;
  return 8192;
}

// Sanitize to a config-safe id: letters (any script), digits and hyphens.
// pi shows this key verbatim in its model picker badge, so keep it readable.
function sanitizeProviderId(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}-]/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// Empty or symbol-only names fall back to the endpoint hostname so the
// provider still gets a valid id while keeping the original display name.
function deriveProviderId(name: string, baseUrl: string): string {
  const fromName = sanitizeProviderId(name);
  if (fromName || !name.trim()) return fromName;
  try {
    const host = new URL(baseUrl.trim()).hostname;
    const skip = new Set(["api", "www", "app", "gateway", "open", "openapi", "platform"]);
    const part = host.split(".").find((p) => p && !skip.has(p.toLowerCase()));
    return sanitizeProviderId(part ?? "");
  } catch {
    return "";
  }
}

// ─── API Key Pool ─────────────────────────────────────────
// pi only reads a provider's single `apiKey`, so the extra keys live alongside
// it in models.json as `apiKeys` + `activeKeyId`, and `apiKey` is kept in sync
// with whichever entry is active. Providers saved before this feature existed
// only have `apiKey`, so they get adopted into a one-entry pool on read.

function newKeyId(): string {
  return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function normalizeKeyPool(
  pool: ProviderApiKey[] | undefined,
  legacyKey: string | undefined
): ProviderApiKey[] {
  const list = (pool ?? []).filter((k) => k && typeof k.key === "string" && k.key !== "");
  if (list.length > 0) {
    // Adopt a key that was edited directly in models.json outside the pool.
    if (legacyKey && !list.some((k) => k.key === legacyKey)) {
      return [...list, { id: newKeyId(), key: legacyKey }];
    }
    return list;
  }
  return legacyKey ? [{ id: newKeyId(), key: legacyKey }] : [];
}

// Mask a key for display: keep enough on both ends to tell keys apart.
function maskKey(key: string): string {
  if (key.startsWith("$")) return key; // env var reference — not a secret
  if (key.length <= 12) return `${key.slice(0, 3)}…`;
  return `${key.slice(0, 7)}…${key.slice(-4)}`;
}

// ─── Enabled Models Panel (cross-provider) ────────────────
// Lists every enabled model across all providers. Shares settings.enabledModels
// as the single source of truth with the per-provider model rows, so toggling
// here stays in sync with the enable/disable state inside each provider.

function EnabledModelsPanel() {
  const { t } = useTranslation();
  const { allModels, settings, removeEnabledModel, updateSettings } = useConfigStore();
  const enabledSet = new Set(settings?.enabledModels ?? []);
  const enabledModels = allModels.filter((m) => enabledSet.has(`${m.providerId}/${m.id}`));

  const disableAll = () => updateSettings({ enabledModels: [] });

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-emerald-400" />
          <h2 className="text-sm font-semibold" style={{ color: "var(--page-text)" }}>
            {t("providers_models.enabled_models_title")}
          </h2>
          <span className="rounded-full border border-gray-700 bg-gray-800 px-2 py-0.5 text-xs text-gray-400">
            {enabledModels.length}
          </span>
        </div>
        {enabledModels.length > 0 && (
          <button
            onClick={disableAll}
            className="rounded-lg border border-gray-700 px-3 py-1 text-xs text-gray-300 transition-colors hover:bg-gray-800 hover:text-white"
          >
            {t("providers_models.disable_all")}
          </button>
        )}
      </div>

      {enabledModels.length === 0 ? (
        <p className="mt-3 text-sm text-gray-500">{t("providers_models.no_enabled_models")}</p>
      ) : (
        <div className="mt-3 grid max-h-72 gap-1.5 overflow-y-auto pr-1 lg:grid-cols-2">
          {enabledModels.map((m) => {
            const ref = `${m.providerId}/${m.id}`;
            return (
              <div
                key={ref}
                className="flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-900/70 px-3 py-2"
              >
                <button
                  onClick={() => removeEnabledModel(ref)}
                  title={t("models.enabled")}
                  className="relative inline-flex h-4 w-7 shrink-0 items-center rounded-full bg-emerald-500 transition-colors"
                >
                  <span className="inline-block h-3 w-3 transform translate-x-3.5 rounded-full bg-white transition-transform" />
                </button>
                <Box className="h-4 w-4 shrink-0 text-gray-500" />
                <span className="min-w-0 flex-1 truncate font-mono text-sm text-gray-200">
                  {m.name || m.id}
                </span>
                <span className="shrink-0 rounded-md border border-gray-600 bg-gray-800/50 px-2 py-0.5 text-xs text-gray-400">
                  {m.providerName}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ProvidersModelsPage() {
  const { t } = useTranslation();
  const { allProviders, auth, modelsJson, removeCustomProvider, disableCustomProvider, enableCustomProvider } = useConfigStore();
  const hasKey = (p: Provider) => p.hasAuth || !!p.apiKey || !!auth?.[p.id]?.key;

  const customProviders = allProviders.filter((p) => p.type === "custom");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importBump, setImportBump] = useState(0);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState(false);

  // Keep a valid custom-provider selection.
  const selected = customProviders.find((p) => p.id === selectedId) ?? null;
  useEffect(() => {
    if (!selected && !adding && customProviders.length > 0) {
      setSelectedId(customProviders[0]?.id ?? null);
    }
  }, [selected, adding, customProviders]);

  const handleAddProvider = async (id: string, cfg: CustomProviderConfig): Promise<boolean> => {
    const ok = await useConfigStore.getState().addCustomProvider(id, cfg);
    if (ok) {
      setAdding(false);
      setSelectedId(id);
    }
    return ok;
  };

  const handleDeleteProvider = async () => {
    if (!deleteConfirm) return;
    setDeleteError(false);
    const ok = await removeCustomProvider(deleteConfirm);
    if (ok) {
      if (selectedId === deleteConfirm) setSelectedId(null);
      setDeleteConfirm(null);
    } else {
      setDeleteError(true);
    }
  };

  const handleDuplicateProvider = async (id: string) => {
    const existing = modelsJson?.providers[id];
    // Resolve the source models: prefer models.json override, else the
    // builtin provider's model list so duplicates keep their models.
    const sourceProvider = allProviders.find((p) => p.id === id);
    const sourceModels = existing?.models ?? sourceProvider?.models ?? [];
    const sourceName = sourceProvider?.name ?? id;
    // Derive the new key from the display name so pi's model picker badge
    // matches what the user sees in this UI.
    const baseId = sanitizeProviderId(sourceName) || id;
    const suffix = "-copy";
    let newId = sanitizeProviderId(baseId + suffix);
    // Ensure uniqueness against existing provider ids
    const taken = new Set(allProviders.map((p) => p.id));
    let i = 2;
    while (taken.has(newId)) newId = sanitizeProviderId(`${baseId}-copy${i++}`);
    // Copy config but clear apiKey; carry models + headers + overrides
    const cfg: CustomProviderConfig = {
      name: `${sourceName} (copy)`,
      baseUrl: existing?.baseUrl ?? sourceProvider?.baseUrl,
      api: existing?.api ?? sourceProvider?.api,
      headers: existing?.headers,
      compat: existing?.compat,
      modelOverrides: existing?.modelOverrides,
      models: sourceModels.map((m) => ({ ...m, enabled: true })),
    };
    const ok = await useConfigStore.getState().addCustomProvider(newId, cfg);
    if (ok) {
      // Enable the carried models in settings.enabledModels
      const list = useConfigStore.getState().settings?.enabledModels ?? [];
      const refs = sourceModels.map((m) => `${newId}/${m.id}`);
      await useConfigStore.getState().updateSettings({
        enabledModels: Array.from(new Set([...list, ...refs])),
      });
      setSelectedId(newId);
    }
  };

  return (
    <div className="providers-page space-y-6">
      <div className="providers-command-header">
        <div>
          <div className="page-kicker"><span /> ROUTING FABRIC // CONFIGURATION</div>
        <h1 className="text-2xl font-bold" style={{ color: "var(--page-text)" }}>
          {t("nav.providers_models")}
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--muted-text)" }}>
          {t("providers_models.subtitle")}
        </p>
        </div>
        <div className="providers-header-signal"><span /> {t("providers_models.config_sync_ready")}</div>
      </div>

      <EnabledModelsPanel />

      <div className="providers-console flex overflow-hidden rounded-xl border border-gray-800 bg-gray-900/50">
        {/* ─── Left: Provider List ─────────────────────── */}
        <div className="provider-rail w-60 shrink-0 border-r border-gray-800 p-3">
          <p className="px-2 pb-2 pt-1 text-xs font-medium uppercase tracking-wider text-gray-500">
            {t("providers_models.custom_providers")}
          </p>
          <div className="space-y-0.5">
            {customProviders.map((p) => (
              <ProviderListItem
                key={p.id}
                provider={p}
                active={!adding && selectedId === p.id}
                hasKey={hasKey(p)}
                disabled={!!modelsJson?._disabledProviders?.[p.id]}
                onToggleDisabled={() => {
                  if (modelsJson?._disabledProviders?.[p.id]) {
                    enableCustomProvider(p.id);
                  } else {
                    disableCustomProvider(p.id);
                  }
                }}
                onClick={() => {
                  setAdding(false);
                  setSelectedId(p.id);
                }}
              />
            ))}
          </div>

          <button
            onClick={() => setAdding(true)}
            className={cn(
              "mt-2 flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
              adding
                ? "border-gray-600 bg-gray-800 text-white"
                : "border-gray-700 text-gray-300 hover:bg-gray-800 hover:text-white"
            )}
          >
            <Plus className="h-4 w-4" />
            {t("providers.add_provider")}
          </button>

          <button
            onClick={() => setImporting(true)}
            className="mt-2 flex w-full items-center gap-2 rounded-lg border border-gray-700 px-3 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-800 hover:text-white"
          >
            <ClipboardPaste className="h-4 w-4" />
            {t("providers_models.import")}
          </button>
        </div>

        {/* ─── Right: Provider Detail / Add Form ───────── */}
        <div className="provider-detail min-w-0 flex-1 p-6">
          {adding ? (
            <AddProviderForm onSubmit={handleAddProvider} onCancel={() => setAdding(false)} />
          ) : selected ? (
            <ProviderDetail
              key={`${selected.id}:${importBump}`}
              provider={selected}
              onDelete={() => setDeleteConfirm(selected.id)}
              onDuplicate={() => handleDuplicateProvider(selected.id)}
              onRenamed={(newId) => setSelectedId(newId)}
              modelsJson={modelsJson}
              onEnable={enableCustomProvider}
              onDisable={disableCustomProvider}
            />
          ) : (
            <div className="flex h-40 items-center justify-center text-sm text-gray-500">
              {t("providers_models.select_hint")}
            </div>
          )}
        </div>
      </div>

      {/* Import Provider Modal */}
      <ImportProviderModal
        open={importing}
        onClose={() => setImporting(false)}
        onImported={(id) => {
          setImporting(false);
          setAdding(false);
          setSelectedId(id);
          setImportBump((n) => n + 1);
        }}
      />

      {/* Delete Provider Confirmation Modal */}
      <Modal
        open={!!deleteConfirm}
        onClose={() => { setDeleteConfirm(null); setDeleteError(false); }}
        title={t("providers.delete_provider")}
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <Trash2 className="h-5 w-5 shrink-0 mt-0.5 text-red-400" />
            <div>
              <p className="text-sm text-gray-200">
                <strong>{allProviders.find((p) => p.id === deleteConfirm)?.name}</strong>
                {" — "}
                {t("providers.delete_confirm")}
              </p>
              <p className="text-xs mt-2 text-gray-500">
                {t("providers_models.delete_provider_note")}
              </p>
              {deleteError && (
                <p className="text-xs mt-2 text-red-400">{t("providers_models.save_failed")}</p>
              )}
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => { setDeleteConfirm(null); setDeleteError(false); }}
              className="rounded-lg px-4 py-2 text-sm text-gray-400 hover:bg-gray-800"
            >
              {t("models.cancel")}
            </button>
            <button
              onClick={handleDeleteProvider}
              className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white"
              style={{ backgroundColor: "var(--danger-solid)" }}
            >
              <Trash2 className="h-4 w-4" />
              {t("providers.delete_provider")}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ─── Provider List Item ───────────────────────────────────

function ProviderListItem({
  provider,
  active,
  hasKey,
  onClick,
  disabled,
  onToggleDisabled,
}: {
  provider: Provider;
  active: boolean;
  hasKey: boolean;
  onClick: () => void;
  disabled?: boolean;
  onToggleDisabled?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      onClick={onClick}
      className={cn(
        "provider-list-item flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
        active ? "is-active border-gray-600 bg-gray-800 text-white" : "is-inactive border-transparent text-gray-300 hover:bg-gray-800/60",
        disabled && "opacity-50 grayscale"
      )}
    >
      {provider.type === "custom" ? (
        <Server className="h-4 w-4 shrink-0 text-blue-400" />
      ) : (
        <Shield className="h-4 w-4 shrink-0 text-emerald-400" />
      )}
      <span className="min-w-0 flex-1 truncate">{provider.name}</span>
      {onToggleDisabled && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleDisabled(); }}
          className={cn(
            "shrink-0 rounded p-1 transition-colors",
            disabled
              ? "text-gray-600 hover:text-gray-400"
              : "text-emerald-400 hover:text-emerald-300"
          )}
          title={disabled ? t("providers_models.enable_provider") : t("providers_models.disable_provider")}
        >
          {disabled ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
        </button>
      )}
      <span
        className={cn("h-2 w-2 shrink-0 rounded-full", hasKey ? "bg-emerald-400" : "bg-gray-600")}
      />
    </button>
  );
}

// ─── Connection Test Button ───────────────────────────────

type TestState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "ok"; latencyMs: number }
  | { status: "fail"; message: string };

function TestConnectionButton({ baseUrl, apiKey }: { baseUrl: string; apiKey?: string }) {
  const { t } = useTranslation();
  const [test, setTest] = useState<TestState>({ status: "idle" });

  const runTest = async () => {
    setTest({ status: "testing" });
    try {
      const res = await fetch("/api/pi/provider-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: baseUrl.trim(), apiKey: apiKey || undefined }),
      });
      const data = await res.json();
      if (data.success) {
        setTest({ status: "ok", latencyMs: data.latencyMs ?? 0 });
      } else {
        setTest({ status: "fail", message: data.message ?? "unknown" });
      }
    } catch {
      setTest({ status: "fail", message: "network error" });
    }
  };

  const disabled = !baseUrl.trim() || !isValidHttpUrl(baseUrl.trim()) || test.status === "testing";

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={runTest}
        disabled={disabled}
        className="flex items-center gap-2 rounded-lg border border-gray-700 px-3 py-1.5 text-sm text-gray-300 transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {test.status === "testing" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Zap className="h-4 w-4" />
        )}
        {test.status === "testing" ? t("providers_models.testing") : t("providers_models.test_connection")}
      </button>
      {test.status === "ok" && (
        <span className="flex items-center gap-1 text-sm text-emerald-400">
          <Check className="h-4 w-4" />
          {t("providers_models.test_ok", String(test.latencyMs))}
        </span>
      )}
      {test.status === "fail" && (
        <span className="flex items-center gap-1 text-sm text-red-400">
          <X className="h-4 w-4" />
          {t("providers_models.test_fail", test.message)}
        </span>
      )}
    </div>
  );
}

// ─── Provider Detail Panel ────────────────────────────────

function ProviderDetail({ provider, onDelete, onDuplicate, onRenamed, modelsJson, onEnable, onDisable }: { provider: Provider; onDelete: () => void; onDuplicate: () => void; onRenamed: (newId: string) => void; modelsJson: PiModelsJson | null; onEnable: (id: string) => Promise<boolean>; onDisable: (id: string) => Promise<boolean> }) {
  const { t } = useTranslation();
  const { currency } = useCurrency();
  const {
    auth,
    settings,
    updateSettings,
    updateCustomProvider,
    renameCustomProvider,
    setProviderAuth,
    removeProviderAuth,
    addModel,
    updateModel,
    removeModel,
    addEnabledModel,
    removeEnabledModel,
  } = useConfigStore();

  // Whether a model is currently enabled (source of truth: settings.enabledModels)
  const enabledRefs = new Set(settings?.enabledModels ?? []);
  const isModelEnabled = (modelId: string) => enabledRefs.has(`${provider.id}/${modelId}`);

  // Toggle a single model's enabled state
  const toggleModelEnabled = (modelId: string) => {
    const ref = `${provider.id}/${modelId}`;
    if (enabledRefs.has(ref)) removeEnabledModel(ref);
    else addEnabledModel(ref);
  };

  // Enable/disable all models of this provider at once (batched)
  const setAllModelsEnabled = async (on: boolean) => {
    const list = settings?.enabledModels ?? [];
    const refs = provider.models.map((m) => `${provider.id}/${m.id}`);
    const set = new Set(list);
    if (on) refs.forEach((r) => set.add(r));
    else refs.forEach((r) => set.delete(r));
    await updateSettings({ enabledModels: Array.from(set) });
  };

  const isCustom = provider.type === "custom";
  const savedKey = provider.apiKey ?? auth?.[provider.id]?.key ?? "";

  // Custom providers keep a pool of keys in models.json (`apiKeys`) plus an
  // `activeKeyId` pointer; `apiKey` always mirrors the active one because that
  // is the only field pi itself reads.
  const savedKeys = useMemo(
    () => normalizeKeyPool(provider.apiKeys, provider.apiKey),
    [provider.apiKeys, provider.apiKey]
  );
  const savedActiveKeyId =
    savedKeys.find((k) => k.id === provider.activeKeyId)?.id ?? savedKeys[0]?.id ?? "";

  const [providerName, setProviderName] = useState(provider.name ?? "");
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl ?? "");
  const [api, setApi] = useState<ApiType>(provider.api ?? "openai-completions");
  const [apiKey, setApiKey] = useState(savedKey);
  const [keys, setKeys] = useState<ProviderApiKey[]>(savedKeys);
  const [activeKeyId, setActiveKeyId] = useState(savedActiveKeyId);
  const [newKeyValue, setNewKeyValue] = useState("");
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
  const [showKey, setShowKey] = useState(false);
  const [editModel, setEditModel] = useState<Model | null>(null);
  const [showAddModel, setShowAddModel] = useState(false);
  const [deleteModel, setDeleteModel] = useState<Model | null>(null);
  const [supportsDeveloperRole, setSupportsDeveloperRole] = useState(
    provider.compat?.supportsDeveloperRole ?? false
  );
  const [supportsFinishReason, setSupportsFinishReason] = useState(
    provider.compat?.supportsFinishReason ?? true
  );
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [keyError, setKeyError] = useState<string | null>(null);

  // Key actually used for outbound calls (test connection, fetch models).
  const activeKey = keys.find((k) => k.id === activeKeyId)?.key ?? "";
  const effectiveKey = isCustom ? activeKey : apiKey;

  // Persist the pool immediately: `apiKey` mirrors the active entry so pi keeps
  // working, and switching keys should not need a separate Save click.
  const persistKeys = async (nextKeys: ProviderApiKey[], nextActiveId: string) => {
    const active = nextKeys.find((k) => k.id === nextActiveId) ?? nextKeys[0];
    setKeys(nextKeys);
    setActiveKeyId(active?.id ?? "");
    setKeyError(null);
    const ok = await updateCustomProvider(provider.id, {
      apiKeys: nextKeys.length > 0 ? nextKeys : undefined,
      activeKeyId: active?.id,
      apiKey: active?.key,
    });
    if (!ok) setKeyError(t("providers_models.save_failed"));
    return ok;
  };

  const handleAddKey = async () => {
    const value = newKeyValue.trim();
    if (!value) return;
    if (keys.some((k) => k.key === value)) {
      setKeyError(t("providers_models.api_key_duplicate"));
      return;
    }
    const entry: ProviderApiKey = { id: newKeyId(), key: value };
    // First key added becomes active automatically.
    const nextActive = keys.length === 0 ? entry.id : activeKeyId;
    const ok = await persistKeys([...keys, entry], nextActive);
    if (ok) setNewKeyValue("");
  };

  const handleRemoveKey = async (id: string) => {
    const next = keys.filter((k) => k.id !== id);
    // Removing the active key promotes the first remaining one.
    const nextActive = id === activeKeyId ? next[0]?.id ?? "" : activeKeyId;
    await persistKeys(next, nextActive);
    setRevealedKeys((prev) => {
      const s = new Set(prev);
      s.delete(id);
      return s;
    });
  };

  const handleActivateKey = async (id: string) => {
    if (id === activeKeyId) return;
    await persistKeys(keys, id);
  };

  const toggleReveal = (id: string) =>
    setRevealedKeys((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });

  // ─── Quick add (inline, one-liner) ───
  const [quickId, setQuickId] = useState("");
  const [quickHint, setQuickHint] = useState<string | null>(null);
  const [copiedParams, setCopiedParams] = useState<string | null>(null);

  // ─── Fetch Models State ───
  const [fetchOpen, setFetchOpen] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetchedModels, setFetchedModels] = useState<FetchedModel[]>([]);
  const [fetchSelected, setFetchSelected] = useState<Set<string>>(new Set());
  const [fetchQuery, setFetchQuery] = useState("");
  const [fetchImported, setFetchImported] = useState<number | null>(null);

  // ─── Per-Model Test State ───
  const [modelTests, setModelTests] = useState<Map<string, TestState>>(new Map());
  const getModelTest = (modelId: string) => modelTests.get(modelId) ?? { status: "idle" };

  const existingModelIds = new Set(provider.models.map((m) => m.id));
  const availableModels = fetchedModels.filter((m) => !existingModelIds.has(m.id));
  const filteredAvailableModels = useMemo(() => {
    const query = fetchQuery.trim().toLocaleLowerCase();
    if (!query) return availableModels;
    return availableModels.filter((model) =>
      [model.id, model.name].some((value) => value?.toLocaleLowerCase().includes(query))
    );
  }, [availableModels, fetchQuery]);
  const isSelected = (id: string) => fetchSelected.has(id);
  const allSelected = availableModels.length > 0 && availableModels.every((m) => isSelected(m.id));

  const toggleSelect = (id: string) => {
    setFetchSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    setFetchSelected(
      availableModels.every((m) => isSelected(m.id))
        ? new Set()
        : new Set(availableModels.map((m) => m.id)),
    );
  };

  const fetchModels = async () => {
    if (!baseUrl.trim() || !isValidHttpUrl(baseUrl.trim())) return;
    setFetchOpen(true);
    setFetching(true);
    setFetchError(null);
    setFetchedModels([]);
    setFetchSelected(new Set());
    setFetchQuery("");
    setFetchImported(null);
    try {
      const res = await fetch("/api/pi/provider-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: baseUrl.trim(), apiKey: effectiveKey, providerId: provider.id }),
      });
      const data = await res.json();
      if (data.error) setFetchError(data.error);
      else setFetchedModels(data.models ?? []);
    } catch {
      setFetchError("network error");
    } finally {
      setFetching(false);
    }
  };

  const handleImportFetched = async () => {
    const selected = availableModels.filter((m) => isSelected(m.id));
    if (selected.length === 0) return;
    selected.forEach((m) => {
      const input: Model["input"] = ["text"];
      if (m.vision) input.push("image");
      if (m.audio) input.push("audio");
      addModel(provider.id, {
        id: m.id,
        name: m.name,
        reasoning: m.reasoning ?? false,
        input,
        contextWindow: m.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
        maxTokens: m.maxTokens ?? DEFAULT_MAX_TOKENS,
        cost: m.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      } as Model);
    });
    // Models are added disabled by default — the user enables them via the
    // per-model toggle. (No write to settings.enabledModels here.)
    setFetchImported(selected.length);
    setTimeout(() => {
      setFetchOpen(false); setFetchedModels([]); setFetchSelected(new Set());
      setFetchImported(null); setFetchError(null);
    }, 1500);
  };

  const handleTestModel = async (m: Model) => {
    const modelId = m.id;
    setModelTests((prev) => {
      const next = new Map(prev);
      next.set(modelId, { status: "testing" });
      return next;
    });
    try {
      const res = await fetch("/api/pi/model-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: baseUrl.trim(), modelId, apiKey: effectiveKey, apiType: api ?? undefined }),
      });
      const data = await res.json();
      setModelTests((prev) => {
        const next = new Map(prev);
        next.set(modelId, data.success
          ? { status: "ok" as const, latencyMs: data.latencyMs ?? 0 }
          : { status: "fail" as const, message: data.message ?? "unknown" });
        return next;
      });
    } catch {
      setModelTests((prev) => {
        const next = new Map(prev);
        next.set(modelId, { status: "fail" as const, message: "network error" });
        return next;
      });
    }
  };

  // Test every model of the provider sequentially (reuses /api/pi/model-test).
  const handleTestAll = async () => {
    for (const m of provider.models) {
      await handleTestModel(m);
    }
  };

  // Quick-add id changes → live hint
  useEffect(() => {
    const id = quickId.trim();
    if (!id) { setQuickHint(null); return; }
    const g = guessModelMeta(id);
    const exact = findCatalogEntry(id);
    setQuickHint(
      g.source === "catalog" && g.matched
        ? t("models.detected_catalog_meta", g.matched, formatTokens(exact?.contextWindow ?? g.contextWindow ?? 0), formatTokens(exact?.maxTokens ?? g.maxTokens ?? 0))
        : g.source === "heuristic"
          ? t("models.detected_heuristic")
          : null
    );
  }, [quickId, t]);

  const handleQuickAdd = async () => {
    const id = quickId.trim();
    if (!id) return;
    const g = guessModelMeta(id);
    const match = findCatalogEntry(id);
    const existing = provider.models.find((model) => model.id === id);
    if (existing) {
      // Re-entering a known model id acts as metadata repair. This fixes
      // models previously added with generic fallback limits without forcing
      // the user to delete and recreate the model or overwriting a custom
      // provider-specific price.
      if (match) {
        updateModel(provider.id, id, {
          name: match.name ?? existing.name,
          reasoning: match.reasoning ?? existing.reasoning,
          input: match.input ?? existing.input,
          contextWindow: match.contextWindow,
          maxTokens: match.maxTokens,
          cost: existing.cost ?? match.cost,
        });
      }
      const list = settings?.enabledModels ?? [];
      await updateSettings({ enabledModels: Array.from(new Set([...list, `${provider.id}/${id}`])) });
      setQuickId("");
      setQuickHint(null);
      return;
    }
    const cw = match?.contextWindow ?? g.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
    const mt = match?.maxTokens ?? g.maxTokens ?? fallbackMaxTokens(cw);
    const model: Model = {
      id,
      name: match?.name,
      reasoning: g.reasoning ?? false,
      input: g.input ?? ["text"],
      contextWindow: cw,
      maxTokens: mt,
      cost: match?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      enabled: false,
    };
    addModel(provider.id, model);
    // Added disabled by default — the user enables it via the toggle.
    setQuickId("");
    setQuickHint(null);
  };

  const handleCopyParams = async (m: Model) => {
    const payload = {
      reasoning: m.reasoning,
      input: m.input,
      contextWindow: m.contextWindow,
      maxTokens: m.maxTokens,
      cost: m.cost,
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setCopiedParams(m.id);
      setTimeout(() => setCopiedParams(null), 1500);
    } catch {
      // ignore
    }
  };

  const urlInvalid = baseUrl.trim() !== "" && !isValidHttpUrl(baseUrl.trim());

  const dirty =
    (isCustom && (providerName !== (provider.name ?? "") || baseUrl !== (provider.baseUrl ?? "") || api !== (provider.api ?? "openai-completions") || supportsDeveloperRole !== (provider.compat?.supportsDeveloperRole ?? true) || supportsFinishReason !== (provider.compat?.supportsFinishReason ?? true))) ||
    (!isCustom && (baseUrl !== (provider.baseUrl ?? "") || api !== (provider.api ?? "openai-completions") || apiKey !== savedKey));

  const handleSave = async () => {
    setSaveState("saving");
    let ok = true;
    if (isCustom) {
      // apiKey / apiKeys are owned by the key pool below and already persisted,
      // so they are deliberately left out of this patch.
      const cfgPatch = {
        name: providerName || undefined,
        baseUrl: baseUrl || undefined,
        api,
        compat: { ...provider.compat, supportsDeveloperRole, supportsFinishReason },
      };
      // pi's model picker shows the provider key, not the display name, so
      // rename the key too when the name changes (references get rewritten).
      const nameChanged = providerName !== (provider.name ?? "");
      const newId = nameChanged ? sanitizeProviderId(providerName) : "";
      const taken = new Set(useConfigStore.getState().allProviders.map((p) => p.id));
      if (newId && newId !== provider.id && !taken.has(newId)) {
        ok = await renameCustomProvider(provider.id, newId, cfgPatch);
        if (ok) onRenamed(newId);
      } else {
        ok = await updateCustomProvider(provider.id, cfgPatch);
      }
    } else {
      // Builtin providers: baseUrl / api are persisted as a models.json
      // override (so the user can point them at a proxy/gateway), while the
      // API key stays in auth.json (the original behavior) to avoid creating a
      // duplicate standalone custom-provider card.
      const cfgPatch: Partial<CustomProviderConfig> = {};
      if (baseUrl !== (provider.baseUrl ?? "")) cfgPatch.baseUrl = baseUrl || undefined;
      if (api !== (provider.api ?? "openai-completions")) cfgPatch.api = api;
      if (Object.keys(cfgPatch).length > 0) {
        ok = await updateCustomProvider(provider.id, cfgPatch);
      }
      if (apiKey !== savedKey) {
        const authOk = apiKey
          ? await setProviderAuth(provider.id, apiKey)
          : await removeProviderAuth(provider.id);
        ok = ok && authOk;
      }
      if (Object.keys(cfgPatch).length === 0 && apiKey === savedKey) ok = true;
    }
    setSaveState(ok ? "saved" : "error");
    if (ok) setTimeout(() => setSaveState("idle"), 2500);
  };

  const visibleModels = provider.models;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold text-white">{provider.name}</h2>
        <Badge variant={isCustom ? "default" : "info"}>
          {isCustom ? t("providers.custom") : t("providers.builtin")}
        </Badge>
        {savedKey && <Badge variant="success">{t("providers.configured")}</Badge>}
        {isCustom && modelsJson?._disabledProviders?.[provider.id] && (
          <Badge variant="warning">{t("providers_models.disabled")}</Badge>
        )}
        {isCustom && (
          <button
            onClick={onDuplicate}
            className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-blue-500/10 hover:text-blue-400"
            title={t("providers.duplicate_provider")}
          >
            <Copy className="h-4 w-4" />
          </button>
        )}
        {isCustom && (
          <button
            onClick={() => {
              if (modelsJson?._disabledProviders?.[provider.id]) {
                onEnable(provider.id);
              } else {
                onDisable(provider.id);
              }
            }}
            className={cn(
              "rounded-lg p-2 transition-colors",
              modelsJson?._disabledProviders?.[provider.id]
                ? "text-gray-500 hover:bg-yellow-500/10 hover:text-yellow-400"
                : "text-gray-500 hover:bg-emerald-500/10 hover:text-emerald-400"
            )}
            title={
              modelsJson?._disabledProviders?.[provider.id]
                ? t("providers_models.enable_provider")
                : t("providers_models.disable_provider")
            }
          >
            {modelsJson?._disabledProviders?.[provider.id] ? (
              <Lock className="h-4 w-4" />
            ) : (
              <Unlock className="h-4 w-4" />
            )}
          </button>
        )}
        {isCustom && (
          <button
            onClick={onDelete}
            className="ml-auto rounded-lg p-2 text-gray-500 transition-colors hover:bg-red-500/10 hover:text-red-400"
            title={t("providers.delete_provider")}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>


      {/* Name (custom only) */}
      {isCustom && (
        <div>
          <label className="block text-sm text-gray-400">{t("providers_models.name")}</label>
          <input
            type="text"
            value={providerName}
            onChange={(e) => setProviderName(e.target.value)}
            placeholder="My Provider"
            className="mt-1.5 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-white"
          />
        </div>
      )}
      {/* Base URL */}
      <div>
        <label className="block text-sm text-gray-400">{t("providers.base_url")}</label>
        <input
          type="text"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://api.example.com/v1"
          className={cn(
            "mt-1.5 w-full rounded-lg border bg-gray-800 px-3 py-2.5 text-sm text-white",
            urlInvalid ? "border-red-500" : "border-gray-700"
          )}
        />
        {urlInvalid && (
          <p className="mt-1 text-xs text-red-400">{t("providers_models.invalid_url")}</p>
        )}
        {!isCustom && !urlInvalid && baseUrl !== (provider.baseUrl ?? "") && (
          <p className="mt-1 text-xs text-amber-400">{t("providers_models.baseurl_override")}</p>
        )}
      </div>

      {/* API Type */}
      <div>
        <label className="block text-sm text-gray-400">{t("providers.api_type")}</label>
        <select
          value={api}
          onChange={(e) => setApi(e.target.value as ApiType)}
          className="mt-1.5 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-white"
        >
          {API_TYPES.map((a) => (
            <option key={a.value} value={a.value}>{a.label}</option>
          ))}
        </select>
      </div>

      {/* API Key — custom providers get a switchable pool, builtins a single key */}
      {isCustom ? (
        <div>
          <div className="flex items-center justify-between gap-3">
            <label className="block text-sm text-gray-400">{t("providers.api_key")}</label>
            {keys.length > 1 && (
              <span className="text-xs text-gray-500">
                {t("providers_models.api_key_count", String(keys.length))}
              </span>
            )}
          </div>

          {keys.length === 0 && (
            <p className="mt-1.5 text-xs text-gray-500">{t("providers_models.api_key_empty")}</p>
          )}

          {keys.length > 0 && (
            <div className="mt-1.5 space-y-1.5">
              {keys.map((k) => {
                const isActive = k.id === activeKeyId;
                const revealed = revealedKeys.has(k.id);
                return (
                  <div
                    key={k.id}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border px-3 py-2",
                      isActive ? "border-blue-500/60 bg-blue-500/5" : "border-gray-700 bg-gray-800"
                    )}
                  >
                    <input
                      type="radio"
                      name={`active-key-${provider.id}`}
                      checked={isActive}
                      onChange={() => handleActivateKey(k.id)}
                      className="text-blue-500"
                      title={t("providers_models.api_key_use")}
                    />
                    <code className="min-w-0 flex-1 truncate font-mono text-xs text-gray-200">
                      {revealed ? k.key : maskKey(k.key)}
                    </code>
                    {isActive && <Badge variant="success">{t("providers_models.api_key_active")}</Badge>}
                    <button
                      onClick={() => toggleReveal(k.id)}
                      className="rounded-md p-1.5 text-gray-500 hover:text-gray-300"
                      title={revealed ? t("providers_models.api_key_hide") : t("providers_models.api_key_show")}
                    >
                      {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                    <button
                      onClick={() => handleRemoveKey(k.id)}
                      className="rounded-md p-1.5 text-gray-500 hover:text-red-400"
                      title={t("providers_models.api_key_delete")}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-2 flex items-center gap-2">
            <input
              type={showKey ? "text" : "password"}
              value={newKeyValue}
              onChange={(e) => {
                setNewKeyValue(e.target.value);
                setKeyError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddKey();
              }}
              placeholder="sk-... or $MY_API_KEY"
              className="min-w-0 flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-white"
            />
            <button
              onClick={() => setShowKey(!showKey)}
              className="rounded-md p-2 text-gray-500 hover:text-gray-300"
              title={showKey ? t("providers_models.api_key_hide") : t("providers_models.api_key_show")}
            >
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
            <button
              onClick={handleAddKey}
              disabled={newKeyValue.trim() === ""}
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-300 transition-colors hover:bg-gray-800 hover:text-white disabled:opacity-40"
            >
              <Plus className="h-4 w-4" />
              {t("providers_models.api_key_add")}
            </button>
          </div>

          {keyError && <p className="mt-1 text-xs text-red-400">{keyError}</p>}
          {newKeyValue.trim().startsWith("$") && (
            <p className="mt-1 text-xs text-sky-400">
              {t("providers_models.api_key_env", newKeyValue.trim())}
            </p>
          )}
          {keys.length > 1 && (
            <p className="mt-1 text-xs text-gray-500">{t("providers_models.api_key_switch_hint")}</p>
          )}
        </div>
      ) : (
        <div>
          <label className="block text-sm text-gray-400">{t("providers.api_key")}</label>
          <div className="relative mt-1.5">
            <input
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-... or $MY_API_KEY"
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 pr-10 text-sm text-white"
            />
            <button
              onClick={() => setShowKey(!showKey)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-gray-500 hover:text-gray-300"
            >
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {apiKey.trim().startsWith("$") && (
            <p className="mt-1 text-xs text-sky-400">
              {t("providers_models.api_key_env", apiKey.trim())}
            </p>
          )}
        </div>
      )}

      {/* Developer Role Support */}
      <div className="provider-compat-row flex items-center gap-2">
        <input
          id="supports-developer-role"
          type="checkbox"
          checked={supportsDeveloperRole}
          onChange={(e) => setSupportsDeveloperRole(e.target.checked)}
          className="rounded border-gray-600 bg-gray-800 text-blue-500"
        />
        <label htmlFor="supports-developer-role" className="provider-compat-label text-sm text-gray-400">
          <span>{t("compat.supports_developer_role")}</span>
          <span className="provider-compat-description ml-2 text-xs text-gray-500">{t("compat.supports_developer_role_desc")}</span>
        </label>
      </div>

      {/* Finish Reason Support */}
      <div className="provider-compat-row flex items-center gap-2">
        <input
          id="supports-finish-reason"
          type="checkbox"
          checked={supportsFinishReason}
          onChange={(e) => setSupportsFinishReason(e.target.checked)}
          className="rounded border-gray-600 bg-gray-800 text-blue-500"
        />
        <label htmlFor="supports-finish-reason" className="provider-compat-label text-sm text-gray-400">
          <span>{t("compat.supports_finish_reason")}</span>
          <span className="provider-compat-description ml-2 text-xs text-gray-500">{t("compat.supports_finish_reason_desc")}</span>
        </label>
      </div>

      {/* Save / Test / Feedback row */}
      <div className="flex flex-wrap items-center gap-3">
        {dirty && (
          <button
            onClick={handleSave}
            disabled={saveState === "saving" || urlInvalid}
            className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
            style={{ backgroundColor: "var(--accent-solid)", color: "#ffffff" }}
          >
            {saveState === "saving" && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("models.save")}
          </button>
        )}
        {saveState === "saved" && (
          <span className="flex items-center gap-1 text-sm text-emerald-400">
            <Check className="h-4 w-4" />
            {t("providers_models.saved")}
          </span>
        )}
        {saveState === "error" && (
          <span className="flex items-center gap-1 text-sm text-red-400">
            <X className="h-4 w-4" />
            {t("providers_models.save_failed")}
          </span>
        )}
        {isCustom && baseUrl.trim() !== "" && (
          <TestConnectionButton baseUrl={baseUrl} apiKey={effectiveKey} />
        )}
      </div>

      {/* Model List */}
      <div>
        <div className="flex items-center justify-between gap-3">
          <label className="block text-sm text-gray-400">{t("providers_models.model_list")}</label>
          {provider.models.length > 0 && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setAllModelsEnabled(true)}
                className="rounded-md border border-gray-700 px-2.5 py-1 text-xs text-gray-300 transition-colors hover:bg-gray-800 hover:text-white"
              >
                {t("providers_models.enable_all")}
              </button>
              <button
                onClick={() => setAllModelsEnabled(false)}
                className="rounded-md border border-gray-700 px-2.5 py-1 text-xs text-gray-300 transition-colors hover:bg-gray-800 hover:text-white"
              >
                {t("providers_models.disable_all")}
              </button>
              <button
                onClick={handleTestAll}
                title={t("providers_models.test_all")}
                className="rounded-md border border-gray-700 px-2.5 py-1 text-xs text-gray-300 transition-colors hover:bg-gray-800 hover:text-white"
              >
                <Zap className="mr-1 inline h-3 w-3" />
                {t("providers_models.test_all")}
              </button>
            </div>
          )}
        </div>

        <div className="mt-1.5 space-y-2 rounded-lg border border-gray-800 p-3">
          {provider.models.length === 0 && (
            <p className="px-1 py-2 text-sm text-gray-500">{t("models.no_models")}</p>
          )}
          {provider.models.length > 0 && visibleModels.length === 0 && (
            <p className="px-1 py-2 text-sm text-gray-500">{t("models.no_models")}</p>
          )}
          {visibleModels.map((m) => {
            const enabled = isModelEnabled(m.id);
            return (
            <div
              key={m.id}
              className="provider-model-row flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-900/70 px-3 py-2.5"
            >
              <button
                onClick={() => toggleModelEnabled(m.id)}
                title={enabled ? t("models.enabled") : t("models.disabled")}
                className={cn(
                  "relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors",
                  enabled ? "bg-emerald-500" : "bg-gray-600"
                )}
              >
                <span
                  className={cn(
                    "inline-block h-3 w-3 transform rounded-full bg-white transition-transform",
                    enabled ? "translate-x-3.5" : "translate-x-0.5"
                  )}
                />
              </button>
              <Box className="h-4 w-4 shrink-0 text-gray-500" />
              <span className="min-w-0 flex-1 truncate font-mono text-sm text-gray-200">
                {m.id}
              </span>
              {m.reasoning && (
                <span title={t("models.reasoning")} className="flex shrink-0">
                  <Brain className="h-3.5 w-3.5 text-purple-400" />
                </span>
              )}
              {m.input?.includes("image") && (
                <span title={t("models.image_input")} className="flex shrink-0">
                  <ImageIcon className="h-3.5 w-3.5 text-blue-400" />
                </span>
              )}
              {m.input?.includes("audio") && (
                <span title={t("models.audio_input")} className="flex shrink-0">
                  <Mic className="h-3.5 w-3.5 text-emerald-400" />
                </span>
              )}
              <span
                className="rounded-md border border-gray-600 bg-gray-800/50 px-2 py-0.5 text-xs text-gray-400"
                title={
                  m.cost
                    ? `In ${formatCost(m.cost.input, currency)} / Out ${formatCost(m.cost.output, currency)} · CacheR ${formatCost(m.cost.cacheRead ?? 0, currency)} / CacheW ${formatCost(m.cost.cacheWrite ?? 0, currency)}`
                    : undefined
                }
              >
                {m.cost && (m.cost.input || m.cost.output)
                  ? `${formatCost(m.cost.input, currency)}/${formatCost(m.cost.output, currency)}`
                  : t("models.free")}
              </span>
              <span className="rounded-md border border-gray-600 bg-gray-800/50 px-2 py-0.5 text-xs text-gray-400">
                {m.contextWindow ? formatTokens(m.contextWindow) : "—"}
              </span>
              {/* Test model */}
              {(() => {
                const test = getModelTest(m.id);
                if (test.status === "testing") return null;
                return (
                  <button
                    onClick={() => handleTestModel(m)}
                    className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-700 hover:text-gray-200"
                    title={t("models.test_model")}
                  >
                    <Zap className="h-3.5 w-3.5" />
                  </button>
                );
              })()}
              {/* Model test result */}
              {(() => {
                const test = getModelTest(m.id);
                if (test.status === "ok") return (
                  <span className="flex items-center gap-1 text-xs text-emerald-400">
                    <Check className="h-3.5 w-3.5" />
                    {t("providers_models.test_ok", String(test.latencyMs))}
                  </span>
                );
                if (test.status === "fail") return (
                  <span className="flex items-center gap-1 text-xs text-red-400">
                    <X className="h-3.5 w-3.5" />
                    {t("providers_models.test_fail", test.message)}
                  </span>
                );
                if (test.status === "testing") return (
                  <span className="flex items-center gap-1 text-xs text-gray-400">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {t("providers_models.testing")}
                  </span>
                );
                return null;
              })()}
              {copiedParams === m.id ? (
                <span className="flex items-center gap-1 px-1 text-xs text-emerald-400">
                  <Check className="h-3.5 w-3.5" />
                </span>
              ) : (
                <button
                  onClick={() => handleCopyParams(m)}
                  className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-700 hover:text-gray-200"
                  title={t("models.copy_params")}
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                onClick={() => setEditModel(m)}
                className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-700 hover:text-gray-200"
                title={t("models.edit_model")}
              >
                <Edit3 className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setDeleteModel(m)}
                className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-red-500/10 hover:text-red-400"
                title={t("models.delete_model")}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          );
          })}
        </div>
        {/* Quick-add input */}
        <div className="mt-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Wand2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-400" />
              <input
                type="text"
                value={quickId}
                onChange={(e) => setQuickId(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); handleQuickAdd(); }
                }}
                placeholder={t("models.quick_add_placeholder")}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 py-2 pl-9 pr-3 text-sm text-white"
              />
            </div>
            <button
              onClick={handleQuickAdd}
              disabled={!quickId.trim()}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50"
              style={{ backgroundColor: "var(--success-solid)" }}
            >
              <Plus className="h-4 w-4" />
              {t("models.quick_add")}
            </button>
            <button
              onClick={() => setShowAddModel(true)}
              className="flex items-center gap-1.5 rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-300 transition-colors hover:bg-gray-800"
            >
              {t("models.add_model")}
            </button>
          </div>
          {quickHint && (
            <p className="mt-1.5 flex items-center gap-1 text-[11px] text-emerald-400">
              <Wand2 className="h-3 w-3" /> {quickHint}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2 mt-3">
          <button
            onClick={fetchModels}
            disabled={!baseUrl.trim() || !isValidHttpUrl(baseUrl.trim()) || fetching}
            title={
              !baseUrl.trim() || !isValidHttpUrl(baseUrl.trim())
                ? t("providers_models.fetch_no_endpoint")
                : t("providers_models.fetch_models")
            }
            className="flex items-center gap-2 rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {fetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {fetching ? t("providers_models.fetching") : t("providers_models.fetch_models")}
          </button>
        </div>
      </div>


      {/* Fetch Models Modal */}
      <Modal
        open={fetchOpen}
        onClose={() => { setFetchOpen(false); setFetchedModels([]); setFetchSelected(new Set()); setFetchQuery(""); setFetchError(null); setFetchImported(null); }}
        title={t("providers_models.fetch_title")}
        size="xl"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-400">{t("providers_models.fetch_desc", provider.name)}</p>
          {fetching && (
            <div className="flex items-center gap-2 py-6 text-gray-400">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>{t("providers_models.fetching")}</span>
            </div>
          )}
          {fetchError && !fetching && (
            <div className="flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
              <X className="h-5 w-5 shrink-0 text-red-400 mt-0.5" />
              <p className="text-sm text-red-300">{t("providers_models.fetch_error", fetchError)}</p>
            </div>
          )}
          {!fetching && !fetchError && availableModels.length === 0 && fetchedModels.length === 0 && (
            <p className="text-sm text-gray-500">{t("providers_models.fetch_empty")}</p>
          )}
          {!fetching && !fetchError && availableModels.length > 0 && (
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                <input
                  autoFocus
                  type="search"
                  value={fetchQuery}
                  onChange={(e) => setFetchQuery(e.target.value)}
                  placeholder={t("models.search_placeholder")}
                  aria-label={t("models.search_placeholder")}
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 py-2 pl-9 pr-3 text-sm text-white placeholder:text-gray-500 outline-none transition-colors focus:border-blue-500"
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">
                  {t("providers_models.selected_count", String(fetchSelected.size), String(availableModels.length))}
                </span>
                <button onClick={toggleAll} className="rounded-md px-2 py-1 text-xs">
                  {allSelected
                    ? <span className="text-amber-400">{t("providers_models.deselect_all")}</span>
                    : <span className="text-emerald-400">{t("providers_models.select_all")}</span>
                  }
                </button>
              </div>
              <div className="max-h-72 overflow-y-auto space-y-1.5 rounded-lg border border-gray-800 p-3">
                {filteredAvailableModels.length === 0 ? (
                  <p className="py-6 text-center text-sm text-gray-500">{t("providers_models.no_match")}</p>
                ) : filteredAvailableModels.map((m) => (
                  <div key={m.id} className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-gray-800 cursor-pointer" onClick={() => toggleSelect(m.id)}>
                    <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded border"
                      style={{ backgroundColor: isSelected(m.id) ? "var(--accent-solid)" : "transparent", borderColor: isSelected(m.id) ? "var(--accent-solid)" : "#4b5563" }}
                    >
                      {isSelected(m.id) && <SquareCheck className="h-4 w-4 text-white" />}
                    </div>
                    <span className="min-w-0 flex-1 truncate font-mono text-sm text-gray-200">{m.id}</span>
                    {m.reasoning && (
                      <span className="flex shrink-0 items-center rounded border border-purple-500/40 bg-purple-500/10 px-1.5 py-0.5 text-[10px] text-purple-400">
                        <Brain className="h-3 w-3" />
                      </span>
                    )}
                    <span className={`flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${m.vision ? "border-blue-500/40 bg-blue-500/10 text-blue-400" : "border-gray-700 bg-gray-800 text-gray-500"}`}>
                      {m.vision ? <ImageIcon className="h-3 w-3" /> : <span className="h-3 w-3 inline-block" />}
                      {m.vision ? t("providers_models.modality_vision") : t("providers_models.modality_text")}
                    </span>
                    {m.audio && (
                      <span className="flex shrink-0 items-center rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-400">
                        <Mic className="h-3 w-3" />
                      </span>
                    )}
                    {m.contextWindow && <span className="rounded border border-gray-700 bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-500 font-mono">{formatTokens(m.contextWindow)}</span>}
                    {m.maxTokens && <span className="rounded border border-gray-700 bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-500 font-mono">{formatTokens(m.maxTokens)}</span>}
                    {m.cost && (m.cost.input || m.cost.output) ? (
                      <span className="rounded border border-gray-700 bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-500 font-mono">${m.cost.input}/${m.cost.output}</span>
                    ) : null}
                  </div>
                ))}
              </div>
            </>
          )}
          <div className="flex items-center justify-end gap-3 pt-1">
            {fetchImported !== null && (
              <span className="flex items-center gap-1 text-sm text-emerald-400">
                <Check className="h-4 w-4" />
                {t("providers_models.import_done", String(fetchImported))}
              </span>
            )}
            <button onClick={() => { setFetchOpen(false); setFetchedModels([]); setFetchSelected(new Set()); setFetchQuery(""); setFetchError(null); setFetchImported(null); }}
              className="rounded-lg px-4 py-2 text-sm text-gray-400 hover:bg-gray-800">
              {t("models.cancel")}
            </button>
            <button onClick={handleImportFetched} disabled={fetching || fetchSelected.size === 0}
              className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
              style={{ backgroundColor: "var(--accent-solid)", color: "#ffffff" }}>
              {t("providers_models.confirm_import")}
            </button>
          </div>
        </div>
      </Modal>

      {/* Edit Model Modal */}
      <Modal
        open={!!editModel}
        onClose={() => setEditModel(null)}
        title={`${t("models.edit_model")}: ${editModel?.name || editModel?.id}`}
        size="xl"
      >
        {editModel && (
          <ModelForm
            initial={editModel}
            onSubmit={(form) => {
              // Apply default maxTokens if left empty
              const patched: Partial<Model> = { ...form };
              if (patched.maxTokens === undefined) patched.maxTokens = DEFAULT_MAX_TOKENS;
              updateModel(provider.id, editModel.id, patched);
              setEditModel(null);
            }}
            onCancel={() => setEditModel(null)}
          />
        )}
      </Modal>

      {/* Add Model Modal */}
      <Modal
        open={showAddModel}
        onClose={() => setShowAddModel(false)}
        title={`${t("models.add_model")} — ${provider.name}`}
        size="xl"
      >
        <ModelForm
          onSubmit={(form) => {
            if (!form.id) return;
            addModel(provider.id, form as Model);
            setShowAddModel(false);
          }}
          onCancel={() => setShowAddModel(false)}
        />
      </Modal>

      {/* Delete Model Confirmation Modal */}
      <Modal
        open={!!deleteModel}
        onClose={() => setDeleteModel(null)}
        title={t("models.delete_model")}
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <Trash2 className="h-5 w-5 shrink-0 mt-0.5 text-red-400" />
            <p className="text-sm text-gray-200">
              <strong className="font-mono">{deleteModel?.id}</strong>
              {" — "}
              {t("models.delete_confirm")}
            </p>
          </div>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setDeleteModel(null)}
              className="rounded-lg px-4 py-2 text-sm text-gray-400 hover:bg-gray-800"
            >
              {t("models.cancel")}
            </button>
            <button
              onClick={() => {
                if (deleteModel) {
                  removeModel(provider.id, deleteModel.id);
                  setDeleteModel(null);
                }
              }}
              className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white"
              style={{ backgroundColor: "var(--danger-solid)" }}
            >
              <Trash2 className="h-4 w-4" />
              {t("models.delete_model")}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ─── Model Form (add & edit) ──────────────────────────────

interface ModelFormProps {
  initial?: Model;
  onSubmit: (form: Partial<Model>) => void;
  onCancel: () => void;
}

function ModelForm({ initial, onSubmit, onCancel }: ModelFormProps) {
  const { t } = useTranslation();
  const isEdit = !!initial;

  const [form, setForm] = useState<Partial<Model>>(
    initial
      ? { ...initial }
      : {
          id: "",
          name: "",
          reasoning: false,
          input: ["text"],
          contextWindow: DEFAULT_CONTEXT_WINDOW,
          maxTokens: DEFAULT_MAX_TOKENS,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        }
  );

  // Which fields the user has manually changed (so auto-detect doesn't clobber them)
  const touchedRef = useRef<Set<string>>(new Set());
  const touch = (field: string) => { touchedRef.current.add(field); };
  const wasTouched = (field: string) => touchedRef.current.has(field);

  // Auto-detect from model id when not editing and id changes
  const [detectHint, setDetectHint] = useState<string | null>(null);
  useEffect(() => {
    if (isEdit) return;
    const id = (form.id ?? "").trim();
    if (!id) { setDetectHint(null); return; }

    const guess = guessModelMeta(id);
    if (guess.source === "default") { setDetectHint(null); return; }

    // The catalog is authoritative when it has an entry: maxTokens there is the
    // vendor-documented output cap. Resolving it via findCatalogEntry (best
    // score) instead of a loose searchCatalog+includes scan avoids a broad
    // family prefix winning over the exact model.
    const match = findCatalogEntry(id);

    setForm((prev) => {
      const next = { ...prev };
      if (guess.contextWindow && !wasTouched("contextWindow")) next.contextWindow = guess.contextWindow;
      if (!wasTouched("maxTokens") || next.maxTokens === undefined) {
        next.maxTokens = match?.maxTokens ?? guess.maxTokens ?? fallbackMaxTokens(guess.contextWindow);
      }
      if (guess.reasoning !== undefined && !wasTouched("reasoning")) next.reasoning = guess.reasoning;
      if (guess.input && !wasTouched("input")) next.input = [...guess.input];
      if (match) {
        if (!wasTouched("name")) next.name = match.name;
        if (match.cost && !wasTouched("cost")) next.cost = { ...match.cost };
      }
      return next;
    });

    setDetectHint(
      guess.source === "catalog" && guess.matched
        ? t("models.detected_catalog", guess.matched)
        : t("models.detected_heuristic")
    );
  }, [form.id, isEdit, t]);

  // ── Catalog picker (add-mode only) ──
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  // No limit: an empty query must list the whole catalog, otherwise families
  // ordered late in the array (GLM, Kimi, Doubao, Llama, Grok) are unreachable
  // without typing.
  const pickerResults = useMemo(
    () => searchCatalog(pickerQuery, MODEL_CATALOG.length),
    [pickerQuery]
  );
  const applyPreset = (entry: ReturnType<typeof searchCatalog>[number]) => {
    const preset = catalogToModel(entry);
    // Apply all fields as if they were default (no touch-marking)
    touchedRef.current = new Set();
    setForm((prev) => ({ ...prev, ...preset }));
    setPickerOpen(false);
    setDetectHint(t("models.detected_catalog", entry.name ?? catalogEntryId(entry)));
  };

  // Apply a quick template (Claude-style, GPT-style, Reasoning, Local small)
  const applyTemplate = (kind: "claude" | "gpt" | "reasoning" | "small") => {
    touchedRef.current = new Set();
    setForm((prev) => {
      switch (kind) {
        case "claude":
          return { ...prev, reasoning: true, input: ["text", "image"], contextWindow: 200_000, maxTokens: 8192 };
        case "gpt":
          return { ...prev, reasoning: false, input: ["text", "image"], contextWindow: 128_000, maxTokens: 16_384 };
        case "reasoning":
          return { ...prev, reasoning: true, input: ["text"], contextWindow: 128_000, maxTokens: 65_536 };
        case "small":
          return { ...prev, reasoning: false, input: ["text"], contextWindow: 32_768, maxTokens: 4096 };
      }
    });
  };

  const setId = (v: string) => { touch("id"); setForm((p) => ({ ...p, id: v })); };
  const setName = (v: string) => { touch("name"); setForm((p) => ({ ...p, name: v })); };
  const setContextWindow = (v: number) => { touch("contextWindow"); setForm((p) => ({ ...p, contextWindow: v })); };
  const setMaxTokens = (v: number | undefined) => { touch("maxTokens"); setForm((p) => ({ ...p, maxTokens: v })); };
  const setReasoning = (v: boolean) => { touch("reasoning"); setForm((p) => ({ ...p, reasoning: v })); };
  const setImage = (v: boolean) => {
    touch("input");
    setForm((p) => ({ ...p, input: v ? ["text", "image"] : ["text"] }));
  };
  const setAudio = (v: boolean) => {
    touch("input");
    setForm((p) => {
      const hasText = p.input?.includes("text") ?? true;
      const hasImage = p.input?.includes("image") ?? false;
      const next: ("text" | "image" | "audio")[] = [];
      if (hasText) next.push("text");
      if (hasImage) next.push("image");
      if (v) next.push("audio");
      return { ...p, input: next };
    });
  };
  const setCostField = (field: keyof NonNullable<Model["cost"]>, v: number) => {
    touch("cost");
    setForm((p) => ({
      ...p,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, ...p.cost, [field]: v },
    }));
  };

  return (
    <div className="space-y-4">
      {/* ── Catalog picker / templates (add-mode) ── */}
      {!isEdit && (
        <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setPickerOpen((o) => !o)}
              className="flex items-center gap-1.5 rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700"
            >
              <Sparkles className="h-3.5 w-3.5 text-amber-400" />
              {t("models.pick_preset")}
            </button>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wide text-gray-500 mr-1">{t("models.manual_fill")}:</span>
              {([
                ["claude", "models.preset_claude"],
                ["gpt", "models.preset_gpt"],
                ["reasoning", "models.preset_reasoning"],
                ["small", "models.preset_small_local"],
              ] as const).map(([kind, key]) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => applyTemplate(kind)}
                  className="rounded-md border px-2 py-1 text-[11px] transition-colors"
                  style={{
                    borderColor: "var(--card-border)",
                    backgroundColor: "var(--card-bg-solid)",
                    color: "var(--muted-text)",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.color = "var(--page-text)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.color = "var(--muted-text)";
                  }}
                >
                  {t(key)}
                </button>
              ))}
            </div>
          </div>

          {pickerOpen && (
            <div className="mt-3 space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                <input
                  autoFocus
                  type="text"
                  value={pickerQuery}
                  onChange={(e) => setPickerQuery(e.target.value)}
                  placeholder={t("models.pick_preset_placeholder")}
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 py-2 pl-9 pr-3 text-sm text-white"
                />
              </div>
              <div className="max-h-56 overflow-y-auto rounded-lg border border-gray-800">
                {pickerResults.length === 0 && (
                  <p className="px-3 py-4 text-center text-xs text-gray-500">—</p>
                )}
                {pickerResults.map((e) => (
                  <button
                    key={catalogEntryId(e)}
                    type="button"
                    onClick={() => applyPreset(e)}
                    className="flex w-full items-center gap-3 border-b border-gray-800 px-3 py-2 text-left hover:bg-gray-800 last:border-0"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-gray-200">{e.name}</span>
                      <span className="block truncate font-mono text-[11px] text-gray-500">{catalogEntryId(e)}</span>
                    </span>
                    {e.reasoning && <Brain className="h-3.5 w-3.5 shrink-0 text-purple-400" aria-label="reasoning" />}
                    {e.input?.includes("image") && <ImageIcon className="h-3.5 w-3.5 shrink-0 text-blue-400" aria-label="vision" />}
                    <span className="shrink-0 rounded border border-gray-700 bg-gray-800 px-1.5 py-0.5 text-[10px] font-mono text-gray-500">
                      {formatTokens(e.contextWindow)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Core fields ── */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-400">{t("models.model_id")} *</label>
          <input
            type="text"
            value={form.id ?? ""}
            disabled={isEdit}
            onChange={(e) => setId(e.target.value)}
            placeholder="my-model-id"
            className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white disabled:opacity-50"
          />
          {!isEdit && detectHint && (
            <p className="mt-1 flex items-center gap-1 text-[11px] text-emerald-400">
              <Wand2 className="h-3 w-3" />
              {detectHint}
            </p>
          )}
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400">{t("models.display_name")}</label>
          <input
            type="text"
            value={form.name ?? ""}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Custom Model"
            className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400">{t("models.context_window")}</label>
          <input
            type="number"
            value={form.contextWindow ?? DEFAULT_CONTEXT_WINDOW}
            onChange={(e) => setContextWindow(parseInt(e.target.value) || DEFAULT_CONTEXT_WINDOW)}
            className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
          />
          <div className="mt-1 flex flex-wrap gap-1">
            {[32_768, 65_536, 131_072, 262_144, 524_288, 1_000_000].map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setContextWindow(v)}
                className={cn(
                  "rounded border px-1.5 py-0.5 text-[10px] font-mono transition-colors",
                  (form.contextWindow ?? DEFAULT_CONTEXT_WINDOW) === v
                    ? "border-blue-500 bg-blue-500/20 text-blue-300"
                    : "border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-500 hover:text-gray-200"
                )}
              >
                {formatTokens(v)}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400">{t("models.max_tokens")}</label>
          <input
            type="number"
            value={form.maxTokens ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              setMaxTokens(v === "" ? undefined : parseInt(v) || undefined);
            }}
            placeholder={String(DEFAULT_MAX_TOKENS)}
            className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
          />
          <p className="mt-0.5 text-[10px] text-gray-500">{t("models.max_tokens_hint", String(DEFAULT_MAX_TOKENS))}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {[4096, 8192, 16_384, 32_768, 65_536].map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setMaxTokens(v)}
                className={cn(
                  "rounded border px-1.5 py-0.5 text-[10px] font-mono transition-colors",
                  (form.maxTokens ?? DEFAULT_MAX_TOKENS) === v
                    ? "border-blue-500 bg-blue-500/20 text-blue-300"
                    : "border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-500 hover:text-gray-200"
                )}
              >
                {formatTokens(v)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Capabilities */}
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={form.reasoning ?? false}
            onChange={(e) => setReasoning(e.target.checked)}
            className="rounded border-gray-600 bg-gray-800 text-blue-500"
          />
          <Brain className="h-3.5 w-3.5 text-purple-400" />
          {t("models.reasoning")}
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={form.input?.includes("image") ?? false}
            onChange={(e) => setImage(e.target.checked)}
            className="rounded border-gray-600 bg-gray-800 text-blue-500"
          />
          <ImageIcon className="h-3.5 w-3.5 text-blue-400" />
          {t("models.image_input")}
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={form.input?.includes("audio") ?? false}
            onChange={(e) => setAudio(e.target.checked)}
            className="rounded border-gray-600 bg-gray-800 text-blue-500"
          />
          <Mic className="h-3.5 w-3.5 text-emerald-400" />
          {t("models.audio_input")}
        </label>
      </div>

      {/* Cost */}
      <div className="grid grid-cols-4 gap-3">
        {(
          [
            ["input", "models.cost_input"],
            ["output", "models.cost_output"],
            ["cacheRead", "models.cost_cache_read"],
            ["cacheWrite", "models.cost_cache_write"],
          ] as const
        ).map(([field, labelKey]) => (
          <div key={field}>
            <label className="block text-xs text-gray-500">{t(labelKey)} $/M</label>
            <input
              type="number"
              step="0.01"
              value={form.cost?.[field] ?? 0}
              onChange={(e) => setCostField(field, parseFloat(e.target.value) || 0)}
              className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
            />
          </div>
        ))}
      </div>

      {!isEdit && (
        <p className="text-[11px] text-gray-500">{t("models.catalog_hint")}</p>
      )}

      <div className="flex justify-end gap-3 pt-2">
        <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm text-gray-400 hover:bg-gray-800">
          {t("models.cancel")}
        </button>
        <button
          onClick={() => onSubmit(form)}
          disabled={!form.id}
          className="rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
          style={{ backgroundColor: "var(--accent-solid)", color: "#ffffff" }}
        >
          {isEdit ? t("models.save") : t("models.add_model")}
        </button>
      </div>
    </div>
  );
}

// ─── Add Provider Form ────────────────────────────────────

function AddProviderForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (id: string, cfg: CustomProviderConfig) => Promise<boolean>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const { allProviders } = useConfigStore();
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [api, setApi] = useState<ApiType>("openai-completions");
  const [models, setModels] = useState<Model[]>([]);
  const [showAddModel, setShowAddModel] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(false);

  const id = deriveProviderId(name, baseUrl);
  const idExists = !!id && allProviders.some((p) => p.id === id);
  const urlInvalid = baseUrl.trim() !== "" && !isValidHttpUrl(baseUrl.trim());

  const handleSubmit = async () => {
    if (!id || !baseUrl || idExists || urlInvalid) return;
    setSubmitting(true);
    setSubmitError(false);
    // Seed the key pool so the detail panel can switch keys right away.
    const seedKey = apiKey.trim() ? { id: newKeyId(), key: apiKey.trim() } : null;
    const ok = await onSubmit(id, {
      name: name.trim() || undefined,
      baseUrl,
      api,
      apiKey: seedKey?.key,
      apiKeys: seedKey ? [seedKey] : undefined,
      activeKeyId: seedKey?.id,
      models,
    });
    setSubmitting(false);
    if (!ok) setSubmitError(true);
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-white">
          {t("providers_models.add_provider_title")}
        </h2>
        <p className="mt-1 text-sm text-gray-500">{t("providers_models.add_provider_desc")}</p>
      </div>

      {/* Name */}
      <div>
        <label className="block text-sm text-gray-400">{t("providers_models.name")}</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("providers_models.name_placeholder")}
          className={cn(
            "mt-1.5 w-full rounded-lg border bg-gray-800 px-3 py-2.5 text-sm text-white",
            idExists ? "border-red-500" : "border-gray-700"
          )}
        />
        {idExists ? (
          <p className="mt-1 text-xs text-red-400">{t("providers_models.id_exists", id)}</p>
        ) : id ? (
          <p className="mt-1 text-xs text-gray-500">{t("providers_models.id_preview", id)}</p>
        ) : name.trim() ? (
          <p className="mt-1 text-xs text-red-400">{t("providers_models.id_invalid")}</p>
        ) : null}
      </div>

      {/* Base URL */}
      <div>
        <label className="block text-sm text-gray-400">{t("providers.base_url")}</label>
        <input
          type="text"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://api.example.com/v1"
          className={cn(
            "mt-1.5 w-full rounded-lg border bg-gray-800 px-3 py-2.5 text-sm text-white",
            urlInvalid ? "border-red-500" : "border-gray-700"
          )}
        />
        {urlInvalid && (
          <p className="mt-1 text-xs text-red-400">{t("providers_models.invalid_url")}</p>
        )}
      </div>

      {/* API Key */}
      <div>
        <label className="block text-sm text-gray-400">{t("providers.api_key")}</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-... or $MY_API_KEY"
          className="mt-1.5 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-white"
        />
      </div>

      {/* API Type */}
      <div>
        <label className="block text-sm text-gray-400">{t("providers.api_type")}</label>
        <select
          value={api}
          onChange={(e) => setApi(e.target.value as ApiType)}
          className="mt-1.5 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-white"
        >
          {API_TYPES.map((a) => (
            <option key={a.value} value={a.value}>{a.label}</option>
          ))}
        </select>
      </div>

      {/* Connection test with the values entered above */}
      {baseUrl.trim() !== "" && !urlInvalid && (
        <TestConnectionButton baseUrl={baseUrl} apiKey={apiKey} />
      )}

      {/* Initial Model List */}
      <div>
        <label className="block text-sm text-gray-400">{t("providers_models.model_list")}</label>
        {models.length > 0 && (
          <div className="mt-1.5 space-y-2">
            {models.map((m) => (
              <div
                key={m.id}
                className="provider-model-row flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-900/70 px-3 py-2.5"
              >
                <Box className="h-4 w-4 shrink-0 text-gray-500" />
                <span className="min-w-0 flex-1 truncate font-mono text-sm text-gray-200">
                  {m.id}
                </span>
                <span className="rounded-md border border-gray-600 bg-gray-800/50 px-2 py-0.5 text-xs text-gray-400">
                  {m.contextWindow ? formatTokens(m.contextWindow) : "—"}
                </span>
                <button
                  onClick={() => setModels(models.filter((x) => x.id !== m.id))}
                  className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-red-500/10 hover:text-red-400"
                  title={t("models.delete_model")}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        <button
          onClick={() => setShowAddModel(true)}
          className="mt-2 flex items-center gap-2 rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 transition-colors hover:bg-gray-800"
        >
          <Plus className="h-4 w-4" />
          {t("models.add_model")}
        </button>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSubmit}
          disabled={!id || !baseUrl || idExists || urlInvalid || submitting}
          className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
          style={{ backgroundColor: "var(--accent-solid)", color: "#ffffff" }}
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {t("providers.add_provider")}
        </button>
        <button
          onClick={onCancel}
          className="rounded-lg px-4 py-2 text-sm text-gray-400 hover:bg-gray-800"
        >
          {t("models.cancel")}
        </button>
        {submitError && (
          <span className="flex items-center gap-1 text-sm text-red-400">
            <X className="h-4 w-4" />
            {t("providers_models.save_failed")}
          </span>
        )}
      </div>

      {/* Add Initial Model Modal */}
      <Modal
        open={showAddModel}
        onClose={() => setShowAddModel(false)}
        title={t("models.add_model")}
        size="xl"
      >
        <ModelForm
          onSubmit={(form) => {
            if (!form.id) return;
            setModels([...models.filter((x) => x.id !== form.id), form as Model]);
            setShowAddModel(false);
          }}
          onCancel={() => setShowAddModel(false)}
        />
      </Modal>
    </div>
  );
}

// ─── Import Provider Modal ─────────────────────────────────

function ImportProviderModal({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { allProviders } = useConfigStore();

  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKeys, setApiKeys] = useState<ImportedApiKey[]>([]);
  const [apiKeysText, setApiKeysText] = useState("");
  const [api, setApi] = useState<ApiType>("openai-completions");
  const [modelIds, setModelIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(false);

  // ─── Fetch models from the endpoint (one-shot import) ───
  const [fetching, setFetching] = useState(false);
  const [fetchErr, setFetchErr] = useState<string | null>(null);
  const [fetchDone, setFetchDone] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<FetchedModel[]>([]);
  const [fetchSel, setFetchSel] = useState<Set<string>>(new Set());

  // Re-parse on every paste/edit of the raw text; fields below stay editable
  const handleText = (value: string) => {
    setText(value);
    const parsed = parseProviderImport(value);
    setName(parsed.name);
    setBaseUrl(parsed.baseUrl);
    setApiKeys(parsed.apiKeys);
    setApiKeysText(formatImportedApiKeys(parsed.apiKeys));
    setModelIds(parsed.modelIds);
  };

  const handleApiKeysText = (value: string) => {
    setApiKeysText(value);
    setApiKeys(parseImportedApiKeys(value));
  };

  const reset = () => {
    setText("");
    setName("");
    setBaseUrl("");
    setApiKeys([]);
    setApiKeysText("");
    setApi("openai-completions");
    setModelIds([]);
    setSubmitting(false);
    setSubmitError(false);
    setFetching(false);
    setFetchErr(null);
    setFetchDone(false);
    setFetchedModels([]);
    setFetchSel(new Set());
  };

  const id = deriveProviderId(name, baseUrl);
  const existing = allProviders.find((p) => p.id === id);
  const builtinConflict = existing?.type === "builtin";
  const mergeTarget = existing?.type === "custom" ? existing : null;
  const urlInvalid = baseUrl.trim() !== "" && !isValidHttpUrl(baseUrl.trim());
  const parsedEmpty =
    text.trim() !== "" && !name && !baseUrl && apiKeys.length === 0 && modelIds.length === 0;
  const canSubmit =
    !!id && (!!baseUrl.trim() || !!mergeTarget) && !urlInvalid && !builtinConflict && !submitting;

  // Fetched models not already covered by the parsed model chips
  const availableFetched = fetchedModels.filter((m) => !modelIds.includes(m.id));
  const allFetchedSelected =
    availableFetched.length > 0 && availableFetched.every((m) => fetchSel.has(m.id));

  const handleFetchModels = async () => {
    if (!isValidHttpUrl(baseUrl.trim()) || fetching) return;
    setFetching(true);
    setFetchErr(null);
    setFetchDone(false);
    try {
      const res = await fetch("/api/pi/provider-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: baseUrl.trim(), apiKey: apiKeys[0]?.key ?? "", providerId: id || undefined }),
      });
      const data = await res.json();
      if (data.error) {
        setFetchErr(data.error);
      } else {
        const models = (data.models ?? []) as FetchedModel[];
        setFetchedModels(models);
        // Select everything by default so import is a single click
        setFetchSel(new Set(models.map((m) => m.id)));
      }
    } catch {
      setFetchErr("network error");
    } finally {
      setFetching(false);
      setFetchDone(true);
    }
  };

  const toggleFetched = (mid: string) => {
    setFetchSel((prev) => {
      const next = new Set(prev);
      if (next.has(mid)) next.delete(mid);
      else next.add(mid);
      return next;
    });
  };
  const toggleAllFetched = () => {
    setFetchSel(allFetchedSelected ? new Set() : new Set(availableFetched.map((m) => m.id)));
  };

  const handleImport = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(false);
    const store = useConfigStore.getState();
    const defaults = {
      input: ["text"] as Model["input"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    };
    const selectedFetched = availableFetched.filter((m) => fetchSel.has(m.id));
    const newModels: Model[] = [
      ...modelIds.map((mid) => ({
        id: mid,
        name: mid.split("/").pop() || mid,
        contextWindow: DEFAULT_CONTEXT_WINDOW,
        maxTokens: DEFAULT_MAX_TOKENS,
        ...defaults,
      })),
      // Fetched models carry real context/output/reasoning/cost when the endpoint provides them
      ...selectedFetched.map((m) => {
        const input: Model["input"] = ["text"];
        if (m.vision) input.push("image");
        if (m.audio) input.push("audio");
        const cost = m.cost
          ? {
              input: m.cost.input ?? 0,
              output: m.cost.output ?? 0,
              cacheRead: m.cost.cacheRead ?? 0,
              cacheWrite: m.cost.cacheWrite ?? 0,
            }
          : defaults.cost;
        return {
          ...defaults,
          id: m.id,
          name: m.name ?? (m.id.split("/").pop() || m.id),
          reasoning: m.reasoning ?? false,
          input,
          contextWindow: m.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
          maxTokens: m.maxTokens ?? DEFAULT_MAX_TOKENS,
          cost,
        };
      }),
    ];
    const newIds = newModels.map((m) => m.id);

    let ok: boolean;
    if (mergeTarget) {
      // Merge into the existing custom provider (dedupe models by id)
      const existingCfg = store.modelsJson?.providers[id];
      const existingModels = existingCfg?.models ?? [];
      const merged = [
        ...existingModels,
        ...newModels.filter((m) => !existingModels.some((e) => e.id === m.id)),
      ];
      // An imported key joins the existing pool instead of replacing it; the
      // active key only changes when the provider had none.
      const pool = normalizeKeyPool(existingCfg?.apiKeys, existingCfg?.apiKey);
      const incoming = apiKeys.filter((entry) => !pool.some((key) => key.key === entry.key));
      const nextPool = [
        ...pool,
        ...incoming.map((entry) => ({
          id: newKeyId(),
          key: entry.key,
          ...(entry.label ? { label: entry.label } : {}),
        })),
      ];
      const activeId =
        nextPool.find((k) => k.id === existingCfg?.activeKeyId)?.id ?? nextPool[0]?.id;
      ok = await store.updateCustomProvider(id, {
        baseUrl: baseUrl.trim() || existingCfg?.baseUrl,
        apiKeys: nextPool.length > 0 ? nextPool : undefined,
        activeKeyId: activeId,
        apiKey: nextPool.find((k) => k.id === activeId)?.key,
        models: merged,
      });
    } else {
      const seedKeys = apiKeys.map((entry) => ({
        id: newKeyId(),
        key: entry.key,
        ...(entry.label ? { label: entry.label } : {}),
      }));
      ok = await store.addCustomProvider(id, {
        name: name.trim() || undefined,
        baseUrl: baseUrl.trim(),
        api,
        apiKey: seedKeys[0]?.key,
        apiKeys: seedKeys.length > 0 ? seedKeys : undefined,
        activeKeyId: seedKeys[0]?.id,
        models: newModels,
      });
    }

    // Imported models are enabled by default (settings.enabledModels refs)
    if (ok && newIds.length > 0) {
      const refs = newIds.map((m) => `${id}/${m}`);
      const list = store.settings?.enabledModels ?? [];
      await store.updateSettings({ enabledModels: Array.from(new Set([...list, ...refs])) });
    }

    setSubmitting(false);
    if (ok) {
      reset();
      onImported(id);
    } else {
      setSubmitError(true);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose(); }}
      title={t("providers_models.import_title")}
      size="xl"
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-500">{t("providers_models.import_desc")}</p>

        {/* Paste area */}
        <textarea
          value={text}
          onChange={(e) => handleText(e.target.value)}
          rows={4}
          placeholder={t("providers_models.import_placeholder")}
          className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 font-mono text-sm text-white placeholder:text-gray-600"
        />
        {parsedEmpty && (
          <p className="text-xs text-amber-400">{t("providers_models.import_empty")}</p>
        )}

        {/* Parsed preview (editable) */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-400">
              {t("providers_models.name")}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("providers_models.name_placeholder")}
              className={cn(
                "mt-1 w-full rounded-lg border bg-gray-800 px-3 py-2 text-sm text-white",
                builtinConflict ? "border-red-500" : "border-gray-700"
              )}
            />
            {builtinConflict ? (
              <p className="mt-1 text-xs text-red-400">
                {t("providers_models.import_builtin_conflict", id)}
              </p>
            ) : mergeTarget ? (
              <p className="mt-1 text-xs text-amber-400">
                {t("providers_models.import_merge", id)}
              </p>
            ) : id ? (
              <p className="mt-1 text-xs text-gray-500">{t("providers_models.id_preview", id)}</p>
            ) : name.trim() ? (
              <p className="mt-1 text-xs text-red-400">{t("providers_models.id_invalid")}</p>
            ) : null}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400">
              {t("providers.api_type")}
            </label>
            <select
              value={api}
              onChange={(e) => setApi(e.target.value as ApiType)}
              className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
            >
              {API_TYPES.map((a) => (
                <option key={a.value} value={a.value}>{a.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400">
              {t("providers.base_url")}
            </label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.example.com/v1"
              className={cn(
                "mt-1 w-full rounded-lg border bg-gray-800 px-3 py-2 text-sm text-white",
                urlInvalid ? "border-red-500" : "border-gray-700"
              )}
            />
            {urlInvalid && (
              <p className="mt-1 text-xs text-red-400">{t("providers_models.invalid_url")}</p>
            )}
          </div>
          <div>
            <label className="flex items-center justify-between text-xs font-medium text-gray-400">
              <span>{t("providers_models.import_keys")}</span>
              {apiKeys.length > 0 && (
                <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-300">
                  {t("providers_models.import_key_count", String(apiKeys.length))}
                </span>
              )}
            </label>
            <textarea
              value={apiKeysText}
              onChange={(e) => handleApiKeysText(e.target.value)}
              rows={Math.max(2, Math.min(5, apiKeys.length || 2))}
              placeholder={t("providers_models.import_keys_placeholder")}
              spellCheck={false}
              className="mt-1 w-full resize-y rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 font-mono text-sm text-white placeholder:text-gray-600"
            />
            <p className="mt-1 text-[11px] leading-4 text-gray-500">
              {t("providers_models.import_keys_hint")}
            </p>
          </div>
        </div>

        {/* Detected models */}
        {modelIds.length > 0 && (
          <div>
            <label className="block text-xs font-medium text-gray-400">
              {t("providers_models.model_list")}
            </label>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {modelIds.map((mid) => (
                <span
                  key={mid}
                  className="flex items-center gap-1.5 rounded-md border border-gray-700 bg-gray-800 px-2 py-1 font-mono text-xs text-gray-200"
                >
                  <Box className="h-3 w-3 text-gray-500" />
                  {mid}
                  <button
                    onClick={() => setModelIds(modelIds.filter((x) => x !== mid))}
                    className="text-gray-500 hover:text-red-400"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Fetch models from the endpoint — one-shot: fetch, tick, import */}
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleFetchModels}
              disabled={!isValidHttpUrl(baseUrl.trim()) || fetching}
              title={
                !isValidHttpUrl(baseUrl.trim())
                  ? t("providers_models.fetch_no_endpoint")
                  : t("providers_models.fetch_models")
              }
              className="flex items-center gap-2 rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {fetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {fetching ? t("providers_models.fetching") : t("providers_models.fetch_models")}
            </button>
            {fetchErr && (
              <span className="text-xs text-red-400">{t("providers_models.fetch_error", fetchErr)}</span>
            )}
            {fetchDone && !fetchErr && fetchedModels.length === 0 && (
              <span className="text-xs text-amber-400">{t("providers_models.fetch_empty")}</span>
            )}
          </div>
          {availableFetched.length > 0 && (
            <div className="mt-2 rounded-lg border border-gray-700">
              <div className="flex items-center justify-between border-b border-gray-700 px-3 py-2">
                <span className="text-xs text-gray-400">
                  {t("providers_models.selected_count", String(fetchSel.size), String(availableFetched.length))}
                </span>
                <button
                  onClick={toggleAllFetched}
                  className="text-xs text-blue-400 hover:text-blue-300"
                >
                  {allFetchedSelected ? t("providers_models.deselect_all") : t("providers_models.select_all")}
                </button>
              </div>
              <div className="max-h-44 overflow-y-auto p-1.5">
                {availableFetched.map((m) => (
                  <label
                    key={m.id}
                    className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-gray-800"
                  >
                    <input
                      type="checkbox"
                      checked={fetchSel.has(m.id)}
                      onChange={() => toggleFetched(m.id)}
                      className="h-3.5 w-3.5 accent-blue-500"
                    />
                    <span className="truncate font-mono text-xs text-gray-200">{m.id}</span>
                    <span className="ml-auto flex shrink-0 items-center gap-1">
                      {m.reasoning && <Brain className="h-3 w-3 text-purple-400" />}
                      {m.audio && <Mic className="h-3 w-3 text-emerald-400" />}
                      <span className={`flex items-center gap-1 rounded border px-1 py-px text-[10px] ${m.vision ? "border-blue-500/40 bg-blue-500/10 text-blue-400" : "border-gray-700 bg-gray-800 text-gray-500"}`}>
                        {m.vision && <ImageIcon className="h-2.5 w-2.5" />}
                        {m.vision ? t("providers_models.modality_vision") : t("providers_models.modality_text")}
                      </span>
                      {m.contextWindow && (
                        <span className="shrink-0 text-[10px] text-gray-500 font-mono">
                          {formatTokens(m.contextWindow)}
                        </span>
                      )}
                      {m.cost && (m.cost.input || m.cost.output) ? (
                        <span className="shrink-0 text-[10px] text-gray-500 font-mono">${m.cost.input}/${m.cost.output}</span>
                      ) : null}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 pt-1">
          {submitError && (
            <span className="flex items-center gap-1 text-sm text-red-400">
              <X className="h-4 w-4" />
              {t("providers_models.save_failed")}
            </span>
          )}
          <button
            onClick={() => { reset(); onClose(); }}
            className="rounded-lg px-4 py-2 text-sm text-gray-400 hover:bg-gray-800"
          >
            {t("models.cancel")}
          </button>
          <button
            onClick={handleImport}
            disabled={!canSubmit}
            className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
            style={{ backgroundColor: "var(--accent-solid)", color: "#ffffff" }}
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("providers_models.import")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
