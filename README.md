<p align="center">
  <img src="public/pi.svg" width="80" height="80" alt="pi-switch logo" />
</p>

<h1 align="center">pi-web-switch</h1>

<p align="center">
  <strong>Web UI for pi coding agent — live configuration management, session browser, and memory viewer</strong>
</p>

<p align="center">
  <a href="README.md">🇬🇧 English</a> ·
  <a href="README.zh-CN.md">🇨🇳 中文</a> ·
  <a href="README.ja.md">🇯🇵 日本語</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Tailwind-4-06B6D4?logo=tailwindcss" alt="Tailwind v4" />
  <img src="https://img.shields.io/badge/Vite-6-646CFF?logo=vite" alt="Vite 6" />
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License" />
</p>

<p align="center">
  Inspired by <a href="https://github.com/farion1231/cc-switch">cc-switch</a> — a visual dashboard for managing your <a href="https://pi.dev">pi coding agent</a> providers, models, token usage, sessions, and settings.
</p>

<p align="center">
  <strong>Reads data directly from <code>~/.pi/agent/</code></strong> — no mock data, no database, no backend setup required.
</p>

---

## ✨ Features

### 📊 Dashboard
- **Usage Statistics** — Today / 7 days / 30 days / Custom date range selector with auto-refresh (5s/10s/30s/60s)
- **Token Breakdown** — Exact token count with approximate display (e.g. `1,631,022 ≈ 1.6M`) and Input/Output/Cache Hit/Cache Create breakdown
- **Cost Tracking** — Daily cost chart + Provider/Model stats tabs with aggregated data
- **Cache Hit Rate** — Visual progress bar showing cache efficiency
- **Request Log** — Detailed log table with time, provider, model, tokens, cost
- **Currency Switch** — Toggle between USD and CNY with real-time conversion (1 USD = 7.2 CNY)
- **Hourly/Daily Granularity** — Today view shows per-hour data; 7d/30d views show per-day data
- All data sourced from **real pi session files** (`~/.pi/agent/sessions/*.jsonl`)

### 📦 Models
- **Model Grid** — Browse all built-in and custom models with search and filter
- **Enable/Disable** — Toggle models on/off to match your `enabledModels` config
- **Edit Model** — Update capabilities, cost, context window, max tokens
- **Add Model** — Create new models for any provider
- **Delete Model** — Remove custom models

### 🔌 Providers
- **Provider List** — Expandable cards for all built-in and custom providers
- **Custom Providers** — Add Ollama, vLLM, LM Studio, or any OpenAI-compatible provider
- **API Key Management** — Set/remove API keys per provider (saved to `auth.json`)
- **Provider Configuration** — baseUrl, API type, custom headers, auth method
- **Enabled Models Panel** — Cross-provider list of every enabled model with one-click disable / disable-all, kept in sync with each provider's per-model toggles
- **Fetch Models Online** — Pull a provider's live model list from its `/models` endpoint and import with one click

### 💬 Sessions
- **Project Grouping** — Auto-decodes session directory names into project paths
- **Session Browser** — View all 100+ sessions across projects
- **Session Details** — Name, timestamp, message count, duration, provider/model used
- **Search & Filter** — Filter sessions by project name
- **Delete Sessions** — Remove old session files (sessions updated within 3 days are protected)

### 🧠 Memory (pi-hermes-memory)
- **Project Memories** — View `MEMORY.md` content with Markdown rendering
- **User Profile** — Display `USER.md` preferences and settings
- **Failure Records** — Browse `failures.md` known issues
- **Live Sync** — Content updates immediately when memory files change on disk

### 🌐 Multi-language
- **English** 🇬🇧 — Default
- **Simplified Chinese** 🇨🇳 — 简体中文
- **Traditional Chinese** 🇭🇰 — 繁體中文
- **Japanese** 🇯🇵 — 日本語
- Language switcher in sidebar footer, persists across sessions

### ⚙️ Settings
- **Defaults** — Default provider, model, thinking level, project trust
- **Theme** — Light / Dark / System with immediate toggle (CSS variables for both modes)
- **Interface Zoom** — Scale the entire UI by percentage (50%–200%), plus a font-size slider
- **Extensions & Packages** — Manage pi packages list
- **Import/Export** — Download full config as JSON, restore from backup
- **Reset** — Factory reset to blank configuration

## 🌗 Theme Support

Full light and dark mode with system-follow support. Theme toggles instantly via CSS custom properties — no page reload needed. All components adapt including sidebar, modals, forms, charts, and scrollbars.

## 🧱 Built-in Providers

The app ships with definitions for **11 built-in providers** and **26 models** (hardcoded from pi's Rust source):

| Provider | Models |
|----------|--------|
| Anthropic | Claude Sonnet 4, Sonnet 4.5, Opus 4, Haiku 3.5 |
| OpenAI | GPT-4o, GPT-4o-mini, GPT-5.1, o3-mini |
| DeepSeek | DeepSeek V3, DeepSeek R1 |
| OpenCode | DeepSeek V4 Flash (Free), DeepSeek V4 Flash |
| OpenCode Go | DeepSeek V4 Flash, V4 Pro, GLM 5.1, Qwen 3.7 Max, MiMo V2.5 |
| Google Gemini | Gemini 2.5 Flash, Gemini 2.5 Pro |
| OpenRouter | Claude Sonnet 4, DeepSeek R1 |
| Mistral | Mistral Large |
| GitHub Copilot | Copilot GPT-4o |
| Groq | Llama 3.3 70B |

## 🚀 Getting Started

### Prerequisites

- **pi coding agent** installed and configured (so `~/.pi/agent/` exists)
- Node.js 18+

### Setup

```bash
# Clone
git clone https://github.com/Raingor/pi-web-switch.git
cd pi-web-switch

# Install dependencies
npm install

# Start dev server (reads ~/.pi/agent/ automatically)
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

The dev server automatically serves pi configuration via Vite middleware at `/api/pi/*` — no separate backend process needed.

## 🖥️ Desktop App (Electron)

pi-web-switch also runs as a **macOS menu bar app** (and a Windows/Linux tray app) — the app lives in your menu bar, and a single click on the tray icon pops up a compact usage summary (today's tokens / cost / requests + a 7-day sparkline + top providers). The full Dashboard is still available from the tray menu or by double-clicking the tray icon.

```bash
# Run in development (Vite dev server + Electron with HMR)
npm run electron:dev

# Build installers (DMG + ZIP for macOS, NSIS for Windows, AppImage for Linux) into release/
npm run electron:build

# Preview the production build without packaging
npm run electron:preview
```

### 🍹 macOS menu bar mode

The packaged macOS app runs as a **menu bar-only** app — it does not appear in the Dock, and `Cmd+Q` quits from the tray menu. This is wired in via `LSUIElement = true` in `electron-builder`'s `extendInfo`. In dev (`electron:dev`) the Dock icon still shows because that Info.plist key only applies to packaged builds; the tray icon works in both modes.

| Tray interaction | What happens |
|------------------|--------------|
| Click | Toggle the usage popup (today + 7d tokens / cost / requests, sparkline, top providers) |
| Right-click | Context menu: open Dashboard, refresh usage, quit |
| Menu → "打开 Dashboard" | Open the full React Dashboard window |

The popup auto-refreshes every 30 seconds while visible. The tray icon is a 16×16 template PNG (`build/trayIconTemplate.png`) that adapts to light/dark menu bars; regenerate it with `npm run tray:icon`.

App icons live in `build/` (`icon.icns` / `icon.ico` / `icon.png`); in development the macOS dock icon is set at runtime from `public/icon-512.png`.

## 🏗️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [React 19](https://react.dev/) |
| Language | [TypeScript 5.8](https://www.typescriptlang.org/) |
| Build | [Vite 6](https://vitejs.dev/) |
| Styling | [Tailwind CSS v4](https://tailwindcss.com/) |
| State | [Zustand](https://github.com/pmndrs/zustand) |
| Charts | [Recharts](https://recharts.org/) |
| Icons | [Lucide React](https://lucide.dev/) |
| Routing | [React Router v7](https://reactrouter.com/) |

## 🗂️ Project Structure

```
pi-web-switch/
├── index.html
├── package.json
├── vite.config.ts          # Vite config + pi API plugin (middleware) + popup entry
├── tsconfig.json
├── server/
│   └── pi-reader.ts        # Server-side module: reads ~/.pi/agent/ files + parses sessions
├── electron/               # Desktop app (macOS menu-bar / tray)
│   ├── main.ts             # Main process: tray, popup window, IPC, local API server
│   ├── api-server.ts       # Local HTTP server serving dist/ + /api/pi/* in packaged mode
│   ├── preload.ts          # contextBridge: settings/auth/models/usage IPC
│   ├── popup.html          # Menu-bar popup UI
│   └── popup-render.ts     # Popup renderer (today/7d tokens, sparkline, top providers)
├── scripts/
│   └── generate-tray-icon.mjs  # Regenerates build/trayIconTemplate.png
├── build/
│   ├── trayIconTemplate.png    # 32x32 menu-bar template icon
│   └── icon.icns / icon.ico / icon.png
├── public/
│   └── pi.svg
└── src/
    ├── main.tsx            # Entry point + theme sync + init gate + i18n provider
    ├── App.tsx             # Router setup (6 routes)
    ├── index.css           # Tailwind + CSS theme variables (light/dark)
    ├── types/index.ts      # All TypeScript interfaces
    ├── data/
    │   └── builtin-providers.ts  # Hardcoded built-in provider definitions
    ├── store/
    │   └── config-store.ts # Zustand store (fetches from /api/pi/*)
    ├── lib/
    │   ├── utils.ts        # Formatting helpers (tokens, cost with USD/CNY)
    │   ├── i18n.tsx        # Multi-language system (React Context + hook)
    │   ├── currency.ts     # Currency switching (USD/CNY toggle)
    │   ├── config.ts       # Config import/export helpers
    │   └── translations/   # Translation files (en, zh-CN, zh-TW, ja)
    └── components/
        ├── layout/          # AppShell, Sidebar (6 nav items + language switcher)
        ├── ui/              # StatCard, Badge, Modal, EmptyState
        ├── dashboard/       # DashboardPage + charts (hourly/daily granularity)
        ├── models/          # ModelsPage + forms
        ├── providers/       # ProvidersPage + forms
        ├── sessions/        # SessionsPage + MemoryPage
        └── settings/        # SettingsPage
```

## 💾 Data Source

All data is read directly from **`~/.pi/agent/`** on your machine via a Vite middleware API plugin — no mock data, no database, no external service.

| File | Purpose |
|------|---------|
| `~/.pi/agent/settings.json` | Default provider, model, theme, enabled models, packages |
| `~/.pi/agent/auth.json` | API keys per provider |
| `~/.pi/agent/models.json` | Custom provider definitions (baseUrl, API type, models) |
| `~/.pi/agent/sessions/*.jsonl` | Session history with token usage, model, provider per message |
| `~/.pi/agent/pi-hermes-memory/*.md` | Hermes memory (MEMORY.md, USER.md, failures.md) |

Changes made in the UI are written back to these files in real time — the pi agent picks them up on next reload.

### Sessions & Usage

- The app parses **106+ JSONL session files** from `sessions/` directory
- Each assistant message's API usage data (tokens, cost) is extracted and aggregated
- Dashboard shows real token consumption, costs, and request volumes across all sessions
- Sessions list groups by project (decoded from directory names) with 24+ project groups

## 🧩 API Routes

These endpoints at `/api/pi/*` are served by the Vite middleware in dev, and by the built-in HTTP server (`electron/api-server.ts`) in the packaged app — so the frontend works identically in both modes:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/pi/settings` | Read `settings.json` |
| POST | `/api/pi/settings` | Write `settings.json` |
| GET | `/api/pi/auth` | Read `auth.json` |
| POST | `/api/pi/auth` | Write `auth.json` |
| GET | `/api/pi/models` | Read `models.json` |
| POST | `/api/pi/models` | Write `models.json` |
| GET | `/api/pi/builtin-providers` | List hardcoded built-in providers |
| GET | `/api/pi/usage` | Aggregated token/cost/request data from sessions |
| GET | `/api/pi/usage-range` | Date-range filtered usage (pi sessions) — `?range=today\|7d\|30d\|custom&from=&to=` |
| GET | `/api/pi/all-usage-range` | Same shape, but combined across **all** sources (pi + cindy + claude + codex + atomcode + copilot) |
| GET | `/api/pi/{cindy-pi\|claude\|codex\|opencode\|gemini\|grok\|atomcode\|copilot}-usage-range` | Per-source usage range |
| GET | `/api/pi/copilot-usage-range` | Local Copilot CLI usage from `~/.copilot/session-store.db` (tokens / requests per day per model; no GitHub API or token required) |
| GET | `/api/pi/copilot-config` | Read Copilot GitHub config (username, token) |
| POST | `/api/pi/copilot-config` | Write Copilot GitHub config |
| GET | `/api/pi/sessions` | Session list grouped by project |
| DELETE | `/api/pi/session?path=` | Move a session file to trash (path must be under sessions/) |
| POST | `/api/pi/session/trash` | Move a session to trash (body: `{ path }`) |
| POST | `/api/pi/session/restore` | Restore a session from trash (body: `{ trashPath }`) |
| GET | `/api/pi/session-preview` | Preview session messages — `?path=` |
| GET | `/api/pi/trash` | List trashed sessions |
| DELETE | `/api/pi/trash?path=` | Permanently delete a trashed session |
| GET | `/api/pi/memory` | Read MEMORY.md, USER.md, failures.md |
| POST | `/api/pi/memory/delete-entry` | Delete a memory entry (body: `{ filename, text }`) |
| GET | `/api/pi/subagents` | Read subagent run history |
| GET | `/api/pi/check-updates` | Check pi package updates |
| POST | `/api/pi/apply-updates` | Apply package updates (body: `{ names }`) |
| POST | `/api/pi/provider-test` | Test a provider connection (body: `{ baseUrl, apiKey }`) |
| POST | `/api/pi/provider-models` | Fetch a provider's live model list (body: `{ baseUrl, apiKey, providerId }`) |
| POST | `/api/pi/model-test` | Test a model (body: `{ baseUrl, modelId, apiKey, apiType }`) |

All `-usage-range` endpoints accept `&refresh=1` to force a rescan, bypassing the 30-second session cache (the Dashboard refresh button sends this).

## 📦 Pi Package

pi-web-switch can be installed as a **pi coding agent extension**, allowing you to start/stop the dashboard directly from your pi session.

### Install

Add `npm:pi-web-switch` to your `~/.pi/agent/settings.json` packages list:

```json
{
  "packages": ["npm:pi-web-switch"]
}
```

Or use the Settings page in the dashboard to add it.

### Commands

Once installed, the following commands are available in your pi session:

| Command | Description |
|---------|-------------|
| `/pi-switch start` | Launch the dashboard at `http://localhost:5173` |
| `/pi-switch stop` | Stop the server |
| `/pi-switch status` | Check if the dashboard is running |
| `/pi-usage` | Print a quick usage summary (today + 7 days) in the terminal — tokens / cost / requests / daily sparkline, without launching the dashboard |

The `/pi-usage` command reads `~/.pi/agent/sessions/*.jsonl` directly and aggregates today + last-7-days stats, so you can see your usage at a glance from any pi session. It mirrors what the macOS menu bar popup shows.

### Package Structure

```
pi-web-switch/
├── package.json           # npm package with pi.extensions + pi.skills
├── pi-package/
│   ├── index.ts           # Extension entry: registers /pi-web-switch command
│   └── skills/
│       └── pi-web-switch/
│           └── SKILL.md   # Usage documentation
├── server/
│   └── pi-reader.ts       # Server-side: reads ~/.pi/agent/ files
└── src/                   # React frontend
```

## 💬 Community

Join the **Telegram group** for questions, suggestions, and bug reports:

👉 **[Join the pi-web-switch Telegram group](https://t.me/+ODpy7_7NlOE4NzA1)**

When reporting an issue, please include:

1. Your OS (macOS / Windows / Linux)
2. Your version — `npm view @raingor/pi-web-switch version`
3. A clear description plus any error screenshots or logs

## 🔗 Links

- **Homepage:** [raingor.github.io/my-blog](https://raingor.github.io/my-blog/)
- **GitHub:** [github.com/Raingor](https://github.com/Raingor)

## 📄 License

MIT
