// Renderer for the menu-bar popup window.
// Talks to the Electron main process via the `window.piAPI` bridge exposed
// by preload.ts. Renders a compact usage summary (today + last 7 days).
//
// This file is loaded as a Vite entry (see vite.electron.config.ts) and
// bundled into dist/electron/popup-render.js.

// ─── Types (mirrors main.ts IPC return) ───────────────────

interface SummaryData {
  today: {
    tokens: number;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost: number;
    requests: number;
  };
  sevenDays: {
    tokens: number;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost: number;
    requests: number;
  };
  daily: { date: string; tokens: number; cost: number; requests: number }[];
  providers: { providerId: string; cost: number; tokens: number; requests: number }[];
  updatedAt: string;
  error?: string;
}

interface CodexWindow {
  windowSeconds: number;
  usedPercent: number;
  remainingPercent: number;
  resetAfterSeconds: number | null;
  resetAt: number | null;
}

interface CodexUsageStatus {
  loggedIn: boolean;
  provider: "openai-codex";
  planType?: string;
  primary?: CodexWindow;
  secondary?: CodexWindow;
  checkedAt: string;
  error?: string;
}

// ─── Helpers ──────────────────────────────────────────────

function formatTokens(n: number): string {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(2)}亿`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}万`;
  return n.toLocaleString();
}

function formatCost(n: number): string {
  if (n === 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function shortDate(iso: string): string {
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  return `${parts[1]}/${parts[2]}`;
}

// Codex reports window length in seconds (18000 = 5h, 604800 = 7d).
function windowLabel(seconds: number): string {
  if (seconds >= 86_400) {
    const days = Math.round(seconds / 86_400);
    return days === 7 ? "每周" : `${days} 天`;
  }
  const hours = Math.round(seconds / 3600);
  return `${hours} 小时`;
}

function remainingTime(seconds: number | null): string | null {
  if (typeof seconds !== "number" || seconds < 0) return null;
  if (seconds >= 86_400) {
    const days = Math.floor(seconds / 86_400);
    const hours = Math.floor((seconds % 86_400) / 3600);
    return hours > 0 ? `${days}天${hours}小时后重置` : `${days}天后重置`;
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}小时${minutes}分后重置` : `${minutes}分钟后重置`;
}

// Green under 60% used, amber to 85%, red above.
function quotaTone(usedPercent: number): string {
  if (usedPercent >= 85) return "danger";
  if (usedPercent >= 60) return "warn";
  return "ok";
}

function providerDisplay(id: string): string {
  const map: Record<string, string> = {
    anthropic: "Anthropic",
    openai: "OpenAI",
    deepseek: "DeepSeek",
    google: "Google",
    gemini: "Gemini",
    openrouter: "OpenRouter",
    mistral: "Mistral",
    groq: "Groq",
    copilot: "Copilot",
    opencode: "OpenCode",
    "cindy-pi": "Cindy Pi",
    claude: "Claude",
    codex: "Codex",
    atomcode: "AtomCode",
  };
  if (map[id]) return map[id];
  return id.charAt(0).toUpperCase() + id.slice(1);
}

// ─── Rendering ────────────────────────────────────────────

// Codex quota block: only rendered when an openai-codex OAuth session exists
// locally. Shows the two official windows (5h + weekly) with a used-percent bar.
function renderCodexQuota(codex: CodexUsageStatus | null): string {
  if (!codex || !codex.loggedIn) return "";

  const plan = codex.planType ? codex.planType.toUpperCase() : "";
  const header = `
    <div class="section-title quota-head">
      <span>Codex 官方额度${plan ? ` · ${plan}` : ""}</span>
      <span class="quota-live">已登录</span>
    </div>`;

  if (codex.error || (!codex.primary && !codex.secondary)) {
    return `<div class="section">${header}<div class="stat-sub">额度暂不可用</div></div>`;
  }

  const row = (win: CodexWindow | undefined, fallbackLabel: string) => {
    if (!win) return `<div class="quota-row"><div class="quota-top"><span>${fallbackLabel}</span><span class="quota-sub">无数据</span></div></div>`;
    const tone = quotaTone(win.usedPercent);
    const reset = remainingTime(win.resetAfterSeconds);
    return `
      <div class="quota-row">
        <div class="quota-top">
          <span class="quota-label">${windowLabel(win.windowSeconds)}</span>
          <span class="quota-pct ${tone}">剩余 ${win.remainingPercent}%</span>
        </div>
        <div class="quota-track"><div class="quota-fill ${tone}" style="width:${Math.min(100, Math.max(0, win.usedPercent))}%"></div></div>
        <div class="quota-sub">已用 ${win.usedPercent}%${reset ? ` · ${reset}` : ""}</div>
      </div>`;
  };

  return `
    <div class="section">
      ${header}
      ${row(codex.primary, "5 小时")}
      ${row(codex.secondary, "每周")}
    </div>`;
}

function render(data: SummaryData, codex: CodexUsageStatus | null): string {
  const t = data.today;
  const s = data.sevenDays;

  // Sparkline (last 7 days tokens)
  const maxTokens = Math.max(1, ...data.daily.map((d) => d.tokens));
  const sparkBars = data.daily
    .map((d) => {
      const h = (d.tokens / maxTokens) * 100;
      return `<div class="spark-bar" style="height:${Math.max(h, 2)}%;" title="${shortDate(d.date)}: ${formatTokens(d.tokens)} tokens"></div>`;
    })
    .join("");
  const sparkLabels = data.daily
    .map((d) => `<span>${shortDate(d.date)}</span>`)
    .join("");

  // Top providers
  const providerItems = data.providers.length
    ? data.providers
        .map(
          (p) => `
        <li class="provider-item">
          <span class="provider-name">${providerDisplay(p.providerId)}</span>
          <span class="provider-cost">${formatCost(p.cost)} · ${formatTokens(p.tokens)}</span>
        </li>`
        )
        .join("")
    : `<li class="provider-item" style="color:var(--muted)">无数据</li>`;

  return `
    <div class="container">
      <div class="header">
        <div class="title">
          <span class="logo">π</span>
          pi-desktop
        </div>
        <button class="refresh-btn" id="refresh-btn">刷新</button>
      </div>

      ${renderCodexQuota(codex)}

      <div class="section">
        <div class="section-title">今日</div>
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">Tokens</div>
            <div class="stat-value tokens">${formatTokens(t.tokens)}</div>
            <div class="stat-sub">${t.requests} 次请求</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">成本</div>
            <div class="stat-value cost">${formatCost(t.cost)}</div>
            <div class="stat-sub">今日累计</div>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">最近 7 天</div>
        <div class="sparkline">${sparkBars}</div>
        <div class="spark-labels">${sparkLabels}</div>
        <div class="stat-sub" style="margin-top:4px;">
          共 ${formatTokens(s.tokens)} tokens · ${formatCost(s.cost)} · ${s.requests} 次请求
        </div>
      </div>

      <div class="section" style="flex:1; overflow:hidden; display:flex; flex-direction:column;">
        <div class="section-title">Top 提供商 (7天)</div>
        <ul class="provider-list" style="overflow-y:auto; flex:1;">${providerItems}</ul>
      </div>

      <div class="footer">
        <span class="updated-time">更新于 ${new Date(data.updatedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</span>
        <button id="open-dashboard-btn">打开 Dashboard</button>
      </div>
    </div>
  `;
}

function renderError(msg: string): string {
  return `<div class="error">⚠️ ${msg}</div>`;
}

function renderLoading(): string {
  return `<div class="loading">加载使用量数据…</div>`;
}

// ─── Main ─────────────────────────────────────────────────

// loadSummary(force) — force=true bypasses the main-process summary cache
// so the refresh button actually picks up new data.
async function loadSummary(force = false) {
  const root = document.getElementById("root");
  if (!root) return;
  root.innerHTML = renderLoading();

  try {
    const piAPI = (window as any).piAPI;
    if (!piAPI?.getUsageSummary) {
      root.innerHTML = renderError("piAPI bridge 不可用");
      return;
    }
    // Both reads are independent; a Codex quota failure must not hide local usage.
    const [data, codex] = await Promise.all([
      piAPI.getUsageSummary(force ? { force: true } : undefined) as Promise<SummaryData>,
      (piAPI.getCodexUsage?.(force ? { force: true } : undefined) ?? Promise.resolve(null)).catch(() => null) as Promise<CodexUsageStatus | null>,
    ]);
    if (data.error) {
      root.innerHTML = renderError(data.error);
    } else {
      root.innerHTML = render(data, codex);
    }

    // Wire up buttons
    const refreshBtn = document.getElementById("refresh-btn");
    refreshBtn?.addEventListener("click", () => loadSummary(true));

    const openBtn = document.getElementById("open-dashboard-btn");
    openBtn?.addEventListener("click", () => {
      piAPI.openDashboard?.();
    });
  } catch (err) {
    root.innerHTML = renderError(String(err));
  }
}

// Auto-refresh every 30 seconds while popup is visible
function startAutoRefresh() {
  setInterval(() => {
    if (document.visibilityState === "visible") {
      loadSummary();
    }
  }, 30_000);
}

document.addEventListener("DOMContentLoaded", () => {
  loadSummary();
  startAutoRefresh();
});
