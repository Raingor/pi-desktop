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
        // Clamp the persisted size to the current monitor so a transient
        // oversized window (e.g. macOS quirk during multi-monitor moves)
        // can't poison the saved state and reintroduce the bottom-controls-off-screen bug.
        let max = window
            .current_monitor()
            .ok()
            .flatten()
            .and_then(|m| Some(m.size().to_logical(window.scale_factor().unwrap_or(1.0))));
        let clamped_w = max.map(|s| size.width.min(s.width)).unwrap_or(size.width);
        let clamped_h = max.map(|s| size.height.min(s.height)).unwrap_or(size.height);
        let pos = window.outer_position().ok();
        let state = WindowState {
            width: clamped_w,
            height: clamped_h,
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
    // Current screen bounds — clamp saved size so a corrupt/too-large saved
    // state (e.g. physical-pixel values leaking into LogicalSize) can never
    // push the bottom of the window off-screen.
    let max_size = window
        .current_monitor()
        .ok()
        .flatten()
        .and_then(|m| Some(m.size().to_logical(window.scale_factor().unwrap_or(1.0))))
        .unwrap_or(tauri::LogicalSize::new(1360, 820));

    // Try saved state first
    let path = state_path(app);
    if path.exists() {
        if let Ok(raw) = fs::read_to_string(&path) {
            if let Ok(state) = serde_json::from_str::<WindowState>(&raw) {
                // If the saved size is larger than the current monitor, it is
                // corrupt/unusable (physical-pixel values leaking into
                // LogicalSize, or a multi-monitor quirk) — fall back to the
                // default size instead of clamping to a full-screen window.
                let fits = state.width <= max_size.width && state.height <= max_size.height;
                if fits {
                    let w = state.width.max(800);
                    let h = state.height.max(600);
                    let _ = window.set_size(tauri::LogicalSize::new(w, h));
                    if let (Some(x), Some(y)) = (state.x, state.y) {
                        let _ = window.set_position(tauri::LogicalPosition::new(x, y));
                    } else {
                        let _ = window.center();
                    }
                    return;
                }
            }
        }
    }

    // No saved state (or it doesn't fit the screen) → fixed default size
    let _ = window.set_size(tauri::LogicalSize::new(1360, 820));
    let _ = window.center();
}