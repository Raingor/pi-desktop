<p align="center">
  <img src="public/pi.svg" width="76" height="76" alt="pi-desktop" />
</p>

<h1 align="center">pi-desktop</h1>

<p align="center">
  <strong>A macOS desktop client for the pi coding agent</strong><br />
  Chat workspace · session &amp; memory management · provider/model config · usage stats · menu-bar quota glance
</p>

<p align="center">
  <a href="https://github.com/Raingor/pi-desktop/releases/latest"><img src="https://img.shields.io/badge/download-macOS%20DMG-0078d4?style=flat-square" alt="Download" /></a>
  <img src="https://img.shields.io/badge/version-0.8.3-blue?style=flat-square" alt="0.8.3" />
  <img src="https://img.shields.io/badge/macOS-11%2B%20·%20Intel%20%2F%20Apple%20Silicon-000?style=flat-square&logo=apple" alt="macOS" />
  <img src="https://img.shields.io/badge/Electron-43-47848F?style=flat-square&logo=electron" alt="Electron 43" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react" alt="React 19" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="MIT" />
</p>

<p align="center"><a href="README.md">🇨🇳 中文</a> · <strong>🇬🇧 English</strong></p>

---

## Install

Grab the build for your chip from **[Releases](https://github.com/Raingor/pi-desktop/releases/latest)**:

| Your Mac | Download |
|---|---|
| Apple Silicon (M1/M2/M3/M4) | `pi-desktop-<version>-arm64.dmg` |
| Intel | `pi-desktop-<version>.dmg` |

Open the DMG and drag **pi-desktop** into Applications.

> **Gatekeeper will block the first launch** — the app is not signed or notarized with an Apple Developer account.
> Right-click the app → **Open** → **Open** again; or go to System Settings → Privacy & Security → **Open Anyway**.

**Prerequisite**: the pi CLI must be installed and signed in. pi-desktop ships no AI capability of its own — it reads and writes the real config in your `~/.pi/agent/` and shells out to your installed `pi` binary to run conversations.

```bash
npm i -g @earendil-works/pi-coding-agent
pi   # first run: sign in, configure providers
```

## What this is

pi-desktop moves everyday pi CLI work into a native window: **sessions on the left, conversation on the right, and every setting collected into one separate workspace.**

It is not a replacement for pi — it is a second entry point to the same config. Everything you change lands in `~/.pi/agent/`, so a provider or memory edit made here is live the next time you run `pi` in a terminal, and vice versa.

- **No backend** — no database, no account, no telemetry; the app starts a local HTTP server bound to `127.0.0.1` purely to read and write local files
- **Shares sessions with pi** — a desktop conversation *is* a pi session file, so `pi --resume` picks it up directly
- **Compatible renaming** — renaming a session in the sidebar writes pi's native `session_info`, so the CLI shows the same name

### Relationship to pi-web-switch

pi-desktop grew out of its sister project **[pi-web-switch](https://github.com/Raingor/pi-web-switch)** (migrated wholesale from its `codex/web-pi-chat` branch), and the two have since diverged into different tools:

| | pi-web-switch | pi-desktop (this repo) |
|---|---|---|
| Form | Browser dashboard | Native macOS app (Electron) |
| Focus | Multi-page config management; Chat is one of 8 nav items | Chat-first; the main window is only conversation, config lives in a separate workspace |
| Menu bar | — | Persistent icon + usage popup (incl. Codex official quota) |
| Theming | Light / dark | 15 whole-UI style presets |
| Install | `npm:@raingor/pi-web-switch` | DMG / ZIP (not published to npm) |

**Both read and write the same `~/.pi/agent/` config and can be used side by side.** Use pi-web-switch when you want config management in a browser tab; use pi-desktop when you want a persistent conversation window.

## Features

### Chat workspace

The main window does one thing: conversation.

- **Sessions grouped by project** — session directory names are decoded back to real project paths, groups collapse, and you can start a new conversation in any project directory
- **Opening a session restores its model** — provider / model / thinking level are read back from session history; if the model is no longer available it falls back to the default rather than showing a misleading stale selection
- **Sidebar rename** — "···" menu → Rename, written to pi's native metadata
- **Session info panel** — message count, duration, tokens, cost, project path, plus reveal-in-Finder
- **Draggable sidebar** — 200–480px (default 264px), width persisted
- **Immersive title bar** — frameless window with traffic lights blended into the sidebar; window size adapts to your display's work area

### Menu bar glance

A persistent menu-bar icon; **click to toggle a usage popup**:

- Today / last 7 days tokens, cost, request count, a mini sparkline, and top providers
- **OpenAI Codex official quota** — remaining percentage, countdown and exact reset time for both the 5-hour and weekly windows
- Right-click menu: open main window / refresh usage / quit
- Auto-refreshes every 30 seconds while visible

### Settings workspace

A full-screen config surface (`/settings`) separate from chat, with seven sections:

| Section | Contents |
|---|---|
| **General** | Theme, interface style, zoom & font size, language, config import/export, pi CLI settings, skills & commands browser, package management |
| **Overview & usage** | Tokens and cost for today / 7d / 30d / custom range, daily cost chart, per-provider and per-model breakdowns, cache hit rate, request log, USD/CNY toggle, Codex sign-in state and official quota |
| **Providers & models** | Provider cards, custom OpenAI-compatible providers (Ollama / vLLM / LM Studio), API keys and key pools, fetch model lists online, cross-provider view of every enabled model |
| **Subagents** | Reads pi subagent definitions and run history; agent config is editable |
| **Speed test** | Batch latency and availability checks with persisted results; models at 100% pass rate can be added to a provider in one click |
| **Sessions** | Browse and preview all sessions, move to a recoverable trash and restore; sessions idle for more than 14 days can be archived in bulk |
| **Memory** | Renders pi-hermes-memory's `MEMORY.md` / `USER.md` / `failures.md`, deletes entries, runs memory optimization |

### 15 interface styles

The whole app is themed through `html[data-style]` tokens, so picking a card re-skins everything instantly without a reload.

**9 pi originals**: Graphite (default) · Signal Terminal · Cyber Neon (always dark) · Pixel · Kawaii · Elegant · Plain · Amber · Violet

**6 editor/assistant palettes** (taken from official or public color references): VS Code Dark Modern · Kiro · Claude · Codex · Gemini · Grok (always dark)

Every style supports light / dark / follow-system, and the Electron window background follows the theme so there is no white flash on launch.

### Languages

UI available in **简体中文 / 繁體中文 / English / 日本語**, switchable from the sidebar footer and persisted.

## Development

```bash
git clone https://github.com/Raingor/pi-desktop.git
cd pi-desktop
npm install

npm run electron:dev      # Electron + Vite HMR (recommended)
npm run dev               # web only, http://localhost:5179
npm test                  # vitest (72 tests)
npm run build             # tsc -b && vite build
npm run electron:build    # DMG + ZIP for x64 and arm64 into release/
npm run electron:preview  # run the production build without packaging
npm run tray:icon         # regenerate the menu-bar template icon
```

**Dev and packaged builds run the same backend code**: `server/api-routes.ts` exports `createPiApiMiddleware()`, mounted as Vite middleware in dev and reused by the local HTTP server in `electron/api-server.ts` after packaging — so the frontend behaves identically in both modes.

Packaged artifacts contain only `dist/` and `dist-electron/`; **`node_modules` is excluded** because the runtime needs nothing but Node builtins and Electron. That keeps `app.asar` at 2MB.

## Project layout

```
pi-desktop/
├── electron/                    # desktop shell
│   ├── main.ts                  # main process: window, tray, popup, IPC, single-instance lock
│   ├── api-server.ts            # local HTTP server for packaged builds (dist/ + /api/pi/*)
│   ├── preload.ts               # contextBridge allowlist
│   ├── popup.html / popup-render.ts   # menu-bar popup
├── server/
│   ├── pi-reader.ts             # reads/writes ~/.pi/agent/, parses sessions, aggregates usage, drives the pi CLI
│   ├── api-routes.ts            # the single implementation of all 45 endpoints
│   ├── local-origin-guard.ts    # Host / Origin / Content-Type guard
├── src/
│   ├── App.tsx                  # routes: / and /chat → chat, /settings → settings workspace
│   ├── index.css                # theme tokens + all 15 styles
│   ├── components/
│   │   ├── chat/                # ChatPage
│   │   ├── layout/              # AppShell, Sidebar
│   │   ├── settings/            # SettingsWorkspace, SettingsPage, Skills, Commands, PiCli, PackageBrowser
│   │   ├── dashboard/           # usage stats
│   │   ├── providers/           # providers & models
│   │   ├── speedtest/           # model speed test
│   │   ├── subagents/           # subagents
│   │   ├── sessions/            # session management, memory
│   │   └── ui/                  # StatCard, Badge, Modal, EmptyState
│   ├── store/config-store.ts    # Zustand
│   ├── lib/                     # i18n, pi-settings merge, provider import, currency, utils
│   └── data/                    # builtin providers, model catalog, changelog
├── pi-package/ + extensions/    # entry points for shipping as a pi extension
├── scripts/                     # electron-dev, tray icon generator
└── build/                       # app icons and menu-bar template
```

## Data source

Everything comes from `~/.pi/agent/` on your machine. **No mock data, no remote service.**

| Path | Purpose |
|---|---|
| `settings.json` | Default provider/model/thinking level, theme, enabled models, packages, project trust |
| `auth.json` | API keys per provider |
| `models.json` | Custom provider definitions (baseUrl, API type, models, key pools) |
| `sessions/*.jsonl` | Session history: messages, model, tokens, cost |
| `pi-hermes-memory/*.md` | Memory: MEMORY.md / USER.md / failures.md |
| `hermes-memory-config.json` | Memory system config |
| `copilot.json` | Copilot account config |

The builtin provider catalog is not hardcoded — it reads `@earendil-works/pi-ai`'s `dist/providers/data/*.json` from your local pi install (39 providers at the time of writing), so upgrading pi refreshes the catalog automatically.

## API

45 routes (24 GET / 21 POST) under `/api/pi/*`, listening on `127.0.0.1` only.

<details>
<summary>Full list</summary>

**Config**
`GET|POST /settings` · `GET|POST /auth` · `GET|POST /models` · `GET /builtin-providers` · `GET|POST /copilot-config`

**Chat**
`POST /chat` · `POST /chat/stop` · `GET /chat/active` · `GET /chat/default-directory` · `POST /chat/select-directory`

**Sessions**
`GET /sessions` · `GET /session-history` · `GET /session-info` · `GET /session-preview` · `GET /session-usage` · `POST /session-message` · `POST /session-rename` · `POST /session/trash` · `POST /session/restore` · `GET /trash`

**Usage**
`GET /usage` · `GET /codex-usage-status` · `GET /official-usage-config` · `POST /official-usage-query` · `POST /official-usage-refresh`

**Memory**
`GET /memory` · `GET|POST /memory/config` · `GET /memory/status` · `POST /memory/delete-entry` · `POST /memory/optimize`

**Extensions & tools**
`GET /skills` · `GET /commands` · `GET /subagents` · `POST /subagents/update-agent` · `GET /packages/search` · `GET /check-updates` · `POST /apply-updates` · `POST /provider-test` · `POST /provider-models` · `POST /model-test`

</details>

## Security notes

Binding to `127.0.0.1` alone does not stop a browser from issuing cross-site writes, so `server/local-origin-guard.ts` checks three things on every `/api/pi/*` request:

- non-loopback `Host` is rejected (DNS rebinding defense)
- cross-origin `Origin` is rejected
- POST with a non-`application/json` content type is rejected (blocks preflight-free form CSRF)

On the Electron side, `contextIsolation: true` and `nodeIntegration: false` mean the renderer can only reach main-process capabilities through the preload allowlist.

API keys in `auth.json` are returned in clear text to the app's own frontend — editing keys, testing connections and exporting backups all need them. That is a deliberate tradeoff, and the endpoint is only reachable from this app.

## Using it as a pi extension

Besides the desktop app, this repo can be installed as a pi extension to start and stop the dev dashboard from inside a pi session. It is **not published to npm** (the `pi-desktop` name on npm belongs to a different package), so declare it by local path in `~/.pi/agent/settings.json`:

```json
{ "packages": ["/absolute/path/to/pi-desktop"] }
```

| Command | Description |
|---|---|
| `/pi-switch start [port]` | Start the dev dashboard (default `http://localhost:5179`) |
| `/pi-switch stop` | Stop it |
| `/pi-switch status` | Check whether it is running |
| `/pi-usage` | Print today + last-7-day usage in the terminal (tokens / cost / requests / sparkline) without opening the dashboard |

## Known limitations

- **Unsigned, un-notarized** — first launch needs a right-click bypass; fixable once an Apple Developer account is available
- **No auto-update** — new versions must be downloaded manually
- **Only macOS is verified** — Windows NSIS and Linux AppImage targets exist in `package.json` but are untested
- **Depends on a local pi CLI** — chat does not work if pi is missing or not signed in
- **`localStorage` keys still carry the old prefix** — left alone so upgrades do not wipe user preferences

## License

MIT

<p align="center">
  <sub>
    <a href="https://github.com/Raingor/pi-desktop">pi-desktop</a> ·
    sister project <a href="https://github.com/Raingor/pi-web-switch">pi-web-switch</a> ·
    <a href="https://github.com/Raingor">GitHub @Raingor</a> ·
    <a href="https://raingor.github.io/my-blog/">Blog</a> ·
    inspired by <a href="https://github.com/farion1231/cc-switch">cc-switch</a>
  </sub>
</p>
