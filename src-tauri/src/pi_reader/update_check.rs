use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use crate::pi_reader::pi_dir;

// ─── Types ─────────────────────────────────────────────

#[derive(Serialize, Clone)]
pub struct UpdateItem {
    pub name: String,
    pub installed: String,
    pub latest: Option<String>,
    pub has_update: bool,
}

#[derive(Serialize, Clone)]
pub struct UpdateCheckResult {
    pub pi: Option<UpdateItem>,
    pub extensions: Vec<UpdateItem>,
    pub checked_at: i64,
}

#[derive(Serialize, Clone)]
pub struct ApplyUpdateResult {
    pub name: String,
    pub success: bool,
    pub message: Option<String>,
}

// ─── Helpers ────────────────────────────────────────────

fn npm_dir() -> PathBuf {
    pi_dir().join("npm")
}

/// Get installed pi binary version.
fn get_pi_version() -> Option<String> {
    let candidates = [
        std::env::var("PI_BINARY").ok(),
        Some("pi".to_string()),
        Some(dirs::home_dir()?.join(".npm-global/bin/pi").to_string_lossy().to_string()),
        Some(dirs::home_dir()?.join(".npm-packages/bin/pi").to_string_lossy().to_string()),
        Some(dirs::home_dir()?.join(".local/share/pnpm/pi").to_string_lossy().to_string()),
    ];

    for candidate in candidates.iter().flatten() {
        if candidate.is_empty() {
            continue;
        }
        if let Ok(output) = std::process::Command::new(candidate)
            .arg("--version")
            .output()
        {
            if output.status.success() {
                let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !version.is_empty() {
                    return Some(version);
                }
            }
        }
    }
    None
}

/// Compare two semver strings. Returns true if latest > installed.
fn is_newer_version(installed: &str, latest: &str) -> bool {
    let parse = |v: &str| -> Vec<u64> {
        v.trim_start_matches('v')
            .split('-')
            .next()
            .unwrap_or("")
            .split('.')
            .map(|s| s.parse::<u64>().unwrap_or(0))
            .collect()
    };

    let a = parse(installed);
    let b = parse(latest);
    let max_len = a.len().max(b.len());

    for i in 0..max_len {
        let ai = a.get(i).copied().unwrap_or(0);
        let bi = b.get(i).copied().unwrap_or(0);
        if bi > ai { return true; }
        if bi < ai { return false; }
    }
    false
}

/// List installed extensions from ~/.pi/agent/npm/package.json dependencies.
fn list_installed_extensions() -> Vec<(String, String)> {
    let package_path = npm_dir().join("package.json");
    if !package_path.exists() {
        return Vec::new();
    }

    let raw = match fs::read_to_string(&package_path) {
        Ok(r) => r,
        Err(_) => return Vec::new(),
    };

    let manifest: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };

    let deps = manifest["dependencies"].as_object();
    match deps {
        Some(deps) => deps
            .keys()
            .map(|name| {
                let version_path = npm_dir()
                    .join("node_modules")
                    .join(name)
                    .join("package.json");
                let version = if version_path.exists() {
                    fs::read_to_string(&version_path)
                        .ok()
                        .and_then(|r| serde_json::from_str::<serde_json::Value>(&r).ok())
                        .and_then(|v| v["version"].as_str().map(|s| s.to_string()))
                        .unwrap_or_else(|| "unknown".to_string())
                } else {
                    "unknown".to_string()
                };
                (name.clone(), version)
            })
            .collect(),
        None => Vec::new(),
    }
}

// ─── Commands ───────────────────────────────────────────

/// Check for updates (pi core + extensions) against npm registry.
/// Note: This is a synchronous version that returns installed info.
/// The actual registry check should be done async via pi_api::fetch_models pattern.
#[tauri::command]
pub fn pi_check_updates() -> Result<UpdateCheckResult, String> {
    let pi_version = get_pi_version();
    let extensions = list_installed_extensions();

    let pi_item = pi_version.map(|v| UpdateItem {
        name: "@earendil-works/pi-coding-agent".to_string(),
        installed: v,
        latest: None, // Frontend should fetch from registry
        has_update: false,
    });

    let ext_items: Vec<UpdateItem> = extensions
        .into_iter()
        .map(|(name, version)| UpdateItem {
            name,
            installed: version,
            latest: None,
            has_update: false,
        })
        .collect();

    Ok(UpdateCheckResult {
        pi: pi_item,
        extensions: ext_items,
        checked_at: chrono::Utc::now().timestamp_millis(),
    })
}

/// Apply updates: npm install <name>@latest for each extension.
#[tauri::command]
pub fn pi_apply_updates(names: Vec<String>) -> Result<Vec<ApplyUpdateResult>, String> {
    let dir = npm_dir();
    if !dir.exists() {
        return Err("npm directory not found".to_string());
    }

    // Verify names are installed
    let installed: Vec<String> = list_installed_extensions()
        .into_iter()
        .map(|(name, _)| name)
        .collect();
    let installed_set: std::collections::HashSet<String> = installed.into_iter().collect();

    let results: Vec<ApplyUpdateResult> = names
        .iter()
        .map(|name| {
            if !installed_set.contains(name) {
                return ApplyUpdateResult {
                    name: name.clone(),
                    success: false,
                    message: Some("not an installed extension".to_string()),
                };
            }

            match std::process::Command::new("npm")
                .args([
                    "install",
                    &format!("{}@latest", name),
                    "--no-audit",
                    "--no-fund",
                    "--legacy-peer-deps",
                ])
                .current_dir(&dir)
                .output()
            {
                Ok(output) => {
                    if output.status.success() {
                        ApplyUpdateResult {
                            name: name.clone(),
                            success: true,
                            message: None,
                        }
                    } else {
                        let stderr = String::from_utf8_lossy(&output.stderr);
                        let last_lines: Vec<&str> = stderr.lines().rev().take(3).collect();
                        ApplyUpdateResult {
                            name: name.clone(),
                            success: false,
                            message: Some(last_lines.join(" ")),
                        }
                    }
                }
                Err(e) => ApplyUpdateResult {
                    name: name.clone(),
                    success: false,
                    message: Some(e.to_string()),
                },
            }
        })
        .collect();

    Ok(results)
}
