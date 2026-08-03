// ─── Core Types ───────────────────────────────────────────

export interface ModelCost {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ThinkingLevelMap {
  off?: string | null;
  minimal?: string | null;
  low?: string | null;
  medium?: string | null;
  high?: string | null;
  xhigh?: string | null;
}

export interface ModelCompat {
  supportsStore?: boolean;
  supportsDeveloperRole?: boolean;
  supportsReasoningEffort?: boolean;
  supportsUsageInStreaming?: boolean;
  maxTokensField?: "max_completion_tokens" | "max_tokens";
  requiresToolResultName?: boolean;
  requiresAssistantAfterToolResult?: boolean;
  requiresThinkingAsText?: boolean;
  requiresReasoningContentOnAssistantMessages?: boolean;
  thinkingFormat?: string;
  cacheControlFormat?: "anthropic";
  supportsEagerToolInputStreaming?: boolean;
  supportsLongCacheRetention?: boolean;
  sendSessionAffinityHeaders?: boolean;
  supportsCacheControlOnTools?: boolean;
  forceAdaptiveThinking?: boolean;
  allowEmptySignature?: boolean;
  openRouterRouting?: Record<string, unknown>;
}

export interface Model {
  id: string;
  name?: string;
  api?: ApiType;
  baseUrl?: string;
  reasoning?: boolean;
  thinkingLevelMap?: ThinkingLevelMap;
  input?: ("text" | "image" | "audio")[];
  cost?: ModelCost;
  contextWindow?: number;
  maxTokens?: number;
  compat?: ModelCompat;
  headers?: Record<string, string>;
  enabled?: boolean;
}

export type ApiType =
  | "openai-completions"
  | "openai-responses"
  | "anthropic-messages"
  | "google-generative-ai"
  | "google-vertex"
  | "bedrock-converse-stream"
  | "mistral-conversations"
  | "azure-openai-responses"
  | "openai-codex-responses";

export interface ProviderAuth {
  type: "api_key" | "oauth";
  key?: string;
  env?: Record<string, string>;
}

export interface ProviderOAuth {
  name: string;
}

export interface Provider {
  id: string;
  name: string;
  type: "builtin" | "custom";
  baseUrl?: string;
  api?: ApiType;
  apiKey?: string;
  authHeader?: boolean;
  headers?: Record<string, string>;
  models: Model[];
  oauth?: ProviderOAuth;
  compat?: ModelCompat;

  // Auth state
  hasAuth: boolean;
  authMethod?: "env" | "file" | "cli" | "none";
}

// ─── Pi Config Structure ──────────────────────────────────

export interface PiSettings {
  lastChangelogVersion?: string;
  defaultProvider?: string;
  defaultModel?: string;
  defaultThinkingLevel?: string;
  defaultProjectTrust?: string;
  theme?: "light" | "dark" | "light/dark";
  hideThinkingBlock?: boolean;
  retry?: { enabled: boolean };
  packages?: string[];
  terminal?: { showTerminalProgress?: boolean };
  warnings?: Record<string, boolean>;
  treeFilterMode?: string;
  doubleEscapeAction?: string;
  enabledModels?: string[];
}

export interface PiAuth {
  [providerId: string]: ProviderAuth;
}

export interface CustomProviderConfig {
  name?: string;
  baseUrl?: string;
  api?: ApiType;
  apiKey?: string;
  authHeader?: boolean;
  headers?: Record<string, string>;
  models?: Model[];
  compat?: ModelCompat;
  modelOverrides?: Record<string, Partial<Model>>;
}

export interface PiModelsJson {
  providers: Record<string, CustomProviderConfig>;
}

export interface PiConfig {
  settings: PiSettings;
  auth: PiAuth;
  modelsJson: PiModelsJson | null;
}

// pi core / extension update check (server queries the npm registry)
export interface UpdateItem {
  name: string;
  installed: string;
  latest: string | null; // null → registry lookup failed
  hasUpdate: boolean;
}

export interface UpdateCheckResult {
  pi: UpdateItem | null; // null → pi version unknown
  extensions: UpdateItem[];
  checkedAt: number;
}

// ─── Usage / Dashboard Types ──────────────────────────────

export interface UsageRecord {
  date: string; // ISO date YYYY-MM-DD
  providerId: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  requests: number;
  cost: number;
}

export interface DailyAggregate {
  date: string;
  totalTokens: number;
  totalCost: number;
  totalRequests: number;
  inputTokens: number;
  outputTokens: number;
}

export interface ModelUsageSummary {
  modelId: string;
  providerId: string;
  modelName: string;
  totalTokens: number;
  totalCost: number;
  totalRequests: number;
  avgTokensPerRequest: number;
}

export interface ProviderUsageSummary {
  providerId: string;
  providerName: string;
  totalTokens: number;
  totalCost: number;
  totalRequests: number;
  modelCount: number;
}

// ─── Subagents ───────────────────────────────────────────

export interface AgentDef {
  name: string;
  fileName: string;
  filePath: string;
  package: string;
  description: string;
  model?: string;
  tools?: string[];
  thinking?: string;
  systemPromptMode?: string;
  inheritProjectContext?: boolean;
  inheritSkills?: boolean;
  input?: string[];
  body: string;
}

export interface ChainStep {
  agent: string;
  phase?: string;
  label?: string;
  output?: string;
  as?: string;
  task?: string;
}

export interface ChainDef {
  name: string;
  fileName: string;
  filePath: string;
  description: string;
  steps: ChainStep[];
  body: string;
}

export interface RunRecord {
  agent: string;
  ts: number;
  status: string;
  duration?: number;
  exit?: number;
  taskHash?: string;
}

export interface SubagentsData {
  agents: AgentDef[];
  chains: ChainDef[];
  runHistory: RunRecord[];
}

// ─── Config Import/Export ─────────────────────────────────

export interface ExportPayload {
  version: string;
  exportedAt: string;
  config: PiConfig;
}