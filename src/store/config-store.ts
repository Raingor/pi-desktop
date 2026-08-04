import { create } from "zustand";
import type {
  PiConfig,
  Provider,
  Model,
  PiSettings,
  PiAuth,
  PiModelsJson,
  CustomProviderConfig,
} from "@/types";
import { BUILTIN_PROVIDERS } from "@/data/builtin-providers";
import {
  piSettingsGet,
  piSettingsSet,
  piAuthGet,
  piAuthSet,
  piModelsGet,
  piModelsSet,
  piUsageGet,
  piUsageRangeGet,
  piSessionsList,
  piTrashList,
  piSessionTrash,
  piSessionRestore,
  piSessionDeletePermanent,
  piSessionPreview,
  piMemoryGet,
  piMemoryDeleteEntry,
  piSubagentsGet,
  piCheckUpdates,
  piApplyUpdates,
  piFetchProviderModels,
  piTestProvider,
  piTestModel,
  piBuiltinCatalogGet,
} from "@/lib/tauri";

// ─── API Helper (Tauri Commands) ─────────────────────────

async function apiGet<T>(command: string): Promise<T> {
  switch (command) {
    case "/settings": return await piSettingsGet() as unknown as T;
    case "/auth": return await piAuthGet() as unknown as T;
    case "/models": return await piModelsGet() as unknown as T;
    case "/usage": return await piUsageGet() as unknown as T;
    case "/sessions": return await piSessionsList() as unknown as T;
    case "/memory": return await piMemoryGet() as unknown as T;
    case "/subagents": return await piSubagentsGet() as unknown as T;
    case "/trash": return await piTrashList() as unknown as T;
    case "/check-updates": return await piCheckUpdates() as unknown as T;
    default: throw new Error(`Unknown API command: ${command}`);
  }
}

async function apiPost(command: string, data: unknown): Promise<boolean> {
  switch (command) {
    case "/settings": return await piSettingsSet(data as PiSettings);
    case "/auth": return await piAuthSet(data as PiAuth);
    case "/models": return await piModelsSet(data as PiModelsJson);
    default: throw new Error(`Unknown API command: ${command}`);
  }
}

// ─── Built-in Provider Helpers (Client-side) ────────────

function getCustomProviders(modelsJson: PiModelsJson | null): Provider[] {
  if (!modelsJson) return [];
  return Object.entries(modelsJson.providers).map(([id, cfg]) => ({
    id,
    name: cfg.name ?? (id.charAt(0).toUpperCase() + id.slice(1)),
    type: "custom" as const,
    baseUrl: cfg.baseUrl,
    api: cfg.api,
    apiKey: cfg.apiKey,
    authHeader: cfg.authHeader,
    headers: cfg.headers,
    compat: cfg.compat,
    hasAuth: !!cfg.apiKey,
    authMethod: (cfg.apiKey ? "file" : "none") as "file" | "none",
    models: (cfg.models ?? []).map((m) => ({ ...m, enabled: true })),
  }));
}

function mergeProviders(
  builtinProviders: Provider[],
  auth: PiAuth,
  customModels: PiModelsJson | null
): Provider[] {
  const customs = getCustomProviders(customModels);
  // models.json entries whose id matches a builtin provider are overrides
  // (e.g. models imported onto a builtin) — merge them into the builtin
  // instead of listing a duplicate custom provider.
  const builtinIds = new Set(builtinProviders.map((p) => p.id));
  // Customs with an apiKey are standalone custom providers (e.g. user-imported
  // ones that happen to share an id with a builtin). They should not be merged
  // into the builtin but instead shown as a custom provider.
  const standaloneIds = new Set(
    customs.filter((c) => builtinIds.has(c.id) && c.apiKey).map((c) => c.id)
  );
  const overrides = new Map(
    customs.filter((c) => builtinIds.has(c.id) && !c.apiKey).map((c) => [c.id, c])
  );
  const builtins = builtinProviders
    .map((p) => {
      if (standaloneIds.has(p.id)) return null; // replaced by standalone custom
      const override = overrides.get(p.id);
      let models = p.models;
      if (override) {
        const byId = new Map(p.models.map((m) => [m.id, m]));
        for (const m of override.models) byId.set(m.id, m);
        models = [...byId.values()];
      }
      return {
        ...p,
        // A user-provided display name in models.json wins over the catalog name.
        name: customModels?.providers?.[p.id]?.name ?? p.name,
        // Apply baseUrl / api overrides so builtins can target a proxy/gateway
        // while keeping their builtin model catalog.
        baseUrl: override?.baseUrl ?? p.baseUrl,
        api: override?.api ?? p.api,
        headers: override?.headers ?? p.headers,
        // hasAuth = a key is actually saved (auth.json or models.json override) —
        // the static builtin flag only means the provider supports auth.
        hasAuth: !!auth[p.id] || !!override?.apiKey,
        authMethod: auth[p.id] ? "file" : p.authMethod,
        models,
      };
    })
    .filter(<T>(p: T): p is NonNullable<T> => p != null);
  return [...builtins, ...customs.filter((c) => !builtinIds.has(c.id) || standaloneIds.has(c.id))];
}

// ─── State Types ─────────────────────────────────────────

interface UsageData {
  dailyAggregates: {
    date: string;
    totalTokens: number;
    totalCost: number;
    totalRequests: number;
    inputTokens: number;
    outputTokens: number;
  }[];
  providerSummaries: {
    providerId: string;
    totalTokens: number;
    totalCost: number;
    totalRequests: number;
  }[];
  modelSummaries: {
    modelId: string;
    providerId: string;
    totalTokens: number;
    totalCost: number;
    totalRequests: number;
    avgTokensPerRequest: number;
  }[];
  totals: {
    totalTokens: number;
    totalCost: number;
    totalRequests: number;
  };
}

interface ConfigState {
  // Raw config from pi files
  settings: PiSettings | null;
  auth: PiAuth | null;
  modelsJson: PiModelsJson | null;

  // Builtin provider catalog (live from the pi install, static fallback)
  builtinProviders: Provider[];

  // Derived
  allProviders: Provider[];
  allModels: (Model & { providerId: string; providerName: string })[];

  // Usage data from session files
  usage: UsageData | null;

  // Lifecycle
  initialized: boolean;
  loading: boolean;
  error: string | null;

  // Actions
  init: () => Promise<void>;
  refreshUsage: () => Promise<void>;

  // Settings
  updateSettings: (settings: Partial<PiSettings>) => Promise<boolean>;
  setDefaultProvider: (provider: string) => Promise<void>;
  setDefaultModel: (model: string) => Promise<void>;
  setTheme: (theme: PiSettings["theme"]) => Promise<void>;
  addEnabledModel: (modelRef: string) => Promise<void>;
  removeEnabledModel: (modelRef: string) => Promise<void>;
  addPackage: (pkg: string) => Promise<void>;
  removePackage: (pkg: string) => Promise<void>;

  // Auth
  setProviderAuth: (providerId: string, key: string) => Promise<boolean>;
  removeProviderAuth: (providerId: string) => Promise<boolean>;

  // Model CRUD (for custom providers)
  toggleModel: (providerId: string, modelId: string) => void;
  updateModel: (providerId: string, modelId: string, updates: Partial<Model>) => void;
  addModel: (providerId: string, model: Model) => void;
  removeModel: (providerId: string, modelId: string) => void;

  // Custom provider CRUD
  addCustomProvider: (id: string, cfg: CustomProviderConfig) => Promise<boolean>;
  updateCustomProvider: (id: string, cfg: Partial<CustomProviderConfig>) => Promise<boolean>;
  removeCustomProvider: (id: string) => Promise<boolean>;

  // Import/Export (to localStorage for backup, writes back to pi files)
  importConfig: (config: PiConfig) => Promise<void>;
  resetToDefaults: () => Promise<void>;
}

export const useConfigStore = create<ConfigState>((set, get) => ({
  settings: null,
  auth: null,
  modelsJson: null,
  builtinProviders: BUILTIN_PROVIDERS,
  allProviders: [],
  allModels: [],
  usage: null,
  usageRangeData: null, // Cached dashboard range data
  initialized: false,
  loading: true,
  error: null,

  // ─── Init (with caching) ─────────────────────────────────

  init: async () => {
    // If already initialized, skip reload (data cached in store)
    if (get().initialized && get().settings) {
      set({ loading: false });
      return;
    }
    set({ loading: true, error: null });
    try {
      const [settings, auth, modelsJson, usage, builtinsRes] = await Promise.all([
        apiGet<PiSettings>("/settings"),
        apiGet<PiAuth>("/auth"),
        apiGet<PiModelsJson>("/models"),
        apiGet<UsageData>("/usage"),
        apiGet<Provider[]>("/builtin-providers").catch(() => null),
      ]);

      const builtinProviders =
        builtinsRes && builtinsRes.length > 0 ? builtinsRes : BUILTIN_PROVIDERS;
      const allProviders = mergeProviders(builtinProviders, auth ?? {}, modelsJson);
      const allModels = allProviders.flatMap((p) =>
        p.models.map((m) => ({
          ...m,
          providerId: p.id,
          providerName: p.name,
        }))
      );

      set({
        settings,
        auth,
        modelsJson,
        builtinProviders,
        allProviders,
        allModels,
        usage,
        initialized: true,
        loading: false,
      });
    } catch (e: any) {
      set({
        error: e.message || "Failed to load pi configuration",
        loading: false,
        initialized: true,
      });
    }
  },

  // ─── Refresh Usage ──────────────────────────────────────

  refreshUsage: async () => {
    try {
      const usage = await apiGet<UsageData>("/usage");
      set({ usage });
    } catch {
      // ignore refresh errors
    }
  },

  // ─── Settings ───────────────────────────────────────────

  updateSettings: async (partial) => {
    const { settings } = get();
    if (!settings) return false;
    const updated = { ...settings, ...partial };
    const ok = await apiPost("/settings", updated);
    if (ok) set({ settings: updated });
    return ok;
  },

  setDefaultProvider: async (provider) => {
    await get().updateSettings({ defaultProvider: provider });
  },

  setDefaultModel: async (model) => {
    await get().updateSettings({ defaultModel: model });
  },

  setTheme: async (theme) => {
    await get().updateSettings({ theme });
  },

  addEnabledModel: async (modelRef) => {
    const { settings } = get();
    if (!settings) return;
    const list = settings.enabledModels ?? [];
    if (!list.includes(modelRef)) {
      await get().updateSettings({ enabledModels: [...list, modelRef] });
    }
  },

  removeEnabledModel: async (modelRef) => {
    const { settings } = get();
    if (!settings) return;
    const list = (settings.enabledModels ?? []).filter((m) => m !== modelRef);
    await get().updateSettings({ enabledModels: list });
  },

  addPackage: async (pkg) => {
    const { settings } = get();
    if (!settings) return;
    const list = settings.packages ?? [];
    if (!list.includes(pkg)) {
      await get().updateSettings({ packages: [...list, pkg] });
    }
  },

  removePackage: async (pkg) => {
    const { settings } = get();
    if (!settings) return;
    const list = (settings.packages ?? []).filter((p) => p !== pkg);
    await get().updateSettings({ packages: list });
  },

  // ─── Auth ───────────────────────────────────────────────

  setProviderAuth: async (providerId, key) => {
    const { auth } = get();
    const updated = { ...(auth ?? {}), [providerId]: { type: "api_key" as const, key } };
    const ok = await apiPost("/auth", updated);
    if (ok) {
      set({ auth: updated });
      // Recompute providers with updated auth state
      const { modelsJson, builtinProviders } = get();
      set({ allProviders: mergeProviders(builtinProviders, updated, modelsJson) });
    }
    return ok;
  },

  removeProviderAuth: async (providerId) => {
    const { auth } = get();
    if (!auth) return false;
    const { [providerId]: _, ...rest } = auth;
    const ok = await apiPost("/auth", rest);
    if (ok) {
      set({ auth: rest });
      const { modelsJson, builtinProviders } = get();
      set({ allProviders: mergeProviders(builtinProviders, rest, modelsJson) });
    }
    return ok;
  },

  // ─── Model CRUD (client-side only, stored in modelsJson) ─

  toggleModel: (providerId, modelId) => {
    const { modelsJson } = get();
    if (!modelsJson) return;
    const p = modelsJson.providers[providerId];
    if (!p?.models) return;
    const newModels = p.models.map((m) =>
      m.id === modelId ? { ...m, enabled: !(m.enabled ?? true) } : m
    );
    const newProviders = {
      ...modelsJson.providers,
      [providerId]: { ...p, models: newModels },
    };
    const updated = { providers: newProviders };
    set({ modelsJson: updated });
    // Persist
    apiPost("/models", updated);
    // Recompute providers
    const { auth, builtinProviders } = get();
    set({ allProviders: mergeProviders(builtinProviders, auth ?? {}, updated) });
  },

  updateModel: (providerId, modelId, updates) => {
    const { modelsJson } = get();
    if (!modelsJson) return;
    const isBuiltin = !modelsJson.providers[providerId];
    const newProviders = { ...(modelsJson.providers ?? {}) };

    if (!newProviders[providerId]) {
      newProviders[providerId] = { models: [] };
    }
    const existingModels = newProviders[providerId]!.models ?? [];
    const idx = existingModels.findIndex((m: any) => m.id === modelId);
    if (idx >= 0) {
      existingModels[idx] = { ...existingModels[idx], ...updates } as Model;
    } else if (isBuiltin) {
      // Store as override
      newProviders[providerId] = {
        ...newProviders[providerId],
        models: [...existingModels, updates as Model],
      };
    } else {
      existingModels.push(updates as Model);
    }
    newProviders[providerId] = { ...newProviders[providerId], models: existingModels };
    const updated = { providers: newProviders };
    set({ modelsJson: updated });
    apiPost("/models", updated);
    const { auth, builtinProviders } = get();
    set({ allProviders: mergeProviders(builtinProviders, auth ?? {}, updated) });
  },

  addModel: (providerId, model) => {
    const { modelsJson } = get();
    if (!modelsJson) return;
    const newProviders = { ...(modelsJson.providers ?? {}) };
    if (!newProviders[providerId]) {
      newProviders[providerId] = { models: [] };
    }
    newProviders[providerId] = {
      ...newProviders[providerId],
      models: [...(newProviders[providerId]!.models ?? []), { ...model, enabled: true }],
    };
    const updated = { providers: newProviders };
    set({ modelsJson: updated });
    apiPost("/models", updated);
    const { auth, builtinProviders } = get();
    const newAllProviders = mergeProviders(builtinProviders, auth ?? {}, updated);
    const newAllModels = newAllProviders.flatMap((p) =>
      p.models.map((m) => ({ ...m, providerId: p.id, providerName: p.name }))
    );
    set({ allProviders: newAllProviders, allModels: newAllModels });
  },

  removeModel: (providerId, modelId) => {
    const { modelsJson } = get();
    if (!modelsJson) return;
    const p = modelsJson.providers[providerId];
    if (!p?.models) return;
    const newModels = p.models.filter((m: any) => m.id !== modelId);
    const newProviders = {
      ...modelsJson.providers,
      [providerId]: { ...p, models: newModels },
    };
    const updated = { providers: newProviders };
    set({ modelsJson: updated });
    apiPost("/models", updated);
    const { auth, builtinProviders } = get();
    set({ allProviders: mergeProviders(builtinProviders, auth ?? {}, updated) });
  },

  // ─── Custom Provider CRUD ──────────────────────────────

  addCustomProvider: async (id, cfg) => {
    const { modelsJson } = get();
    if (!modelsJson) return false;
    const newProviders = { ...modelsJson.providers, [id]: cfg };
    const updated = { providers: newProviders };
    const ok = await apiPost("/models", updated);
    if (ok) {
      set({ modelsJson: updated });
      const { auth, builtinProviders } = get();
      set({ allProviders: mergeProviders(builtinProviders, auth ?? {}, updated) });
    }
    return ok;
  },

  updateCustomProvider: async (id, cfg) => {
    const { modelsJson } = get();
    if (!modelsJson) return false;
    const existing = modelsJson.providers[id];
    if (!existing) return false;
    const newProviders = {
      ...modelsJson.providers,
      [id]: { ...existing, ...cfg },
    };
    const updated = { providers: newProviders };
    const ok = await apiPost("/models", updated);
    if (ok) {
      set({ modelsJson: updated });
      const { auth, builtinProviders } = get();
      set({ allProviders: mergeProviders(builtinProviders, auth ?? {}, updated) });
    }
    return ok;
  },

  removeCustomProvider: async (id) => {
    const { modelsJson } = get();
    if (!modelsJson) return false;
    const { [id]: _, ...rest } = modelsJson.providers;
    const updated = { providers: rest };
    const ok = await apiPost("/models", updated);
    if (ok) {
      set({ modelsJson: updated });
      const { auth, builtinProviders } = get();
      const newAllProviders = mergeProviders(builtinProviders, auth ?? {}, updated);
      const newAllModels = newAllProviders.flatMap((p) =>
        p.models.map((m) => ({ ...m, providerId: p.id, providerName: p.name }))
      );
      set({ allProviders: newAllProviders, allModels: newAllModels });
    }
    return ok;
  },

  // ─── Import/Export ─────────────────────────────────────

  importConfig: async (config) => {
    // Write all three config files through the API
    await Promise.all([
      apiPost("/settings", config.settings),
      apiPost("/auth", config.auth),
      apiPost("/models", config.modelsJson ?? { providers: {} }),
    ]);
    // Reload
    await get().init();
  },

  resetToDefaults: async () => {
    // Write empty/default configs
    await Promise.all([
      apiPost("/settings", {
        lastChangelogVersion: "0.80.3",
        defaultProvider: "",
        defaultModel: "",
        theme: "dark",
        hideThinkingBlock: true,
        retry: { enabled: true },
        packages: [],
        enabledModels: [],
      }),
      apiPost("/auth", {}),
      apiPost("/models", { providers: {} }),
    ]);
    await get().init();
  },
}));
