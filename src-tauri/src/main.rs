// pi-desktop Tauri 2.0 — main entry point
// Commands registered incrementally across phases.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use pi_desktop_lib::pi_reader;
use pi_desktop_lib::pi_api;
use pi_desktop_lib::chat_agent;
use pi_desktop_lib::system;
use pi_desktop_lib::window_state;
use tauri::{Manager, Emitter};

// NOTE: dbg_log removed after diagnosis.

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            // Phase 1: pi_reader — file I/O commands
            pi_reader::settings::pi_settings_get,
            pi_reader::settings::pi_settings_set,
            pi_reader::auth::pi_auth_get,
            pi_reader::auth::pi_auth_set,
            pi_reader::models::pi_models_get,
            pi_reader::models::pi_models_set,
            pi_reader::usage::pi_usage_get,
            pi_reader::usage::pi_usage_range_get,
            pi_reader::sessions::pi_sessions_list,
            pi_reader::sessions::pi_session_trash,
            pi_reader::sessions::pi_session_restore,
            pi_reader::sessions::pi_session_delete_permanent,
            pi_reader::sessions::pi_trash_list,
            pi_reader::sessions::pi_session_preview,
            pi_reader::memory::pi_memory_get,
            pi_reader::memory::pi_memory_delete_entry,
            // Phase 2: pi_api — HTTP proxy commands
            pi_api::provider_test::pi_test_provider,
            pi_api::provider_test::pi_test_model,
            pi_api::fetch_models::pi_fetch_provider_models,
            // Phase 3: chat_agent — session management via Node bridge
            chat_agent::session::chat_list_sessions,
            chat_agent::session::chat_get_session,
            chat_agent::session::chat_start_session,
            chat_agent::session::chat_send_command,
            chat_agent::session::chat_get_state,
            chat_agent::session::chat_rename_session,
            chat_agent::session::chat_delete_session,
            chat_agent::session::chat_load_models,
            chat_agent::session::chat_auto_name,
            chat_agent::session::chat_subscribe_events,
            // System commands
            system::system_get_home_dir,
            system::fs_list_dir,
            system::fs_validate_dir,
            system::fs_read_file,
            // Phase 5: Subagents, updates, builtin catalog
            pi_reader::subagents::pi_subagents_get,
            pi_reader::update_check::pi_check_updates,
            pi_reader::update_check::pi_apply_updates,
            pi_reader::builtin_catalog::pi_builtin_catalog_get,
        ])
        .setup(|app| {
            // Initialize chat bridge (Node.js child process)
            let bridge_state = chat_agent::session::ChatBridgeState::new(app.handle())
                .map_err(|e| format!("Failed to start chat bridge: {}", e))?;
            app.handle().manage(bridge_state);

            // Start file watcher for ~/.pi/agent/
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                use notify::{Watcher, RecursiveMode, Config};
                use std::sync::mpsc::channel;
                use std::time::Duration;

                let (tx, rx) = channel();
                let mut watcher = match notify::recommended_watcher(tx) {
                    Ok(w) => w,
                    Err(_) => return,
                };

                let pi_dir = dirs::home_dir()
                    .unwrap_or_default()
                    .join(".pi/agent");

                if watcher.watch(&pi_dir, RecursiveMode::Recursive).is_ok() {
                    let mut last_notify = std::time::Instant::now();
                    while let Ok(_event) = rx.recv() {
                        // Debounce: max 1 notification per second
                        let now = std::time::Instant::now();
                        if now.duration_since(last_notify) > Duration::from_secs(1) {
                            last_notify = now;
                            app_handle.emit("pi-files-changed", ()).ok();
                        }
                    }
                }
            });

            // Restore window size/position from saved state, or 70% of screen
            if let Some(window) = app.get_webview_window("main") {
                window_state::restore_window_state(app.handle(), &window);

                // Save window state on resize/move (debounced via the window event)
                let app_for_save = app.handle().clone();
                window.on_window_event(move |event| {
                    use tauri::WindowEvent;
                    match event {
                        WindowEvent::Resized(_) | WindowEvent::Moved(_) => {
                            if let Some(w) = app_for_save.get_webview_window("main") {
                                window_state::save_window_state(&app_for_save, &w);
                            }
                        }
                        _ => {}
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
