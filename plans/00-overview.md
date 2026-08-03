# pi-desktop Tauri 2.0 Migration Plan

> **Goal**: Rewrite pi-web-switch (Electron) as pi-desktop (Tauri 2.0) with 100% feature parity,
> smaller package (~10MB vs ~150MB), faster startup (<2s vs ~5s), and lower memory (<100MB vs ~300MB).
>
> **Source**: `/Users/mac-2312-r/workspace/wwwroot/M-projects/pi-web-switch/`
> **Target**: `/Users/mac-2312-r/workspace/wwwroot/M-projects/pi-desktop/`

---

## Architecture Summary

```
pi-desktop (Tauri 2.0)
├── Frontend (React 19 + Vite 6 + Tailwind v4) — 90% code reuse from pi-web-switch
│   ├── Navigation: Dashboard / Sessions(Memory+Chat) / Settings(Providers+Models+Subagents+System)
│   ├── Store: Zustand (fetch → invoke)
│   └── Chat: EventSource → Tauri Channel (redesigned UI per reference image)
└── Rust Backend (src-tauri/)
    ├── pi_reader module    → File I/O for ~/.pi/agent/ (replaces server/pi-reader.ts)
    ├── pi_api module       → HTTP proxy with proxy detection (replaces Vite piApiPlugin)
    ├── chat_agent module   → SSE via Tauri Channel (replaces chat-api-plugin.ts)
    └── chat_bridge (Node)  → Child process running agent-session-manager.ts (pi SDK is Node.js)
```

## Key Migration Decision: pi SDK Bridge

The pi SDK (`@earendil-works/pi-coding-agent`) is **Node.js-only**. The Tauri version uses a **Node.js child process bridge**:

- Rust spawns a long-lived Node.js process that imports `agent-session-manager.ts`
- Rust ↔ Node communication: stdin/stdout JSON-RPC
- Rust ↔ Frontend: Tauri Commands + Channel for SSE events

This avoids reimplementing the pi SDK in Rust while still getting Tauri's size/speed benefits for the core read-only operations (dashboard, sessions, memory, settings).

---

## Phase Index

| Phase | File | What |
|-------|------|------|
| 0 | `01-phase0-scaffold.md` | Tauri project init, dependencies, frontend copy |
| 1 | `02-phase1-pi-reader.md` | Rust pi_reader — all file I/O Commands |
| 2 | `03-phase2-providers-http.md` | Rust HTTP proxy — provider/model fetch + test |
| 3 | `04-phase3-chat-bridge.md` | Node child process + Rust chat_agent + SSE Channel |
| 4 | `05-phase4-frontend-adapt.md` | Frontend store/hook migration (fetch→invoke, EventSource→Channel) |
| 5 | `06-phase5-subagents-settings.md` | Subagents, update check, settings polish, packaging |
| — | `07-ui-reference.md` | **UI 设计参考规范** — 导航简化 + Chat 重设计 (以用户提供的截图为准) |

---

## Source → Target Mapping

### Backend (Node.js → Rust)

| Source File (Electron) | Target Module (Tauri Rust) | Status |
|---|---|---|
| `server/pi-reader.ts` (settings/auth/models) | `src-tauri/src/pi_reader/settings.rs` + `auth.rs` + `models.rs` | Phase 1 |
| `server/pi-reader.ts` (usage/sessions) | `src-tauri/src/pi_reader/usage.rs` + `sessions.rs` | Phase 1 |
| `server/pi-reader.ts` (memory/trash) | `src-tauri/src/pi_reader/memory.rs` | Phase 1 |
| `server/pi-reader.ts` (subagents) | `src-tauri/src/pi_reader/subagents.rs` | Phase 5 |
| `server/pi-reader.ts` (update_check) | `src-tauri/src/pi_reader/update_check.rs` | Phase 5 |
| `server/pi-reader.ts` (provider_test/fetch) | `src-tauri/src/pi_api/http.rs` + `provider_test.rs` | Phase 2 |
| `server/chat-api-plugin.ts` | `src-tauri/src/chat_agent/mod.rs` + `sse.rs` | Phase 3 |
| `server/agent-session-manager.ts` | `src-tauri/src/chat_bridge/` (Node child process) | Phase 3 |
| `electron/main.ts` (IPC) | `src-tauri/src/main.rs` (Command registration) | Phase 0+1 |
| `electron/preload.ts` | Removed — Tauri has no preload needed for invoke | Phase 0 |

### Frontend (Electron → Tauri)

| Source File | Change | Phase |
|---|---|---|
| `src/store/config-store.ts` | `fetch('/api/pi/*')` → `invoke('pi_*')` | Phase 4 |
| `src/hooks/useAgentSession.ts` | `EventSource` → `Channel<AgentEvent>` | Phase 4 |
| `src/main.tsx` | Remove `applySavedFontSize/Zoom` (use Tauri window) | Phase 4 |
| `src/App.tsx` | **Consolidate routes**: only 4 nav items (Dashboard/Sessions/Settings + Chat as session detail) | Phase 4 |
| `src/components/layout/Sidebar.tsx` | Simplify to 4 icons; move Providers/Models/Subagents into Settings tabs | Phase 4 |
| `src/components/settings/SettingsPage.tsx` | Expand with tabs: General / Providers / Models / Subagents / About/Updates | Phase 4 |
| `src/components/chat/ChatPage.tsx` | **Redesign** per reference image (stats bar, inline tools, model selector) | Phase 4 |
| `src/components/chat/ChatInput.tsx` | Add model selector, attachment button, send button | Phase 4 |
| `src/components/chat/MessageView.tsx` | Inline tool calls, collapsible sections | Phase 4 |
| `src/components/**` (others) | No change (framework-agnostic) | — |
| `src/types/**` | No change | — |
| `src/data/**` | No change | — |
| `src/lib/**` | No change (i18n, currency, utils, config) | — |
| `vite.config.ts` | Remove piApiPlugin + chatApiPlugin | Phase 0 |

---

## Verification Strategy

After each phase:
1. `cargo check` — Rust compiles
2. `npm run tauri dev` — App launches
3. Manual: each page renders with real data from `~/.pi/agent/`
4. Phase 5: `npm run tauri build` — produces .dmg

---

## Risk Register

| Risk | Mitigation |
|---|---|
| pi SDK Node child process crashes | Rust monitors process, auto-restarts, reports error to frontend |
| Tauri fs scope permissions block reads | Configure `tauri.conf.json` fs/protocol scopes for `~/.pi/agent/**` |
| SSE Channel backpressure | Tauri Channel handles backpressure natively; no custom buffering needed |
| macOS proxy detection in Rust | Use `system-configuration` crate or read env vars directly |
| Large session JSONL files | Rust uses `BufReader` + streaming; no OOM risk |
