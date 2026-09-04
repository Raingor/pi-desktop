// Agnes image and video generation.
//
// A gateway at apihub.agnes-ai.com that speaks an OpenAI-shaped API for images
// and its own async job API for video. This is deliberately separate from the
// provider/model catalogue in models.json: generation has nothing to do with
// which chat model a pi run uses, so it carries its own credential and never
// appears as a chat provider.
//
// The credential lives in ~/.pi/agent/agnes-config.json at 0600 and is only
// ever read here, server-side. Generation requests from the renderer carry a
// prompt and parameters — never a key.
//
// Several behaviours below contradict the vendor docs and were established by
// measurement (verified against a live account in the sister project
// pi-web-switch); each one is marked where it matters.

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { fetchExternal } from "./pi-reader";

const CONFIG_PATH = join(homedir(), ".pi", "agent", "agnes-config.json");
const PI_DIR = join(homedir(), ".pi", "agent");

export const DEFAULT_BASE_URL = "https://apihub.agnes-ai.com/v1";

/** Images come back in seconds, but a cold gateway can take much longer. */
const IMAGE_TIMEOUT_MS = 360_000;
const VIDEO_CREATE_TIMEOUT_MS = 60_000;
const VIDEO_STATUS_TIMEOUT_MS = 30_000;

export interface AgnesConfig {
  apiKey: string;
  baseUrl: string;
}

export interface AgnesConfigView {
  /** Masked for display; the real key never leaves the server. */
  maskedKey: string;
  hasKey: boolean;
  baseUrl: string;
}

export interface GenerateResult {
  success: boolean;
  status?: number;
  latencyMs?: number;
  message?: string;
  /** Image URLs or data URIs, in request order. */
  images?: string[];
  videoId?: string;
  taskStatus?: string;
  progress?: number;
  videoUrl?: string;
  /**
   * The call failed but the task did not: rate limits, gateway errors and
   * timeouts all mean "ask again later". Callers keep polling on this.
   */
  retryable?: boolean;
  /** Upstream payload, kept so an unfamiliar response shape is still inspectable. */
  raw?: unknown;
}

// ─── Credential ──────────────────────────────────────────

function normalize(value: unknown): AgnesConfig {
  const record = (value ?? {}) as Record<string, unknown>;
  const apiKey = typeof record.apiKey === "string" ? record.apiKey.trim() : "";
  const baseUrl = typeof record.baseUrl === "string" ? record.baseUrl.trim() : "";
  return { apiKey, baseUrl: baseUrl || DEFAULT_BASE_URL };
}

export function readAgnesConfig(): AgnesConfig {
  try {
    if (!existsSync(CONFIG_PATH)) return { apiKey: "", baseUrl: DEFAULT_BASE_URL };
    return normalize(JSON.parse(readFileSync(CONFIG_PATH, "utf-8")));
  } catch {
    return { apiKey: "", baseUrl: DEFAULT_BASE_URL };
  }
}

export function writeAgnesConfig(config: { apiKey?: unknown; baseUrl?: unknown }): boolean {
  try {
    const next = normalize(config);
    if (!next.apiKey) return false;
    const url = new URL(next.baseUrl);
    if (!/^https?:$/.test(url.protocol)) return false;
    mkdirSync(PI_DIR, { recursive: true });
    // mode on write covers creation; chmod covers a pre-existing looser file.
    writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), { encoding: "utf-8", mode: 0o600 });
    chmodSync(CONFIG_PATH, 0o600);
    return true;
  } catch {
    return false;
  }
}

/** "sk-abcd…wxyz" — enough to recognise a key, not enough to use one. */
export function maskKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return "";
  if (trimmed.length <= 12) return `${trimmed.slice(0, 3)}…`;
  return `${trimmed.slice(0, 7)}…${trimmed.slice(-4)}`;
}

export function readAgnesConfigView(): AgnesConfigView {
  const config = readAgnesConfig();
  return {
    maskedKey: maskKey(resolveKey(config.apiKey)),
    hasKey: Boolean(resolveKey(config.apiKey)),
    baseUrl: config.baseUrl,
  };
}

/** Resolve `$ENV_VAR` style keys the same way pi does. */
function resolveKey(raw: string): string {
  const key = raw.trim();
  if (!key.startsWith("$")) return key;
  return process.env[key.slice(1)]?.trim() ?? "";
}

// ─── Shared plumbing ─────────────────────────────────────

function authHeaders(key: string): Record<string, string> {
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

/**
 * Surface the upstream message verbatim.
 *
 * Free-tier limits produce specific, actionable text ("video queue is full,
 * please retry later"), and wrapping that in a generic failure would leave the
 * user with no idea what to do.
 */
async function httpError(res: Response, started: number): Promise<GenerateResult> {
  let message = `HTTP ${res.status}`;
  let raw: unknown;
  try {
    const text = await res.text();
    raw = text;
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      raw = parsed;
      const error = parsed.error as Record<string, unknown> | string | undefined;
      const detail =
        typeof error === "string"
          ? error
          : typeof error?.message === "string"
            ? error.message
            : typeof parsed.message === "string"
              ? parsed.message
              : "";
      if (detail) message = detail;
    } catch {
      if (text.trim()) message = text.trim().slice(0, 400);
    }
  } catch {
    /* body unavailable — the status line is all we have */
  }
  return { success: false, status: res.status, latencyMs: Date.now() - started, message, raw };
}

function requestFailure(error: unknown, started: number): GenerateResult {
  const message =
    error instanceof Error
      ? error.name === "TimeoutError" || error.name === "AbortError"
        ? "request timed out"
        : error.message
      : "request failed";
  return { success: false, latencyMs: Date.now() - started, message };
}

// ─── Images ──────────────────────────────────────────────

export interface ImageOptions {
  prompt: string;
  model: string;
  size: string;
  ratio?: string;
  /** Reference images for img2img / composition: public URLs or data URIs. */
  referenceImages?: string[];
  wantBase64?: boolean;
}

export async function generateImage(options: ImageOptions): Promise<GenerateResult> {
  const config = readAgnesConfig();
  const key = resolveKey(config.apiKey);
  if (!key) return { success: false, message: "missing api key" };
  const prompt = options.prompt.trim();
  if (!prompt) return { success: false, message: "prompt is required" };

  const references = (options.referenceImages ?? []).filter((v) => v.trim());
  const extra: Record<string, unknown> = {};
  if (references.length > 0) {
    // Reference images belong in extra_body.image[]. There is no `tags` field
    // to opt into img2img — passing one is rejected.
    extra.image = references;
    // With references present, base64 output is requested through extra_body;
    // the top-level return_base64 flag only applies to text-to-image.
    if (options.wantBase64) extra.response_format = "b64_json";
  }
  if (options.ratio) extra.ratio = options.ratio;

  const body: Record<string, unknown> = {
    model: options.model,
    prompt,
    size: options.size,
    ...(options.wantBase64 && references.length === 0 ? { return_base64: true } : {}),
    ...(Object.keys(extra).length > 0 ? { extra_body: extra } : {}),
  };

  const started = Date.now();
  try {
    const res = await fetchExternal(`${config.baseUrl}/images/generations`, {
      method: "POST",
      headers: authHeaders(key),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
    });
    if (!res.ok) return await httpError(res, started);
    const payload = (await res.json()) as Record<string, unknown>;
    const items = Array.isArray(payload.data) ? payload.data : [];
    const images = items
      .map((item) => {
        const record = (item ?? {}) as Record<string, unknown>;
        if (typeof record.url === "string" && record.url) return record.url;
        if (typeof record.b64_json === "string" && record.b64_json) {
          return `data:image/png;base64,${record.b64_json}`;
        }
        return "";
      })
      .filter(Boolean);
    return {
      success: images.length > 0,
      status: res.status,
      latencyMs: Date.now() - started,
      images,
      message: images.length === 0 ? "no image in response" : undefined,
      raw: images.length === 0 ? payload : undefined,
    };
  } catch (error) {
    return requestFailure(error, started);
  }
}

// ─── Video ───────────────────────────────────────────────

export type VideoMode = "text" | "keyframe" | "reference";

export interface VideoOptions {
  prompt: string;
  model: string;
  mode: VideoMode;
  /** "4" through "12". A string upstream, not a number. */
  seconds: string;
  size?: string;
  aspectRatio?: string;
  firstFrame?: string;
  lastFrame?: string;
  images?: string[];
  audios?: string[];
}

export async function createVideoTask(options: VideoOptions): Promise<GenerateResult> {
  const config = readAgnesConfig();
  const key = resolveKey(config.apiKey);
  if (!key) return { success: false, message: "missing api key" };
  const prompt = options.prompt.trim();
  if (!prompt) return { success: false, message: "prompt is required" };

  const body: Record<string, unknown> = {
    model: options.model,
    prompt,
    mode: options.mode,
    seconds: options.seconds,
    size: options.size ?? "720P",
    aspect_ratio: options.aspectRatio ?? "16:9",
  };

  // Each mode accepts only its own media fields; sending one that belongs to
  // another mode is a 400, so the payload is built per mode rather than by
  // spreading whatever the caller passed.
  if (options.mode === "keyframe") {
    const first = options.firstFrame?.trim();
    const last = options.lastFrame?.trim();
    if (!first && !last) return { success: false, message: "keyframe mode needs a first or last frame" };
    if (first) body.first_frame = first;
    if (last) body.last_frame = last;
  } else if (options.mode === "reference") {
    const images = (options.images ?? []).filter((v) => v.trim()).slice(0, 5);
    const audios = (options.audios ?? []).filter((v) => v.trim()).slice(0, 3);
    if (images.length === 0 && audios.length === 0) {
      return { success: false, message: "reference mode needs at least one image or audio" };
    }
    if (images.length > 0) body.images = images;
    if (audios.length > 0) body.audios = audios;
  }

  const started = Date.now();
  try {
    const res = await fetchExternal(`${config.baseUrl}/videos`, {
      method: "POST",
      headers: authHeaders(key),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(VIDEO_CREATE_TIMEOUT_MS),
    });
    if (!res.ok) return await httpError(res, started);
    const payload = (await res.json()) as Record<string, unknown>;
    // The response carries `id` and `task_id` as well, but only `video_id`
    // works against the status endpoint.
    const videoId = typeof payload.video_id === "string" ? payload.video_id : "";
    if (!videoId) {
      return {
        success: false,
        status: res.status,
        latencyMs: Date.now() - started,
        message: "response contained no video_id",
        raw: payload,
      };
    }
    return {
      success: true,
      status: res.status,
      latencyMs: Date.now() - started,
      videoId,
      taskStatus: typeof payload.status === "string" ? payload.status : "queued",
      raw: payload,
    };
  } catch (error) {
    return requestFailure(error, started);
  }
}

/**
 * Depth-first search for the first plausible video URL in a task payload.
 *
 * The completed-task shape is not documented, so the field is discovered rather
 * than assumed; `raw` is returned alongside as a fallback. Insertion order means
 * shallow fields win, and in practice the URL sits at the top level.
 */
export function findVideoUrl(payload: unknown, depth = 0): string | undefined {
  if (depth > 6 || !payload || typeof payload !== "object") return undefined;
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (typeof value === "string" && /^https?:\/\//i.test(value)) {
      const normalized = key.toLowerCase().replace(/[^a-z]/g, "");
      if (normalized.includes("video") || normalized === "url" || normalized.includes("download")) {
        return value;
      }
      // Signed URLs carry a query string, hence the (\?|$).
      if (/\.(mp4|mov|webm|m4v)(\?|$)/i.test(value)) return value;
    }
    if (value && typeof value === "object") {
      const nested = findVideoUrl(value, depth + 1);
      if (nested) return nested;
    }
  }
  return undefined;
}

/**
 * One status query. Deliberately not a loop.
 *
 * A video takes minutes, and looping here would hold an HTTP connection open
 * that long with no way for the user to cancel it. The caller drives the
 * cadence and uses `retryable` to decide whether to keep waiting.
 */
export async function pollVideoTask(
  videoId: string,
  model?: string,
): Promise<GenerateResult> {
  const config = readAgnesConfig();
  const key = resolveKey(config.apiKey);
  if (!key) return { success: false, message: "missing api key" };
  const id = videoId.trim();
  if (!id) return { success: false, message: "videoId is required" };

  // The status endpoint sits at the account root, not under /v1.
  const origin = config.baseUrl.replace(/\/v\d+$/, "");
  const url = new URL(`${origin}/agnesapi`);
  url.searchParams.set("video_id", id);
  if (model?.trim()) url.searchParams.set("model_name", model.trim());

  const started = Date.now();
  try {
    const res = await fetchExternal(url, {
      headers: authHeaders(key),
      signal: AbortSignal.timeout(VIDEO_STATUS_TIMEOUT_MS),
    });
    if (!res.ok) {
      const failure = await httpError(res, started);
      // The endpoint rate-limits well below the documented 1-2s cadence, and a
      // 5xx is a gateway hiccup. Neither means the task itself failed.
      return res.status === 429 || res.status >= 500
        ? { ...failure, videoId: id, retryable: true }
        : failure;
    }
    const payload = (await res.json()) as Record<string, unknown>;
    // `internal_status` and `internal_progress` are gateway-internal and lag
    // behind: a completed task can still report internal_status "pending".
    const taskStatus = typeof payload.status === "string" ? payload.status : undefined;
    const progress = typeof payload.progress === "number" ? payload.progress : undefined;
    return {
      success: true,
      status: res.status,
      latencyMs: Date.now() - started,
      videoId: id,
      taskStatus,
      progress,
      videoUrl: findVideoUrl(payload),
      raw: payload,
    };
  } catch (error) {
    // A timeout here is transient too: the task keeps running upstream.
    return { ...requestFailure(error, started), videoId: id, retryable: true };
  }
}
