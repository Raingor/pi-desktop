use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use crate::pi_reader::pi_path;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ProviderAuth {
    #[serde(rename = "type")]
    pub auth_type: String,
    pub key: Option<String>,
    pub env: Option<HashMap<String, String>>,
}

pub type PiAuth = HashMap<String, ProviderAuth>;

#[tauri::command]
pub fn pi_auth_get() -> Result<PiAuth, String> {
    let path = pi_path("auth.json");
    if !path.exists() {
        return Ok(HashMap::new());
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("Read auth.json: {}", e))?;
    serde_json::from_str(&raw).map_err(|e| format!("Parse auth.json: {}", e))
}

#[tauri::command]
pub fn pi_auth_set(data: PiAuth) -> Result<bool, String> {
    let path = pi_path("auth.json");
    if path.exists() {
        fs::copy(&path, path.with_extension("json.bak")).ok();
    }
    let raw = serde_json::to_string_pretty(&data).map_err(|e| format!("Serialize auth: {}", e))?;
    fs::write(&path, raw).map_err(|e| format!("Write auth.json: {}", e))?;
    Ok(true)
}
