use serde::{Deserialize, Serialize};
use std::fs;
use crate::pi_reader::pi_path;

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
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
    pub default_project_trust: Option<String>,
    #[serde(default)]
    pub theme: Option<String>,
    #[serde(default)]
    pub hide_thinking_block: Option<bool>,
    #[serde(default)]
    pub retry: Option<RetryConfig>,
    #[serde(default)]
    pub packages: Option<Vec<String>>,
    #[serde(default)]
    pub terminal: Option<TerminalConfig>,
    #[serde(default)]
    pub warnings: Option<serde_json::Value>,
    #[serde(default)]
    pub tree_filter_mode: Option<String>,
    #[serde(default)]
    pub double_escape_action: Option<String>,
    #[serde(default)]
    pub enabled_models: Option<Vec<String>>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct RetryConfig {
    #[serde(default)]
    pub enabled: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct TerminalConfig {
    #[serde(default)]
    pub show_terminal_progress: Option<bool>,
}

#[tauri::command]
pub fn pi_settings_get() -> Result<PiSettings, String> {
    let path = pi_path("settings.json");
    if !path.exists() {
        return Ok(PiSettings::default());
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("Read settings.json: {}", e))?;
    serde_json::from_str(&raw).map_err(|e| format!("Parse settings.json: {}", e))
}

#[tauri::command]
pub fn pi_settings_set(data: PiSettings) -> Result<bool, String> {
    let path = pi_path("settings.json");
    if path.exists() {
        let backup = path.with_extension("json.bak");
        fs::copy(&path, &backup).ok();
    }
    let raw = serde_json::to_string_pretty(&data).map_err(|e| format!("Serialize settings: {}", e))?;
    fs::write(&path, raw).map_err(|e| format!("Write settings.json: {}", e))?;
    Ok(true)
}
