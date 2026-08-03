# Phase 3: Chat Agent — Node.js Child Process Bridge + SSE Channel

> Goal: Implement the chat functionality by bridging Rust to the pi SDK via a Node.js child process,
> and streaming SSE events to the frontend via Tauri Channel.
> After this phase, the Chat page works end-to-end.

---

## Architecture

```
Frontend (React)
  │  invoke("chat_start_session", { cwd })
  │  invoke("chat_send_command", { sessionId, command })
  │  Channel<AgentEvent> via invoke("chat_subscribe_events", { sessionId })
  ▼
Rust (Tauri Commands)
  │  stdin/stdout JSON-RPC
  ▼
Node.js Child Process (chat_bridge)
  │  imports agent-session-manager.ts
  │  wraps pi SDK AgentSession
  ▼
pi SDK (@earendil-works/pi-coding-agent)
```

---

## Step 1: Create the Node.js Bridge Script

Create `src-tauri/chat-bridge/index.js` (bundled with the app):

```javascript
// chat-bridge/index.js — long-lived Node.js process that bridges Rust ↔ pi SDK
// Communication: stdin (JSON-RPC requests from Rust), stdout (JSON-RPC responses + events)

import { startRpcSession, getRpcSession, listAllSessions, getSessionData, resolveSessionPath, cacheSessionPath, invalidateSessionListCache, loadModels } from '/Users/mac-2312-r/workspace/wwwroot/M-projects/pi-web-switch/server/agent-session-manager.ts';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { readFileSync, writeFileSync, readdirSync, unlinkSync, existsSync } from 'fs';
import { dirname, join, resolve } from 'path';

const OMITTED_EVENT_TYPES = new Set(['turn_start', 'turn_end', 'tool_execution_update']);

function toClientEvent(event) {
  if (OMITTED_EVENT_TYPES.has(event.type)) return null;
  if (event.type === 'message_update') {
    const e = { ...event };
    delete e.assistantMessageEvent;
    return e;
  }
  if (event.type === 'agent_end') return { type: 'agent_end' };
  return event;
}

// Read JSON-RPC request from stdin (length-prefixed: 4 bytes LE + JSON)
async function readRequest() {
  const header = new Uint8Array(4);
  const bytesRead = await readExactly(header, 4);
  if (bytesRead === 0) return null; // EOF
  const len = new DataView(header.buffer).getUint32(0, true);
  const body = new Uint8Array(len);
  await readExactly(body, len);
  return JSON.parse(new TextDecoder().decode(body));
}

function readExactly(buffer, n) {
  return new Promise((resolve, reject) => {
    let offset = 0;
    function chunkHandler(chunk) {
      const needed = n - offset;
      const toCopy = Math.min(needed, chunk.length);
      buffer.set(chunk.subarray(0, toCopy), offset);
      offset += toCopy;
      if (offset >= n) {
        process.stdin.off('data', chunkHandler);
        resolve(n);
      } else if (toCopy < chunk.length) {
        // More data than needed — this shouldn't happen with length-prefixed protocol
        buffer.set(chunk.subarray(toCopy), offset);
      }
    }
    process.stdin.on('data', chunkHandler);
  });
}

// Write JSON-RPC response to stdout
function writeResponse(msg) {
  const data = new TextEncoder().encode(JSON.stringify(msg));
  const header = new Uint8Array(4);
  new DataView(header.buffer).setUint32(0, data.length, true);
  process.stdin.pause(); // not needed for stdout
  process.stdout.write(header);
  process.stdout.write(data);
}

// Event streaming: write events as JSON-RPC notifications
function emitEvent(sessionId, event) {
  writeResponse({
    jsonrpc: '2.0',
    method: 'event',
    params: { sessionId, event }
  });
}

// Main: process requests
process.stdin.on('data', async (chunk) => {
  // Protocol: length-prefixed JSON messages
  // ... (implement the JSON-RPC loop)
});
```

**Simpler alternative**: Use newline-delimited JSON (NDJSON) on stdin/stdout instead of length-prefined binary. Each line is one JSON message. This is simpler to implement and debug.

### Revised Protocol (NDJSON):
```
Rust → Node: {"id":1,"method":"start_session","params":{"cwd":"/path","options":{}}}\n
Node → Rust: {"id":1,"result":{"sessionId":"abc","model":{...}}}\n
Node → Rust: {"method":"event","params":{"sessionId":"abc","event":{...}}}\n
```

---

## Step 2: Rust Chat Bridge Module

### `src-tauri/src/chat_bridge/mod.rs`

```rust
use std::process::{Command, Stdio};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, BufWriter};
use tokio::sync::{mpsc, Mutex};
use std::sync::Arc;
use serde::{Deserialize, Serialize};

struct ChatBridge {
    child: tokio::process::Child,
    writer: BufWriter<tokio::process::ChildStdin>,
    next_id: u64,
}

impl ChatBridge {
    fn new() -> Result<Self, String> {
        let mut child = Command::new("node")
            .arg("chat-bridge/index.js")  // bundled resource
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn chat bridge: {}", e))?;

        let stdin = child.stdin.take().unwrap();
        let stdout = child.stdout.take().unwrap();

        // Spawn reader task
        let (tx, mut rx) = mpsc::channel::<BridgeMessage>(256);
        tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if let Ok(msg) = serde_json::from_str::<BridgeMessage>(&line) {
                    tx.send(msg).await.ok();
                }
            }
        });

        Ok(ChatBridge {
            child,
            writer: BufWriter::new(stdin),
            next_id: 1,
        })
    }

    async fn call(&mut self, method: &str, params: serde_json::Value) -> Result<serde_json::Value, String> {
        let id = self.next_id;
        self.next_id += 1;

        let request = serde_json::json!({
            "id": id,
            "method": method,
            "params": params
        });

        let line = format!("{}\n", request);
        self.writer.write_all(line.as_bytes()).await.map_err(|e| e.to_string())?;
        self.writer.flush().await.map_err(|e| e.to_string())?;

        // Wait for response with matching id (with timeout)
        // ... (use tokio::time::timeout + event loop)
        todo!()
    }
}
```

---

## Step 3: Tauri Chat Commands

### `src-tauri/src/chat_agent/mod.rs`

```rust
use tauri::Window;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Clone)]
pub struct SessionInfo {
    pub id: String,
    pub path: String,
    pub cwd: String,
    pub name: Option<String>,
    pub created: String,
    pub modified: String,
    pub messageCount: u32,
    pub firstMessage: String,
}

#[tauri::command]
pub async fn chat_list_sessions(
    bridge: tauri::State<'_, ChatBridgeState>,
) -> Result<Vec<SessionInfo>, String> {
    bridge.call("list_sessions", serde_json::json!({})).await
}

#[tauri::command]
pub async fn chat_start_session(
    cwd: String,
    options: SessionStartOptions,
    bridge: tauri::State<'_, ChatBridgeState>,
) -> Result<StartSessionResult, String> {
    bridge.call("start_session", serde_json::json!({ "cwd": cwd, "options": options })).await
}

#[tauri::command]
pub async fn chat_send_command(
    session_id: String,
    command: serde_json::Value,
    bridge: tauri::State<'_, ChatBridgeState>,
) -> Result<serde_json::Value, String> {
    bridge.call("send_command", serde_json::json!({ "sessionId": session_id, "command": command })).await
}

#[tauri::command]
pub async fn chat_get_state(
    session_id: String,
    bridge: tauri::State<'_, ChatBridgeState>,
) -> Result<AgentState, String> {
    bridge.call("get_state", serde_json::json!({ "sessionId": session_id })).await
}
```

---

## Step 4: SSE via Tauri Channel

### `src-tauri/src/chat_agent/sse.rs`

```rust
use tauri::ipc::Channel;
use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct AgentEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    #[serde(flatten)]
    pub extra: serde_json::Value,
}

#[tauri::command]
pub fn chat_subscribe_events(
    session_id: String,
    channel: Channel<AgentEvent>,
    bridge: tauri::State<'_, ChatBridgeState>,
) -> Result<(), String> {
    // Register a callback that forwards events to the Channel
    bridge.subscribe(session_id, move |event| {
        channel.send(event).ok();
    })?;
    Ok(())
}
```

**Frontend usage** (will be implemented in Phase 4):
```typescript
import { Channel } from '@tauri-apps/api/core';
const channel = new Channel<AgentEvent>();
channel.onmessage = (event) => { /* handle */ };
await invoke('chat_subscribe_events', { sessionId, channel });
```

---

## Step 5: Bundle the Node Bridge

The `chat-bridge/index.js` and its dependencies need to be bundled with the Tauri app.

**Option A**: Use `esbuild` to bundle `chat-bridge/index.js` + `agent-session-manager.ts` + pi SDK into a single JS file at build time.

**Option B**: Ship the `node_modules` from pi-web-switch alongside the Tauri app and point `NODE_PATH` to it.

**Recommended**: Option A — add a build script in `package.json`:
```json
{
  "scripts": {
    "build:bridge": "esbuild chat-bridge/index.js --bundle --platform=node --outfile=src-tauri/resources/chat-bridge.js --external:@earendil-works/*"
  }
}
```

Then in `tauri.conf.json`, add to `bundle > resources`:
```json
{
  "resources": ["resources/chat-bridge.js", "resources/node_modules/@earendil-works/**/*"]
}
```

---

## Step 6: Register Commands

Add to `main.rs`:
```rust
.invoke_handler(tauri::generate_handler![
    // ... Phase 1+2 commands ...
    // chat_agent
    chat_agent::chat_list_sessions,
    chat_agent::chat_start_session,
    chat_agent::chat_send_command,
    chat_agent::chat_get_state,
    chat_agent::sse::chat_subscribe_events,
])
```

---

## Verification Checklist

- [ ] `chat_list_sessions()` returns the same data as `GET /api/chat/sessions` in the Electron version
- [ ] `chat_start_session("/path/to/project")` creates a new pi session and returns sessionId
- ] `chat_send_command(sessionId, { type: "prompt", message: "hello" })` sends a message
- [ ] `chat_subscribe_events` delivers real-time events to the frontend Channel
- [ ] Events include: `agent_start`, `message_start`, `message_update`, `message_end`, `agent_end`, `tool_execution_start/end`
- [ ] Node child process auto-restarts if it crashes
- [ ] Multiple concurrent sessions work (each with its own event stream)
- [ ] `chat_get_state` returns current model, streaming status, context usage

---

## Anti-Patterns

- **Don't** try to reimplement the pi SDK in Rust — use the Node bridge
- **Don't** use blocking I/O for the child process — always `tokio::process::Command`
- **Don't** forget to handle the Node process dying — monitor and restart
- **Don't** send binary data (images) through JSON-RPC — base64 encode first
- **Don't** create a new Node process per command — one long-lived process handles all sessions
