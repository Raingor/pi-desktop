# Phase 2: HTTP Proxy Commands — Provider & Model Online Operations

> Goal: Implement provider/model fetch + connection testing as Rust Commands.
> After this phase, the Providers page can fetch model lists from OpenAI/OpenRouter/Ollama endpoints.

---

## Source Mapping

| Rust Module | Replaces (TypeScript) |
|---|---|
| `pi_api/http.rs` | `pi-reader.ts:fetchExternal()` — proxy-aware HTTP |
| `pi_api/provider_test.rs` | `pi-reader.ts:testProviderConnection()` + `testModel()` |
| `pi_api/mod.rs` | barrel exports |

---

## Step 1: Update `Cargo.toml` Dependencies

Add to `src-tauri/Cargo.toml`:
```toml
reqwest = { version = "0.12", features = ["json"] }
```

---

## Step 2: HTTP Client with Proxy Detection

### `src-tauri/src/pi_api/http.rs`

**Proxy detection** (port from pi-reader.ts:954-978):

```rust
/// Detect system proxy URL from env vars or macOS scutil.
fn detect_proxy_url() -> Option<String> {
    // 1. Check env vars
    for var in &["https_proxy", "HTTPS_PROXY", "http_proxy", "HTTP_PROXY"] {
        if let Ok(val) = std::env::var(var) {
            if val.starts_with("http") {
                return Some(val);
            }
        }
    }

    // 2. macOS: scutil --proxy
    if cfg!(target_os = "macos") {
        if let Ok(output) = std::process::Command::new("scutil")
            .arg("--proxy")
            .output()
        {
            let text = String::from_utf8_lossy(&output.stdout);
            // Parse HTTPSProxy / HTTPSPort / HTTPEnable etc.
            // ... (regex or line parsing)
        }
    }

    None
}
```

**HTTP client builder**:
```rust
fn build_client() -> reqwest::Result<reqwest::Client> {
    let mut builder = reqwest::Client::builder();
    if let Some(proxy_url) = detect_proxy_url() {
        if let Ok(proxy) = reqwest::Proxy::all(proxy_url) {
            builder = builder.proxy(proxy);
        }
    }
    builder.build()
}
```

**$ENV_VAR resolution** (port from pi-reader.ts:1247-1248):
```rust
fn resolve_api_key(key: &str) -> String {
    if key.starts_with('$') {
        std::env::var(&key[1..]).unwrap_or_default()
    } else {
        key.to_string()
    }
}
```

---

## Step 3: Provider Test Commands

### `src-tauri/src/pi_api/provider_test.rs`

```rust
use serde::Serialize;
use crate::pi_api::http::{build_client, resolve_api_key};

#[derive(Serialize, Clone)]
pub struct ProviderTestResult {
    pub success: bool,
    pub status: Option<u16>,
    pub latency_ms: Option<u16>,
    pub message: Option<String>,
}

/// GET {baseUrl}/models — any HTTP response = reachable
#[tauri::command]
pub async fn pi_test_provider(
    base_url: String,
    api_key: Option<String>,
) -> Result<ProviderTestResult, String> {
    let url = format!("{}/models", base_url.trim_end_matches('/'));
    let key = api_key.as_deref().map(resolve_api_key).unwrap_or_default();

    let client = build_client().map_err(|e| e.to_string())?;
    let mut req = client.get(&url);
    if !key.is_empty() {
        req = req.bearer_auth(&key);
    }

    let start = std::time::Instant::now();
    match req.timeout(std::time::Duration::from_secs(10)).send().await {
        Ok(res) => {
            let latency = start.elapsed().as_millis() as u16;
            if res.status().is_success() {
                Ok(ProviderTestResult { success: true, status: Some(res.status().as_u16()), latency_ms: Some(latency), message: None })
            } else {
                Ok(ProviderTestResult { success: false, status: Some(res.status().as_u16()), latency_ms: Some(latency), message: Some(format!("HTTP {}", res.status())) })
            }
        }
        Err(e) => {
            let latency = start.elapsed().as_millis() as u16;
            Ok(ProviderTestResult { success: false, status: None, latency_ms: Some(latency), message: Some(e.to_string()) })
        }
    }
}

/// POST {baseUrl}/chat/completions with a minimal payload to test a specific model
#[tauri::command]
pub async fn pi_test_model(
    base_url: String,
    model_id: String,
    api_key: Option<String>,
    api_type: String,
) -> Result<ProviderTestResult, String> {
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let key = api_key.as_deref().map(resolve_api_key).unwrap_or_default();

    let body = serde_json::json!({
        "model": model_id,
        "messages": [{"role": "user", "content": "Reply with a single word: ok"}],
        "max_tokens": 4,
        "temperature": 0
    });

    let client = build_client().map_err(|e| e.to_string())?;
    let mut req = client.post(&url).json(&body);
    if !key.is_empty() {
        req = req.bearer_auth(&key);
    }

    let start = std::time::Instant::now();
    match req.timeout(std::time::Duration::from_secs(15)).send().await {
        Ok(res) => {
            let latency = start.elapsed().as_millis() as u16;
            if res.status().is_success() {
                // Validate response has choices[0].message.content or usage
                // ... (port from pi-reader.ts:1455-1481)
                Ok(ProviderTestResult { success: true, status: Some(res.status().as_u16()), latency_ms: Some(latency), message: None })
            } else {
                Ok(ProviderTestResult { success: false, status: Some(res.status().as_u16()), latency_ms: Some(latency), message: Some(format!("HTTP {}", res.status())) })
            }
        }
        Err(e) => {
            let latency = start.elapsed().as_millis() as u16;
            Ok(ProviderTestResult { success: false, status: None, latency_ms: Some(latency), message: Some(e.to_string()) })
        }
    }
}
```

---

## Step 4: Fetch Provider Models

### `src-tauri/src/pi_api/fetch_models.rs`

Port from `fetchProviderModels()` (pi-reader.ts:1242-1408):

**Output type**:
```rust
#[derive(Serialize, Clone)]
pub struct FetchedModel {
    pub id: String,
    pub name: Option<String>,
    pub context_window: Option<u32>,
    pub max_tokens: Option<u32>,
    pub reasoning: Option<bool>,
    pub vision: Option<bool>,
    pub audio: Option<bool>,
    pub cost: Option<ModelCost>,
    pub source: String,  // "openai" | "openrouter" | "ollama" | "heuristic"
}

#[derive(Serialize)]
pub struct FetchedModelsResult {
    pub models: Vec<FetchedModel>,
    pub error: Option<String>,
}
```

**Logic**:
1. Detect Ollama (localhost:11434) → GET `/api/tags`
2. OpenRouter → GET `/models` with 20s timeout, parse pricing
3. OpenAI-compatible → GET `/models` with 15s timeout
4. Apply heuristic flags (reasoning/vision/audio) from model ID
5. Return deduplicated list

**Heuristic patterns** (port from pi-reader.ts:1186-1202):
```rust
fn heuristic_flags(id: &str) -> (Option<bool>, Option<bool>, Option<bool>) {
    let k = id.to_lowercase();
    let reasoning = matches!(k.as_str(), s if s.contains("r1") || s.contains("o1") || s.contains("o3") || s.contains("reason"));
    let vision = matches!(k.as_str(), s if s.contains("vision") || s.contains("gpt-4o") || s.contains("claude"));
    let audio = k.contains("audio") || k.contains("whisper");
    (Some(reasoning), Some(vision), Some(audio))
}
```

---

## Step 5: Register Commands

Add to `main.rs`:
```rust
.invoke_handler(tauri::generate_handler![
    // ... existing Phase 1 commands ...
    // pi_api
    pi_api::provider_test::pi_test_provider,
    pi_api::provider_test::pi_test_model,
    pi_api::fetch_models::pi_fetch_provider_models,
])
```

---

## Verification Checklist

- [ ] `pi_test_provider("https://api.openai.com/v1", Some("sk-..."))` returns success
- [ ] `pi_test_provider` works behind a proxy (set `https_proxy` env var)
- [ ] `pi_fetch_provider_models("https://api.openai.com/v1", Some(key), None)` returns model list
- [ ] `pi_fetch_provider_models("https://openrouter.ai/api/v1", None, None)` returns OpenRouter models with pricing
- [ ] `pi_test_model("https://api.openai.com/v1", "gpt-4o-mini", Some(key), "openai-completions".into())` returns success
- [ ] `$ENV_VAR` API key resolution works (e.g., `$OPENAI_API_KEY`)
- [ ] Timeout: 10s for provider test, 15s for model test, 20s for OpenRouter

---

## Anti-Patterns

- **Don't** hardcode API endpoints — the base URL comes from user config
- **Don't** skip proxy detection — many users are behind Clash/clash-verge
- **Don't** use `reqwest::get()` directly — always go through `build_client()` for proxy support
- **Don't** return raw reqwest errors to frontend — map to user-friendly strings
