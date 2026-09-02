import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUILTIN_PROVIDERS } from "./builtin-providers";

// This file is only the fallback for /api/pi/builtin-providers, which normally
// serves pi's real catalog from @earendil-works/pi-ai. Drift between the two is
// invisible at runtime (the fallback only kicks in when pi is missing), so these
// tests pin the fallback to the catalog shipped with the pinned dependency.

type CatalogModel = {
  id: string;
  name?: string;
  reasoning?: boolean;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
};

function catalogDir(): string | null {
  let dir = dirname(new URL(import.meta.url).pathname);
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, "node_modules", "@earendil-works", "pi-ai", "dist", "providers");
    if (existsSync(join(candidate, "data"))) return candidate;
    dir = dirname(dir);
  }
  return null;
}

const dir = catalogDir();

/** Flatten one provider's data file into an id -> model map, as pi-reader does. */
function readProvider(providerId: string): Record<string, CatalogModel> | null {
  if (!dir) return null;
  const file = join(dir, "data", `${providerId}.json`);
  if (!existsSync(file)) return null;
  const data = JSON.parse(readFileSync(file, "utf-8")) as Record<string, Record<string, CatalogModel>>;
  const out: Record<string, CatalogModel> = {};
  for (const api of Object.keys(data)) {
    for (const model of Object.values(data[api] ?? {})) {
      if (model?.id) out[model.id] = model;
    }
  }
  return out;
}

describe.skipIf(!dir)("builtin providers match the pi-ai catalog", () => {
  it("every provider id exists in the catalog", () => {
    const available = new Set(
      readdirSync(join(dir!, "data"))
        .filter((f) => f.endsWith(".json") && !f.startsWith("."))
        .map((f) => f.replace(/\.json$/, ""))
    );
    const unknown = BUILTIN_PROVIDERS.map((p) => p.id).filter((id) => !available.has(id));
    expect(unknown).toEqual([]);
  });

  it.each(BUILTIN_PROVIDERS.map((p) => [p.id, p] as const))(
    "%s models match the catalog",
    (providerId, provider) => {
      const catalog = readProvider(providerId);
      expect(catalog, `${providerId}.json missing`).toBeTruthy();

      for (const model of provider.models) {
        const ref = catalog![model.id] as CatalogModel | undefined;
        expect(ref, `${providerId}/${model.id} is not in the catalog`).toBeDefined();
        if (!ref) continue;
        expect(model.contextWindow, `${providerId}/${model.id} contextWindow`).toBe(ref.contextWindow);
        expect(model.maxTokens, `${providerId}/${model.id} maxTokens`).toBe(ref.maxTokens);
        expect(model.reasoning, `${providerId}/${model.id} reasoning`).toBe(!!ref.reasoning);
        expect(model.input, `${providerId}/${model.id} input`).toEqual(ref.input ?? ["text"]);
        // Entry pricing tier only — cost.tiers surcharges have no Model field.
        expect(model.cost?.input, `${providerId}/${model.id} cost.input`).toBe(ref.cost?.input ?? 0);
        expect(model.cost?.output, `${providerId}/${model.id} cost.output`).toBe(ref.cost?.output ?? 0);
        expect(model.cost?.cacheRead, `${providerId}/${model.id} cost.cacheRead`).toBe(ref.cost?.cacheRead ?? 0);
        expect(model.cost?.cacheWrite, `${providerId}/${model.id} cost.cacheWrite`).toBe(ref.cost?.cacheWrite ?? 0);
      }
    }
  );
});

describe("builtin providers shape", () => {
  it("provider ids are unique", () => {
    const ids = BUILTIN_PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("model ids are unique within each provider", () => {
    for (const provider of BUILTIN_PROVIDERS) {
      const ids = provider.models.map((m) => m.id);
      expect(new Set(ids).size, provider.id).toBe(ids.length);
    }
  });

  it("maxTokens never exceeds contextWindow", () => {
    for (const provider of BUILTIN_PROVIDERS) {
      for (const model of provider.models) {
        expect(model.maxTokens!, `${provider.id}/${model.id}`).toBeLessThanOrEqual(model.contextWindow!);
      }
    }
  });

  it("hasAuth agrees with authMethod", () => {
    for (const provider of BUILTIN_PROVIDERS) {
      expect(provider.hasAuth, provider.id).toBe(provider.authMethod !== "none");
    }
  });
});
