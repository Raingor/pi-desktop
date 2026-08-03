# Phase 4: Frontend Migration — fetch→invoke, EventSource→Channel, UI Consolidation

> Goal: Adapt the React frontend to use Tauri Commands instead of HTTP fetch,
> Tauri Channel instead of browser EventSource for SSE,
> **consolidate navigation to 4 items**, and **redesign Chat per reference image**.
>
> After this phase, all pages work with the Rust backend and match the target UI.
>
> **UI Reference**: See `07-ui-reference.md` for the full layout specification.

---

## Step 1: Replace `config-store.ts` API Layer

**Source**: `pi-web-switch/src/store/config-store.ts`
**Target**: `pi-desktop/src/store/config-store.ts`

### Before (Electron):
```typescript
const API_BASE = "/api/pi";

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`API ${path}: ${res.status}`);
  return res.json();
}

async function apiPost(path: string, data: unknown): Promise<boolean> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) return false;
  const result = await res.json();
  return result.success === true;
}
```

### After (Tauri):
```typescript
import { invoke } from "@tauri-apps/api/core";

async function apiGet<T>(command: string): Promise<T> {
  return invoke<T>(command);
}

async function apiPost(command: string, data: unknown): Promise<boolean> {
  const result = await invoke<{ success: boolean }>(command, data as any);
  return result.success;
}
```

### Updated Store Actions:
```typescript
// Before:
const [settings, auth, modelsJson, usage, builtinsRes] = await Promise.all([
  apiGet<PiSettings>("/settings"),
  apiGet<PiAuth>("/auth"),
  apiGet<PiModelsJson>("/models"),
  apiGet<UsageData>("/usage"),
  apiGet<Provider[]>("/builtin-providers").catch(() => null),
]);

// After:
const [settings, auth, modelsJson, usage, builtinsRes] = await Promise.all([
  invoke<PiSettings>("pi_settings_get"),
  invoke<PiAuth>("pi_auth_get"),
  invoke<PiModelsJson>("pi_models_get"),
  invoke<UsageData>("pi_usage_get"),
  invoke<Provider[]>("pi_builtin_catalog_get").catch(() => null),
]);
```

### Updated Write Operations:
```typescript
// Before:
const ok = await apiPost("/settings", updated);

// After:
const ok = await invoke<boolean>("pi_settings_set", { data: updated });
// Note: Rust command signature is `pi_settings_set(data: PiSettings) -> Result<bool, String>`
```

### Full Command Mapping:

| Old `apiGet("/path")` | New `invoke("command")` |
|---|---|
| `GET /settings` | `invoke("pi_settings_get")` |
| `POST /settings` | `invoke("pi_settings_set", { data })` |
| `GET /auth` | `invoke("pi_auth_get")` |
| `POST /auth` | `invoke("pi_auth_set", { data })` |
| `GET /models` | `invoke("pi_models_get")` |
| `POST /models` | `invoke("pi_models_set", { data })` |
| `GET /usage` | `invoke("pi_usage_get")` |
| `GET /usage-range` | `invoke("pi_usage_range_get", { range, from, to })` |
| `GET /sessions` | `invoke("pi_sessions_list")` |
| `GET /memory` | `invoke("pi_memory_get")` |
| `GET /subagents` | `invoke("pi_subagents_get")` |
| `GET /builtin-providers` | `invoke("pi_builtin_catalog_get")` |
| `DELETE /session?path=` | `invoke("pi_session_trash", { path })` |
| `POST /session/restore` | `invoke("pi_session_restore", { trashPath })` |
| `DELETE /trash?path=` | `invoke("pi_session_delete_permanent", { path })` |
| `GET /trash` | `invoke("pi_trash_list")` |
| `GET /session-preview?path=` | `invoke("pi_session_preview", { path })` |
| `POST /memory/delete-entry` | `invoke("pi_memory_delete_entry", { filename, text })` |
| `GET /check-updates` | `invoke("pi_check_updates")` |
| `POST /apply-updates` | `invoke("pi_apply_updates", { names })` |
| `POST /provider-models` | `invoke("pi_fetch_provider_models", { baseUrl, apiKey, providerId })` |
| `POST /provider-test` | `invoke("pi_test_provider", { baseUrl, apiKey })` |
| `POST /model-test` | `invoke("pi_test_model", { baseUrl, modelId, apiKey, apiType })` |

---

## Step 2: Replace `useAgentSession.ts` EventSource with Tauri Channel

### Before (Electron):
```typescript
const connectEvents = useCallback((sid: string) => {
  closeEvents();
  const es = new EventSource(`/api/chat/agent/${encodeURIComponent(sid)}/events`);
  eventSourceRef.current = es;

  es.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data);
      if (event.type === "connected") return;
      handleAgentEventRef.current?.(event);
    } catch { /* ignore */ }
  };

  es.onerror = () => { /* auto-reconnect */ };
}, [closeEvents]);
```

### After (Tauri):
```typescript
import { Channel } from "@tauri-apps/api/core";

const channelRef = useRef<Channel<AgentEvent> | null>(null);
const unlistenRef = useRef<(() => void) | null>(null);

const connectEvents = useCallback(async (sid: string) => {
  closeEvents();

  const channel = new Channel<AgentEvent>();
  channelRef.current = channel;

  channel.onmessage = (event: AgentEvent) => {
    if (event.type === "connected") return;
    handleAgentEventRef.current?.(event);
  };

  // Tell Rust to start forwarding events for this session
  await invoke("chat_subscribe_events", { sessionId: sid, channel });
}, [closeEvents]);

const closeEvents = useCallback(() => {
  channelRef.current = null;
  // Channel drops when dropped; Rust detects the disconnect
}, []);
```

### Updated Session Operations:
```typescript
// Before:
const res = await fetch(`/api/chat/sessions/${sid}`);
const stateRes = await fetch(`/api/chat/agent/${sid}`);
await fetch("/api/chat/agent/new", { method: "POST", body: JSON.stringify({...}) });

// After:
const data = await invoke<SessionData>("chat_get_session", { id: sid });
const state = await invoke<AgentState>("chat_get_state", { sessionId: sid });
const result = await invoke<StartSessionResult>("chat_start_session", {
  cwd: newSessionCwd,
  options: { toolNames, provider, modelId, thinkingLevel }
});
```

### Updated `sendAgentCommand`:
```typescript
// Before:
export async function sendAgentCommand<T>(sessionId: string, command: Record<string, unknown>): Promise<T> {
  const res = await fetch(`/api/chat/agent/${encodeURIComponent(sessionId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body.data as T;
}

// After:
export async function sendAgentCommand<T>(sessionId: string, command: Record<string, unknown>): Promise<T> {
  return invoke<T>("chat_send_command", { sessionId, command });
}
```

---

## Step 3: Update `main.tsx` — Remove Electron-specific Code

### Before:
```typescript
applySavedFontSize();
function applySavedFontSize() {
  const saved = Number(localStorage.getItem("pi-font-size"));
  if (saved >= 12 && saved <= 24) {
    document.documentElement.style.fontSize = `${saved}px`;
  }
}

applySavedZoom();
function applySavedZoom() {
  const saved = Number(localStorage.getItem("pi-ui-zoom"));
  if (saved >= 50 && saved <= 200) {
    document.documentElement.style.zoom = `${saved}%`;
  }
}
```

### After:
```typescript
// Keep for now — will be replaced by Tauri window API in Phase 5
// TODO: Phase 5 - use tauri://window event for zoom/font sync
applySavedFontSize();
applySavedZoom();
```

**Note**: These stay as-is for Phase 4. In Phase 5, we'll implement proper Tauri window management. The `localStorage` approach still works in Tauri WebView.

---

## Step 4: Update `vite.config.ts`

Remove the Electron/Vite plugin middleware. The file is already clean from Phase 0.

**Before** (pi-web-switch):
```typescript
plugins: [
  react(),
  tailwindcss(),
  piApiPlugin(),    // REMOVE
  chatApiPlugin(),  // REMOVE
],
```

**After** (pi-desktop, from Phase 0):
```typescript
plugins: [
  react(),
  tailwindcss(),
],
```

---

## Step 5: Update `package.json` Dependencies

**Remove** Electron-only packages:
```json
// REMOVE these:
"electron": "^43.2.0",
"electron-builder": "^26.15.3",
"electron-vite": "^5.0.0",
"vite-plugin-electron": "^1.1.0",
"vite-plugin-pwa": "^1.3.0",  // PWA not applicable to Tauri
"undici": "^8.9.0",  // Node.js fetch proxy — only needed in chat-bridge
```

**Add** Tauri packages:
```json
// ADD these:
"@tauri-apps/api": "^2.5.0",
"@tauri-apps/cli": "^2.5.0",  // devDependency
```

---

## Step 6: TypeScript Types for Tauri Commands

Create `src/lib/tauri.ts` with typed wrappers:

```typescript
import { invoke } from "@tauri-apps/api/core";
import type { PiSettings, PiAuth, PiModelsJson, Provider, Model } from "@/types";

// Settings
export const piSettingsGet = () => invoke<PiSettings>("pi_settings_get");
export const piSettingsSet = (data: PiSettings) => invoke<boolean>("pi_settings_set", { data });

// Auth
export const piAuthGet = () => invoke<PiAuth>("pi_auth_get");
export const piAuthSet = (data: PiAuth) => invoke<boolean>("pi_auth_set", { data });

// Models
export const piModelsGet = () => invoke<PiModelsJson>("pi_models_get");
export const piModelsSet = (data: PiModelsJson) => invoke<boolean>("pi_models_set", { data });

// Usage
export const piUsageGet = () => invoke<UsageData>("pi_usage_get");
export const piUsageRangeGet = (range: string, from: string, to: string) =>
  invoke<UsageRangeData>("pi_usage_range_get", { range, from, to });

// Sessions
export const piSessionsList = () => invoke<ProjectGroup[]>("pi_sessions_list");
export const piSessionTrash = (path: string) => invoke<boolean>("pi_session_trash", { path });
export const piSessionRestore = (trashPath: string) => invoke<boolean>("pi_session_restore", { trashPath });
export const piSessionDeletePermanent = (path: string) => invoke<boolean>("pi_session_delete_permanent", { path });
export const piTrashList = () => invoke<TrashEntry[]>("pi_trash_list");
export const piSessionPreview = (path: string) => invoke<SessionPreview>("pi_session_preview", { path });

// Memory
export const piMemoryGet = () => invoke<MemoryFile[]>("pi_memory_get");
export const piMemoryDeleteEntry = (filename: string, text: string) =>
  invoke<boolean>("pi_memory_delete_entry", { filename, text });

// Subagents
export const piSubagentsGet = () => invoke<SubagentsData>("pi_subagents_get");

// Updates
export const piCheckUpdates = () => invoke<UpdateCheckResult>("pi_check_updates");
export const piApplyUpdates = (names: string[]) => invoke<ApplyUpdateResult[]>("pi_apply_updates", { names });

// Provider/Model online
export const piFetchProviderModels = (baseUrl: string, apiKey?: string, providerId?: string) =>
  invoke<FetchedModelsResult>("pi_fetch_provider_models", { baseUrl, apiKey, providerId });
export const piTestProvider = (baseUrl: string, apiKey?: string) =>
  invoke<ProviderTestResult>("pi_test_provider", { baseUrl, apiKey });
export const piTestModel = (baseUrl: string, modelId: string, apiKey?: string, apiType?: string) =>
  invoke<ProviderTestResult>("pi_test_model", { baseUrl, modelId, apiKey, apiType });

// Chat
export const chatListSessions = () => invoke<SessionInfo[]>("chat_list_sessions");
export const chatGetSession = (id: string) => invoke<SessionData>("chat_get_session", { id });
export const chatStartSession = (cwd: string, options: SessionStartOptions) =>
  invoke<StartSessionResult>("chat_start_session", { cwd, options });
export const chatSendCommand = (sessionId: string, command: Record<string, unknown>) =>
  invoke<serde_json.Value>("chat_send_command", { sessionId, command });
export const chatGetState = (sessionId: string) => invoke<AgentState>("chat_get_state", { sessionId });
export const chatSubscribeEvents = (sessionId: string, channel: Channel<AgentEvent>) =>
  invoke<void>("chat_subscribe_events", { sessionId, channel });
```

---

## Step 7: Navigation Consolidation (4 Items Only)

**Reference**: `07-ui-reference.md` → "Navigation Structure"

### New Routes (`src/App.tsx`)
```typescript
<BrowserRouter>
  <Routes>
    <Route element={<AppShell />}>
      <Route path="/" element={<DashboardPage />} />
      <Route path="/sessions" element={<SessionsPage />} />
      <Route path="/sessions/:id" element={<ChatPage />} />  {/* Session detail = chat */}
      <Route path="/memory" element={<MemoryPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/settings/:tab" element={<SettingsPage />} />  {/* /settings/providers */}
    </Route>
  </Routes>
</BrowserRouter>
```

### Sidebar (`src/components/layout/Sidex.tsx`)
```typescript
const navItems = [
  { icon: "ChartBar", label: "Dashboard", path: "/" },
  { icon: "MessageCircle", label: "Sessions", path: "/sessions" },
  { icon: "Brain", label: "Memory", path: "/memory" },
  { icon: "Settings", label: "Settings", path: "/settings" },
];
```

**Removed from sidebar**: Providers, Models, Subagents (now in Settings tabs)

### Settings Page with Tabs (`src/components/settings/SettingsPage.tsx`)
```typescript
const tabs = [
  { id: "general", label: "General", icon: "Settings" },
  { id: "providers", label: "Providers", icon: "Cloud" },
  { id: "models", label: "Models", icon: "Cpu" },
  { id: "subagents", label: "Subagents", icon: "Bot" },
  { id: "about", label: "About", icon: "Info" },
];
```

Each tab is a separate component:
- `GeneralTab` — existing settings (theme, font, language, defaults)
- `ProvidersTab` — move from `ProvidersModelsPage` (providers half)
- `ModelsTab` — move from `ProvidersModelsPage` (models half)
- `SubagentsTab` — move from `SubagentsPage`
- `AboutTab` — version, update check, apply updates

---

## Step 8: Chat Page Redesign

**Reference**: `07-ui-reference.md` → "Chat Page Layout"

### New Chat Component Structure
```
src/components/chat/
├── ChatPage.tsx          # Main container (replaces existing)
├── ChatStatsBar.tsx      # NEW: Context/Cost/Tokens bar
├── ChatInput.tsx         # Enhanced: model selector + attachment
├── MessageView.tsx       # Enhanced: inline tool calls
├── ToolCallView.tsx      # NEW: collapsible tool display
├── StreamingMessage.tsx  # NEW: partial text + cursor
├── ModelSelector.tsx     # NEW: model dropdown
└── ChatSessionList.tsx   # Session list (left panel or full page)
```

### ChatPage Layout
```tsx
<div className="flex h-full">
  {/* Session list sidebar (collapsible on < 768px) */}
  <SessionListPanel />

  {/* Main chat area */}
  <div className="flex flex-col flex-1">
    <ChatTopBar session={session} />      {/* Name + model selector */}
    <ChatStatsBar session={session} />     {/* Context/Cost/Tokens */}
    <MessageList messages={messages} />    {/* Scrollable messages */}
    <ChatInput />                          {/* Input + send */}
  </div>
</div>
```

### ChatStatsBar (NEW)
```tsx
<div className="flex items-center gap-4 px-4 py-2 bg-slate-800 text-sm">
  <span>Context: {contextTokens.toLocaleString()}/{contextLimit.toLocaleString()} ({percent}%)</span>
  <div className="h-1.5 flex-1 bg-slate-700 rounded-full max-w-32">
    <div className="h-full bg-blue-500 rounded-full" style={{ width: `${percent}%` }} />
  </div>
  <span>Cost: ${cost.toFixed(4)}</span>
  <span>Tokens: {inputTokens.toLocaleString()} in / {outputTokens.toLocaleString()} out</span>
</div>
```

### ToolCallView (NEW)
```tsx
<div className="rounded border border-slate-700 my-1">
  <button className="flex items-center gap-2 px-3 py-1.5 w-full text-left text-sm">
    <span>{expanded ? '▼' : '▶'}</span>
    <span>{toolIcon}</span>
    <span className="font-mono">{toolName}</span>
    <span className="text-slate-400 truncate">{target}</span>
    <span className={status === 'success' ? 'text-green-400' : 'text-red-400'}>
      [{status}]
    </span>
  </button>
  {expanded && (
    <pre className="px-3 py-2 text-xs bg-slate-900 overflow-x-auto">
      {output}
    </pre>
  )}
</div>
```

### ModelSelector (NEW)
```tsx
<select
  value={currentModel}
  onChange={(e) => handleModelChange(e.target.value)}
  className="rounded bg-slate-700 px-2 py-1 text-sm"
>
  {modelList.map((m) => (
    <option key={m.id} value={m.id}>{m.name}</option>
  ))}
</select>
```

---

## Verification Checklist

- [ ] Dashboard page loads and shows real usage data from `~/.pi/agent/sessions/`
- [ ] Sessions page shows project-grouped sessions
- [ ] Memory page shows MEMORY.md / USER.md / failures.md
- [ ] **Settings page has tabs**: General / Providers / Models / Subagents / About
- [ ] **Sidebar has only 4 nav items**: Dashboard, Sessions, Memory, Settings
- [ ] **Chat page matches reference image**: stats bar, inline tools, model selector
- [ ] Chat SSE events flow through Tauri Channel (not EventSource)
- [ ] All pages work without any `fetch()` calls (grep `fetch(` in src/ should return 0 results)
- [ ] No console errors related to CORS, API routes, or missing endpoints
- [ ] `npm run tauri dev` launches with full functionality
- [ ] **Navigation**: Providers/Models/Subagents accessible via Settings tabs
- [ ] **Chat stats bar** updates in real-time during streaming
- [ ] **Tool calls** are collapsible in chat messages

---

## Anti-Patterns

- **Don't** mix `fetch()` and `invoke()` — all backend communication goes through `invoke()`
- **Don't** create a new `Channel` for each message — one Channel per session
- **Don't** forget to close the Channel when the component unmounts
- **Don't** use `window.piAPI` (Electron preload) — Tauri doesn't need preload
- **Don't** keep the old `server/` directory in the Tauri project — it's replaced by Rust
- **Don't** add separate sidebar items for Providers/Models/Subagents — they're in Settings
- **Don't** deviate from the reference image layout for Chat — match it exactly
