use serde::{Deserialize, Serialize};
use std::io::Write;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri::ipc::Channel;

// ─── Types ─────────────────────────────────────────────
// Wire format matches the bridge output (camelCase) in both directions.

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
pub struct ListSessionsResult {
    pub sessions: Vec<SessionInfo>,
    #[serde(default)]
    pub running_session_ids: Vec<String>,
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
) -> Result<ListSessionsResult, String> {
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

// ─── Events ────────────────────────────────────────────
//
// The stdout reader thread (in new()) is the SINGLE consumer of the
// bridge output. It routes each NDJSON line:
//   · {id, result|error}  → the pending request channel for that id
//   · {method, params}    → emitted as a Tauri app event "pi-agent-event"
//     (thread-safe; the frontend listens via `listen` and filters by
//     params.sessionId). This replaces the earlier shared-receiver /
//     Channel-from-thread designs that dropped events and left the UI
//     stuck at "thinking".

#[tauri::command]
pub fn chat_subscribe_events(
    _session_id: String,
    _channel: Channel<serde_json::Value>,
    _bridge: State<'_, ChatBridgeState>,
) -> Result<(), String> {
    // Events are now delivered via the "pi-agent-event" app event emitted
    // by the reader thread; the frontend uses `listen`. Kept as a no-op for
    // compatibility.
    Ok(())
}

// ─── Chat Bridge State ──────────────────────────────────

pub struct ChatBridgeStateInner {
    writer: Mutex<Option<std::process::ChildStdin>>,
    /// Pending request-response channels keyed by request id.
    pending: Arc<Mutex<std::collections::HashMap<u64, std::sync::mpsc::Sender<serde_json::Value>>>>,
    app: AppHandle,
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
        let pending: Arc<Mutex<std::collections::HashMap<u64, std::sync::mpsc::Sender<serde_json::Value>>>> =
            Arc::new(Mutex::new(std::collections::HashMap::new()));
        let pending_for_reader = Arc::clone(&pending);
        let app_for_reader = app.clone();

        // Spawn stdout reader thread — the single consumer. Routes responses
        // (id) to the matching pending request and emits events (method) as
        // Tauri app events (thread-safe; frontend listens via `listen`).
        std::thread::spawn(move || {
            use std::io::{BufRead, BufReader};
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                if let Ok(line) = line {
                    if let Ok(msg) = serde_json::from_str::<serde_json::Value>(&line) {
                        if let Some(id) = msg.get("id").and_then(|v| v.as_u64()) {
                            eprintln!("[chat-reader] routing id={} to caller", id);
                            let mut pend = pending_for_reader.lock().unwrap();
                            if let Some(tx) = pend.remove(&id) {
                                let _ = tx.send(msg);
                                eprintln!("[chat-reader] id={} sent to caller", id);
                            } else {
                                eprintln!("[chat-reader] id={} no pending channel (already consumed or timeout?)", id);
                            }
                        } else if msg.get("method").is_some() {
                            let event_type = msg.get("params").and_then(|p| p.get("event")).and_then(|e| e.get("type")).and_then(|t| t.as_str()).unwrap_or("unknown");
                            let session_id = msg.get("params").and_then(|p| p.get("sessionId")).and_then(|s| s.as_str()).unwrap_or("unknown");
                            eprintln!("[chat-emit] type={} session={}", event_type, session_id);
                            match app_for_reader.emit("pi-agent-event", &msg) {
                                Ok(_) => eprintln!("[chat-emit] emitted successfully"),
                                Err(e) => eprintln!("[chat-emit] emit FAILED: {}", e),
                            }
                        }
                    }
                }
            }
            eprintln!("[chat-reader] stdout reader thread exited");
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
                pending,
                app: app.clone(),
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
        eprintln!("[chat-call] method={}", method);
        let id = {
            let mut id = self.inner.request_id.lock().map_err(|e| e.to_string())?;
            let current = *id;
            *id += 1;
            current
        };

        let request = serde_json::json!({ "id": id, "method": method, "params": params });

        // Register a response channel for this request BEFORE writing, so
        // the reader thread can route the matching response to us.
        let (resp_tx, resp_rx) = std::sync::mpsc::channel::<serde_json::Value>();
        {
            let mut pend = self.inner.pending.lock().map_err(|e| e.to_string())?;
            pend.insert(id, resp_tx);
        }

        // Write request
        {
            let mut writer = self.inner.writer.lock().map_err(|e| e.to_string())?;
            if let Some(ref mut stdin) = *writer {
                let line = format!("{}\n", request);
                if let Err(e) = stdin.write_all(line.as_bytes()).and_then(|_| stdin.flush()) {
                    *writer = None;
                    return Err(format!("Chat bridge unavailable: {}", e));
                }
            } else {
                return Err("Chat bridge unavailable: process exited".to_string());
            }
        }

        // Wait for the routed response (with timeout).
        // send_command may carry a long-running "prompt" that takes minutes
        // (especially with thinking models), so allow a generous timeout there.
        let timeout_secs = if method == "send_command" { 600 } else { 30 };
        match resp_rx.recv_timeout(std::time::Duration::from_secs(timeout_secs)) {
            Ok(msg) => {
                if let Some(err) = msg.get("error") {
                    return Err(err.as_str().unwrap_or("Unknown error").to_string());
                }
                if let Some(result) = msg.get("result") {
                    return serde_json::from_value(result.clone())
                        .map_err(|e| format!("Deserialize result: {}", e));
                }
                Err("Malformed response".to_string())
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => Err("Request timeout".to_string()),
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                Err("Response channel closed".to_string())
            }
        }
    }
}
