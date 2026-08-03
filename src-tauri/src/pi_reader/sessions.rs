use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;
use crate::pi_reader::pi_dir;

// ─── Types ─────────────────────────────────────────────

#[derive(Serialize, Clone)]
pub struct SessionFileInfo {
    pub id: String,
    pub file_name: String,
    pub file_path: String,
    pub timestamp: String,
    pub last_active: String,
    pub name: Option<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub message_count: u64,
    pub duration: Option<i64>,
}

#[derive(Serialize, Clone)]
pub struct ProjectGroup {
    pub project_path: String,
    pub project_name: String,
    pub sessions: Vec<SessionFileInfo>,
    pub total_sessions: usize,
    pub last_active: String,
}

#[derive(Serialize, Clone)]
pub struct TrashEntry {
    pub trash_path: String,
    pub original_path: String,
    pub file_name: String,
    pub trashed_at: String,
    pub session_id: String,
    pub session_name: String,
    pub last_active: String,
    pub message_count: u64,
}

#[derive(Serialize, Clone)]
pub struct SessionPreviewMessage {
    pub role: String,
    pub text: String,
    pub timestamp: String,
}

#[derive(Serialize, Clone)]
pub struct SessionPreview {
    pub messages: Vec<SessionPreviewMessage>,
    pub total: usize,
}

// ─── Path Helpers ───────────────────────────────────────

fn sessions_dir() -> PathBuf {
    pi_dir().join("sessions")
}

fn trash_dir() -> PathBuf {
    pi_dir().join(".trash")
}

/// Validate that a path is within the sessions directory.
fn assert_in_sessions(path: &str) -> Result<(), String> {
    let canonical = fs::canonicalize(path).map_err(|e| format!("Invalid path: {}", e))?;
    let sessions = fs::canonicalize(sessions_dir()).map_err(|e| format!("Sessions dir: {}", e))?;
    if !canonical.starts_with(&sessions) {
        return Err("Path is outside sessions directory".to_string());
    }
    if !canonical.extension().map_or(false, |e| e == "jsonl") {
        return Err("Only .jsonl files can be deleted".to_string());
    }
    Ok(())
}

/// Validate that a path is within the trash directory.
fn assert_in_trash(path: &str) -> Result<(), String> {
    let canonical = fs::canonicalize(path).map_err(|e| format!("Invalid path: {}", e))?;
    let trash = fs::canonicalize(trash_dir()).map_err(|e| format!("Trash dir: {}", e))?;
    if !canonical.starts_with(&trash) {
        return Err("Path is outside trash directory".to_string());
    }
    Ok(())
}

// ─── Session Listing ────────────────────────────────────

fn decode_project_name(dir_name: &str) -> (String, String) {
    // "--Users-foo--workspace--project--" → "/Users/foo/workspace/project"
    let trimmed = dir_name.trim_start_matches("--").trim_end_matches("--");
    let decoded = trimmed.replace("--", "/");

    let home = dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    let display_name = if decoded.starts_with(&home) {
        format!("~{}", &decoded[home.len()..])
    } else {
        decoded.clone()
    };

    let segments: Vec<&str> = display_name.split('/').filter(|s| !s.is_empty()).collect();
    let project_name = segments.last().unwrap_or(&"unknown").to_string();

    (decoded, project_name)
}

fn parse_session_file_info(path: &Path) -> Option<SessionFileInfo> {
    let file = fs::File::open(path).ok()?;
    let reader = BufReader::new(file);

    let mut id = String::new();
    let mut timestamp = String::new();
    let mut name: Option<String> = None;
    let mut provider: Option<String> = Some("unknown".to_string());
    let mut model: Option<String> = Some("unknown".to_string());
    let mut message_count: u64 = 0;
    let mut first_ts: i64 = 0;
    let mut last_ts: i64 = 0;

    for line in reader.lines() {
        let line = match line {
            Ok(l) if !l.trim().is_empty() => l,
            _ => continue,
        };

        let obj: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let event_type = obj["type"].as_str().unwrap_or("");

        match event_type {
            "session" => {
                id = obj["id"].as_str().unwrap_or("").to_string();
                timestamp = obj["timestamp"].as_str().unwrap_or("").to_string();
                if let Ok(ts) = chrono::DateTime::parse_from_rfc3339(&timestamp) {
                    first_ts = ts.timestamp_millis();
                    last_ts = first_ts;
                }
            }
            "session_info" => {
                if let Some(n) = obj["name"].as_str() {
                    name = Some(n.to_string());
                }
            }
            "model_change" => {
                if let Some(p) = obj["provider"].as_str() {
                    provider = Some(p.to_string());
                }
                if let Some(m) = obj["model_id"].as_str() {
                    model = Some(m.to_string());
                }
            }
            "message" => {
                message_count += 1;
                if let Some(ts_str) = obj["timestamp"].as_str() {
                    if let Ok(ts) = chrono::DateTime::parse_from_rfc3339(ts_str) {
                        let ms = ts.timestamp_millis();
                        if ms > last_ts { last_ts = ms; }
                        if first_ts == 0 { first_ts = ms; }
                    }
                }
            }
            _ => {}
        }
    }

    let duration = if last_ts > first_ts { Some(last_ts - first_ts) } else { None };
    let last_active = if last_ts > 0 {
        chrono::DateTime::from_timestamp_millis(last_ts)
            .map(|dt| dt.to_rfc3339())
            .unwrap_or(timestamp.clone())
    } else {
        timestamp.clone()
    };

    let file_name = path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    Some(SessionFileInfo {
        id,
        file_name,
        file_path: path.to_string_lossy().to_string(),
        timestamp,
        last_active,
        name,
        provider,
        model,
        message_count,
        duration,
    })
}

#[tauri::command]
pub fn pi_sessions_list() -> Result<Vec<ProjectGroup>, String> {
    let sdir = sessions_dir();
    if !sdir.exists() {
        return Ok(Vec::new());
    }

    let mut groups: HashMap<String, ProjectGroup> = HashMap::new();

    for entry in WalkDir::new(&sdir)
        .min_depth(1)
        .max_depth(1)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_dir())
    {
        let dir_name = entry.file_name().to_string_lossy();
        if !dir_name.starts_with("--") {
            continue;
        }

        let (project_path, project_name) = decode_project_name(&dir_name);

        let mut sessions = Vec::new();

        for file_entry in WalkDir::new(entry.path())
            .max_depth(1)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file() && e.path().extension().map_or(false, |ext| ext == "jsonl"))
        {
            if let Some(info) = parse_session_file_info(file_entry.path()) {
                sessions.push(info);
            }
        }

        sessions.sort_by(|a, b| b.last_active.cmp(&a.last_active));

        if !sessions.is_empty() {
            let last_active = sessions[0].last_active.clone();
            groups.insert(project_path.clone(), ProjectGroup {
                project_path,
                project_name,
                total_sessions: sessions.len(),
                sessions,
                last_active,
            });
        }
    }

    let mut result: Vec<_> = groups.into_values().collect();
    result.sort_by(|a, b| b.last_active.cmp(&a.last_active));
    Ok(result)
}

// ─── Trash Operations ───────────────────────────────────

#[tauri::command]
pub fn pi_session_trash(path: String) -> Result<bool, String> {
    assert_in_sessions(&path)?;

    let sessions = sessions_dir();
    let canonical = fs::canonicalize(&path).map_err(|e| e.to_string())?;
    let relative = canonical.strip_prefix(&sessions).map_err(|e| e.to_string())?;

    let trash_path = trash_dir().join(relative);
    if let Some(parent) = trash_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::rename(&canonical, &trash_path).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub fn pi_session_restore(trash_path: String) -> Result<bool, String> {
    assert_in_trash(&trash_path)?;

    let trash = trash_dir();
    let canonical = fs::canonicalize(&trash_path).map_err(|e| e.to_string())?;
    let relative = canonical.strip_prefix(&trash).map_err(|e| e.to_string())?;

    let original = sessions_dir().join(relative);
    if let Some(parent) = original.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::rename(&canonical, &original).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub fn pi_session_delete_permanent(path: String) -> Result<bool, String> {
    assert_in_trash(&path)?;
    let canonical = fs::canonicalize(&path).map_err(|e| e.to_string())?;
    fs::remove_file(&canonical).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub fn pi_trash_list() -> Result<Vec<TrashEntry>, String> {
    let tdir = trash_dir();
    if !tdir.exists() {
        return Ok(Vec::new());
    }

    let mut entries = Vec::new();
    let trash = fs::canonicalize(&tdir).map_err(|e| e.to_string())?;

    for entry in WalkDir::new(&trash)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file() && e.path().extension().map_or(false, |ext| ext == "jsonl"))
    {
        let trash_path = entry.path();
        let info = parse_session_file_info(trash_path);

        let trashed_at = fs::metadata(trash_path)
            .and_then(|m| m.created().or_else(|_| m.modified()))
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| chrono::DateTime::from_timestamp(d.as_secs() as i64, 0).map(|dt| dt.to_rfc3339()))
            .flatten()
            .unwrap_or_default();

        let relative = trash_path.strip_prefix(&trash).unwrap_or(trash_path);
        let original_path = sessions_dir().join(relative);

        entries.push(TrashEntry {
            trash_path: trash_path.to_string_lossy().to_string(),
            original_path: original_path.to_string_lossy().to_string(),
            file_name: entry.file_name().to_string_lossy().to_string(),
            trashed_at,
            session_id: info.as_ref().map(|i| i.id.clone()).unwrap_or_default(),
            session_name: info.as_ref().and_then(|i| i.name.clone()).unwrap_or_default(),
            last_active: info.as_ref().map(|i| i.last_active.clone()).unwrap_or_default(),
            message_count: info.as_ref().map(|i| i.message_count).unwrap_or(0),
        });
    }

    entries.sort_by(|a, b| b.trashed_at.cmp(&a.trashed_at));
    Ok(entries)
}

// ─── Session Preview ────────────────────────────────────

#[tauri::command]
pub fn pi_session_preview(path: String) -> Result<SessionPreview, String> {
    let canonical = fs::canonicalize(&path).map_err(|e| e.to_string())?;

    let in_sessions = canonical.starts_with(fs::canonicalize(sessions_dir()).unwrap_or_default());
    let in_trash = canonical.starts_with(fs::canonicalize(trash_dir()).unwrap_or_default());

    if !in_sessions && !in_trash {
        return Err("Path is not in sessions or trash".to_string());
    }
    if !canonical.extension().map_or(false, |e| e == "jsonl") {
        return Err("Not a .jsonl file".to_string());
    }

    let file = fs::File::open(&canonical).map_err(|e| e.to_string())?;
    let reader = BufReader::new(file);

    let mut messages = Vec::new();
    let mut total: usize = 0;
    let limit = 20;

    for line in reader.lines() {
        let line = match line {
            Ok(l) if !l.trim().is_empty() => l,
            _ => continue,
        };

        let obj: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        if obj["type"].as_str() != Some("message") {
            continue;
        }

        let message = match obj.get("message") {
            Some(m) => m,
            None => continue,
        };

        let role = message["role"].as_str().unwrap_or("");
        if role != "user" && role != "assistant" {
            continue;
        }

        total += 1;
        if messages.len() >= limit {
            continue;
        }

        let text = extract_message_text(message);
        let text = if text.len() > 400 {
            format!("{}…", &text[..400])
        } else {
            text
        };

        messages.push(SessionPreviewMessage {
            role: role.to_string(),
            text,
            timestamp: obj["timestamp"].as_str().unwrap_or("").to_string(),
        });
    }

    Ok(SessionPreview { messages, total })
}

fn extract_message_text(message: &serde_json::Value) -> String {
    let content = &message["content"];

    if let Some(s) = content.as_str() {
        return s.to_string();
    }

    if let Some(arr) = content.as_array() {
        let text_parts: Vec<String> = arr.iter()
            .filter_map(|block| {
                if block["type"].as_str() == Some("text") {
                    block["text"].as_str().map(|s| s.to_string())
                } else {
                    None
                }
            })
            .collect();

        if !text_parts.is_empty() {
            return text_parts.join("\n");
        }

        // Check for tool calls
        let tool_count = arr.iter()
            .filter(|b| b["type"].as_str() == Some("toolCall"))
            .count();

        if tool_count > 0 {
            return format!("[{} tool call{}]", tool_count, if tool_count > 1 { "s" } else { "" });
        }
    }

    String::new()
}
