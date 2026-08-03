# Phase 0: Project Scaffold & Frontend Copy

> Goal: Initialize a working Tauri 2.0 project with the frontend from pi-web-switch copied in.
> After this phase, `npm run tauri dev` launches a blank-but-functional app.

---

## Step 1: Initialize Tauri 2.0 Project

Run in `/Users/mac-2312-r/workspace/wwwroot/M-projects/pi-desktop/`:

```bash
npm create tauri-app@latest . -- --template react-ts --manager npm
```

**OR** (since the directory already has .git, manual setup is cleaner):

Create these files manually:

### `package.json`
```json
{
  "name": "@raingor/pi-desktop",
  "private": false,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "tauri": "tauri",
    "tauri:dev": "tauri dev",
    "tauri:build": "tauri build"
  },
  "dependencies": {
    "@tauri-apps/api": "^2.5.0",
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "react-router-dom": "^7.5.0",
    "recharts": "^2.15.3",
    "zustand": "^5.0.4",
    "lucide-react": "^0.487.0"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.5.0",
    "@tailwindcss/vite": "^4.1.4",
    "@types/react": "^19.1.2",
    "@types/react-dom": "^19.1.2",
    "@vitejs/plugin-react": "^4.4.1",
    "tailwindcss": "^4.1.4",
    "typescript": "~5.8.3",
    "vite": "^6.3.2"
  }
}
```

### `vite.config.ts`
```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  server: { port: 5176, strictPort: true },
});
```

**Key difference from source**: No `piApiPlugin()`, no `chatApiPlugin()`. Those become Rust Commands.

### `tsconfig.json`
Copy from `pi-web-switch/tsconfig.json` (identical).

### `index.html`
Copy from `pi-web-switch/index.html`.

---

## Step 2: Copy Frontend Source Files

Copy these directories/files **as-is** from `pi-web-switch/src/`:

```
cp -r pi-web-switch/src/components/ pi-desktop/src/
cp -r pi-web-switch/src/types/    pi-desktop/src/
cp -r pi-web-switch/src/data/     pi-desktop/src/
cp -r pi-web-switch/src/lib/      pi-desktop/src/
cp -r pi-web-switch/src/hooks/    pi-desktop/src/
cp -r pi-web-switch/src/store/    pi-desktop/src/
cp pi-web-switch/src/App.tsx      pi-desktop/src/
cp pi-web-switch/src/index.css    pi-desktop/src/
cp pi-web-switch/src/vite-env.d.ts pi-desktop/src/
```

**Modify `src/main.tsx`**: Remove `applySavedFontSize()` and `applySavedZoom()` calls (lines 103-118 in source). These will be replaced by Tauri window config in Phase 5. For now, keep them so the app looks correct — but mark with `// TODO: Phase 5 - replace with Tauri window API`.

---

## Step 3: Create `src-tauri/` (Rust Backend)

```bash
mkdir -p pi-desktop/src-tauri/src
mkdir -p pi-desktop/src-tauri/capabilities
```

### `src-tauri/Cargo.toml`
```toml
[package]
name = "pi-desktop"
version = "0.1.0"
edition = "2021"

[lib]
name = "pi_desktop_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = ["protocol-asset"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
dirs = "5"

# Phase 1 additions:
# chrono = "0.4"
# walkdir = "2"
# regex = "1"
# glob = "0.3"

# Phase 2 additions:
# reqwest = { version = "0.12", features = ["json"] }

# Phase 3 additions:
# uuid = { version = "1", features = ["v4"] }
# notify = "6"

[features]
default = ["custom-protocol"]
custom-protocol = ["tauri/custom-protocol"]
```

### `src-tauri/tauri.conf.json`
```json
{
  "productName": "pi-desktop",
  "version": "0.1.0",
  "identifier": "com.raingor.pi-desktop",
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://localhost:5176",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "pi-desktop",
        "width": 1280,
        "height": 800,
        "minWidth": 800,
        "minHeight": 600
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": ["icons/32x32.png", "icons/128x128.png", "icons/128x128@2x.png", "icons/icon.icns", "icons/icon.ico"]
  }
}
```

### `src-tauri/capabilities/default.json`
```json
{
  "identifier": "default",
  "description": "Default permissions for pi-desktop",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:window:allow-start-dragging",
    "core:window:allow-close",
    "core:window:allow-minimize",
    "core:window:allow-toggle-maximize"
  ]
}
```

### `src-tauri/src/main.rs`
```rust
// Phase 0: minimal entry point. Commands added in Phase 1+.

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

---

## Step 4: Install Dependencies & Verify

```bash
cd pi-desktop
npm install
cargo check  # from src-tauri/
npm run tauri dev
```

**Verification checklist:**
- [ ] `npm install` succeeds
- [ ] `npm run tauri dev` launches a window
- [ ] No console errors (blank page is OK — we'll wire up data in Phase 1)
- [ ] `npm run build` produces `dist/`

---

## Anti-Patterns to Avoid

- **Don't** copy `vite.electron.config.ts` or `vite.preload.config.ts` — Tauri doesn't need them
- **Don't** copy `electron/` directory — it's Electron-specific
- **Don't** copy `pi-package/` — that's a pi extension, not part of the desktop app
- **Don't** copy `server/` — those become Rust modules
- **Don't** add the pi SDK npm dependencies (`@earendil-works/*`) in Phase 0 — they go in the Node bridge (Phase 3)
