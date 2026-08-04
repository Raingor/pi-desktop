use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use std::time::Instant;
use crate::pi_reader::pi_dir;

// ─── Types ─────────────────────────────────────────────

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CatalogModel {
    pub id: String,
    pub name: Option<String>,
    pub reasoning: Option<bool>,
    pub input: Option<Vec<String>>,
    pub context_window: Option<u64>,
    pub max_tokens: Option<u64>,
    pub cost: Option<ModelCost>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelCost {
    pub input: f64,
    pub output: f64,
    pub cache_read: f64,
    pub cache_write: f64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CatalogProvider {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub provider_type: String,
    pub api: Option<String>,
    pub base_url: Option<String>,
    pub has_auth: bool,
    pub auth_method: String,
    pub models: Vec<CatalogModel>,
}

// ─── Cache ──────────────────────────────────────────────

use std::sync::Mutex;

lazy_static::lazy_static! {
    static ref CATALOG_CACHE: Mutex<Option<(Vec<CatalogProvider>, Instant)>> = Mutex::new(None);
}

// ─── Helpers ────────────────────────────────────────────

fn pi_core_package() -> String {
    "@earendil-works/pi-coding-agent".to_string()
}

/// Find the @earendil-works/pi-ai/dist/providers directory from the active pi install.
fn find_pi_ai_providers_dir() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let mut roots: Vec<PathBuf> = Vec::new();

    // Try to resolve pi binary symlink
    if let Ok(output) = std::process::Command::new("which").arg("pi").output() {
        if output.status.success() {
            let bin = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !bin.is_empty() {
                if let Ok(real) = std::process::Command::new("readlink")
                    .arg("-f")
                    .arg(&bin)
                    .output()
                {
                    if real.status.success() {
                        let cli = String::from_utf8_lossy(&real.stdout).trim().to_string();
                        if !cli.is_empty() {
                            // cli = .../pi-coding-agent/dist/cli.js → package root is ..
                            if let Some(parent) = PathBuf::from(&cli).parent() {
                                if let Some(pkg_root) = parent.parent() {
                                    roots.push(pkg_root.to_path_buf());
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Known install locations as fallback
    let pi_node = home.join(".local/share/pi-node");
    if let Ok(entries) = fs::read_dir(&pi_node) {
        for entry in entries.flatten() {
            let pi_ai_path = entry
                .path()
                .join("lib/node_modules")
                .join(pi_core_package());
            roots.push(pi_ai_path);
        }
    }

    for root in &roots {
        let dir = root
            .join("node_modules/@earendil-works/pi-ai/dist/providers");
        if dir.join("data").exists() {
            return Some(dir);
        }
    }

    None
}

/// Read provider display name from dist/providers/<id>.js source.
fn read_provider_name(dir: &PathBuf, id: &str) -> String {
    let js_path = dir.join(format!("{}.js", id));
    if let Ok(src) = fs::read_to_string(&js_path) {
        // Try: id: "openai", name: "OpenAI"
        let pattern = format!(r#"id:\s*"{}",\s*name:\s*"([^"]+)""#, regex::escape(id));
        if let Ok(re) = regex::Regex::new(&pattern) {
            if let Some(cap) = re.captures(&src) {
                if let Some(m) = cap.get(1) {
                    return m.as_str().to_string();
                }
            }
        }
        // Fallback: createProvider({ name: "..." })
        if let Ok(re) = regex::Regex::new(r#"createProvider\(\{[^}]*?name:\s*"([^"]+)""#) {
            if let Some(cap) = re.captures(&src) {
                if let Some(m) = cap.get(1) {
                    return m.as_str().to_string();
                }
            }
        }
    }

    // Derive from id: "openai" → "Openai"
    id.split('-')
        .map(|s| {
            let mut c = s.chars();
            match c.next() {
                None => String::new(),
                Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

// ─── Command ────────────────────────────────────────────

#[tauri::command]
pub fn pi_builtin_catalog_get() -> Result<Option<Vec<CatalogProvider>>, String> {
    // Check cache (5 minutes)
    {
        let cache = CATALOG_CACHE.lock().map_err(|e| e.to_string())?;
        if let Some((ref providers, ref at)) = *cache {
            if at.elapsed() < std::time::Duration::from_secs(300) {
                return Ok(Some(providers.clone()));
            }
        }
    }

    let dir = match find_pi_ai_providers_dir() {
        Some(d) => d,
        None => return Ok(None),
    };

    let data_dir = dir.join("data");
    let mut providers = Vec::new();

    let entries = match fs::read_dir(&data_dir) {
        Ok(e) => e,
        Err(_) => return Ok(None),
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.extension().map_or(false, |e| e == "json") {
            continue;
        }
        if path.file_name().map_or(false, |n| n.to_string_lossy().starts_with('.')) {
            continue;
        }

        let id = path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();

        let raw = match fs::read_to_string(&path) {
            Ok(r) => r,
            Err(_) => continue,
        };

        let data: serde_json::Value = match serde_json::from_str(&raw) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let mut models = Vec::new();
        let mut base_url: Option<String> = None;
        let mut api: Option<String> = None;

        // data is Record<apiKey, Record<modelId, modelData>>
        if let Some(obj) = data.as_object() {
            for (_, api_models) in obj {
                if let Some(api_obj) = api_models.as_object() {
                    for (_, model_data) in api_obj {
                        let model_id = model_data["id"].as_str().unwrap_or("").to_string();
                        if model_id.is_empty() {
                            continue;
                        }

                        base_url = base_url.or_else(|| {
                            model_data["baseUrl"].as_str().map(|s| s.to_string())
                        });
                        api = api.or_else(|| {
                            model_data["api"].as_str().map(|s| s.to_string())
                        });

                        models.push(CatalogModel {
                            id: model_id,
                            name: model_data["name"].as_str().map(|s| s.to_string()),
                            reasoning: model_data["reasoning"].as_bool(),
                            input: model_data["input"].as_array().map(|arr| {
                                arr.iter()
                                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                                    .collect()
                            }),
                            context_window: model_data["contextWindow"].as_u64(),
                            max_tokens: model_data["maxTokens"].as_u64(),
                            cost: model_data["cost"].as_object().map(|c| ModelCost {
                                input: c["input"].as_f64().unwrap_or(0.0),
                                output: c["output"].as_f64().unwrap_or(0.0),
                                cache_read: c["cacheRead"].as_f64().unwrap_or(0.0),
                                cache_write: c["cacheWrite"].as_f64().unwrap_or(0.0),
                            }),
                        });
                    }
                }
            }
        }

        if models.is_empty() {
            continue;
        }

        models.sort_by(|a, b| a.id.cmp(&b.id));
        let name = read_provider_name(&dir, &id);

        providers.push(CatalogProvider {
            id,
            name,
            provider_type: "builtin".to_string(),
            api,
            base_url,
            has_auth: false,
            auth_method: "env".to_string(),
            models,
        });
    }

    if providers.is_empty() {
        return Ok(None);
    }

    providers.sort_by(|a, b| a.id.cmp(&b.id));

    // Update cache
    {
        let mut cache = CATALOG_CACHE.lock().map_err(|e| e.to_string())?;
        *cache = Some((providers.clone(), Instant::now()));
    }

    Ok(Some(providers))
}
