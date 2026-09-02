// ─── Built-in Providers (static fallback) ─────────────────
// pi's real builtin catalog lives in @earendil-works/pi-ai as
// dist/providers/data/*.json and is served at /api/pi/builtin-providers via
// readBuiltinCatalog(). This list is only the fallback used when pi cannot be
// located on the machine, so it must stay consistent with that catalog.
//
// Generated from the pi-ai catalog shipped with this repo's pinned
// @earendil-works/pi-ai. Costs are USD per 1M tokens; only the entry pricing
// tier is kept (pi-ai's `cost.tiers` long-context surcharges are dropped
// because Model has no field for them).

import type { Provider } from "@/types";

export const BUILTIN_PROVIDERS: Provider[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    type: "builtin",
    api: "anthropic-messages",
    baseUrl: "https://api.anthropic.com",
    hasAuth: true,
    authMethod: "env",
    models: [
      { id: "claude-opus-5", name: "Claude Opus 5", reasoning: true, input: ["text", "image"], contextWindow: 1000000, maxTokens: 128000, cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }, enabled: false },
      { id: "claude-sonnet-5", name: "Claude Sonnet 5", reasoning: true, input: ["text", "image"], contextWindow: 1000000, maxTokens: 128000, cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 }, enabled: true },
      { id: "claude-opus-4-5", name: "Claude Opus 4.5 (latest)", reasoning: true, input: ["text", "image"], contextWindow: 200000, maxTokens: 64000, cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }, enabled: true },
      { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5 (latest)", reasoning: true, input: ["text", "image"], contextWindow: 1000000, maxTokens: 64000, cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }, enabled: true },
      { id: "claude-haiku-4-5", name: "Claude Haiku 4.5 (latest)", reasoning: true, input: ["text", "image"], contextWindow: 200000, maxTokens: 64000, cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 }, enabled: true },
    ],
  },
  {
    id: "openai",
    name: "OpenAI",
    type: "builtin",
    api: "openai-responses",
    baseUrl: "https://api.openai.com/v1",
    hasAuth: true,
    authMethod: "env",
    models: [
      { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", reasoning: true, input: ["text", "image"], contextWindow: 272000, maxTokens: 128000, cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 6.25 }, enabled: true },
      { id: "gpt-5.6-terra", name: "GPT-5.6 Terra", reasoning: true, input: ["text", "image"], contextWindow: 272000, maxTokens: 128000, cost: { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 3.125 }, enabled: true },
      { id: "gpt-5.6-luna", name: "GPT-5.6 Luna", reasoning: true, input: ["text", "image"], contextWindow: 272000, maxTokens: 128000, cost: { input: 1, output: 6, cacheRead: 0.1, cacheWrite: 1.25 }, enabled: false },
      { id: "gpt-5.1", name: "GPT-5.1", reasoning: true, input: ["text", "image"], contextWindow: 400000, maxTokens: 128000, cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 }, enabled: true },
      { id: "o3-mini", name: "o3-mini", reasoning: true, input: ["text"], contextWindow: 200000, maxTokens: 100000, cost: { input: 1.1, output: 4.4, cacheRead: 0.55, cacheWrite: 0 }, enabled: false },
    ],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    type: "builtin",
    api: "openai-completions",
    baseUrl: "https://api.deepseek.com",
    hasAuth: true,
    authMethod: "env",
    models: [
      { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", reasoning: true, input: ["text"], contextWindow: 1000000, maxTokens: 384000, cost: { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 }, enabled: true },
      { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", reasoning: true, input: ["text"], contextWindow: 1000000, maxTokens: 384000, cost: { input: 0.435, output: 0.87, cacheRead: 0.003625, cacheWrite: 0 }, enabled: true },
    ],
  },
  {
    id: "google",
    name: "Google",
    type: "builtin",
    api: "google-generative-ai",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    hasAuth: true,
    authMethod: "env",
    models: [
      { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview", reasoning: true, input: ["text", "image"], contextWindow: 1048576, maxTokens: 65536, cost: { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 0 }, enabled: false },
      { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash", reasoning: true, input: ["text", "image"], contextWindow: 1048576, maxTokens: 65536, cost: { input: 1.5, output: 9, cacheRead: 0.15, cacheWrite: 0 }, enabled: true },
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", reasoning: true, input: ["text", "image"], contextWindow: 1048576, maxTokens: 65536, cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 }, enabled: false },
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", reasoning: true, input: ["text", "image"], contextWindow: 1048576, maxTokens: 65536, cost: { input: 0.3, output: 2.5, cacheRead: 0.03, cacheWrite: 0 }, enabled: true },
    ],
  },
  {
    id: "opencode",
    name: "OpenCode Zen",
    type: "builtin",
    api: "openai-completions",
    baseUrl: "https://opencode.ai/zen/v1",
    hasAuth: true,
    authMethod: "file",
    models: [
      { id: "deepseek-v4-flash-free", name: "DeepSeek V4 Flash Free", reasoning: true, input: ["text"], contextWindow: 200000, maxTokens: 128000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, enabled: true },
      { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", reasoning: true, input: ["text"], contextWindow: 1000000, maxTokens: 384000, cost: { input: 0.14, output: 0.28, cacheRead: 0.028, cacheWrite: 0 }, enabled: true },
      { id: "claude-sonnet-5", name: "Claude Sonnet 5", reasoning: true, input: ["text", "image"], contextWindow: 1000000, maxTokens: 128000, cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 }, enabled: true },
      { id: "gpt-5", name: "GPT-5", reasoning: true, input: ["text", "image"], contextWindow: 400000, maxTokens: 128000, cost: { input: 1.07, output: 8.5, cacheRead: 0.107, cacheWrite: 0 }, enabled: false },
      { id: "glm-5.2", name: "GLM-5.2", reasoning: true, input: ["text"], contextWindow: 1000000, maxTokens: 131072, cost: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 }, enabled: true },
    ],
  },
  {
    id: "opencode-go",
    name: "OpenCode Zen Go",
    type: "builtin",
    api: "openai-completions",
    baseUrl: "https://opencode.ai/zen/go/v1",
    hasAuth: true,
    authMethod: "file",
    models: [
      { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", reasoning: true, input: ["text"], contextWindow: 1000000, maxTokens: 384000, cost: { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 }, enabled: true },
      { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", reasoning: true, input: ["text"], contextWindow: 1000000, maxTokens: 384000, cost: { input: 0.435, output: 0.87, cacheRead: 0.003625, cacheWrite: 0 }, enabled: true },
      { id: "glm-5.2", name: "GLM-5.2", reasoning: true, input: ["text"], contextWindow: 1000000, maxTokens: 131072, cost: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 }, enabled: true },
      { id: "qwen3.7-max", name: "Qwen3.7 Max", reasoning: true, input: ["text"], contextWindow: 1000000, maxTokens: 65536, cost: { input: 2.5, output: 7.5, cacheRead: 0.5, cacheWrite: 3.125 }, enabled: true },
      { id: "minimax-m3", name: "MiniMax-M3", reasoning: true, input: ["text", "image"], contextWindow: 1000000, maxTokens: 131072, cost: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0 }, enabled: true },
      { id: "kimi-k3", name: "Kimi K3 (2x usage)", reasoning: true, input: ["text", "image"], contextWindow: 1048576, maxTokens: 131072, cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 0 }, enabled: true },
    ],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    type: "builtin",
    api: "openai-completions",
    baseUrl: "https://openrouter.ai/api/v1",
    hasAuth: false,
    authMethod: "none",
    models: [
      { id: "anthropic/claude-sonnet-5", name: "Anthropic: Claude Sonnet 5", reasoning: true, input: ["text", "image"], contextWindow: 1000000, maxTokens: 128000, cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 }, enabled: false },
      { id: "anthropic/claude-opus-4.5", name: "Anthropic: Claude Opus 4.5", reasoning: true, input: ["text", "image"], contextWindow: 200000, maxTokens: 64000, cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }, enabled: false },
      { id: "deepseek/deepseek-v4-flash", name: "DeepSeek: DeepSeek V4 Flash", reasoning: true, input: ["text"], contextWindow: 1048576, maxTokens: 393216, cost: { input: 0.14, output: 0.28, cacheRead: 0.028, cacheWrite: 0 }, enabled: false },
    ],
  },
  {
    id: "mistral",
    name: "Mistral",
    type: "builtin",
    api: "mistral-conversations",
    baseUrl: "https://api.mistral.ai",
    hasAuth: false,
    authMethod: "none",
    models: [
      { id: "mistral-large-latest", name: "Mistral Large (latest)", reasoning: false, input: ["text", "image"], contextWindow: 262144, maxTokens: 262144, cost: { input: 0.5, output: 1.5, cacheRead: 0.05, cacheWrite: 0 }, enabled: true },
      { id: "mistral-medium-latest", name: "Mistral Medium (latest)", reasoning: true, input: ["text", "image"], contextWindow: 262144, maxTokens: 262144, cost: { input: 1.5, output: 7.5, cacheRead: 0.15, cacheWrite: 0 }, enabled: false },
      { id: "mistral-small-latest", name: "Mistral Small (latest)", reasoning: true, input: ["text", "image"], contextWindow: 256000, maxTokens: 256000, cost: { input: 0.15, output: 0.6, cacheRead: 0.015, cacheWrite: 0 }, enabled: false },
    ],
  },
  {
    id: "github-copilot",
    name: "GitHub Copilot",
    type: "builtin",
    api: "anthropic-messages",
    baseUrl: "https://api.individual.githubcopilot.com",
    hasAuth: false,
    authMethod: "none",
    models: [
      { id: "claude-sonnet-5", name: "Claude Sonnet 5", reasoning: true, input: ["text", "image"], contextWindow: 1000000, maxTokens: 128000, cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 }, enabled: true },
      { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", reasoning: true, input: ["text", "image"], contextWindow: 1050000, maxTokens: 128000, cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 6.25 }, enabled: true },
      { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash", reasoning: true, input: ["text", "image"], contextWindow: 200000, maxTokens: 64000, cost: { input: 1.5, output: 9, cacheRead: 0.15, cacheWrite: 0 }, enabled: true },
    ],
  },
  {
    id: "groq",
    name: "Groq",
    type: "builtin",
    api: "openai-completions",
    baseUrl: "https://api.groq.com/openai/v1",
    hasAuth: false,
    authMethod: "none",
    models: [
      { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B", reasoning: false, input: ["text"], contextWindow: 131072, maxTokens: 32768, cost: { input: 0.59, output: 0.79, cacheRead: 0, cacheWrite: 0 }, enabled: true },
      { id: "meta-llama/llama-4-scout-17b-16e-instruct", name: "Llama 4 Scout 17B 16E", reasoning: false, input: ["text", "image"], contextWindow: 131072, maxTokens: 8192, cost: { input: 0.11, output: 0.34, cacheRead: 0, cacheWrite: 0 }, enabled: false },
    ],
  },
];

export function getBuiltinProviders(): Provider[] {
  return BUILTIN_PROVIDERS;
}
