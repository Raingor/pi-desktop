import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export function defaultSessionsDir() {
  return join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"), "sessions");
}

function numberOrZero(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function dateKey(value, timeZone) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dateKeysForLastDays(now, timeZone, days) {
  const today = dateKey(now, timeZone);
  if (!today) return [];

  const [year, month, day] = today.split("-").map(Number);
  return Array.from({ length: days }, (_, index) => {
    const value = new Date(Date.UTC(year, month - 1, day - (days - 1 - index)));
    return value.toISOString().slice(0, 10);
  });
}

function usageRecord(entry, sessionFile, currentModel, timeZone) {
  const message = entry.message;
  if (entry.type !== "message" || message?.role !== "assistant" || !message.usage) return undefined;

  const date = dateKey(entry.timestamp ?? message.timestamp, timeZone);
  if (!date) return undefined;

  const usage = message.usage;
  const input = numberOrZero(usage.input);
  const output = numberOrZero(usage.output);
  const cacheRead = numberOrZero(usage.cacheRead);
  const cacheWrite = numberOrZero(usage.cacheWrite);

  return {
    sessionFile,
    date,
    provider: message.provider ?? currentModel.provider,
    model: message.model ?? currentModel.model,
    input,
    output,
    cacheRead,
    cacheWrite,
    tokens: input + output + cacheRead + cacheWrite,
    cost: numberOrZero(usage.cost?.total),
  };
}

export function parseSessionText(text, { sessionFile = "unknown", timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone } = {}) {
  const records = [];
  let currentModel = { provider: "unknown", model: "unknown" };

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;

    try {
      const entry = JSON.parse(line);
      if (entry.type === "model_change") {
        currentModel = {
          provider: entry.provider ?? currentModel.provider,
          model: entry.modelId ?? currentModel.model,
        };
        continue;
      }

      const record = usageRecord(entry, sessionFile, currentModel, timeZone);
      if (record) records.push(record);
    } catch {
      // Session files may contain a partially written final line; ignore malformed entries.
    }
  }

  return records;
}

async function findSessionFiles(directory, state) {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await findSessionFiles(path, state);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        state.files.push(path);
      }
    }
  } catch {
    state.skippedPaths += 1;
  }
}

function emptyBucket() {
  return { sessions: new Set(), requests: 0, tokens: 0, cost: 0 };
}

function addRecord(bucket, record) {
  bucket.sessions.add(record.sessionFile);
  bucket.requests += 1;
  bucket.tokens += record.tokens;
  bucket.cost += record.cost;
}

function serializeBucket(bucket) {
  return {
    sessions: bucket.sessions.size,
    requests: bucket.requests,
    tokens: bucket.tokens,
    cost: bucket.cost,
  };
}

export function aggregateUsage(records, { now = new Date(), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone } = {}) {
  const lastSevenDays = dateKeysForLastDays(now, timeZone, 7);
  const today = lastSevenDays.at(-1);
  const sevenDayDates = new Set(lastSevenDays);
  const todayBucket = emptyBucket();
  const sevenDayBucket = emptyBucket();
  const daily = new Map(lastSevenDays.map((date) => [date, emptyBucket()]));
  const models = new Map();

  for (const record of records) {
    if (record.date === today) addRecord(todayBucket, record);
    if (!sevenDayDates.has(record.date)) continue;

    addRecord(sevenDayBucket, record);
    addRecord(daily.get(record.date), record);

    const key = `${record.provider}/${record.model}`;
    const model = models.get(key) ?? { name: key, requests: 0, tokens: 0, cost: 0 };
    model.requests += 1;
    model.tokens += record.tokens;
    model.cost += record.cost;
    models.set(key, model);
  }

  return {
    timeZone,
    todayDate: today,
    startDate: lastSevenDays[0],
    today: serializeBucket(todayBucket),
    lastSevenDays: serializeBucket(sevenDayBucket),
    daily: [...daily].map(([date, bucket]) => ({ date, ...serializeBucket(bucket) })),
    models: [...models.values()].sort((left, right) => right.tokens - left.tokens || left.name.localeCompare(right.name)),
  };
}

export async function readUsageSummary({
  sessionsDir = defaultSessionsDir(),
  now = new Date(),
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
} = {}) {
  const state = { files: [], skippedPaths: 0 };
  await findSessionFiles(sessionsDir, state);

  const records = [];
  for (const sessionFile of state.files) {
    try {
      const text = await readFile(sessionFile, "utf8");
      records.push(...parseSessionText(text, { sessionFile, timeZone }));
    } catch {
      state.skippedPaths += 1;
    }
  }

  return { ...aggregateUsage(records, { now, timeZone }), scannedFiles: state.files.length, skippedPaths: state.skippedPaths };
}

export function formatTokens(tokens) {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return String(tokens);
}

export function formatCost(cost) {
  if (cost === 0) return "$0.00";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

function formatBucket(label, bucket) {
  return [
    label,
    `  Sessions: ${bucket.sessions}`,
    `  Requests: ${bucket.requests}`,
    `  Tokens:   ${formatTokens(bucket.tokens)}`,
    `  Cost:     ${formatCost(bucket.cost)}`,
  ].join("\n");
}

export function formatUsageSummary(summary) {
  const lines = [
    "Pi usage summary",
    `Timezone: ${summary.timeZone}`,
    "",
    formatBucket(`Today (${summary.todayDate})`, summary.today),
    "",
    formatBucket(`Last 7 days (${summary.startDate} to ${summary.todayDate})`, summary.lastSevenDays),
    "",
    "Daily tokens",
    ...summary.daily.map((day) => `  ${day.date}: ${formatTokens(day.tokens)}`),
    "",
    "Models (last 7 days)",
  ];

  if (summary.models.length === 0) {
    lines.push("  No assistant usage records found.");
  } else {
    lines.push(...summary.models.map((model) =>
      `  ${model.name}: ${model.requests} requests, ${formatTokens(model.tokens)}, ${formatCost(model.cost)}`,
    ));
  }

  if (summary.skippedPaths > 0) {
    lines.push("", `Skipped unreadable paths: ${summary.skippedPaths}`);
  }

  return lines.join("\n");
}
