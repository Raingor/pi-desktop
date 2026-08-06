use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, WebviewWindow};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WindowState {
    pub width: u32,
    pub height: u32,
    pub x: Option<i32>,
    pub y: Option<i32>,
}

fn state_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("window-state.json")
}

/// Save current window size and position to disk.
pub fn save_window_state(app: &AppHandle, window: &WebviewWindow) {
    if let Ok(size) = window.outer_size() {
        let pos = window.outer_position().ok();
        let state = WindowState {
            width: size.width,
            height: size.height,
            x: pos.map(|p| p.x),
            y: pos.map(|p| p.y),
        };
        if let Ok(path) = app.path().app_data_dir() {
            let _ = fs::create_dir_all(&path);
        }
        if let Ok(json) = serde_json::to_string_pretty(&state) {
            let _ = fs::write(state_path(app), json);
        }
    }
}

/// Restore window state from disk, or set to 70% of the primary monitor.
pub fn restore_window_state(app: &AppHandle, window: &WebviewWindow) {
    // Try saved state first
    let path = state_path(app);
    if path.exists() {
        if let Ok(raw) = fs::read_to_string(&path) {
            if let Ok(state) = serde_json::from_str::<WindowState>(&raw) {
                let _ = window.set_size(tauri::LogicalSize::new(state.width, state.height));
                if let (Some(x), Some(y)) = (state.x, state.y) {
                    let _ = window.set_position(tauri::LogicalPosition::new(x, y));
                } else {
                    let _ = window.center();
                }
                return;
            }
        }
    }

    // No saved state → fixed default (slightly larger than minimum)
    let _ = window.set_size(tauri::LogicalSize::new(1360, 820));
    let _ = window.center();
}