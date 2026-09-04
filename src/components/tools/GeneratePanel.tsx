// Generation panel — Agnes images and video.
//
// Sits alongside the other tools rather than in settings: this produces
// artefacts for the work at hand, like the file browser or terminal do. The API
// key is entered once at the top and stored server-side; every generate call
// goes through the local API, so the key never reaches this code.
//
// Video is an async job. The server does one status query per request and tells
// us whether a failure is worth retrying; the cadence below is ours to pick.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Clapperboard,
  Download,
  ImageIcon,
  KeyRound,
  Loader2,
  Save,
  Sparkles,
} from "lucide-react";

interface GenerateResult {
  success: boolean;
  status?: number;
  latencyMs?: number;
  message?: string;
  images?: string[];
  videoId?: string;
  taskStatus?: string;
  progress?: number;
  videoUrl?: string;
  retryable?: boolean;
}

interface ConfigView {
  maskedKey: string;
  hasKey: boolean;
  baseUrl: string;
}

const IMAGE_MODELS = ["agnes-image-2.5-flash", "agnes-image-2.1-flash"] as const;
const VIDEO_MODELS = ["agnes-video-2.5-flash"] as const;
const SIZES = ["1K", "2K", "3K", "4K"] as const;
const RATIOS = ["1:1", "3:4", "4:3", "16:9", "9:16", "2:3", "3:2", "21:9"] as const;
const SECONDS = ["4", "6", "8", "10", "12"] as const;

/**
 * The status endpoint rate-limits well below its documented 1-2s cadence — 3s
 * already returns 429. Eight seconds never tripped it in testing.
 */
const POLL_INTERVAL_MS = 8000;
const DONE_STATES = /^(completed|succeeded|success)$/i;
const FAILED_STATES = /^(failed|error|cancelled|canceled)$/i;

const STATUS_LABEL: Record<string, string> = {
  queued: "排队中",
  pending: "等待中",
  in_progress: "生成中",
  processing: "生成中",
  completed: "已完成",
  succeeded: "已完成",
  failed: "失败",
  error: "失败",
  cancelled: "已取消",
  canceled: "已取消",
};

/** Server messages stay English so tests can assert on them; localize here. */
function errorText(message?: string): string {
  if (!message) return "生成失败";
  if (message === "missing api key") return "请先保存 API Key";
  if (message === "prompt is required") return "请填写提示词";
  if (message === "videoId is required") return "缺少任务 ID";
  if (message === "request timed out") return "请求超时";
  if (message === "response contained no video_id") return "接口未返回任务 ID";
  if (message === "no image in response") return "接口未返回图片";
  if (message.includes("keyframe mode needs")) return "首帧模式需要提供首帧或尾帧";
  if (message.includes("reference mode needs")) return "参考模式需要至少一张图片或一段音频";
  return message;
}

export function GeneratePanel() {
  const [config, setConfig] = useState<ConfigView | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [keyError, setKeyError] = useState("");
  const [tab, setTab] = useState<"image" | "video">("image");

  const loadConfig = useCallback(() => {
    fetch("/api/pi/agnes-config")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: ConfigView | null) => setConfig(data))
      .catch(() => setConfig(null));
  }, []);

  useEffect(loadConfig, [loadConfig]);

  const saveKey = async () => {
    const apiKey = keyInput.trim();
    if (!apiKey) return;
    setSavingKey(true);
    setKeyError("");
    try {
      const res = await fetch("/api/pi/agnes-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      const data = (await res.json()) as { success?: boolean; error?: string } & ConfigView;
      if (data.success) {
        setConfig({ maskedKey: data.maskedKey, hasKey: data.hasKey, baseUrl: data.baseUrl });
        setKeyInput("");
      } else {
        setKeyError(data.error ?? "保存失败");
      }
    } catch {
      setKeyError("保存失败");
    } finally {
      setSavingKey(false);
    }
  };

  // ── Image ──────────────────────────────────────────────
  const [imagePrompt, setImagePrompt] = useState("");
  const [imageModel, setImageModel] = useState<string>(IMAGE_MODELS[0]);
  const [size, setSize] = useState<string>(SIZES[0]);
  const [ratio, setRatio] = useState<string>(RATIOS[0]);
  const [references, setReferences] = useState("");
  const [imageBusy, setImageBusy] = useState(false);
  const [imageResult, setImageResult] = useState<GenerateResult | null>(null);

  const generateImage = async () => {
    setImageBusy(true);
    setImageResult(null);
    try {
      const res = await fetch("/api/pi/image-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: imagePrompt,
          model: imageModel,
          size,
          ratio,
          referenceImages: references
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean),
        }),
      });
      setImageResult((await res.json()) as GenerateResult);
    } catch {
      setImageResult({ success: false, message: "请求失败" });
    } finally {
      setImageBusy(false);
    }
  };

  // ── Video ──────────────────────────────────────────────
  const [videoPrompt, setVideoPrompt] = useState("");
  // One video model exists, so there is nothing to pick.
  const videoModel: string = VIDEO_MODELS[0];
  const [mode, setMode] = useState<"text" | "keyframe" | "reference">("text");
  const [seconds, setSeconds] = useState<string>(SECONDS[0]);
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [firstFrame, setFirstFrame] = useState("");
  const [lastFrame, setLastFrame] = useState("");
  const [videoRefs, setVideoRefs] = useState("");
  const [videoBusy, setVideoBusy] = useState(false);
  const [videoResult, setVideoResult] = useState<GenerateResult | null>(null);
  /** Set while a poll loop is live; flipping `cancelled` ends it. */
  const pollToken = useRef<{ cancelled: boolean } | null>(null);

  const stopPolling = useCallback(() => {
    if (pollToken.current) pollToken.current.cancelled = true;
    pollToken.current = null;
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  /**
   * Wait for the task, one query at a time.
   *
   * A serial loop rather than a repeating timer: each query has a 30s server
   * timeout, so a fixed interval shorter than that could stack requests and
   * trip the very rate limit the interval exists to avoid.
   */
  const watchVideo = useCallback(
    async (videoId: string, model: string) => {
      stopPolling();
      const token = { cancelled: false };
      pollToken.current = token;
      const params = new URLSearchParams({ videoId, model });

      while (!token.cancelled) {
        await new Promise((resolve) => window.setTimeout(resolve, POLL_INTERVAL_MS));
        if (token.cancelled) return;

        let next: GenerateResult;
        try {
          const res = await fetch(`/api/pi/video-status?${params}`);
          next = (await res.json()) as GenerateResult;
        } catch {
          // Network blip: the task is still running upstream, so keep waiting.
          continue;
        }
        if (token.cancelled) return;

        if (!next.success && next.retryable) {
          // Rate limits are routine on this endpoint, not errors. Keep the
          // progress on screen instead of flashing a failure at the user.
          setVideoResult((prev) => ({ ...(prev ?? {}), ...next, success: true, message: undefined }));
          continue;
        }

        setVideoResult(next);
        const finished =
          // A completed payload carries the URL, and trusting it first avoids
          // polling forever on an unfamiliar status word.
          !!next.videoUrl ||
          !next.success ||
          FAILED_STATES.test(next.taskStatus ?? "") ||
          DONE_STATES.test(next.taskStatus ?? "");
        if (finished) {
          setVideoBusy(false);
          pollToken.current = null;
          return;
        }
      }
    },
    [stopPolling],
  );

  const createVideo = async () => {
    stopPolling();
    setVideoBusy(true);
    setVideoResult(null);
    const refs = videoRefs
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    try {
      const res = await fetch("/api/pi/video-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: videoPrompt,
          model: videoModel,
          mode,
          seconds,
          aspectRatio,
          ...(mode === "keyframe" ? { firstFrame, lastFrame } : {}),
          ...(mode === "reference" ? { images: refs } : {}),
        }),
      });
      const created = (await res.json()) as GenerateResult;
      setVideoResult(created);
      if (created.success && created.videoId) void watchVideo(created.videoId, videoModel);
      else setVideoBusy(false);
    } catch {
      setVideoResult({ success: false, message: "请求失败" });
      setVideoBusy(false);
    }
  };

  const locked = !config?.hasKey;

  return (
    <div className="tool-panel-body">
      <div className="tool-panel-bar">
        <span className="tool-panel-bar-title">生图 / 生视频</span>
        <span className="tool-panel-bar-meta">{config?.hasKey ? "已配置" : "未配置"}</span>
      </div>

      <div className="gen-scroll">
        <section className="gen-card">
          <p className="gen-card-title">
            <KeyRound className="h-3.5 w-3.5" />
            Agnes API Key
          </p>
          {config?.hasKey && (
            <p className="gen-hint">
              当前：<code>{config.maskedKey}</code>
            </p>
          )}
          <div className="gen-row">
            <input
              type="password"
              value={keyInput}
              onChange={(event) => setKeyInput(event.target.value)}
              placeholder={config?.hasKey ? "输入新 Key 可替换" : "sk-…"}
              autoComplete="off"
            />
            <button
              type="button"
              className="gen-btn"
              onClick={saveKey}
              disabled={savingKey || !keyInput.trim()}
            >
              {savingKey ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              保存
            </button>
          </div>
          {keyError && <p className="gen-error">{keyError}</p>}
          <p className="gen-hint">
            Key 只保存在本机 <code>~/.pi/agent/agnes-config.json</code>（权限 600），生成请求由本地服务端代发。
          </p>
        </section>

        <nav className="gen-tabs">
          <button className={tab === "image" ? "is-active" : ""} onClick={() => setTab("image")}>
            <ImageIcon className="h-3.5 w-3.5" />
            图片
          </button>
          <button className={tab === "video" ? "is-active" : ""} onClick={() => setTab("video")}>
            <Clapperboard className="h-3.5 w-3.5" />
            视频
          </button>
        </nav>

        {tab === "image" ? (
          <section className="gen-card">
            <textarea
              value={imagePrompt}
              onChange={(event) => setImagePrompt(event.target.value)}
              placeholder="描述你想要的画面"
              rows={3}
            />
            <div className="gen-row">
              <label className="gen-field">
                <span>模型</span>
                <select value={imageModel} onChange={(e) => setImageModel(e.target.value)}>
                  {IMAGE_MODELS.map((m) => (
                    <option key={m} value={m}>
                      {m.replace("agnes-image-", "")}
                    </option>
                  ))}
                </select>
              </label>
              <label className="gen-field">
                <span>尺寸</span>
                <select value={size} onChange={(e) => setSize(e.target.value)}>
                  {SIZES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="gen-field">
                <span>比例</span>
                <select value={ratio} onChange={(e) => setRatio(e.target.value)}>
                  {RATIOS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="gen-field is-block">
              <span>参考图（每行一个 URL，可留空）</span>
              <textarea
                value={references}
                onChange={(event) => setReferences(event.target.value)}
                placeholder="https://…"
                rows={2}
              />
            </label>
            <button
              type="button"
              className="gen-btn is-primary"
              onClick={generateImage}
              disabled={locked || imageBusy || !imagePrompt.trim()}
              title={locked ? "请先保存 API Key" : undefined}
            >
              {imageBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {imageBusy ? "生成中…" : "生成图片"}
            </button>

            {imageResult && !imageResult.success && (
              <p className="gen-error">{errorText(imageResult.message)}</p>
            )}
            {imageResult?.images?.map((src, index) => (
              <figure key={index} className="gen-figure">
                <img src={src} alt={`生成结果 ${index + 1}`} />
                <a href={src} download={`agnes-image-${index + 1}.png`}>
                  <Download className="h-3 w-3" />
                  下载
                </a>
              </figure>
            ))}
            {imageResult?.success && imageResult.latencyMs && (
              <p className="gen-hint">耗时 {(imageResult.latencyMs / 1000).toFixed(1)}s</p>
            )}
          </section>
        ) : (
          <section className="gen-card">
            <textarea
              value={videoPrompt}
              onChange={(event) => setVideoPrompt(event.target.value)}
              placeholder="描述这段视频"
              rows={3}
            />
            <div className="gen-row">
              <label className="gen-field">
                <span>模式</span>
                <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
                  <option value="text">文生视频</option>
                  <option value="keyframe">首尾帧</option>
                  <option value="reference">参考素材</option>
                </select>
              </label>
              <label className="gen-field">
                <span>时长</span>
                <select value={seconds} onChange={(e) => setSeconds(e.target.value)}>
                  {SECONDS.map((s) => (
                    <option key={s} value={s}>
                      {s}s
                    </option>
                  ))}
                </select>
              </label>
              <label className="gen-field">
                <span>比例</span>
                <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)}>
                  {RATIOS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {mode === "keyframe" && (
              <>
                <label className="gen-field is-block">
                  <span>首帧 URL</span>
                  <input value={firstFrame} onChange={(e) => setFirstFrame(e.target.value)} placeholder="https://…" />
                </label>
                <label className="gen-field is-block">
                  <span>尾帧 URL</span>
                  <input value={lastFrame} onChange={(e) => setLastFrame(e.target.value)} placeholder="https://…" />
                </label>
              </>
            )}
            {mode === "reference" && (
              <label className="gen-field is-block">
                <span>参考图（每行一个，最多 5 个）</span>
                <textarea
                  value={videoRefs}
                  onChange={(event) => setVideoRefs(event.target.value)}
                  placeholder="https://…"
                  rows={3}
                />
              </label>
            )}

            <button
              type="button"
              className="gen-btn is-primary"
              onClick={createVideo}
              disabled={locked || videoBusy || !videoPrompt.trim()}
              title={locked ? "请先保存 API Key" : undefined}
            >
              {videoBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {videoBusy ? "生成中…" : "生成视频"}
            </button>
            <p className="gen-hint">视频通常需要 3–5 分钟，期间可以切到其他面板。</p>

            {videoResult && !videoResult.success && (
              <p className="gen-error">{errorText(videoResult.message)}</p>
            )}
            {videoResult?.success && !videoResult.videoUrl && (
              <div className="gen-progress">
                <p>
                  {STATUS_LABEL[videoResult.taskStatus ?? ""] ?? videoResult.taskStatus ?? "已提交"}
                  {typeof videoResult.progress === "number" ? ` · ${videoResult.progress}%` : ""}
                </p>
                <div className="gen-progress-track">
                  <span style={{ width: `${Math.max(3, videoResult.progress ?? 3)}%` }} />
                </div>
              </div>
            )}
            {videoResult?.videoUrl && (
              <figure className="gen-figure">
                <video src={videoResult.videoUrl} controls preload="metadata" />
                <a href={videoResult.videoUrl} download>
                  <Download className="h-3 w-3" />
                  下载
                </a>
              </figure>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
