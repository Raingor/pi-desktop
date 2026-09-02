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

function render(data: SummaryData): string {
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
    const data: SummaryData = await piAPI.getUsageSummary(force ? { force: true } : undefined);
    if (data.error) {
      root.innerHTML = renderError(data.error);
    } else {
      root.innerHTML = render(data);
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
