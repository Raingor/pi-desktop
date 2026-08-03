use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use crate::pi_reader::pi_path;

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct ModelCost {
    #[serde(default)]
    pub input: f64,
    #[serde(default)]
    pub output: f64,
    #[serde(default)]
    pub cache_read: f64,
    #[serde(default)]
    pub cache_write: f64,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct Model {
    pub id: String,
    pub name: Option<String>,
    pub api: Option<String>,
    pub base_url: Option<String>,
    pub reasoning: Option<bool>,
    pub input: Option<Vec<String>>,
    pub cost: Option<ModelCost>,
    pub context_window: Option<u64>,
    pub max_tokens: Option<u64>,
    pub headers: Option<HashMap<String, String>>,
    pub enabled: Option<bool>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct CustomProviderConfig {
    pub name: Option<String>,
    pub base_url: Option<String>,
    pub api: Option<String>,
    pub api_key: Option<String>,
    pub auth_header: Option<bool>,
    pub headers: Option<HashMap<String, String>>,
    pub models: Option<Vec<Model>>,
    pub compat: Option<serde_json::Value>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PiModelsJson {
    pub providers: HashMap<String, CustomProviderConfig>,
}

impl Default for PiModelsJson {
    fn default() -> Self {
        Self { providers: HashMap::new() }
    }
}

#[tauri::command]
pub fn pi_models_get() -> Result<PiModelsJson, String> {
    let path = pi_path("models.json");
    if !path.exists() {
        return Ok(PiModelsJson::default());
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("Read models.json: {}", e))?;
    serde_json::from_str(&raw).map_err(|e| format!("Parse models.json: {}", e))
}

#[tauri::command]
pub fn pi_models_set(data: PiModelsJson) -> Result<bool, String> {
    let path = pi_path("models.json");
    if path.exists() {
        fs::copy(&path, path.with_extension("json.bak")).ok();
    }
    let raw = serde_json::to_string_pretty(&data).map_err(|e| format!("Serialize models: {}", e))?;
    fs::write(&path, raw).map_err(|e| format!("Write models.json: {}", e))?;
    Ok(true)
}
