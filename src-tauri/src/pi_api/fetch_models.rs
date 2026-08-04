use serde::Serialize;
use crate::pi_api::http::{build_client, resolve_api_key};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FetchedModel {
    pub id: String,
    pub name: Option<String>,
    pub context_window: Option<u64>,
    pub max_tokens: Option<u64>,
    pub reasoning: Option<bool>,
    pub vision: Option<bool>,
    pub audio: Option<bool>,
    pub cost: Option<ModelCost>,
    pub source: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelCost {
    pub input: f64,
    pub output: f64,
    pub cache_read: Option<f64>,
    pub cache_write: Option<f64>,
}

#[derive(Serialize)]
pub struct FetchedModelsResult {
    pub models: Vec<FetchedModel>,
    pub error: Option<String>,
}

/// Fetch model list from a provider endpoint.
/// Supports: OpenAI-compatible /models, OpenRouter /models, Ollama /api/tags.
#[tauri::command]
pub async fn pi_fetch_provider_models(
    base_url: String,
    api_key: Option<String>,
    provider_id: Option<String>,
) -> Result<FetchedModelsResult, String> {
    let key = api_key.as_deref().map(resolve_api_key).unwrap_or_default();

    let base = match url::Url::parse(base_url.trim_end_matches('/')) {
        Ok(u) => u,
        Err(_) => return Ok(FetchedModelsResult {
            models: vec![],
            error: Some("invalid URL".to_string()),
        }),
    };

    if !base.scheme().starts_with("http") {
        return Ok(FetchedModelsResult {
            models: vec![],
            error: Some("invalid URL: must be http(s)".to_string()),
        });
    }

    let host = base.host_str().unwrap_or("");

    // Detect Ollama
    let is_ollama = host == "localhost" && base.port() == Some(11434);

    if is_ollama {
        return fetch_ollama_models(&base).await;
    }

    // OpenRouter or OpenAI-compatible
    let is_openrouter = host.contains("openrouter.ai");
    let timeout_secs = if is_openrouter { 20 } else { 15 };

    let models_url = format!("{}/models", base);
    let client = build_client(timeout_secs)?;

    let mut req = client.get(&models_url);
    if !key.is_empty() {
        if provider_id.as_deref() == Some("anthropic") || host.contains("anthropic") {
            req = req.header("x-api-key", &key);
        } else {
            req = req.bearer_auth(&key);
        }
    }

    match req.send().await {
        Ok(res) if res.status().is_success() => {
            match res.json::<serde_json::Value>().await {
                Ok(data) => {
                    let models = parse_models_response(&data, is_openrouter);
                    Ok(FetchedModelsResult { models, error: None })
                }
                Err(e) => Ok(FetchedModelsResult {
                    models: vec![],
                    error: Some(format!("invalid JSON: {}", e)),
                }),
            }
        }
        Ok(res) => Ok(FetchedModelsResult {
            models: vec![],
            error: Some(format!("HTTP {}", res.status())),
        }),
        Err(e) => Ok(FetchedModelsResult {
            models: vec![],
            error: Some(e.to_string()),
        }),
    }
}

fn parse_models_response(data: &serde_json::Value, is_openrouter: bool) -> Vec<FetchedModel> {
    let mut models = Vec::new();
    let mut seen = std::collections::HashSet::new();

    let items = if let Some(arr) = data.as_array() {
        arr.clone()
    } else if let Some(d) = data.get("data").and_then(|v| v.as_array()) {
        d.clone()
    } else if let Some(m) = data.get("models").and_then(|v| v.as_array()) {
        m.clone()
    } else {
        vec![]
    };

    for item in &items {
        let raw_id = item["id"].as_str()
            .or_else(|| item["model"].as_str())
            .or_else(|| item["name"].as_str())
            .unwrap_or("");

        let id = raw_id.replace("models/", "");
        if id.is_empty() || seen.contains(&id) {
            continue;
        }
        seen.insert(id.clone());

        let name = item["name"].as_str().filter(|n| *n != id).map(|s| s.to_string());
        let context_window = item["context_length"].as_u64()
            .or_else(|| item["max_context"].as_u64())
            .or_else(|| item["context_window"].as_u64());
        let max_tokens = item["max_output_tokens"].as_u64()
            .or_else(|| item["max_completion_tokens"].as_u64())
            .or_else(|| item["top_provider"]["max_completion_tokens"].as_u64());

        let reasoning = item["reasoning"].as_bool();
        let vision = detect_vision(item);
        let audio = detect_audio(item);

        let cost = if is_openrouter {
            item.get("pricing").map(|p| ModelCost {
                input: parse_cost(p["prompt"].as_str().unwrap_or("0"))
                    .or_else(|| parse_cost(p["input"].as_str().unwrap_or("0")))
                    .unwrap_or(0.0),
                output: parse_cost(p["completion"].as_str().unwrap_or("0"))
                    .or_else(|| parse_cost(p["output"].as_str().unwrap_or("0")))
                    .unwrap_or(0.0),
                cache_read: parse_cost(p["cache_read"].as_str().unwrap_or(""))
                        .or_else(|| parse_cost(p["cacheRead"].as_str().unwrap_or(""))),
                cache_write: parse_cost(p["cache_write"].as_str().unwrap_or(""))
                        .or_else(|| parse_cost(p["cacheWrite"].as_str().unwrap_or(""))),
            })
        } else {
            None
        };

        // Apply heuristic defaults
        let flags = heuristic_flags(&id);
        models.push(FetchedModel {
            id,
            name,
            context_window: context_window.or(flags.context_window),
            max_tokens,
            reasoning: reasoning.or(flags.reasoning),
            vision: vision.or(flags.vision),
            audio: audio.or(flags.audio),
            cost,
            source: if is_openrouter { "openrouter".to_string() } else { "openai".to_string() },
        });
    }

    models
}

async fn fetch_ollama_models(base: &url::Url) -> Result<FetchedModelsResult, String> {
    let tags_url = format!("{}/api/tags", base);
    let client = build_client(10)?;

    match client.get(&tags_url).send().await {
        Ok(res) if res.status().is_success() => {
            match res.json::<serde_json::Value>().await {
                Ok(data) => {
                    let mut models = Vec::new();
                    let items = data["models"].as_array().cloned().unwrap_or_default();

                    for item in &items {
                        let id = item["name"].as_str()
                            .or_else(|| item["model"].as_str())
                            .unwrap_or("")
                            .to_string();

                        if id.is_empty() {
                            continue;
                        }

                        let flags = heuristic_flags(&id);
                        models.push(FetchedModel {
                            id,
                            name: None,
                            context_window: flags.context_window,
                            max_tokens: None,
                            reasoning: flags.reasoning,
                            vision: flags.vision,
                            audio: flags.audio,
                            cost: None,
                            source: "ollama".to_string(),
                        });
                    }

                    Ok(FetchedModelsResult { models, error: None })
                }
                Err(e) => Ok(FetchedModelsResult {
                    models: vec![],
                    error: Some(format!("invalid JSON: {}", e)),
                }),
            }
        }
        Ok(res) => Ok(FetchedModelsResult {
            models: vec![],
            error: Some(format!("HTTP {}", res.status())),
        }),
        Err(e) => Ok(FetchedModelsResult {
            models: vec![],
            error: Some(e.to_string()),
        }),
    }
}

// ─── Helpers ────────────────────────────────────────────

fn detect_vision(item: &serde_json::Value) -> Option<bool> {
    if let Some(cap) = item.get("capabilities") {
        if let Some(v) = cap["vision"].as_bool() {
            return Some(v);
        }
    }
    if item["supports_vision"].as_bool() == Some(true) || item["vision"].as_bool() == Some(true) {
        return Some(true);
    }
    let mods = item["architecture"]["input_modalities"].as_array()
        .or_else(|| item["input_modalities"].as_array())
        .or_else(|| item["modalities"].as_array());
    if let Some(mods) = mods {
        return Some(mods.iter().any(|m| m.as_str() == Some("image")));
    }
    None
}

fn detect_audio(item: &serde_json::Value) -> Option<bool> {
    let mods = item["architecture"]["input_modalities"].as_array()
        .or_else(|| item["input_modalities"].as_array())
        .or_else(|| item["modalities"].as_array());
    if let Some(mods) = mods {
        return Some(mods.iter().any(|m| m.as_str() == Some("audio")));
    }
    None
}

fn parse_cost(s: &str) -> Option<f64> {
    if s.is_empty() {
        return None;
    }
    s.parse::<f64>().ok().map(|v| v * 1_000_000.0)
}

struct HeuristicFlags {
    reasoning: Option<bool>,
    vision: Option<bool>,
    audio: Option<bool>,
    context_window: Option<u64>,
}

fn heuristic_flags(id: &str) -> HeuristicFlags {
    let k = id.to_lowercase();

    let reasoning = Some(k.contains("r1") || k.contains("o1") || k.contains("o3")
        || k.contains("reasoner") || k.contains("reasoning") || k.contains("qwq")
        || k.contains("deepseek-r") || k.contains("think"));

    let vision = Some(k.contains("vision") || k.contains("-vl") || k.contains("multimodal")
        || k.contains("gpt-4o") || k.contains("gpt-5") || k.contains("claude")
        || k.contains("gemini") || k.contains("llama-") || k.contains("qwen")
        || k.contains("glm-"));

    let audio = Some(k.contains("audio") || k.contains("whisper") || k.contains("tts")
        || k.contains("speech"));

    let context_window = if k.contains("-1m") || k.contains("-1024k") || k.contains("-1048576") {
        Some(1_048_576)
    } else if k.contains("-256k") {
        Some(262_144)
    } else if k.contains("-128k") {
        Some(131_072)
    } else if k.contains("-64k") {
        Some(65_536)
    } else if k.contains("-32k") {
        Some(32_768)
    } else if k.contains("-16k") {
        Some(16_384)
    } else if k.contains("-8k") {
        Some(8_192)
    } else {
        None
    };

    HeuristicFlags { reasoning, vision, audio, context_window }
}
