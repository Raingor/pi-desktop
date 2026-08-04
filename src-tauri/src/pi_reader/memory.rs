use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use crate::pi_reader::pi_dir;

// ─── Types ─────────────────────────────────────────────

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MemoryFile {
    pub name: String,
    pub filename: String,
    pub content: String,
    pub updated_at: String,
}

// ─── Helpers ────────────────────────────────────────────

fn hermes_dir() -> PathBuf {
    pi_dir().join("pi-hermes-memory")
}

// ─── Commands ───────────────────────────────────────────

const MEMORY_FILES: &[(&str, &str)] = &[
    ("Project Memories", "MEMORY.md"),
    ("User Profile", "USER.md"),
    ("Failure Records", "failures.md"),
];

#[tauri::command]
pub fn pi_memory_get() -> Result<Vec<MemoryFile>, String> {
    let hdir = hermes_dir();
    let mut result = Vec::new();

    for (name, filename) in MEMORY_FILES {
        let file_path = hdir.join(filename);
        let content = if file_path.exists() {
            fs::read_to_string(&file_path).unwrap_or_else(|_| "// Error reading file".to_string())
        } else {
            String::new()
        };

        let updated_at = fs::metadata(&file_path)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| chrono::DateTime::from_timestamp(d.as_secs() as i64, 0).map(|dt| dt.to_rfc3339()))
            .flatten()
            .unwrap_or_default();

        result.push(MemoryFile {
            name: name.to_string(),
            filename: filename.to_string(),
            content,
            updated_at,
        });
    }

    Ok(result)
}

#[tauri::command]
pub fn pi_memory_delete_entry(filename: String, text: String) -> Result<bool, String> {
    // Validate filename
    let valid = ["MEMORY.md", "USER.md", "failures.md"];
    if !valid.contains(&filename.as_str()) {
        return Err("Invalid memory filename".to_string());
    }

    let file_path = hermes_dir().join(&filename);
    if !file_path.exists() {
        return Err("File not found".to_string());
    }

    let content = fs::read_to_string(&file_path).map_err(|e| e.to_string())?;
    let sections: Vec<&str> = content.split('§').collect();
    let target = text.trim();

    // Find section whose trimmed content (minus trailing comment) matches
    let idx = sections.iter().position(|s| {
        let cleaned = strip_section_comment(s);
        !cleaned.is_empty() && cleaned == target
    });

    match idx {
        Some(i) => {
            let mut new_sections = sections.clone();
            new_sections.remove(i);
            let new_content = new_sections.join("§");
            fs::write(&file_path, new_content).map_err(|e| e.to_string())?;
            Ok(true)
        }
        None => Err("Entry not found".to_string()),
    }
}

/// Strip the trailing `<!-- created=..., last=... -->` marker from a section.
fn strip_section_comment(section: &str) -> String {
    if let Some(pos) = section.rfind("<!--") {
        section[..pos].trim().to_string()
    } else {
        section.trim().to_string()
    }
}
