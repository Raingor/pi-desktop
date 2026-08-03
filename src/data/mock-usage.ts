import type { UsageRecord } from "@/types";

// Generate 30 days of mock usage data
function generateMockUsage(): UsageRecord[] {
  const records: UsageRecord[] = [];
  const today = new Date();
  const modelProviderPairs = [
    { providerId: "opencode-go", modelId: "deepseek-v4-flash", baseTokens: 1_200_000, baseCost: 0.36 },
    { providerId: "opencode-go", modelId: "deepseek-v4-pro", baseTokens: 400_000, baseCost: 0.80 },
    { providerId: "opencode-go", modelId: "glm-5.1", baseTokens: 250_000, baseCost: 0.125 },
    { providerId: "opencode-go", modelId: "qwen3.7-max", baseTokens: 180_000, baseCost: 0.27 },
    { providerId: "opencode-go", modelId: "mimo-v2.5", baseTokens: 300_000, baseCost: 0.36 },
    { providerId: "opencode", modelId: "deepseek-v4-flash-free", baseTokens: 800_000, baseCost: 0 },
    { providerId: "opencode", modelId: "deepseek-v4-flash", baseTokens: 200_000, baseCost: 0.06 },
    { providerId: "anthropic", modelId: "claude-sonnet-4", baseTokens: 150_000, baseCost: 0.45 },
    { providerId: "anthropic", modelId: "claude-haiku-3-5", baseTokens: 90_000, baseCost: 0.036 },
    { providerId: "openai", modelId: "gpt-4o", baseTokens: 80_000, baseCost: 0.20 },
    { providerId: "openai", modelId: "gpt-4o-mini", baseTokens: 120_000, baseCost: 0.018 },
    { providerId: "deepseek", modelId: "deepseek-chat", baseTokens: 60_000, baseCost: 0.0162 },
    { providerId: "google", modelId: "gemini-2.5-flash", baseTokens: 40_000, baseCost: 0.006 },
  ];

  for (let day = 29; day >= 0; day--) {
    const date = new Date(today);
    date.setDate(date.getDate() - day);
    const dateStr = date.toISOString().split("T")[0]!;

    for (const pair of modelProviderPairs) {
      // Add some daily variance (±40%)
      const variance = 0.6 + Math.random() * 0.8;
      const dayOfWeek = date.getDay();
      const weekendFactor = dayOfWeek === 0 || dayOfWeek === 6 ? 0.5 : 1.0;
      const trendFactor = 1 + (29 - day) * 0.01; // slight upward trend

      const inputRatio = 0.7 + Math.random() * 0.1;
      const baseTokens = pair.baseTokens * variance * weekendFactor * trendFactor;
      const inputTokens = Math.round(baseTokens * inputRatio);
      const outputTokens = Math.round(baseTokens * (1 - inputRatio));
      const cacheReadTokens = Math.round(inputTokens * 0.3 * Math.random());
      const cacheWriteTokens = Math.round(inputTokens * 0.1 * Math.random());
      const requests = Math.round(20 + Math.random() * 60);

      records.push({
        date: dateStr!,
        providerId: pair.providerId,
        modelId: pair.modelId,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        requests,
        cost: pair.baseCost * variance * weekendFactor * trendFactor,
      });
    }
  }

  return records;
}

export const MOCK_USAGE_DATA = generateMockUsage();

// Aggregate helpers

export function getDailyAggregates(): {
  date: string;
  totalTokens: number;
  totalCost: number;
  totalRequests: number;
  inputTokens: number;
  outputTokens: number;
}[] {
  const daily = new Map<string, {
    totalTokens: number; totalCost: number; totalRequests: number;
    inputTokens: number; outputTokens: number;
  }>();

  for (const r of MOCK_USAGE_DATA) {
    const d = daily.get(r.date) ?? {
      totalTokens: 0, totalCost: 0, totalRequests: 0,
      inputTokens: 0, outputTokens: 0,
    };
    d.totalTokens += r.inputTokens + r.outputTokens + r.cacheReadTokens + r.cacheWriteTokens;
    d.totalCost += r.cost;
    d.totalRequests += r.requests;
    d.inputTokens += r.inputTokens;
    d.outputTokens += r.outputTokens;
    daily.set(r.date, d);
  }

  return Array.from(daily.entries())
    .map(([date, agg]) => ({ date, ...agg }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function getProviderSummaries() {
  const sums = new Map<string, {
    totalTokens: number; totalCost: number; totalRequests: number;
  }>();

  for (const r of MOCK_USAGE_DATA) {
    const s = sums.get(r.providerId) ?? { totalTokens: 0, totalCost: 0, totalRequests: 0 };
    s.totalTokens += r.inputTokens + r.outputTokens + r.cacheReadTokens + r.cacheWriteTokens;
    s.totalCost += r.cost;
    s.totalRequests += r.requests;
    sums.set(r.providerId, s);
  }

  return Array.from(sums.entries()).map(([providerId, s]) => ({ providerId, ...s }));
}

export function getModelSummaries() {
  const sums = new Map<string, {
    providerId: string; totalTokens: number; totalCost: number; totalRequests: number; count: number;
  }>();

  for (const r of MOCK_USAGE_DATA) {
    const key = `${r.providerId}/${r.modelId}`;
    const s = sums.get(key) ?? { providerId: r.providerId, totalTokens: 0, totalCost: 0, totalRequests: 0, count: 0 };
    s.totalTokens += r.inputTokens + r.outputTokens + r.cacheReadTokens + r.cacheWriteTokens;
    s.totalCost += r.cost;
    s.totalRequests += r.requests;
    s.count++;
    sums.set(key, s);
  }

  return Array.from(sums.entries()).map(([key, s]) => {
    const [providerId, modelId] = key.split("/");
    return {
      modelId: modelId!,
      providerId: s.providerId,
      totalTokens: s.totalTokens,
      totalCost: s.totalCost,
      totalRequests: s.totalRequests,
      avgTokensPerRequest: Math.round(s.totalTokens / s.totalRequests),
    };
  });
}

export function getTotals() {
  let totalTokens = 0;
  let totalCost = 0;
  let totalRequests = 0;

  for (const r of MOCK_USAGE_DATA) {
    totalTokens += r.inputTokens + r.outputTokens + r.cacheReadTokens + r.cacheWriteTokens;
    totalCost += r.cost;
    totalRequests += r.requests;
  }

  return { totalTokens, totalCost, totalRequests };
}