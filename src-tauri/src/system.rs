use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use dirs::home_dir;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub is_directory: bool,
    pub path: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    pub path: String,
    pub content: String,
    pub size: u64,
    pub modified: String,
}

/// Get the user's home directory.
#[tauri::command]
pub fn system_get_home_dir() -> String {
    home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default()
}

/// List directory contents (excluding hidden files).
#[tauri::command]
pub fn fs_list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let dir_path = PathBuf::from(&path);
    if !dir_path.exists() {
        return Err("Directory not found".to_string());
    }
    if !dir_path.is_dir() {
        return Err("Not a directory".to_string());
    }

    let mut entries = Vec::new();
    let read_dir = fs::read_dir(&dir_path).map_err(|e| format!("Read dir: {}", e))?;

    for entry in read_dir.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue; // Skip hidden files
        }

        let is_dir = entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false);
        let entry_path = entry.path().to_string_lossy().to_string();

        entries.push(DirEntry {
            name,
            is_directory: is_dir,
            path: entry_path,
        });
    }

    // Sort: directories first, then alphabetically
    entries.sort_by(|a, b| {
        match (a.is_directory, b.is_directory) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.cmp(&b.name),
        }
    });

    Ok(entries)
}

/// Validate a directory path and return the canonical path.
#[tauri::command]
pub fn fs_validate_dir(path: String) -> Result<String, String> {
    let dir_path = PathBuf::from(&path);
    if !dir_path.exists() {
        return Err(format!("Directory does not exist: {}", path));
    }
    if !dir_path.is_dir() {
        return Err(format!("Not a directory: {}", path));
    }
    let canonical = fs::canonicalize(&dir_path).map_err(|e| format!("Canonicalize: {}", e))?;
    Ok(canonical.to_string_lossy().to_string())
}

/// Read a text file's content.
#[tauri::command]
pub fn fs_read_file(path: String) -> Result<FileContent, String> {
    let file_path = PathBuf::from(&path);
    if !file_path.exists() {
        return Err("File not found".to_string());
    }

    let content = fs::read_to_string(&file_path).map_err(|e| format!("Read file: {}", e))?;
    let metadata = fs::metadata(&file_path).map_err(|e| format!("Metadata: {}", e))?;
    let modified = metadata.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| chrono::DateTime::from_timestamp(d.as_secs() as i64, 0).map(|dt| dt.to_rfc3339()))
        .flatten()
        .unwrap_or_default();

    Ok(FileContent {
        path,
        content,
        size: metadata.len(),
        modified,
    })
}
