# Phase 5: Subagents, Update Check, Settings Polish & Packaging

> Goal: Complete remaining features (subagents, updates, settings) and produce a shippable .dmg.
> After this phase, pi-desktop is feature-complete and ready for distribution.

---

## Step 1: Subagents Module (Rust)

### `src-tauri/src/pi_reader/subagents.rs`

Port from `pi-reader.ts:1483-1684`:

**YAML frontmatter parsing** — Use `serde_yaml` or simple line parsing:
```rust
fn parse_frontmatter(raw: &str) -> (serde_json::Value, String) {
    // Find first "---" and second "---"
    // Parse key: value lines between them
    // Handle array values: "[item1, item2]"
    // Handle boolean/number coercion
}
```

**Agent definitions** (`agents/*.md`):
```rust
#[derive(Serialize)]
pub struct AgentDef {
    pub name: String,
    pub file_name: String,
    pub file_path: String,
    pub package: String,
    pub description: String,
    pub model: Option<String>,
    pub tools: Option<Vec<String>>,
    pub thinking: Option<String>,
    pub body: String,
}
```

**Chain definitions** (`chains/*.chain.md`):
- Parse `## agent-name` headers as steps
- Support parallel steps: `## (agent1 | agent2)`

**Run history** (`run-history.jsonl`):
- Read last N lines, parse JSON each line, reverse order

```rust
#[tauri::command]
pub fn pi_subagents_get() -> Result<SubagentsData, String> {
    Ok(SubagentsData {
        agents: list_agents()?,
        chains: list_chains()?,
        run_history: read_run_history(100)?,
    })
}
```

---

## Step 2: Update Check Module (Rust)

### `src-tauri/src/pi_reader/update_check.rs`

Port from `pi-reader.ts:867-1095`:

**pi version detection**:
```rust
fn get_pi_version() -> Option<String> {
    // Try: PI_BINARY env → `which pi` → known locations
    // Each: spawn `pi --version`, parse output
}
```

**npm registry lookup** (using reqwest):
```rust
async fn fetch_latest_version(pkg_name: &str) -> Option<String> {
    let url = format!("https://registry.npmjs.org/{}/latest", pkg_name);
    // GET with 8s timeout, parse { "version": "..." }
}
```

**Extension updates** (`~/.pi/agent/npm/package.json`):
- Read `dependencies` keys
- For each, read `node_modules/{name}/package.json` version
- Compare with npm registry latest

**Apply updates**:
```rust
#[tauri::command]
pub fn pi_apply_updates(names: Vec<String>) -> Result<Vec<ApplyUpdateResult>, String> {
    // For each name: cd ~/.pi/agent/npm && npm install {name}@latest --legacy-peer-deps
    // Return success/failure per package
}
```

---

## Step 3: File Watching (notify crate)

Watch `~/.pi/agent/` for changes and emit events to frontend:

### `src-tauri/src/file_watcher.rs`

```rust
use notify::{Watcher, RecursiveMode, Config};
use std::sync::mpsc::channel;
use std::time::Duration;

pub fn start_watcher(app_handle: tauri::AppHandle) {
    let (tx, rx) = channel();
    let mut watcher = notify::recommended_watcher(tx).unwrap();
    watcher.watch(pi_dir().as_path(), RecursiveMode::Recursive).ok();

    std::thread::spawn(move || {
        for event in rx {
            // Debounce: wait 500ms for batch changes
            // Then emit "pi-files-changed" event
            app_handle.emit("pi-files-changed", &changed_paths).ok();
        }
    });
}
```

**Frontend** (in `main.tsx` or a hook):
```typescript
import { listen } from "@tauri-apps/api/event";
listen("pi-files-changed", () => {
    useConfigStore.getState().init();  // Refresh all data
});
```

---

## Step 4: Settings & System Polish

### Theme Sync
Already handled by existing frontend code in `main.tsx` (`useThemeSync`). Works as-is.

### Font Size & Zoom
Replace `localStorage` approach with Tauri window API:
```typescript
// In SettingsPage.tsx
import { getCurrentWindow } from "@tauri-apps/api/window";

// Zoom: use webview.set_zoom() or CSS zoom
await appWindow.setZoom(1.2);  // 120%

// Font size: keep localStorage approach (it works in WebView)
```

### Window State Persistence
Add to `main.tsx`:
```typescript
import { getCurrentWindow } from "@tauri-apps/api/window";

// On mount: restore
const saved = JSON.parse(localStorage.getItem("window-state") || "{}");
if (saved.width) {
    await appWindow.setSize(new LogicalSize(saved.width, saved.height));
    await appWindow.setPosition(new PhysicalPosition(saved.x, saved.y));
}

// On close: save
window.addEventListener("beforeunload", async () => {
    const size = await appWindow.innerSize();
    const pos = await appWindow.innerPosition();
    localStorage.setItem("window-state", JSON.stringify({
        width: size.width, height: size.height, x: pos.x, y: pos.y
    }));
});
```

### Application Icons
- Place icon files in `src-tauri/icons/`
- Required: `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns` (macOS), `icon.ico` (Windows)

---

## Step 5: Capabilities / Permissions

Update `src-tauri/capabilities/default.json`:

```json
{
  "identifier": "default",
  "description": "Permissions for pi-desktop",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:window:allow-close",
    "core:window:allow-minimize",
    "core:window:allow-toggle-maximize",
    "core:window:allow-start-dragging",
    "core:window:allow-set-fullscreen",
    "core:window:allow-set-size",
    "core:window:allow-set-position",
    "core:window:allow-set-zoom",
    "opener:default",
    "shell:allow-execute"
  ]
}
```

**Note**: File system access from Rust side (`std::fs`) doesn't need capability scopes — those only apply to frontend JS API. Rust can read any file the app process can access.

---

## Step 6: Build & Package

### Development
```bash
npm run tauri dev
```

### Production Build
```bash
npm run tauri build
```

### Output Locations
```
src-tauri/target/release/bundle/
├── dmg/pi-desktop_0.1.0_aarch64.dmg      # macOS Apple Silicon
├── dmg/pi-desktop_0.1.0_x64.dmg          # macOS Intel
├── msi/pi-desktop_0.1.0_x64_en-US.msi    # Windows
├── appimage/pi-desktop_0.1.0_amd64.AppImage  # Linux
└── deb/pi-desktop_0.1.0_amd64.deb        # Debian/Ubuntu
```

### Code Signing (macOS)
```bash
# Set environment variables:
export APPLE_CERTIFICATE="..."
export APPLE_SIGNING_IDENTITY="Developer ID Application: ..."
export APPLE_ID="..."
export APPLE_PASSWORD="..."
export APPLE_TEAM_ID="..."

npm run tauri build
```

---

## Verification Checklist

- [ ] Subagents page shows agents/chains/run-history from `~/.pi/agent/`
- [ ] Update check compares pi core + extensions against npm registry
- [ ] Apply updates actually runs `npm install` in `~/.pi/agent/npm/`
- [ ] File watching: changes to `~/.pi/agent/` auto-refresh the UI
- [ ] Window size/position persists between launches
- [ ] Theme changes apply immediately
- [ ] Font size changes apply immediately
- [ ] `npm run tauri build` produces a .dmg < 30MB
- [ ] Cold start < 2s
- [ ] Idle memory < 100MB
- [ ] All 7 pages functional with real data
- [ ] Multi-language (en/zh-CN/zh-TW/ja) works
- [ ] No console errors

---

## Final Acceptance Criteria

| Metric | Target | Verify |
|--------|--------|--------|
| Feature parity | 100% of Electron version | Manual test all pages |
| Package size | macOS .dmg < 30MB | `ls -lh` on build artifact |
| Cold start | < 2s | Stopwatch from click to interactive |
| Memory (idle) | < 100MB | Activity Monitor / Task Manager |
| First data load | < 500ms | DevTools network tab |
| Multi-platform | macOS + Windows + Linux | Build on each platform |

---

## Anti-Patterns

- **Don't** run `npm install` on the host project during build — only in `~/.pi/agent/npm/`
- **Don't** use `unwrap()` in the update check module — network operations fail often
- **Don't** watch files from the frontend JS (use Rust `notify` crate instead) — more reliable
- **Don't** forget to add `serde(default)` on all Rust struct fields — config files evolve
- **Don't** bundle the entire `node_modules` in the Tauri app — use esbuild to tree-shake the chat-bridge
