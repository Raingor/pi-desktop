# UI Reference Specification — pi-desktop Layout

> **Source of truth**: The reference image provided by the user.
> All frontend implementation MUST match this layout.
>
> Image: `cindy-media/blobs/bb/bb92a0efe235e94927e2780c68a457e40ac6b4a271a70c49b0752df3e566cbca.png`

---

## Navigation Structure (Left Sidebar)

### Layout
- **Width**: ~60px (icon-only) or ~200px (icon + label)
- **Position**: Fixed left, full height
- **Background**: Dark (#111827 / gray-900)

### Items (top to bottom)

| # | Icon | Label | Route | Source Page |
|---|------|-------|-------|-------------|
| 1 | 🔷 (pi logo) | — | — | App title |
| 2 | 📊 (chart-bar) | Dashboard | `/` | DashboardPage |
| 3 | 💬 (message-circle) | Sessions | `/sessions` | SessionsPage (chat session list) |
| 4 | 📁 (brain/memory) | Memory | `/memory` | MemoryPage |
| 5 | ⚙️ (settings) | Settings | `/settings` | SettingsPage (expanded) |

### Moved into Settings (NOT separate nav items)
- **Providers & Models** → Settings → Providers tab
- **Subagents** → Settings → Subagents tab
- **Update Check** → Settings → About tab
- **Auth/Keys** → Settings → Providers tab (per-provider)

---

## Chat Page Layout (Right Panel — Main Content)

When a session is selected from the Sessions list, the main area shows the chat interface:

### Top Bar (height ~48px)
```
┌──────────────────────────────────────────────────────────┐
│  ←  claude-sonnet-4-sonnet                    [model ▾] │
│     Session name                                        │
└──────────────────────────────────────────────────────────┘
```
- **Left**: Back button (←) to return to session list, session name + model
- **Right**: Model selector dropdown

### Stats Bar (height ~32px, muted background)
```
┌──────────────────────────────────────────────────────────┐
│  Context: 1.2M/200k (96%)   │  Cost: $0.09              │
│  Tokens: 45.2k in / 3.8k out                             │
└──────────────────────────────────────────────────────────┘
```
- **Context usage**: `current / limit (percent%)` — progress bar style
- **Cost**: Accumulated cost for this session (USD)
- **Tokens**: Input / Output token counts
- **Auto-updates** as new messages arrive (from SSE events)

### Messages Area (flex-grow, scrollable)

#### User Message
```
┌─────────────────────────────────────────────┐
│                    ┌───────────────────────┐ │
│                    │ Write a Rust program  │ │
│                    │ that reads JSONL...   │ │
│                    └───────────────────────┘ │
│                              [timestamp]     │
└─────────────────────────────────────────────┘
```
- Right-aligned, blue background (bg-blue-600), white text
- Rounded corners (rounded-2xl)
- Max width ~70% of container

#### Assistant Message
```
┌─────────────────────────────────────────────┐
│ ┌─────────────────────────────────────────┐ │
│ │ Here's the Rust program...              │ │
│ │                                         │ │
│ │ ```rust                                 │ │
│ │ use std::fs::File;                      │ │
│ │ ...                                     │ │
│ │ ```                                     │ │
│ └─────────────────────────────────────────┘ │
│ [tool: read] [tool: bash]  [timestamp]      │
└─────────────────────────────────────────────┘
```
- Left-aligned, transparent/gray background
- Markdown rendering (code blocks, inline code)
- Tool calls shown as small badges below message

#### Tool Call (inline, collapsible)
```
┌─────────────────────────────────────────────┐
│ ▼ 📖 read  src/main.rs         [✓ success] │
│   ┌───────────────────────────────────────┐ │
│   │ use serde::Deserialize;               │ │
│   │ ...                                   │ │
│   └───────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```
- Collapsible section (▶ expanded, ▼ collapsed)
- Shows: tool name, target/path, status (success/error)
- Output preview (truncated, max ~200 lines)

#### Streaming Message (in progress)
```
┌─────────────────────────────────────────────┐
│ ┌─────────────────────────────────────────┐ │
│ │ Here's the analysis...                  │ │
│ │ ▌                                       │ │  ← cursor blink
│ └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```
- Shows partial text as it streams
- Blinking cursor indicator at end

### Input Area (bottom, auto-height)
```
┌──────────────────────────────────────────────────────────┐
│  ┌─────────────────────────────────────┐  ┌──┐  ┌────┐ │
│  │ Type a message...                   │  │📎│  │ ➤  │ │
│  │                                     │  │  │  │send│ │
│  └─────────────────────────────────────┘  └──┘  └────┘ │
│  Model: [claude-sonnet-4-sonnet ▾]   [+ attach img]    │
└──────────────────────────────────────────────────────────┘
```
- **Text input**: Multi-line, auto-grow, max ~400px
- **Attachment button** (📎): Opens file picker for images
- **Send button** (➤): Disabled when empty or streaming
- **Model selector**: Dropdown to switch model mid-session
- **Keyboard**: Enter to send, Shift+Enter for newline

---

## Settings Page Layout

### Tab Navigation (left or top)
```
┌──────────────────────────────────────────────────────────┐
│  [General] [Providers] [Models] [Subagents] [About]      │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  (Tab content area)                                      │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### Tab: General
- Default Provider / Model / Thinking Level
- Theme (Light/Dark/System)
- Font size slider (12-24px)
- UI zoom slider (50%-200%)
- Language (en/zh-CN/zh-TW/ja)
- Config import/export
- Reset to defaults

### Tab: Providers
- Built-in provider list (from pi install)
- Custom provider CRUD
- API Key management ($ENV reference hint)
- Connection test button per provider
- Online model fetch (OpenAI/OpenRouter/Ollama)

### Tab: Models
- Model catalog (all providers)
- Enable/disable toggle per model
- Price display (follows currency)
- Search/filter/sort
- Model test (single + batch)

### Tab: Subagents
- Agent definitions list (YAML frontmatter)
- Chain definitions list
- Run history table

### Tab: About
- pi core version + update check
- Extension list + update check
- Apply updates button
- App version

---

## Sessions Page Layout

### Session List (when no session selected)
```
┌──────────────────────────────────────────────────────────┐
│  Sessions                                    [+ New]     │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  📁 ~/workspace/project-a                                │
│  ├── 💬 Fix auth bug                    2 min ago        │
│  ├── 💬 Add tests for user module      1 hour ago       │
│  └── 💬 Initial project setup          3 days ago       │
│                                                          │
│  📁 ~/workspace/project-b                                │
│  ├── 💬 Refactor database layer        30 min ago       │
│  └── 💬 Add API documentation          2 hours ago      │
│                                                          │
└──────────────────────────────────────────────────────────┘
```
- Grouped by project directory
- Each session shows: name, last active time
- Click → opens chat view in main area
- **+ New** button → creates new session (prompts for cwd)

---

## Color Scheme / Theme

| Element | Dark Mode | Light Mode |
|---------|-----------|------------|
| Background | #0f172a (slate-900) | #ffffff |
| Sidebar | #1e293b (slate-800) | #f8fafc (slate-50) |
- Card | #1e293b | #ffffff |
| User message bg | #2563eb (blue-600) | #2563eb |
| Text primary | #f1f5f9 (slate-100) | #0f172a |
| Text secondary | #94a3b8 (slate-400) | #64748b |
| Border | #334155 (slate-700) | #e2e8f0 |
| Accent | #3b82f6 (blue-500) | #2563eb |

---

## Responsive Behavior

- **< 768px**: Sidebar collapses to icon-only; chat takes full width
- **768px - 1280px**: Sidebar icon-only (60px), chat fills rest
- **> 1280px**: Sidebar expanded (200px with labels), chat fills rest

---

## Component Breakdown (New/Modified)

| Component | Source | Action |
|-----------|--------|--------|
| `layout/Sidebar.tsx` | Existing | Simplify to 4 nav items |
| `layout/AppShell.tsx` | Existing | Adapt for new sidebar width |
| `chat/ChatPage.tsx` | Existing | **Redesign** — split into sub-components |
| `chat/ChatStatsBar.tsx` | **NEW** | Context/Cost/Tokens stats bar |
| `chat/ChatInput.tsx` | Existing | Add model selector + attachment |
| `chat/MessageView.tsx` | Existing | Inline tool calls, collapsible |
| `chat/ToolCallView.tsx` | **NEW** | Collapsible tool call display |
| `chat/StreamingMessage.tsx` | **NEW** | Blinking cursor + partial text |
| `chat/ModelSelector.tsx` | **NEW** | Dropdown to switch model |
| `sessions/SessionsPage.tsx` | Existing | Session list + click-to-chat |
| `settings/SettingsPage.tsx` | Existing | Add tabs for Providers/Models/Subagents |
| `settings/ProvidersTab.tsx` | **NEW** | Provider management |
| `settings/ModelsTab.tsx` | **NEW** | Model management |
| `settings/SubagentsTab.tsx` | **NEW** | Subagents display |
| `settings/AboutTab.tsx` | **NEW** | Version + updates |
