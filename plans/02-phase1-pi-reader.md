# Phase 1: Rust pi_reader Module — File I/O Commands

> Goal: Implement all `~/.pi/agent/` file read/write operations as Tauri Commands.
> After this phase, Dashboard / Sessions / Memory / Settings pages show real data.

---

## Source Mapping

| Rust Module | Replaces (TypeScript) |
|---|---|
| `pi_reader/settings.rs` | `pi-reader.ts:readSettings/writeSettings` |
| `pi_reader/auth.rs` | `pi-reader.ts:readAuth/writeAuth` |
| `pi_reader/models.rs` | `pi-reader.ts:readModels/writeModels` |
| `pi_reader/usage.rs` | `pi-reader.ts:readAllUsage + aggregation helpers` |
| `pi_reader/sessions.rs` | `pi-reader.ts:listSessions + trash functions` |
| `pi_reader/memory.rs` | `pi-reader.ts:readMemoryFiles + deleteMemoryEntry` |
| `pi_reader/mod.rs` | barrel exports + `PI_DIR` constant |

---

## Step 1: Update `Cargo.toml` Dependencies

Add to `src-tauri/Cargo.toml`:
```toml
[dependencies]
# ... existing ...
chrono = "0.4"
walkdir = "2"
regex = "1"
glob = "0.3"
notify = "6"  # file watching (Phase 5, but add now)
```

---

## Step 2: Module Structure

Create `src-tauri/src/pi_reader/`:

```
src-tauri/src/pi_reader/
├── mod.rs          # PI_DIR constant, module declarations
├── settings.rs     # pi_settings_get / pi_settings_set
├── auth.rs         # pi_auth_get / pi_auth_set
├── models.rs       # pi_models_get / pi_models_set
├── usage.rs        # pi_usage_get / pi_usage_range_get
├── sessions.rs     # pi_sessions_list / trash operations / preview
├── memory.rs       # pi_memory_get / pi_memory_delete_entry
└── builtin_catalog.rs  # pi_builtin_catalog_get
```

### `pi_reader/mod.rs`
```rust
pub mod settings;
pub mod auth;
pub mod models;
pub mod usage;
pub mod sessions;
pub mod memory;
pub mod builtin_catalog;

use std::path::PathBuf;
use dirs::home_dir;

/// ~/.pi/agent/ — all data lives here
pub fn pi_dir() -> PathBuf {
    home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".pi/agent")
}

pub fn pi_path(filename: &str) -> PathBuf {
    pi_dir().join(filename)
}
```

---

## Step 3: Settings Commands

### `pi_reader/settings.rs`
```rust
use serde::{Deserialize, Serialize};
use std::fs;
use crate::pi_reader::pi_path;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PiSettings {
    #[serde(default)]
    pub last_changelog_version: Option<String>,
    #[serde(default)]
    pub default_provider: Option<String>,
    #[serde(default)]
    pub default_model: Option<String>,
    #[serde(default)]
    pub default_thinking_level: Option<String>,
    #[serde(default)]
    pub theme: Option<String>,
    #[serde(default)]
    pub hide_thinking_block: Option<bool>,
    #[serde(default)]
    pub enabled_models: Option<Vec<String>>,
    #[serde(default)]
    pub packages: Option<Vec<String>>,
    // ... remaining fields
}

#[tauri::command]
pub fn pi_settings_get() -> Result<PiSettings, String> {
    let path = pi_path("settings.json");
    if !path.exists() {
        return Ok(PiSettings::default());
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pi_settings_set(data: PiSettings) -> Result<bool, String> {
    let path = pi_path("settings.json");
    // Backup existing
    if path.exists() {
        let backup = path.with_extension("json.bak");
        fs::copy(&path, &backup).ok();
    }
    let raw = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    fs::write(&path, raw).map_err(|e| e.to_string())?;
    Ok(true)
}
```

**Pattern**: Use `serde(default)` for all optional fields so older config files don't break.

---

## Step 4: Auth Commands

### `pi_reader/auth.rs`
```rust
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use crate::pi_reader::pi_path;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ProviderAuth {
    #[serde(rename = "type")]
    pub auth_type: String,
    pub key: Option<String>,
}

pub type PiAuth = HashMap<String, ProviderAuth>;

#[tauri::command]
pub fn pi_auth_get() -> Result<PiAuth, String> {
    let path = pi_path("auth.json");
    if !path.exists() { return Ok(HashMap::new()); }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pi_auth_set(data: PiAuth) -> Result<bool, String> {
    let path = pi_path("auth.json");
    if path.exists() {
        fs::copy(&path, path.with_extension("json.bak")).ok();
    }
    let raw = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    fs::write(&path, raw).map_err(|e| e.to_string())?;
    Ok(true)
}
```

---

## Step 5: Models Commands

### `pi_reader/models.rs`
```rust
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use crate::pi_reader::pi_path;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CustomProviderConfig {
    pub name: Option<String>,
    pub base_url: Option<String>,
    pub api: Option<String>,
    pub api_key: Option<String>,
    pub auth_header: Option<bool>,
    pub models: Option<Vec<serde_json::Value>>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PiModelsJson {
    pub providers: HashMap<String, CustomProviderConfig>,
}

#[tauri::command]
pub fn pi_models_get() -> Result<PiModelsJson, String> {
    let path = pi_path("models.json");
    if !path.exists() {
        return Ok(PiModelsJson { providers: HashMap::new() });
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pi_models_set(data: PiModelsJson) -> Result<bool, String> {
    let path = pi_path("models.json");
    if path.exists() {
        fs::copy(&path, path.with_extension("json.bak")).ok();
    }
    let raw = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    fs::write(&path, raw).map_err(|e| e.to_string())?;
    Ok(true)
}
```

---

## Step 6: Usage / Dashboard Commands

### `pi_reader/usage.rs`

This is the most complex module — parsing JSONL session files and aggregating token/cost data.

**Key types** (matching the TypeScript `UsageRecord` interface):
```rust
use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct UsageRecord {
    pub date: String,        // "YYYY-MM-DD"
    pub hour: Option<u32>,
    pub provider_id: String,
    pub model_id: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
    pub requests: u64,
    pub cost: f64,
}

#[derive(Serialize)]
pub struct UsageData {
    pub daily_aggregates: Vec<DailyAggregate>,
    pub provider_summaries: Vec<ProviderSummary>,
    pub model_summaries: Vec<ModelSummary>,
    pub totals: Totals,
}
```

**JSONL parsing logic** (port from `parseSessionFile` in pi-reader.ts:114-164):
- Read `~/.pi/agent/sessions/--*/*.jsonl` files
- For each line, parse JSON, check `type === "message"` and `message.role === "assistant"`
- Extract `usage.input/output/cacheRead/cacheWrite/cost.total`
- Track `model_change` events for current provider/model context
- Use `BufReader` for streaming large files

**Aggregation** (port from `getDailyAggregates`, `getProviderSummaries`, `getModelSummaries`, `getTotals`):
- Use `HashMap<String, Aggregate>` keyed by date/provider/model
- Return sorted vectors

### Commands:
```rust
#[tauri::command]
pub fn pi_usage_get() -> Result<UsageData, String> {
    let records = read_all_usage()?;
    Ok(UsageData {
        daily_aggregates: get_daily_aggregates(&records),
        provider_summaries: get_provider_summaries(&records),
        model_summaries: get_model_summaries(&records),
        totals: get_totals(&records),
    })
}

#[tauri::command]
pub fn pi_usage_range_get(range: String, from: String, to: String) -> Result<UsageRangeData, String> {
    let records = read_all_usage()?;
    let filtered: Vec<_> = records.iter()
        .filter(|r| r.date >= from && r.date <= to)
        .cloned()
        .collect();
    Ok(aggregate_range(&filtered, &range))
}
```

---

## Step 7: Sessions Commands

### `pi_reader/sessions.rs`

Port from:
- `listSessions()` → `pi_sessions_list()`
- `trashSessionFile()` → `pi_session_trash()`
- `restoreFromTrash()` → `pi_session_restore()`
- `permanentlyDeleteTrash()` → `pi_session_delete_permanent()`
- `listTrash()` → `pi_trash_list()`
- `readSessionPreview()` → `pi_session_preview()`

**Security**: All path operations must validate the path starts with `~/.pi/agent/sessions/` or `~/.pi/agent/.trash/` (same as TypeScript source).

**Project name decoding** (port `decodeProjectName`):
```rust
fn decode_project_name(dir_name: &str) -> (String, String) {
    // "--Users-foo--workspace--project--" → "/Users/foo/workspace/project"
    let trimmed = dir_name.trim_start_matches("--").trim_end_matches("--");
    let decoded = trimmed.replace("--", "/");
    // ... extract project name from last path segment
}
```

---

## Step 8: Memory Commands

### `pi_reader/memory.rs`

Port from:
- `readMemoryFiles()` → `pi_memory_get()`
- `deleteMemoryEntry()` → `pi_memory_delete_entry()`

**Memory entry deletion** (port from pi-reader.ts:847-865):
- Read file, split by `§`, find section matching entry text, remove, rejoin

---

## Step 9: Built-in Catalog

### `pi_reader/builtin_catalog.rs`

Port from `readBuiltinCatalog()` (pi-reader.ts:1746-1823):
- Find pi binary via `which pi` → readlink → locate `@earendil-works/pi-ai/dist/providers/data/*.json`
- Parse each provider JSON file
- Cache for 5 minutes (300,000 ms)
- Return `Vec<CatalogProvider>` or `None` (frontend falls back to static BUILTIN_PROVIDERS)

---

## Step 10: Register Commands in `main.rs`

```rust
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            // pi_reader
            pi_reader::settings::pi_settings_get,
            pi_reader::settings::pi_settings_set,
            pi_reader::auth::pi_auth_get,
            pi_reader::auth::pi_auth_set,
            pi_reader::models::pi_models_get,
            pi_reader::models::pi_models_set,
            pi_reader::usage::pi_usage_get,
            pi_reader::usage::pi_usage_range_get,
            pi_reader::sessions::pi_sessions_list,
            pi_reader::sessions::pi_session_trash,
            pi_reader::sessions::pi_session_restore,
            pi_reader::sessions::pi_session_delete_permanent,
            pi_reader::sessions::pi_trash_list,
            pi_reader::sessions::pi_session_preview,
            pi_reader::memory::pi_memory_get,
            pi_reader::memory::pi_memory_delete_entry,
            pi_reader::builtin_catalog::pi_builtin_catalog_get,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

---

## Verification Checklist

- [ ] `cargo check` passes
- [ ] `pi_settings_get()` returns the actual `~/.pi/agent/settings.json` content
- [ ] `pi_usage_get()` returns aggregated token/cost data from session files
- [ ] `pi_sessions_list()` returns project-grouped sessions
- [ ] `pi_memory_get()` returns MEMORY.md / USER.md / failures.md content
- [ ] `pi_builtin_catalog_get()` returns the live catalog from the pi install
- [ ] File writes (settings/auth/models) create `.bak` backup before overwriting
- [ ] Trash operations correctly move files to `~/.pi/agent/.trash/`
- [ ] Path traversal is blocked (paths outside `~/.pi/agent/` rejected)

---

## Anti-Patterns

- **Don't** use `unwrap()` in production code — return `Result<T, String>`
- **Don't** read entire JSONL files into memory — use `BufReader::new()` + `lines()`
- **Don't** use `std::process::Command::new("date")` for timestamps — use `chrono::Local::now()`
- **Don't** cache usage data across Commands (no global state yet) — each call re-reads. Add caching in Phase 5 if performance is an issue.
