use serde::{Deserialize, Serialize};
use std::io::Write;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};
use tauri::ipc::Channel;

// ─── Types ─────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
pub struct SessionInfo {
    pub id: String,
    pub path: String,
    pub cwd: String,
    pub name: Option<String>,
    pub created: String,
    pub modified: String,
    pub message_count: u32,
    pub first_message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_root: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worktree_branch: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct StartSessionOptions {
    #[serde(default)]
    pub tool_names: Option<Vec<String>>,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub model_id: Option<String>,
    #[serde(default)]
    pub thinking_level: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct StartSessionResult {
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<ModelRef>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thinking_level: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ModelRef {
    pub provider: String,
    pub model_id: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct AgentState {
    #[serde(default)]
    pub running: bool,
    #[serde(default)]
    pub state: Option<serde_json::Value>,
}

// ─── Commands ───────────────────────────────────────────

#[tauri::command]
pub async fn chat_list_sessions(
    bridge: State<'_, ChatBridgeState>,
) -> Result<Vec<SessionInfo>, String> {
    bridge.call("list_sessions", serde_json::json!({})).await
}

#[tauri::command]
pub async fn chat_get_session(
    id: String,
    bridge: State<'_, ChatBridgeState>,
) -> Result<Option<serde_json::Value>, String> {
    bridge.call("get_session", serde_json::json!({ "id": id })).await
}

#[tauri::command]
pub async fn chat_start_session(
    cwd: String,
    options: StartSessionOptions,
    bridge: State<'_, ChatBridgeState>,
) -> Result<StartSessionResult, String> {
    let opts = serde_json::json!({
        "cwd": cwd,
        "options": {
            "toolNames": options.tool_names,
            "provider": options.provider,
            "modelId": options.model_id,
            "thinkingLevel": options.thinking_level,
        }
    });
    bridge.call("start_session", opts).await
}

#[tauri::command]
pub async fn chat_send_command(
    session_id: String,
    command: serde_json::Value,
    bridge: State<'_, ChatBridgeState>,
) -> Result<serde_json::Value, String> {
    bridge.call("send_command", serde_json::json!({
        "sessionId": session_id,
        "command": command
    })).await
}

#[tauri::command]
pub async fn chat_get_state(
    session_id: String,
    bridge: State<'_, ChatBridgeState>,
) -> Result<AgentState, String> {
    bridge.call("get_state", serde_json::json!({ "sessionId": session_id })).await
}

#[tauri::command]
pub async fn chat_rename_session(
    id: String,
    name: String,
    bridge: State<'_, ChatBridgeState>,
) -> Result<bool, String> {
    bridge.call("rename_session", serde_json::json!({ "id": id, "name": name })).await
}

#[tauri::command]
pub async fn chat_delete_session(
    id: String,
    bridge: State<'_, ChatBridgeState>,
) -> Result<bool, String> {
    bridge.call("delete_session", serde_json::json!({ "id": id })).await
}

#[tauri::command]
pub async fn chat_load_models(
    cwd: String,
    bridge: State<'_, ChatBridgeState>,
) -> Result<serde_json::Value, String> {
    bridge.call("load_models", serde_json::json!({ "cwd": cwd })).await
}

#[tauri::command]
pub async fn chat_auto_name(
    id: String,
    bridge: State<'_, ChatBridgeState>,
) -> Result<String, String> {
    let result: serde_json::Value = bridge.call("auto_name", serde_json::json!({ "id": id })).await?;
    Ok(result["title"].as_str().unwrap_or("New Session").to_string())
}

// ─── SSE via Channel ────────────────────────────────────

#[tauri::command]
pub fn chat_subscribe_events(
    session_id: String,
    channel: Channel<serde_json::Value>,
    bridge: State<'_, ChatBridgeState>,
) -> Result<(), String> {
    let event_rx = Arc::clone(&bridge.inner.event_rx);
    let sid = session_id.clone();

    std::thread::spawn(move || {
        loop {
            // Use try_recv with sleep to avoid blocking the shared receiver
            let msg = {
                let rx = event_rx.lock().unwrap();
                rx.try_recv()
            };
            match msg {
                Ok(event) => {
                    if event.get("params")
                        .and_then(|p| p.get("sessionId"))
                        .and_then(|s| s.as_str())
                        .map_or(false, |s| s == sid)
                    {
                        if let Some(evt) = event.get("params").and_then(|p| p.get("event")) {
                            if channel.send(evt.clone()).is_err() {
                                break; // Channel closed
                            }
                        }
                    }
                    // Brief sleep to avoid busy-waiting
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }
                Err(std::sync::mpsc::TryRecvError::Empty) => {
                    // No message available, sleep briefly
                    std::thread::sleep(std::time::Duration::from_millis(100));
                }
                Err(std::sync::mpsc::TryRecvError::Disconnected) => break,
            }
        }
    });

    Ok(())
}

// ─── Chat Bridge State ──────────────────────────────────

pub struct ChatBridgeStateInner {
    writer: Mutex<Option<std::process::ChildStdin>>,
    event_rx: Arc<Mutex<std::sync::mpsc::Receiver<serde_json::Value>>>,
    request_id: Mutex<u64>,
}

#[derive(Clone)]
pub struct ChatBridgeState {
    inner: Arc<ChatBridgeStateInner>,
}

impl ChatBridgeState {
    pub fn new(app: &AppHandle) -> Result<Self, String> {
        // The bridge script ships under src-tauri/resources/chat-bridge.
        // In packaged builds it lands in resource_dir; in dev builds that
        // dir points at target/debug, so fall back to the source tree.
        // index.mjs is ESM so the pi SDK loads from this app's node_modules.
        let mut bridge_path = app.path().resource_dir()
            .map_err(|e| format!("Resource dir: {}", e))?
            .join("chat-bridge/index.mjs");
        if !bridge_path.exists() {
            bridge_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("resources/chat-bridge/index.mjs");
        }

        let mut child = std::process::Command::new("node")
            .arg(&bridge_path)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("Spawn chat bridge: {}", e))?;

        let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
        let (event_tx, event_rx) = std::sync::mpsc::channel::<serde_json::Value>();
        let event_rx = Arc::new(Mutex::new(event_rx));

        // Spawn stdout reader thread — forward every NDJSON line into the
        // shared channel. call() matches responses by id; the event
        // subscription thread matches method/params events. (Previously
        // responses {id,result} were filtered out, so calls always timed out.)
        std::thread::spawn(move || {
            use std::io::{BufRead, BufReader};
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                if let Ok(line) = line {
                    if let Ok(msg) = serde_json::from_str::<serde_json::Value>(&line) {
                        event_tx.send(msg).ok();
                    }
                }
            }
        });

        // Drain stderr so the child never blocks on a full pipe, and log it.
        if let Some(stderr) = child.stderr.take() {
            std::thread::spawn(move || {
                use std::io::{BufRead, BufReader};
                let reader = BufReader::new(stderr);
                for line in reader.lines() {
                    if let Ok(line) = line {
                        eprintln!("[chat-bridge] {}", line);
                    }
                }
            });
        }

        Ok(ChatBridgeState {
            inner: Arc::new(ChatBridgeStateInner {
                writer: Mutex::new(child.stdin.take()),
                event_rx,
                request_id: Mutex::new(1),
            }),
        })
    }

    pub fn inner(&self) -> &ChatBridgeStateInner {
        &self.inner
    }

    pub async fn call<T: serde::de::DeserializeOwned>(
        &self,
        method: &str,
        params: serde_json::Value,
    ) -> Result<T, String> {
        let id = {
            let mut id = self.inner.request_id.lock().map_err(|e| e.to_string())?;
            let current = *id;
            *id += 1;
            current
        };

        let request = serde_json::json!({ "id": id, "method": method, "params": params });

        // Write request
        {
            let mut writer = self.inner.writer.lock().map_err(|e| e.to_string())?;
            if let Some(ref mut stdin) = *writer {
                let line = format!("{}\n", request);
                if let Err(e) = stdin.write_all(line.as_bytes()).and_then(|_| stdin.flush()) {
                    // The bridge process has exited — drop the writer so later
                    // calls fail fast with a clear message instead of EPIPE.
                    *writer = None;
                    return Err(format!("Chat bridge unavailable: {}", e));
                }
            } else {
                return Err("Chat bridge unavailable: process exited".to_string());
            }
        }

        // Wait for response with matching id (with timeout)
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while std::time::Instant::now() < deadline {
            // Brief lock to check for message, then release immediately
            let msg = {
                let rx = self.inner.event_rx.lock().map_err(|e| e.to_string())?;
                rx.try_recv()
            };
            match msg {
                Ok(msg) => {
                    if msg.get("id").and_then(|v| v.as_u64()) == Some(id) {
                        if let Some(err) = msg.get("error") {
                            return Err(err.as_str().unwrap_or("Unknown error").to_string());
                        }
                        if let Some(result) = msg.get("result") {
                            return serde_json::from_value(result.clone())
                                .map_err(|e| format!("Deserialize result: {}", e));
                        }
                    }
                    // Not our response, continue polling
                }
                Err(std::sync::mpsc::TryRecvError::Empty) => {
                    // No message yet, yield and retry
                    tokio::time::sleep(std::time::Duration::from_millis(20)).await;
                }
                Err(std::sync::mpsc::TryRecvError::Disconnected) => {
                    return Err("Event channel closed".to_string());
                }
            }
        }

        Err("Request timeout".to_string())
    }
}
