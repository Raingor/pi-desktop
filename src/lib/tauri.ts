/**
 * tauri.ts — typed wrappers for all Tauri Commands.
 * Replaces the old HTTP fetch() calls to /api/pi/* and /api/chat/*
 */
import { invoke } from "@tauri-apps/api/core";
import type {
  PiSettings,
  PiAuth,
  PiModelsJson,
  Provider,
  Model,
  UpdateCheckResult,
} from "@/types";
import type { SessionData } from "@/types/chat";

// ─── Settings ───────────────────────────────────────────

export const piSettingsGet = () => invoke<PiSettings>("pi_settings_get");
export const piSettingsSet = (data: PiSettings) =>
  invoke<boolean>("pi_settings_set", { data });

// ─── Auth ───────────────────────────────────────────────

export const piAuthGet = () => invoke<PiAuth>("pi_auth_get");
export const piAuthSet = (data: PiAuth) =>
  invoke<boolean>("pi_auth_set", { data });

// ─── Models ─────────────────────────────────────────────

export const piModelsGet = () => invoke<PiModelsJson>("pi_models_get");
export const piModelsSet = (data: PiModelsJson) =>
  invoke<boolean>("pi_models_set", { data });

// ─── Usage / Dashboard ──────────────────────────────────

interface UsageData {
  dailyAggregates: Array<{
    date: string;
    totalTokens: number;
    totalCost: number;
    totalRequests: number;
    inputTokens: number;
    outputTokens: number;
  }>;
  providerSummaries: Array<{
    providerId: string;
    totalTokens: number;
    totalCost: number;
    totalRequests: number;
  }>;
  modelSummaries: Array<{
    modelId: string;
    providerId: string;
    totalTokens: number;
    totalCost: number;
    totalRequests: number;
    avgTokensPerRequest: number;
  }>;
  totals: {
    totalTokens: number;
    totalCost: number;
    totalRequests: number;
  };
}

export const piUsageGet = () => invoke<UsageData>("pi_usage_get");

// Range queries return a richer shape (see Rust UsageRangeData, camelCase serde)
export interface UsageRangeData {
  totalTokens: number;
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  totalCacheWrite: number;
  totalCost: number;
  totalRequests: number;
  cacheHitRate: number;
  dailyBreakdown: Array<{
    date: string;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost: number;
    requests: number;
  }>;
  hourlyBreakdown: Array<{
    hour: string;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost: number;
    requests: number;
  }>;
  requestLog: Array<{
    timestamp: string;
    providerId: string;
    modelId: string;
    input: number;
    output: number;
    cost: number;
    requests: number;
  }>;
  providerStats: Array<{
    providerId: string;
    totalTokens: number;
    totalInput: number;
    totalOutput: number;
    totalCost: number;
    totalRequests: number;
    modelCount: number;
  }>;
  modelStats: Array<{
    modelId: string;
    providerId: string;
    totalTokens: number;
    totalInput: number;
    totalOutput: number;
    totalCost: number;
    totalRequests: number;
  }>;
}

export const piUsageRangeGet = (range: string, from: string, to: string) =>
  invoke<UsageRangeData>("pi_usage_range_get", { range, from, to });

// ─── Sessions ───────────────────────────────────────────

interface SessionFileInfo {
  id: string;
  fileName: string;
  filePath: string;
  timestamp: string;
  lastActive: string;
  name?: string;
  provider?: string;
  model?: string;
  messageCount: number;
  duration?: number;
}

export interface ProjectGroup {
  projectPath: string;
  projectName: string;
  sessions: SessionFileInfo[];
  totalSessions: number;
  lastActive: string;
}

export interface TrashEntry {
  trashPath: string;
  originalPath: string;
  fileName: string;
  trashedAt: string;
  sessionId: string;
  sessionName: string;
  lastActive: string;
  messageCount: number;
}

export interface SessionPreview {
  messages: Array<{ role: string; text: string; timestamp: string }>;
  total: number;
}

export const piSessionsList = () => invoke<ProjectGroup[]>("pi_sessions_list");
export const piSessionTrash = (path: string) =>
  invoke<boolean>("pi_session_trash", { path });
export const piSessionRestore = (trashPath: string) =>
  invoke<boolean>("pi_session_restore", { trashPath });
export const piSessionDeletePermanent = (path: string) =>
  invoke<boolean>("pi_session_delete_permanent", { path });
export const piTrashList = () => invoke<TrashEntry[]>("pi_trash_list");
export const piSessionPreview = (path: string) =>
  invoke<SessionPreview>("pi_session_preview", { path });

// ─── Memory ─────────────────────────────────────────────

interface MemoryFile {
  name: string;
  filename: string;
  content: string;
  updatedAt: string;
}

export const piMemoryGet = () => invoke<MemoryFile[]>("pi_memory_get");
export const piMemoryDeleteEntry = (filename: string, text: string) =>
  invoke<boolean>("pi_memory_delete_entry", { filename, text });

// ─── Subagents ──────────────────────────────────────────

interface SubagentsData {
  agents: Array<{
    name: string;
    fileName: string;
    filePath: string;
    package: string;
    description: string;
    model?: string;
    tools?: string[];
    body: string;
  }>;
  chains: Array<{
    name: string;
    fileName: string;
    filePath: string;
    description: string;
    steps: Array<{ agent: string }>;
    body: string;
  }>;
  runHistory: Array<{
    agent: string;
    ts: number;
    status: string;
  }>;
}

export const piSubagentsGet = () => invoke<SubagentsData>("pi_subagents_get");

// ─── Updates ────────────────────────────────────────────

export const piCheckUpdates = () => invoke<UpdateCheckResult>("pi_check_updates");
export const piApplyUpdates = (names: string[]) =>
  invoke<Array<{ name: string; success: boolean; message?: string }>>(
    "pi_apply_updates",
    { names }
  );

// ─── Provider/Model Online ──────────────────────────────

interface FetchedModel {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  vision?: boolean;
  audio?: boolean;
  cost?: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
  source: string;
}

interface FetchedModelsResult {
  models: FetchedModel[];
  error?: string;
}

interface ProviderTestResult {
  success: boolean;
  status?: number;
  latencyMs?: number;
  message?: string;
}

export const piFetchProviderModels = (
  baseUrl: string,
  apiKey?: string,
  providerId?: string
) =>
  invoke<FetchedModelsResult>("pi_fetch_provider_models", {
    baseUrl,
    apiKey,
    providerId,
  });

export const piTestProvider = (baseUrl: string, apiKey?: string) =>
  invoke<ProviderTestResult>("pi_test_provider", { baseUrl, apiKey });

export const piTestModel = (
  baseUrl: string,
  modelId: string,
  apiKey?: string,
  apiType?: string
) =>
  invoke<ProviderTestResult>("pi_test_model", {
    baseUrl,
    modelId,
    apiKey,
    apiType,
  });

// ─── Built-in Catalog ───────────────────────────────────

interface CatalogProvider {
  id: string;
  name: string;
  type: string;
  api?: string;
  baseUrl?: string;
  hasAuth: boolean;
  authMethod: string;
  models: Array<{
    id: string;
    name?: string;
    reasoning?: boolean;
    input?: string[];
    contextWindow?: number;
    maxTokens?: number;
    cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
  }>;
}

export const piBuiltinCatalogGet = () =>
  invoke<CatalogProvider[] | null>("pi_builtin_catalog_get");

// ─── Chat (via Node bridge) ────────────────────────────

interface SessionInfo {
  id: string;
  path: string;
  cwd: string;
  name?: string;
  created: string;
  modified: string;
  messageCount: number;
  firstMessage: string;
}

interface StartSessionOptions {
  toolNames?: string[];
  provider?: string;
  modelId?: string;
  thinkingLevel?: string;
}

interface StartSessionResult {
  sessionId: string;
  model?: { provider: string; modelId: string };
  thinkingLevel?: string;
}

interface AgentState {
  running: boolean;
  state?: {
    isStreaming?: boolean;
    isBashRunning?: boolean;
    isCompacting?: boolean;
    contextUsage?: { percent: number | null; contextWindow: number; tokens: number | null };
    systemPrompt?: string;
    thinkingLevel?: string;
    model?: { id: string; provider: string };
  };
}

// chat_list_sessions returns the Rust SessionInfo struct as-is (snake_case serde)
export interface RawSessionInfo {
  id: string;
  path: string;
  cwd: string;
  name?: string;
  created: string;
  modified: string;
  message_count: number;
  first_message: string;
  parent_session_id?: string;
  project_root?: string;
  worktree_branch?: string;
}

export const chatListSessions = () => invoke<RawSessionInfo[]>("chat_list_sessions");
export const chatGetSession = (id: string) =>
  invoke<SessionData | null>("chat_get_session", { id });
export const chatStartSession = (cwd: string, options: StartSessionOptions) =>
  invoke<StartSessionResult>("chat_start_session", { cwd, options });
export const chatSendCommand = (sessionId: string, command: Record<string, unknown>) =>
  invoke<{ success: boolean; data: unknown }>("chat_send_command", {
    sessionId,
    command,
  });
export const chatGetState = (sessionId: string) =>
  invoke<AgentState>("chat_get_state", { sessionId });
export const chatRenameSession = (id: string, name: string) =>
  invoke<boolean>("chat_rename_session", { id, name });
export const chatDeleteSession = (id: string) =>
  invoke<boolean>("chat_delete_session", { id });
export const chatLoadModels = (cwd: string) =>
  invoke<{
    models: Record<string, string>;
    modelList: Array<{ id: string; name: string; provider: string }>;
    defaultModel?: { provider: string; modelId: string } | null;
    thinkingLevels?: Record<string, string[]>;
    modelError?: string;
  }>("chat_load_models", { cwd });
export const chatAutoName = (id: string) =>
  invoke<string>("chat_auto_name", { id });
