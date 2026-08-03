// ─── Built-in Providers ───────────────────────────────────
// These are hardcoded in pi's Rust source and not exposed as config files.
// We maintain this list to display known providers in the UI.

import type { Provider } from "@/types";

export const BUILTIN_PROVIDERS: Provider[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    type: "builtin",
    api: "anthropic-messages",
    baseUrl: "https://api.anthropic.com/v1",
    hasAuth: true,
    authMethod: "env",
    models: [
      { id: "claude-sonnet-4", name: "Claude 4 Sonnet", reasoning: true, input: ["text", "image"], contextWindow: 200000, maxTokens: 16384, cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }, enabled: true },
      { id: "claude-sonnet-4-5", name: "Claude 4.5 Sonnet", reasoning: true, input: ["text", "image"], contextWindow: 200000, maxTokens: 16384, cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }, enabled: false },
      { id: "claude-opus-4", name: "Claude 4 Opus", reasoning: true, input: ["text", "image"], contextWindow: 200000, maxTokens: 32000, cost: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 }, enabled: false },
      { id: "claude-haiku-3-5", name: "Claude 3.5 Haiku", reasoning: false, input: ["text", "image"], contextWindow: 200000, maxTokens: 8192, cost: { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 }, enabled: true },
    ],
  },
  {
    id: "openai",
    name: "OpenAI",
    type: "builtin",
    api: "openai-completions",
    baseUrl: "https://api.openai.com/v1",
    hasAuth: true,
    authMethod: "env",
    models: [
      { id: "gpt-4o", name: "GPT-4o", reasoning: false, input: ["text", "image"], contextWindow: 128000, maxTokens: 16384, cost: { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 3.75 }, enabled: true },
      { id: "gpt-4o-mini", name: "GPT-4o Mini", reasoning: false, input: ["text", "image"], contextWindow: 128000, maxTokens: 16384, cost: { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0.225 }, enabled: true },
      { id: "gpt-5.1", name: "GPT-5.1", reasoning: true, input: ["text", "image"], contextWindow: 256000, maxTokens: 65536, cost: { input: 10, output: 40, cacheRead: 5, cacheWrite: 10 }, enabled: false },
      { id: "o3-mini", name: "o3-mini", reasoning: true, input: ["text"], contextWindow: 200000, maxTokens: 100000, cost: { input: 1.1, output: 4.4, cacheRead: 0.55, cacheWrite: 1.65 }, enabled: false },
    ],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    type: "builtin",
    api: "openai-completions",
    baseUrl: "https://api.deepseek.com/v1",
    hasAuth: true,
    authMethod: "env",
    models: [
      { id: "deepseek-chat", name: "DeepSeek V3", reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 8192, cost: { input: 0.27, output: 1.1, cacheRead: 0.07, cacheWrite: 0.27 }, enabled: true },
      { id: "deepseek-reasoner", name: "DeepSeek R1", reasoning: true, input: ["text"], contextWindow: 128000, maxTokens: 8192, cost: { input: 0.55, output: 2.19, cacheRead: 0.14, cacheWrite: 0.55 }, enabled: true },
    ],
  },
  {
    id: "opencode",
    name: "OpenCode",
    type: "builtin",
    api: "openai-completions",
    hasAuth: true,
    authMethod: "file",
    models: [
      { id: "deepseek-v4-flash-free", name: "DeepSeek V4 Flash (Free)", reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 8192, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, enabled: true },
      { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 8192, cost: { input: 0.3, output: 0.6, cacheRead: 0.15, cacheWrite: 0.3 }, enabled: true },
    ],
  },
  {
    id: "opencode-go",
    name: "OpenCode Go",
    type: "builtin",
    api: "openai-completions",
    hasAuth: true,
    authMethod: "file",
    models: [
      { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 8192, cost: { input: 0.3, output: 0.6, cacheRead: 0.15, cacheWrite: 0.3 }, enabled: true },
      { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", reasoning: true, input: ["text"], contextWindow: 128000, maxTokens: 8192, cost: { input: 2, output: 8, cacheRead: 1, cacheWrite: 2 }, enabled: true },
      { id: "glm-5.1", name: "GLM 5.1", reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 8192, cost: { input: 0.5, output: 2, cacheRead: 0.25, cacheWrite: 0.5 }, enabled: true },
      { id: "qwen3.7-max", name: "Qwen 3.7 Max", reasoning: true, input: ["text"], contextWindow: 128000, maxTokens: 8192, cost: { input: 1.5, output: 6, cacheRead: 0.75, cacheWrite: 1.5 }, enabled: true },
      { id: "mimo-v2.5", name: "MiMo V2.5", reasoning: true, input: ["text"], contextWindow: 128000, maxTokens: 8192, cost: { input: 1.2, output: 4.8, cacheRead: 0.6, cacheWrite: 1.2 }, enabled: true },
    ],
  },
  {
    id: "google",
    name: "Google Gemini",
    type: "builtin",
    api: "google-generative-ai",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    hasAuth: true,
    authMethod: "env",
    models: [
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", reasoning: false, input: ["text", "image"], contextWindow: 1048576, maxTokens: 65536, cost: { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0.15 }, enabled: true },
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", reasoning: true, input: ["text", "image"], contextWindow: 1048576, maxTokens: 65536, cost: { input: 1.25, output: 10, cacheRead: 0.625, cacheWrite: 1.25 }, enabled: false },
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
      { id: "openrouter/anthropic/claude-sonnet-4", name: "Claude 4 Sonnet (OpenRouter)", reasoning: true, input: ["text", "image"], contextWindow: 200000, maxTokens: 16384, cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }, enabled: false },
      { id: "openrouter/deepseek/deepseek-r1", name: "DeepSeek R1 (OpenRouter)", reasoning: true, input: ["text"], contextWindow: 128000, maxTokens: 8192, cost: { input: 0.55, output: 2.19, cacheRead: 0.14, cacheWrite: 0.55 }, enabled: false },
    ],
  },
  {
    id: "mistral",
    name: "Mistral",
    type: "builtin",
    api: "mistral-conversations",
    baseUrl: "https://api.mistral.ai/v1",
    hasAuth: false,
    authMethod: "none",
    models: [
      { id: "mistral-large", name: "Mistral Large", reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 8192, cost: { input: 2, output: 6, cacheRead: 1, cacheWrite: 2 }, enabled: false },
    ],
  },
  {
    id: "github-copilot",
    name: "GitHub Copilot",
    type: "builtin",
    api: "openai-completions",
    baseUrl: "https://api.githubcopilot.com",
    hasAuth: false,
    authMethod: "none",
    models: [
      { id: "copilot-gpt-4o", name: "Copilot GPT-4o", reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, enabled: false },
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
      { id: "llama-3.3-70b", name: "Llama 3.3 70B", reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 4096, cost: { input: 0.59, output: 0.79, cacheRead: 0, cacheWrite: 0 }, enabled: false },
    ],
  },
];

export function getBuiltinProviders(): Provider[] {
  return BUILTIN_PROVIDERS;
}
