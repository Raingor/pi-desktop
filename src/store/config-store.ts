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

// ─── API Helper ──────────────────────────────────────────

const API_BASE = "/api/pi";

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`API ${path}: ${res.status}`);
  return res.json();
}

async function apiPost(path: string, data: unknown): Promise<boolean> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) return false;
  const result = await res.json();
  return result.success === true;
}

// ─── Built-in Provider Helpers (Client-side) ────────────

function getCustomProviders(modelsJson: PiModelsJson | null): Provider[] {
  if (!modelsJson) return [];
  const disabled = new Set(Object.keys(modelsJson._disabledProviders ?? {}));
  const result: Provider[] = [];
  for (const [id, cfg] of Object.entries(modelsJson.providers)) {
    result.push({
      id,
      name: cfg.name ?? (id.charAt(0).toUpperCase() + id.slice(1)),
      type: "custom" as const,
      baseUrl: cfg.baseUrl,
      api: cfg.api,
      apiKey: cfg.apiKey,
      apiKeys: cfg.apiKeys,
      activeKeyId: cfg.activeKeyId,
      authHeader: cfg.authHeader,
      headers: cfg.headers,
      compat: cfg.compat,
      hasAuth: !!cfg.apiKey,
      authMethod: (cfg.apiKey ? "file" : "none") as "file" | "none",
      models: (cfg.models ?? []).map((m) => ({ ...m, enabled: true })),
    });
  }
  for (const [id, cfg] of Object.entries(modelsJson._disabledProviders ?? {})) {
    result.push({
      id,
      name: cfg.name ?? (id.charAt(0).toUpperCase() + id.slice(1)),
      type: "custom" as const,
      baseUrl: cfg.baseUrl,
      api: cfg.api,
      apiKey: cfg.apiKey,
      apiKeys: cfg.apiKeys,
      activeKeyId: cfg.activeKeyId,
      authHeader: cfg.authHeader,
      headers: cfg.headers,
      compat: cfg.compat,
      hasAuth: !!cfg.apiKey,
      authMethod: (cfg.apiKey ? "file" : "none") as "file" | "none",
      models: (cfg.models ?? []).map((m) => ({ ...m, enabled: true })),
      disabled: true,
    });
  }
  return result;
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

// Carry `_disabledProviders` through every models.json write. Several actions
// rebuilt the payload as a plain { providers: … } object, which silently
// dropped all disabled providers from disk on the next save.
function carryDisabled(
  modelsJson: PiModelsJson,
  providers: PiModelsJson["providers"]
): PiModelsJson {
  return modelsJson._disabledProviders && Object.keys(modelsJson._disabledProviders).length > 0
    ? { providers, _disabledProviders: modelsJson._disabledProviders }
    : { providers };
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
  renameCustomProvider: (oldId: string, newId: string, cfg?: Partial<CustomProviderConfig>) => Promise<boolean>;
  removeCustomProvider: (id: string) => Promise<boolean>;
  disableCustomProvider: (id: string) => Promise<boolean>;
  enableCustomProvider: (id: string) => Promise<boolean>;

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
  initialized: false,
  loading: true,
  error: null,

  // ─── Init ───────────────────────────────────────────────

  init: async () => {
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
      models: [...(newProviders[providerId]!.models ?? []), { ...model, enabled: false }],
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
    const updated = carryDisabled(modelsJson, newProviders);
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
    // Disabled providers keep their config under `_disabledProviders` — updates
    // (e.g. key-pool changes from a still-open detail panel) must land there
    // instead of failing because `providers[id]` no longer exists.
    if (!existing) {
      const disabledEntry = modelsJson._disabledProviders?.[id];
      if (!disabledEntry) return false;
      const newDisabled = {
        ...modelsJson._disabledProviders,
        [id]: { ...disabledEntry, ...cfg },
      };
      const updated = { providers: modelsJson.providers, _disabledProviders: newDisabled };
      const ok = await apiPost("/models", updated);
      if (ok) {
        set({ modelsJson: updated });
        const { auth, builtinProviders } = get();
        set({ allProviders: mergeProviders(builtinProviders, auth ?? {}, updated) });
      }
      return ok;
    }
    const newProviders = {
      ...modelsJson.providers,
      [id]: { ...existing, ...cfg },
    };
    const updated = carryDisabled(modelsJson, newProviders);
    const ok = await apiPost("/models", updated);
    if (ok) {
      set({ modelsJson: updated });
      const { auth, builtinProviders } = get();
      set({ allProviders: mergeProviders(builtinProviders, auth ?? {}, updated) });
    }
    return ok;
  },

  renameCustomProvider: async (oldId, newId, cfg) => {
    const { modelsJson, settings } = get();
    if (!modelsJson || oldId === newId) return false;
    const existing = modelsJson.providers[oldId];
    if (!existing || modelsJson.providers[newId]) return false;
    // Re-key in place, preserving provider order in models.json
    const newProviders: PiModelsJson["providers"] = {};
    for (const [k, v] of Object.entries(modelsJson.providers)) {
      newProviders[k === oldId ? newId : k] = k === oldId ? { ...existing, ...cfg } : v;
    }
    const updated = carryDisabled(modelsJson, newProviders);
    const ok = await apiPost("/models", updated);
    if (!ok) return false;
    set({ modelsJson: updated });
    // Rewrite provider references in settings (defaultProvider, defaultModel,
    // enabledModels entries are "providerId/modelId" strings)
    if (settings) {
      const prefix = `${oldId}/`;
      const patch: Partial<PiSettings> = {};
      if (settings.defaultProvider === oldId) patch.defaultProvider = newId;
      if (settings.defaultModel?.startsWith(prefix))
        patch.defaultModel = `${newId}/${settings.defaultModel.slice(prefix.length)}`;
      if (settings.enabledModels?.some((r) => r.startsWith(prefix)))
        patch.enabledModels = settings.enabledModels.map((r) =>
          r.startsWith(prefix) ? `${newId}/${r.slice(prefix.length)}` : r
        );
      if (Object.keys(patch).length > 0) {
        const updatedSettings = { ...settings, ...patch };
        if (await apiPost("/settings", updatedSettings)) set({ settings: updatedSettings });
      }
    }
    const { auth, builtinProviders } = get();
    const newAllProviders = mergeProviders(builtinProviders, auth ?? {}, updated);
    const newAllModels = newAllProviders.flatMap((p) =>
      p.models.map((m) => ({ ...m, providerId: p.id, providerName: p.name }))
    );
    set({ allProviders: newAllProviders, allModels: newAllModels });
    return true;
  },

  removeCustomProvider: async (id) => {
    const { modelsJson } = get();
    if (!modelsJson) return false;
    const { [id]: _, ...rest } = modelsJson.providers;
    // Deleting an enabled provider must not wipe the disabled ones either.
    const disabled = { ...(modelsJson._disabledProviders ?? {}) };
    delete disabled[id];
    const updated =
      Object.keys(disabled).length > 0
        ? { providers: rest, _disabledProviders: disabled }
        : { providers: rest };
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

  disableCustomProvider: async (id) => {
    const { modelsJson, auth, builtinProviders } = get();
    if (!modelsJson || !modelsJson.providers[id]) return false;
    const provider = modelsJson.providers[id];
    const newProviders = { ...modelsJson.providers };
    delete newProviders[id];
    const disabled = { ...(modelsJson._disabledProviders ?? {}), [id]: provider };
    const updated = { providers: newProviders, _disabledProviders: disabled };
    const ok = await apiPost("/models", updated);
    if (ok) {
      set({ modelsJson: updated });
      const newAllProviders = mergeProviders(builtinProviders, auth ?? {}, updated);
      const newAllModels = newAllProviders.flatMap((p) =>
        p.models.map((m) => ({ ...m, providerId: p.id, providerName: p.name }))
      );
      set({ allProviders: newAllProviders, allModels: newAllModels });
    }
    return ok;
  },

  enableCustomProvider: async (id) => {
    const { modelsJson, auth, builtinProviders } = get();
    if (!modelsJson || !modelsJson._disabledProviders?.[id]) return false;
    const provider = modelsJson._disabledProviders[id];
    const newDisabled = { ...modelsJson._disabledProviders };
    delete newDisabled[id];
    const updated = {
      providers: { ...modelsJson.providers, [id]: provider },
      _disabledProviders: Object.keys(newDisabled).length > 0 ? newDisabled : undefined,
    };
    const ok = await apiPost("/models", updated);
    if (ok) {
      set({ modelsJson: updated });
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
