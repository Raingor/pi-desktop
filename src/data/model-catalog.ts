// ─── Model Catalog ─────────────────────────────────────────
// A curated database of known models with their full capabilities,
// so users don't have to look up context window / max tokens / reasoning / vision / cost
// every time they add a model to a custom provider.
//
// Costs are in USD per 1M tokens. For providers whose pricing differs
// from the vendor (e.g. resellers), users can override cost in the form.

import type { Model } from "@/types";

export interface CatalogEntry {
  // Match patterns: tried in order, first match wins on id (case-insensitive)
  patterns: string[];
  // Filled-in model meta
  name?: string;
  reasoning?: boolean;
  input?: Model["input"];
  contextWindow: number;
  maxTokens: number;
  cost?: Model["cost"];
  // Optional tag shown in the catalog picker
  family?: string;
}

// ─── Helpers ────────────────────────────────────────────────

const P = (input: number, output: number, cacheRead = 0, cacheWrite = 0) => ({
  input,
  output,
  cacheRead,
  cacheWrite,
});

// ─── Catalog ────────────────────────────────────────────────
// Ordered roughly by popularity; more specific patterns first.

export const MODEL_CATALOG: CatalogEntry[] = [
  // ── Anthropic Claude ────────────────────────────────────
  {
    patterns: ["claude-opus-4-5", "claude-4-5-opus"],
    name: "Claude 4.5 Opus",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 200_000,
    maxTokens: 32_000,
    cost: P(15, 75, 1.5, 18.75),
    family: "Anthropic",
  },
  {
    patterns: ["claude-sonnet-4-5", "claude-4-5-sonnet"],
    name: "Claude 4.5 Sonnet",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 200_000,
    maxTokens: 16_384,
    cost: P(3, 15, 0.3, 3.75),
    family: "Anthropic",
  },
  {
    patterns: ["claude-opus-4", "claude-4-opus"],
    name: "Claude 4 Opus",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 200_000,
    maxTokens: 32_000,
    cost: P(15, 75, 1.5, 18.75),
    family: "Anthropic",
  },
  {
    patterns: ["claude-sonnet-4", "claude-4-sonnet"],
    name: "Claude 4 Sonnet",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 200_000,
    maxTokens: 16_384,
    cost: P(3, 15, 0.3, 3.75),
    family: "Anthropic",
  },
  {
    patterns: ["claude-3-7-sonnet", "claude-3.7-sonnet"],
    name: "Claude 3.7 Sonnet",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 200_000,
    maxTokens: 64_000,
    cost: P(3, 15, 0.3, 3.75),
    family: "Anthropic",
  },
  {
    patterns: ["claude-3-5-sonnet", "claude-3.5-sonnet"],
    name: "Claude 3.5 Sonnet",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 200_000,
    maxTokens: 8192,
    cost: P(3, 15, 0.3, 3.75),
    family: "Anthropic",
  },
  {
    patterns: ["claude-3-5-haiku", "claude-3.5-haiku"],
    name: "Claude 3.5 Haiku",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 200_000,
    maxTokens: 8192,
    cost: P(0.8, 4, 0.08, 1),
    family: "Anthropic",
  },
  {
    patterns: ["claude-haiku-3-5"],
    name: "Claude 3.5 Haiku",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 200_000,
    maxTokens: 8192,
    cost: P(0.8, 4, 0.08, 1),
    family: "Anthropic",
  },

  // ── OpenAI / GPT ────────────────────────────────────────
  {
    patterns: ["gpt-5", "gpt5"],
    name: "GPT-5",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 256_000,
    maxTokens: 65_536,
    cost: P(10, 40, 5, 10),
    family: "OpenAI",
  },
  {
    patterns: ["gpt-5.1", "gpt-5-1"],
    name: "GPT-5.1",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 256_000,
    maxTokens: 65_536,
    cost: P(10, 40, 5, 10),
    family: "OpenAI",
  },
  {
    patterns: ["gpt-4o-mini"],
    name: "GPT-4o Mini",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 128_000,
    maxTokens: 16_384,
    cost: P(0.15, 0.6, 0.075, 0.225),
    family: "OpenAI",
  },
  {
    patterns: ["gpt-4o"],
    name: "GPT-4o",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 128_000,
    maxTokens: 16_384,
    cost: P(2.5, 10, 1.25, 3.75),
    family: "OpenAI",
  },
  {
    patterns: ["gpt-4.1-mini", "gpt-4-1-mini"],
    name: "GPT-4.1 Mini",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 1_048_576,
    maxTokens: 65_536,
    cost: P(0.4, 1.6, 0.2, 0.4),
    family: "OpenAI",
  },
  {
    patterns: ["gpt-4.1", "gpt-4-1"],
    name: "GPT-4.1",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 1_048_576,
    maxTokens: 32_768,
    cost: P(2, 8, 0.5, 2),
    family: "OpenAI",
  },
  {
    patterns: ["o3-pro"],
    name: "o3-pro",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 200_000,
    maxTokens: 100_000,
    cost: P(11, 44),
    family: "OpenAI",
  },
  {
    patterns: ["o3"],
    name: "o3",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 200_000,
    maxTokens: 100_000,
    cost: P(2, 8, 1, 2),
    family: "OpenAI",
  },
  {
    patterns: ["o4-mini"],
    name: "o4-mini",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 200_000,
    maxTokens: 100_000,
    cost: P(1.1, 4.4, 0.55, 1.65),
    family: "OpenAI",
  },
  {
    patterns: ["o3-mini"],
    name: "o3-mini",
    reasoning: true,
    input: ["text"],
    contextWindow: 200_000,
    maxTokens: 100_000,
    cost: P(1.1, 4.4, 0.55, 1.65),
    family: "OpenAI",
  },
  {
    patterns: ["o1"],
    name: "o1",
    reasoning: true,
    input: ["text"],
    contextWindow: 200_000,
    maxTokens: 100_000,
    cost: P(15, 60),
    family: "OpenAI",
  },

  // ── DeepSeek ────────────────────────────────────────────
  {
    patterns: ["deepseek-v4", "deepseek-v4-flash", "deepseek-v4-chat"],
    name: "DeepSeek V4 Flash",
    reasoning: false,
    input: ["text"],
    contextWindow: 128_000,
    maxTokens: 8192,
    cost: P(0.3, 0.6, 0.15, 0.3),
    family: "DeepSeek",
  },
  {
    patterns: ["deepseek-v4-pro"],
    name: "DeepSeek V4 Pro",
    reasoning: true,
    input: ["text"],
    contextWindow: 128_000,
    maxTokens: 8192,
    cost: P(2, 8, 1, 2),
    family: "DeepSeek",
  },
  {
    patterns: ["deepseek-reasoner", "deepseek-r1"],
    name: "DeepSeek R1",
    reasoning: true,
    input: ["text"],
    contextWindow: 128_000,
    maxTokens: 8192,
    cost: P(0.55, 2.19, 0.14, 0.55),
    family: "DeepSeek",
  },
  {
    patterns: ["deepseek-chat", "deepseek-v3"],
    name: "DeepSeek V3",
    reasoning: false,
    input: ["text"],
    contextWindow: 128_000,
    maxTokens: 8192,
    cost: P(0.27, 1.1, 0.07, 0.27),
    family: "DeepSeek",
  },

  // ── Google Gemini ───────────────────────────────────────
  {
    patterns: ["gemini-2.5-pro"],
    name: "Gemini 2.5 Pro",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_048_576,
    maxTokens: 65_536,
    cost: P(1.25, 10, 0.625, 1.25),
    family: "Google",
  },
  {
    patterns: ["gemini-2.5-flash"],
    name: "Gemini 2.5 Flash",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 1_048_576,
    maxTokens: 65_536,
    cost: P(0.15, 0.6, 0.075, 0.15),
    family: "Google",
  },
  {
    patterns: ["gemini-2.0-flash"],
    name: "Gemini 2.0 Flash",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 1_048_576,
    maxTokens: 8192,
    cost: P(0.1, 0.4, 0.025, 0.1),
    family: "Google",
  },

  // ── Alibaba Qwen (通义千问) ─────────────────────────────
  {
    patterns: ["qwen3-max", "qwen-3-max", "qwen3.7-max", "qwen-3.7-max"],
    name: "Qwen 3 Max",
    reasoning: true,
    input: ["text"],
    contextWindow: 128_000,
    maxTokens: 8192,
    cost: P(1.5, 6, 0.75, 1.5),
    family: "Qwen",
  },
  {
    patterns: ["qwen3-coder"],
    name: "Qwen 3 Coder",
    reasoning: true,
    input: ["text"],
    contextWindow: 256_000,
    maxTokens: 65_536,
    family: "Qwen",
  },
  {
    patterns: ["qwen3-vl"],
    name: "Qwen 3 VL",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 128_000,
    maxTokens: 8192,
    family: "Qwen",
  },
  {
    patterns: ["qwen3-"],
    name: "Qwen 3",
    reasoning: true,
    input: ["text"],
    contextWindow: 128_000,
    maxTokens: 8192,
    family: "Qwen",
  },
  {
    patterns: ["qwen2.5-vl", "qwen-vl-max", "qwen-vl-plus"],
    name: "Qwen VL",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 128_000,
    maxTokens: 8192,
    family: "Qwen",
  },
  {
    patterns: ["qwen-max"],
    name: "Qwen Max",
    reasoning: false,
    input: ["text"],
    contextWindow: 32_768,
    maxTokens: 8192,
    cost: P(1.6, 6.4),
    family: "Qwen",
  },
  {
    patterns: ["qwen-plus"],
    name: "Qwen Plus",
    reasoning: false,
    input: ["text"],
    contextWindow: 128_000,
    maxTokens: 8192,
    cost: P(0.8, 2),
    family: "Qwen",
  },
  {
    patterns: ["qwen-turbo"],
    name: "Qwen Turbo",
    reasoning: false,
    input: ["text"],
    contextWindow: 1_000_000,
    maxTokens: 8192,
    cost: P(0.3, 0.6),
    family: "Qwen",
  },
  {
    patterns: ["qwen2.5-coder", "qwen-coder"],
    name: "Qwen 2.5 Coder",
    reasoning: false,
    input: ["text"],
    contextWindow: 128_000,
    maxTokens: 8192,
    family: "Qwen",
  },
  {
    patterns: ["qwen2.5-72b"],
    name: "Qwen 2.5 72B",
    reasoning: false,
    input: ["text"],
    contextWindow: 128_000,
    maxTokens: 8192,
    family: "Qwen",
  },
  {
    patterns: ["qwen-long"],
    name: "Qwen Long",
    reasoning: false,
    input: ["text"],
    contextWindow: 10_000_000,
    maxTokens: 8192,
    cost: P(0.5, 2),
    family: "Qwen",
  },

  // ── Zhipu GLM (智谱) ────────────────────────────────────
  {
    patterns: ["glm-5.1", "glm-5-plus"],
    name: "GLM 5.1",
    reasoning: false,
    input: ["text"],
    contextWindow: 128_000,
    maxTokens: 8192,
    cost: P(0.5, 2, 0.25, 0.5),
    family: "GLM",
  },
  {
    patterns: ["glm-z1", "glm-4.5"],
    name: "GLM-Z1 (Reasoning)",
    reasoning: true,
    input: ["text"],
    contextWindow: 128_000,
    maxTokens: 8192,
    family: "GLM",
  },
  {
    patterns: ["glm-4-plus"],
    name: "GLM-4 Plus",
    reasoning: false,
    input: ["text"],
    contextWindow: 128_000,
    maxTokens: 4096,
    cost: P(5, 5),
    family: "GLM",
  },
  {
    patterns: ["glm-4-air"],
    name: "GLM-4 Air",
    reasoning: false,
    input: ["text"],
    contextWindow: 128_000,
    maxTokens: 4096,
    cost: P(0.1, 0.1),
    family: "GLM",
  },
  {
    patterns: ["glm-4v", "glm-4-vision"],
    name: "GLM-4V (Vision)",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 8192,
    maxTokens: 4096,
    cost: P(1, 1),
    family: "GLM",
  },
  {
    patterns: ["glm-4-long"],
    name: "GLM-4 Long",
    reasoning: false,
    input: ["text"],
    contextWindow: 1_000_000,
    maxTokens: 4096,
    cost: P(1, 1),
    family: "GLM",
  },

  // ── Moonshot Kimi (月之暗面) ────────────────────────────
  {
    patterns: ["moonshot-v1-128k", "kimi-128k"],
    name: "Kimi 128K",
    reasoning: false,
    input: ["text"],
    contextWindow: 128_000,
    maxTokens: 8192,
    cost: P(1.2, 1.2),
    family: "Moonshot",
  },
  {
    patterns: ["moonshot-v1-32k", "kimi-32k"],
    name: "Kimi 32K",
    reasoning: false,
    input: ["text"],
    contextWindow: 32_768,
    maxTokens: 8192,
    cost: P(0.6, 0.6),
    family: "Moonshot",
  },
  {
    patterns: ["moonshot-v1-8k", "kimi-8k", "moonshot-v1"],
    name: "Kimi 8K",
    reasoning: false,
    input: ["text"],
    contextWindow: 8192,
    maxTokens: 4096,
    cost: P(0.3, 0.3),
    family: "Moonshot",
  },
  {
    patterns: ["kimi-latest"],
    name: "Kimi Latest",
    reasoning: false,
    input: ["text"],
    contextWindow: 256_000,
    maxTokens: 8192,
    family: "Moonshot",
  },

  // ── ByteDance Doubao (豆包) ─────────────────────────────
  {
    patterns: ["doubao-1.5-pro"],
    name: "Doubao 1.5 Pro",
    reasoning: false,
    input: ["text"],
    contextWindow: 256_000,
    maxTokens: 16_384,
    cost: P(0.8, 2),
    family: "Doubao",
  },
  {
    patterns: ["doubao-pro"],
    name: "Doubao Pro",
    reasoning: false,
    input: ["text"],
    contextWindow: 256_000,
    maxTokens: 4096,
    cost: P(0.8, 2),
    family: "Doubao",
  },
  {
    patterns: ["doubao-lite"],
    name: "Doubao Lite",
    reasoning: false,
    input: ["text"],
    contextWindow: 256_000,
    maxTokens: 4096,
    cost: P(0.3, 0.6),
    family: "Doubao",
  },
  {
    patterns: ["doubao-vision"],
    name: "Doubao Vision",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 32_768,
    maxTokens: 4096,
    family: "Doubao",
  },
  {
    patterns: ["seed-1-6", "doubao-seed"],
    name: "Doubao Seed 1.6",
    reasoning: true,
    input: ["text"],
    contextWindow: 256_000,
    maxTokens: 16_384,
    family: "Doubao",
  },

  // ── Baidu ERNIE (文心) ──────────────────────────────────
  {
    patterns: ["ernie-4", "ernie-4.0", "wenxin-4"],
    name: "ERNIE 4.0",
    reasoning: false,
    input: ["text"],
    contextWindow: 128_000,
    maxTokens: 4096,
    cost: P(12, 12),
    family: "ERNIE",
  },
  {
    patterns: ["ernie-3.5", "ernie-35"],
    name: "ERNIE 3.5",
    reasoning: false,
    input: ["text"],
    contextWindow: 128_000,
    maxTokens: 4096,
    cost: P(1.2, 1.2),
    family: "ERNIE",
  },
  {
    patterns: ["ernie-x1"],
    name: "ERNIE X1 (Reasoning)",
    reasoning: true,
    input: ["text"],
    contextWindow: 128_000,
    maxTokens: 8192,
    family: "ERNIE",
  },

  // ── SenseNova (商汤) ────────────────────────────────────
  {
    patterns: ["glm-5.2"],
    name: "GLM 5.2",
    reasoning: false,
    input: ["text"],
    contextWindow: 128_000,
    maxTokens: 8192,
    family: "SenseNova",
  },

  // ── MiniMax ─────────────────────────────────────────────
  {
    patterns: ["minimax-abab6.5", "abab6.5"],
    name: "MiniMax abab 6.5",
    reasoning: false,
    input: ["text"],
    contextWindow: 245_760,
    maxTokens: 8192,
    family: "MiniMax",
  },
  {
    patterns: ["minimax-text-01"],
    name: "MiniMax Text-01",
    reasoning: false,
    input: ["text"],
    contextWindow: 1_000_000,
    maxTokens: 8192,
    family: "MiniMax",
  },

  // ── 01.AI Yi (零一万物) ─────────────────────────────────
  {
    patterns: ["yi-lightning"],
    name: "Yi Lightning",
    reasoning: false,
    input: ["text"],
    contextWindow: 128_000,
    maxTokens: 4096,
    family: "Yi",
  },
  {
    patterns: ["yi-large"],
    name: "Yi Large",
    reasoning: false,
    input: ["text"],
    contextWindow: 32_768,
    maxTokens: 4096,
    cost: P(1, 2),
    family: "Yi",
  },
  {
    patterns: ["yi-vision"],
    name: "Yi Vision",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 16_384,
    maxTokens: 4096,
    family: "Yi",
  },
  {
    patterns: ["yi-34b"],
    name: "Yi 34B",
    reasoning: false,
    input: ["text"],
    contextWindow: 4096,
    maxTokens: 4096,
    family: "Yi",
  },

  // ── MiMo ────────────────────────────────────────────────
  {
    patterns: ["mimo-v2.5", "mimo-v2"],
    name: "MiMo V2.5",
    reasoning: true,
    input: ["text"],
    contextWindow: 128_000,
    maxTokens: 8192,
    cost: P(1.2, 4.8, 0.6, 1.2),
    family: "MiMo",
  },

  // ── StepFun (阶跃星辰) ──────────────────────────────────
  {
    patterns: ["step-2"],
    name: "Step 2",
    reasoning: true,
    input: ["text"],
    contextWindow: 128_000,
    maxTokens: 8192,
    family: "StepFun",
  },
  {
    patterns: ["step-1v"],
    name: "Step 1V (Vision)",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 8192,
    maxTokens: 4096,
    family: "StepFun",
  },

  // ── Mistral ─────────────────────────────────────────────
  {
    patterns: ["mistral-large"],
    name: "Mistral Large",
    reasoning: false,
    input: ["text"],
    contextWindow: 128_000,
    maxTokens: 8192,
    cost: P(2, 6, 1, 2),
    family: "Mistral",
  },
  {
    patterns: ["mistral-medium"],
    name: "Mistral Medium",
    reasoning: false,
    input: ["text"],
    contextWindow: 32_000,
    maxTokens: 4096,
    cost: P(0.4, 2),
    family: "Mistral",
  },
  {
    patterns: ["mistral-small"],
    name: "Mistral Small",
    reasoning: false,
    input: ["text"],
    contextWindow: 32_000,
    maxTokens: 4096,
    cost: P(0.2, 0.6),
    family: "Mistral",
  },
  {
    patterns: ["codestral"],
    name: "Codestral",
    reasoning: false,
    input: ["text"],
    contextWindow: 32_000,
    maxTokens: 4096,
    cost: P(0.3, 0.9),
    family: "Mistral",
  },

  // ── Llama (Meta) ────────────────────────────────────────
  {
    patterns: ["llama-4-maverick"],
    name: "Llama 4 Maverick",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_000_000,
    maxTokens: 16_384,
    family: "Llama",
  },
  {
    patterns: ["llama-4-scout"],
    name: "Llama 4 Scout",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 10_000_000,
    maxTokens: 16_384,
    family: "Llama",
  },
  {
    patterns: ["llama-3.3-70b", "llama-3-3-70b"],
    name: "Llama 3.3 70B",
    reasoning: false,
    input: ["text"],
    contextWindow: 128_000,
    maxTokens: 8192,
    cost: P(0.59, 0.79),
    family: "Llama",
  },
  {
    patterns: ["llama-3.1-405b", "llama-3-1-405b"],
    name: "Llama 3.1 405B",
    reasoning: false,
    input: ["text"],
    contextWindow: 128_000,
    maxTokens: 4096,
    family: "Llama",
  },
  {
    patterns: ["llama-3.1-70b", "llama-3-1-70b"],
    name: "Llama 3.1 70B",
    reasoning: false,
    input: ["text"],
    contextWindow: 128_000,
    maxTokens: 4096,
    family: "Llama",
  },
  {
    patterns: ["llama-3.2-90b-vision", "llama-3-2-90b-vision"],
    name: "Llama 3.2 90B Vision",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 128_000,
    maxTokens: 4096,
    family: "Llama",
  },
  {
    patterns: ["llama-3.2-11b-vision", "llama-3-2-11b-vision"],
    name: "Llama 3.2 11B Vision",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 128_000,
    maxTokens: 4096,
    family: "Llama",
  },

  // ── Grok (xAI) ─────────────────────────────────────────
  {
    patterns: ["grok-3-mini"],
    name: "Grok 3 Mini",
    reasoning: true,
    input: ["text"],
    contextWindow: 131_072,
    maxTokens: 16_384,
    cost: P(0.3, 0.5),
    family: "Grok",
  },
  {
    patterns: ["grok-3"],
    name: "Grok 3",
    reasoning: true,
    input: ["text"],
    contextWindow: 131_072,
    maxTokens: 16_384,
    cost: P(3, 15),
    family: "Grok",
  },

  // ── Cohere Command ──────────────────────────────────────
  {
    patterns: ["command-r-plus"],
    name: "Command R Plus",
    reasoning: false,
    input: ["text"],
    contextWindow: 128_000,
    maxTokens: 4096,
    cost: P(2.5, 10),
    family: "Cohere",
  },
  {
    patterns: ["command-r"],
    name: "Command R",
    reasoning: false,
    input: ["text"],
    contextWindow: 128_000,
    maxTokens: 4096,
    cost: P(0.15, 0.6),
    family: "Cohere",
  },

  // ── GitHub Copilot ──────────────────────────────────────
  {
    patterns: ["copilot-gpt-4o"],
    name: "Copilot GPT-4o",
    reasoning: false,
    input: ["text"],
    contextWindow: 128_000,
    maxTokens: 4096,
    cost: P(0, 0),
    family: "GitHub",
  },

  // ── OpenCode / free providers ───────────────────────────
  {
    patterns: ["deepseek-v4-flash-free"],
    name: "DeepSeek V4 Flash (Free)",
    reasoning: false,
    input: ["text"],
    contextWindow: 128_000,
    maxTokens: 8192,
    cost: P(0, 0, 0, 0),
    family: "OpenCode",
  },
];

// ─── Heuristic guess by id (pattern + keyword matching) ────
// Used as a last-resort fallthrough for unknown model IDs.

const KW_REASONING = /\b(r1|o1|o3|o4|z1|reasoner|reasoning|think\b|deepseek-r|qwq)\b/i;
const KW_VISION = /\b(vision|vl|multimodal|4o|gpt-4o|gemini-.*-vision|claude-.*opu|claude-.*sonnet|claude-.*haiku|llama-.*vision|qwen-.*vl|glm-.*v\b)\b/i;
const KW_CONTEXT_8K = /[-_](8k)\b/i;
const KW_CONTEXT_16K = /[-_](16k)\b/i;
const KW_CONTEXT_32K = /[-_](32k)\b/i;
const KW_CONTEXT_64K = /[-_](64k)\b/i;
const KW_CONTEXT_128K = /[-_](128k)\b/i;
const KW_CONTEXT_256K = /[-_](256k)\b/i;
const KW_CONTEXT_1M = /[-_](1m|1024k|1048576)\b/i;
const KW_AUDIO = /\b(audio|whisper|tts|speech)\b/i;

export interface GuessResult {
  reasoning?: boolean;
  input?: Model["input"];
  contextWindow?: number;
  maxTokens?: number;
  source: "catalog" | "heuristic" | "default";
  matched?: string; // pattern that matched
}

export function guessModelMeta(id: string): GuessResult {
  const key = (id ?? "").toLowerCase();

  // 1. Exact/prefix/suffix catalog match
  for (const entry of MODEL_CATALOG) {
    for (const p of entry.patterns) {
      const pat = p.toLowerCase();
      if (key === pat || key.startsWith(pat + "-") || key.endsWith("/" + pat) ||
          key.includes("/" + pat + "-") || key.includes("/" + pat + ":")) {
        return {
          reasoning: entry.reasoning,
          input: entry.input,
          contextWindow: entry.contextWindow,
          maxTokens: entry.maxTokens,
          source: "catalog",
          matched: entry.name ?? p,
        };
      }
    }
  }

  // 2. Heuristic keyword match
  const reasoning = KW_REASONING.test(key);
  const input: Model["input"] = ["text"];
  if (KW_VISION.test(key)) input.push("image");
  if (KW_AUDIO.test(key)) input.push("audio");

  let contextWindow: number | undefined;
  if (KW_CONTEXT_1M.test(key)) contextWindow = 1_048_576;
  else if (KW_CONTEXT_256K.test(key)) contextWindow = 262_144;
  else if (KW_CONTEXT_128K.test(key)) contextWindow = 131_072;
  else if (KW_CONTEXT_64K.test(key)) contextWindow = 65_536;
  else if (KW_CONTEXT_32K.test(key)) contextWindow = 32_768;
  else if (KW_CONTEXT_16K.test(key)) contextWindow = 16_384;
  else if (KW_CONTEXT_8K.test(key)) contextWindow = 8192;

  if (reasoning || input.length > 1 || contextWindow) {
    return { reasoning, input, contextWindow, source: "heuristic" };
  }

  // 3. Nothing matched — caller falls back to defaults
  return { source: "default" };
}

// ─── Search the catalog for the picker UI ───────────────────

export function searchCatalog(query: string, limit = 40): CatalogEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return MODEL_CATALOG.slice(0, limit);
  const out: CatalogEntry[] = [];
  for (const e of MODEL_CATALOG) {
    const hay = [e.name ?? "", e.family ?? "", ...e.patterns].join(" ").toLowerCase();
    if (hay.includes(q)) out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}

// ─── Convert a catalog entry to a Partial<Model> for prefill ─

export function catalogToModel(e: CatalogEntry, idOverride?: string): Partial<Model> {
  return {
    id: idOverride ?? e.patterns[0],
    name: e.name,
    reasoning: e.reasoning ?? false,
    input: e.input ?? ["text"],
    contextWindow: e.contextWindow,
    maxTokens: e.maxTokens,
    cost: e.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
}
