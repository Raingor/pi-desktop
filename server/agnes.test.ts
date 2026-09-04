import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// The module resolves ~/.pi/agent/agnes-config.json at import time, so HOME is
// redirected to a scratch directory before it loads.
let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "agnes-home-"));
  vi.resetModules();
  process.env.HOME = home;
  delete process.env.AGNES_TEST_KEY;
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function load() {
  return await import("./agnes");
}

function configPath(): string {
  return join(home, ".pi", "agent", "agnes-config.json");
}

describe("credential storage", () => {
  it("returns an empty config with the default base URL when nothing is saved", async () => {
    const { readAgnesConfig, DEFAULT_BASE_URL } = await load();
    expect(readAgnesConfig()).toEqual({ apiKey: "", baseUrl: DEFAULT_BASE_URL });
  });

  it("writes the file at 0600", async () => {
    const { writeAgnesConfig } = await load();
    expect(writeAgnesConfig({ apiKey: "sk-secret-value-1234" })).toBe(true);
    // A credential readable by other local accounts is the whole risk here.
    expect(statSync(configPath()).mode & 0o777).toBe(0o600);
  });

  it("tightens the mode on a pre-existing loose file", async () => {
    const { writeAgnesConfig } = await load();
    writeAgnesConfig({ apiKey: "sk-first" });
    chmodSync(configPath(), 0o644);
    writeAgnesConfig({ apiKey: "sk-second" });
    expect(statSync(configPath()).mode & 0o777).toBe(0o600);
  });

  it("round-trips key and base URL", async () => {
    const { writeAgnesConfig, readAgnesConfig } = await load();
    writeAgnesConfig({ apiKey: " sk-abc ", baseUrl: " https://example.test/v2 " });
    expect(readAgnesConfig()).toEqual({ apiKey: "sk-abc", baseUrl: "https://example.test/v2" });
  });

  it("refuses an empty key", async () => {
    const { writeAgnesConfig } = await load();
    expect(writeAgnesConfig({ apiKey: "   " })).toBe(false);
    expect(existsSync(configPath())).toBe(false);
  });

  it("refuses a non-http base URL", async () => {
    const { writeAgnesConfig } = await load();
    expect(writeAgnesConfig({ apiKey: "sk-abc", baseUrl: "file:///etc/passwd" })).toBe(false);
    expect(writeAgnesConfig({ apiKey: "sk-abc", baseUrl: "not a url" })).toBe(false);
  });

  it("survives a corrupt config file", async () => {
    const { readAgnesConfig, DEFAULT_BASE_URL } = await load();
    mkdirSync(join(home, ".pi", "agent"), { recursive: true });
    writeFileSync(configPath(), "{ not json", { encoding: "utf-8" });
    expect(readAgnesConfig()).toEqual({ apiKey: "", baseUrl: DEFAULT_BASE_URL });
  });
});

describe("maskKey", () => {
  it("keeps a recognisable head and tail", async () => {
    const { maskKey } = await load();
    expect(maskKey("sk-YCvOabcdefghijklUKpj")).toBe("sk-YCvO…UKpj");
  });

  it("does not reveal a short key", async () => {
    const { maskKey } = await load();
    expect(maskKey("sk-short")).toBe("sk-…");
  });

  it("returns empty for no key", async () => {
    const { maskKey } = await load();
    expect(maskKey("")).toBe("");
    expect(maskKey("   ")).toBe("");
  });
});

describe("readAgnesConfigView", () => {
  it("never includes the plaintext key", async () => {
    const { writeAgnesConfig, readAgnesConfigView } = await load();
    const secret = "sk-plaintext-must-not-leak-9876";
    writeAgnesConfig({ apiKey: secret });
    const view = readAgnesConfigView();
    expect(JSON.stringify(view)).not.toContain(secret);
    expect(view.hasKey).toBe(true);
    expect(view.maskedKey).toContain("…");
  });

  it("reports hasKey false when nothing is saved", async () => {
    const { readAgnesConfigView } = await load();
    expect(readAgnesConfigView()).toMatchObject({ hasKey: false, maskedKey: "" });
  });

  it("resolves $ENV_VAR keys the way pi does", async () => {
    const { writeAgnesConfig, readAgnesConfigView } = await load();
    writeAgnesConfig({ apiKey: "$AGNES_TEST_KEY" });
    expect(readAgnesConfigView().hasKey).toBe(false);
    process.env.AGNES_TEST_KEY = "sk-from-environment-abcd";
    const view = readAgnesConfigView();
    expect(view.hasKey).toBe(true);
    expect(view.maskedKey).toBe("sk-from…abcd");
  });
});

describe("findVideoUrl", () => {
  it("finds the top-level url of a real completed payload", async () => {
    const { findVideoUrl } = await load();
    expect(
      findVideoUrl({
        completed_at: 1788493841,
        error: null,
        id: "task_DbtJgxgPK9B8ARpZc8X1Y5JEjZjM5M5t",
        internal_progress: 0,
        internal_status: "pending",
        object: "video",
        progress: 100,
        seconds: "4",
        status: "completed",
        url: "https://platform-outputs.agnes-ai.space/videos/agnes-video-2.5/task_DbtJ.mp4",
      }),
    ).toBe("https://platform-outputs.agnes-ai.space/videos/agnes-video-2.5/task_DbtJ.mp4");
  });

  it("matches video_url, videoUrl and video-url alike", async () => {
    const { findVideoUrl } = await load();
    for (const key of ["video_url", "videoUrl", "video-url", "downloadLink"]) {
      expect(findVideoUrl({ [key]: "https://cdn.test/a" })).toBe("https://cdn.test/a");
    }
  });

  it("falls back to a media extension when the key says nothing", async () => {
    const { findVideoUrl } = await load();
    expect(findVideoUrl({ output: "https://cdn.test/clip.mp4" })).toBe("https://cdn.test/clip.mp4");
    expect(findVideoUrl({ output: "https://cdn.test/clip.webm?sig=abc" })).toBe(
      "https://cdn.test/clip.webm?sig=abc",
    );
  });

  it("searches nested objects and arrays", async () => {
    const { findVideoUrl } = await load();
    expect(findVideoUrl({ data: { result: [{ video: "https://cdn.test/n.mp4" }] } })).toBe(
      "https://cdn.test/n.mp4",
    );
  });

  it("ignores non-http strings and unrelated keys", async () => {
    const { findVideoUrl } = await load();
    expect(findVideoUrl({ id: "task_123", status: "completed", thumb: "/local/path.png" })).toBeUndefined();
  });

  it("gives up rather than recursing forever", async () => {
    const { findVideoUrl } = await load();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(findVideoUrl(cyclic)).toBeUndefined();
  });
});

// ─── Network-facing behaviour ────────────────────────────
//
// fetchExternal is stubbed at the module boundary so these cover the request
// shapes and the retry classification without touching the network.

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  vi.doMock("./pi-reader", () => ({
    fetchExternal: (url: string | URL, init?: RequestInit) => handler(String(url), init),
  }));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("generateImage", () => {
  it("refuses to call out without a key", async () => {
    stubFetch(() => {
      throw new Error("should not be called");
    });
    const { generateImage } = await load();
    const result = await generateImage({ prompt: "a cat", model: "agnes-image-2.5-flash", size: "1K" });
    expect(result).toMatchObject({ success: false, message: "missing api key" });
  });

  it("puts response_format inside extra_body, never at the top level", async () => {
    let sent: Record<string, unknown> = {};
    stubFetch((_url, init) => {
      sent = JSON.parse(String(init?.body));
      return jsonResponse({ data: [{ b64_json: "AAAA" }] });
    });
    const { writeAgnesConfig, generateImage } = await load();
    writeAgnesConfig({ apiKey: "sk-test-key-abcdefgh" });
    await generateImage({
      prompt: "a cat",
      model: "agnes-image-2.5-flash",
      size: "2K",
      referenceImages: ["https://cdn.test/ref.png"],
      wantBase64: true,
    });
    // Top-level response_format is rejected upstream.
    expect(sent).not.toHaveProperty("response_format");
    expect(sent.extra_body).toMatchObject({
      response_format: "b64_json",
      image: ["https://cdn.test/ref.png"],
    });
    // There is no tags field to opt into img2img.
    expect(sent.extra_body).not.toHaveProperty("tags");
  });

  it("uses top-level return_base64 for text-to-image", async () => {
    let sent: Record<string, unknown> = {};
    stubFetch((_url, init) => {
      sent = JSON.parse(String(init?.body));
      return jsonResponse({ data: [{ b64_json: "AAAA" }] });
    });
    const { writeAgnesConfig, generateImage } = await load();
    writeAgnesConfig({ apiKey: "sk-test-key-abcdefgh" });
    await generateImage({ prompt: "a cat", model: "m", size: "1K", wantBase64: true });
    expect(sent.return_base64).toBe(true);
    expect(sent).not.toHaveProperty("extra_body");
  });

  it("turns b64_json into a data URI", async () => {
    stubFetch(() => jsonResponse({ data: [{ b64_json: "QUJD" }] }));
    const { writeAgnesConfig, generateImage } = await load();
    writeAgnesConfig({ apiKey: "sk-test-key-abcdefgh" });
    const result = await generateImage({ prompt: "a cat", model: "m", size: "1K" });
    expect(result.images).toEqual(["data:image/png;base64,QUJD"]);
  });

  it("passes through the upstream error message", async () => {
    stubFetch(() =>
      jsonResponse({ error: { message: "You've reached the API rate limit for free users" } }, 429),
    );
    const { writeAgnesConfig, generateImage } = await load();
    writeAgnesConfig({ apiKey: "sk-test-key-abcdefgh" });
    const result = await generateImage({ prompt: "a cat", model: "m", size: "1K" });
    expect(result).toMatchObject({
      success: false,
      status: 429,
      message: "You've reached the API rate limit for free users",
    });
  });

  it("rejects an empty prompt before making a request", async () => {
    stubFetch(() => {
      throw new Error("should not be called");
    });
    const { writeAgnesConfig, generateImage } = await load();
    writeAgnesConfig({ apiKey: "sk-test-key-abcdefgh" });
    expect(await generateImage({ prompt: "  ", model: "m", size: "1K" })).toMatchObject({
      success: false,
      message: "prompt is required",
    });
  });
});

describe("createVideoTask", () => {
  it("reads video_id, not id or task_id", async () => {
    stubFetch(() =>
      jsonResponse({ id: "task_AAA", task_id: "task_AAA", video_id: "vid_BBB", status: "queued" }),
    );
    const { writeAgnesConfig, createVideoTask } = await load();
    writeAgnesConfig({ apiKey: "sk-test-key-abcdefgh" });
    const result = await createVideoTask({ prompt: "a cat", model: "m", mode: "text", seconds: "4" });
    expect(result).toMatchObject({ success: true, videoId: "vid_BBB", taskStatus: "queued" });
  });

  it("fails clearly when video_id is absent", async () => {
    stubFetch(() => jsonResponse({ id: "task_AAA" }));
    const { writeAgnesConfig, createVideoTask } = await load();
    writeAgnesConfig({ apiKey: "sk-test-key-abcdefgh" });
    expect(
      await createVideoTask({ prompt: "a cat", model: "m", mode: "text", seconds: "4" }),
    ).toMatchObject({ success: false, message: "response contained no video_id" });
  });

  it("sends seconds as a string and defaults size to 720P", async () => {
    let sent: Record<string, unknown> = {};
    stubFetch((_url, init) => {
      sent = JSON.parse(String(init?.body));
      return jsonResponse({ video_id: "vid" });
    });
    const { writeAgnesConfig, createVideoTask } = await load();
    writeAgnesConfig({ apiKey: "sk-test-key-abcdefgh" });
    await createVideoTask({ prompt: "a cat", model: "m", mode: "text", seconds: "8" });
    expect(sent.seconds).toBe("8");
    expect(sent.size).toBe("720P");
    expect(sent.aspect_ratio).toBe("16:9");
  });

  it("sends no media fields in text mode", async () => {
    let sent: Record<string, unknown> = {};
    stubFetch((_url, init) => {
      sent = JSON.parse(String(init?.body));
      return jsonResponse({ video_id: "vid" });
    });
    const { writeAgnesConfig, createVideoTask } = await load();
    writeAgnesConfig({ apiKey: "sk-test-key-abcdefgh" });
    // A field belonging to another mode is a 400 upstream, so callers passing
    // leftovers must not have them forwarded.
    await createVideoTask({
      prompt: "a cat",
      model: "m",
      mode: "text",
      seconds: "4",
      firstFrame: "https://cdn.test/a.png",
      images: ["https://cdn.test/b.png"],
    });
    expect(sent).not.toHaveProperty("first_frame");
    expect(sent).not.toHaveProperty("images");
  });

  it("requires a frame in keyframe mode and forwards only frames", async () => {
    let sent: Record<string, unknown> = {};
    stubFetch((_url, init) => {
      sent = JSON.parse(String(init?.body));
      return jsonResponse({ video_id: "vid" });
    });
    const { writeAgnesConfig, createVideoTask } = await load();
    writeAgnesConfig({ apiKey: "sk-test-key-abcdefgh" });
    expect(
      await createVideoTask({ prompt: "p", model: "m", mode: "keyframe", seconds: "4" }),
    ).toMatchObject({ success: false });
    await createVideoTask({
      prompt: "p",
      model: "m",
      mode: "keyframe",
      seconds: "4",
      firstFrame: "https://cdn.test/a.png",
      images: ["https://cdn.test/ignored.png"],
    });
    expect(sent.first_frame).toBe("https://cdn.test/a.png");
    expect(sent).not.toHaveProperty("images");
  });

  it("requires media in reference mode and caps images at 5, audios at 3", async () => {
    let sent: Record<string, unknown> = {};
    stubFetch((_url, init) => {
      sent = JSON.parse(String(init?.body));
      return jsonResponse({ video_id: "vid" });
    });
    const { writeAgnesConfig, createVideoTask } = await load();
    writeAgnesConfig({ apiKey: "sk-test-key-abcdefgh" });
    expect(
      await createVideoTask({ prompt: "p", model: "m", mode: "reference", seconds: "4" }),
    ).toMatchObject({ success: false });
    await createVideoTask({
      prompt: "p",
      model: "m",
      mode: "reference",
      seconds: "4",
      images: Array.from({ length: 7 }, (_, i) => `https://cdn.test/${i}.png`),
      audios: Array.from({ length: 5 }, (_, i) => `https://cdn.test/${i}.mp3`),
    });
    expect((sent.images as string[]).length).toBe(5);
    expect((sent.audios as string[]).length).toBe(3);
  });
});

describe("pollVideoTask", () => {
  it("queries the account root, not /v1", async () => {
    let seen = "";
    stubFetch((url) => {
      seen = url;
      return jsonResponse({ status: "in_progress", progress: 40 });
    });
    const { writeAgnesConfig, pollVideoTask } = await load();
    writeAgnesConfig({ apiKey: "sk-test-key-abcdefgh", baseUrl: "https://apihub.agnes-ai.com/v1" });
    await pollVideoTask("vid_1", "agnes-video-2.5-flash");
    expect(seen).toContain("https://apihub.agnes-ai.com/agnesapi?");
    expect(seen).not.toContain("/v1/agnesapi");
    expect(seen).toContain("video_id=vid_1");
    expect(seen).toContain("model_name=agnes-video-2.5-flash");
  });

  it("reads status and progress, ignoring the internal_ fields", async () => {
    stubFetch(() =>
      jsonResponse({
        status: "completed",
        progress: 100,
        internal_status: "pending",
        internal_progress: 0,
        url: "https://cdn.test/out.mp4",
      }),
    );
    const { writeAgnesConfig, pollVideoTask } = await load();
    writeAgnesConfig({ apiKey: "sk-test-key-abcdefgh" });
    const result = await pollVideoTask("vid_1");
    expect(result).toMatchObject({
      success: true,
      taskStatus: "completed",
      progress: 100,
      videoUrl: "https://cdn.test/out.mp4",
    });
  });

  it("marks 429 retryable — the documented cadence trips it routinely", async () => {
    stubFetch(() => jsonResponse({ error: "video status query rate limit exceeded" }, 429));
    const { writeAgnesConfig, pollVideoTask } = await load();
    writeAgnesConfig({ apiKey: "sk-test-key-abcdefgh" });
    const result = await pollVideoTask("vid_1");
    expect(result).toMatchObject({ success: false, status: 429, retryable: true, videoId: "vid_1" });
    expect(result.message).toContain("rate limit");
  });

  it("marks 5xx retryable", async () => {
    stubFetch(() => jsonResponse({ error: "bad gateway" }, 502));
    const { writeAgnesConfig, pollVideoTask } = await load();
    writeAgnesConfig({ apiKey: "sk-test-key-abcdefgh" });
    expect(await pollVideoTask("vid_1")).toMatchObject({ retryable: true });
  });

  it("does not mark 404 or 401 retryable", async () => {
    for (const status of [401, 404]) {
      vi.resetModules();
      stubFetch(() => jsonResponse({ error: "nope" }, status));
      const { writeAgnesConfig, pollVideoTask } = await load();
      writeAgnesConfig({ apiKey: "sk-test-key-abcdefgh" });
      const result = await pollVideoTask("vid_1");
      expect(result.retryable).toBeUndefined();
    }
  });

  it("marks a network failure retryable — the task keeps running upstream", async () => {
    stubFetch(() => {
      throw new Error("socket hang up");
    });
    const { writeAgnesConfig, pollVideoTask } = await load();
    writeAgnesConfig({ apiKey: "sk-test-key-abcdefgh" });
    expect(await pollVideoTask("vid_1")).toMatchObject({ retryable: true, videoId: "vid_1" });
  });

  it("requires a videoId", async () => {
    stubFetch(() => {
      throw new Error("should not be called");
    });
    const { writeAgnesConfig, pollVideoTask } = await load();
    writeAgnesConfig({ apiKey: "sk-test-key-abcdefgh" });
    expect(await pollVideoTask("  ")).toMatchObject({ success: false, message: "videoId is required" });
  });
});
