/**
 * chat-bridge/index.js — long-lived Node.js process bridging Rust ↔ pi SDK.
 *
 * Protocol: newline-delimited JSON (NDJSON) on stdin/stdout.
 *   Rust → Node: {"id":1,"method":"start_session","params":{...}}\n
 *   Node → Rust: {"id":1,"result":{...}}\n
 *   Node → Rust: {"method":"event","params":{"sessionId":"abc","event":{...}}}\n
 */

const readline = require('readline');
const path = require('path');

// Path to the pi-web-switch server modules (sibling project)
const PI_WEB_SWITCH = path.resolve(__dirname, '../../../../pi-web-switch');

// Lazy-load the agent-session-manager (Node.js-only pi SDK wrapper)
let agentSessionManager = null;
function getManager() {
  if (!agentSessionManager) {
    try {
      agentSessionManager = require(path.join(PI_WEB_SWITCH, 'server/agent-session-manager'));
    } catch (e) {
      process.stderr.write(`Failed to load agent-session-manager: ${e.message}\n`);
      process.exit(1);
    }
  }
  return agentSessionManager;
}

// Event listeners per session
const sessionListeners = new Map();

// Omitted event types (same as chat-api-plugin.ts)
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

function emitEvent(sessionId, event) {
  const clientEvent = toClientEvent(event);
  if (clientEvent) {
    writeResponse({ method: 'event', params: { sessionId, event: clientEvent } });
  }
}

function writeResponse(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

async function handleRequest(req) {
  const { id, method, params = {} } = req;

  try {
    const mgr = getManager();
    let result;

    switch (method) {
      case 'list_sessions': {
        const sessions = await mgr.listAllSessions();
        result = { sessions, runningSessionIds: mgr.getRunningRpcSessionIds() };
        break;
      }

      case 'get_session': {
        const data = await mgr.getSessionData(params.id);
        result = data;
        break;
      }

      case 'start_session': {
        const { cwd, options = {} } = params;
        const tempKey = `__new__${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const { session, realSessionId } = await mgr.startRpcSession(tempKey, '', cwd, {
          ...(options.toolNames ? { toolNames: options.toolNames } : {}),
          ...(options.provider && options.modelId ? { initialModel: { provider: options.provider, modelId: options.modelId } } : {}),
          ...(options.thinkingLevel ? { thinkingLevel: options.thinkingLevel } : {}),
        });

        // Set up event listener
        const unsubscribe = session.onEvent((event) => {
          emitEvent(realSessionId, event);
        });
        sessionListeners.set(realSessionId, unsubscribe);

        // Get initial state
        const state = await session.send({ type: 'get_state' });

        result = {
          sessionId: realSessionId,
          model: state.model ? { provider: state.model.provider, modelId: state.model.id } : null,
          thinkingLevel: state.thinkingLevel,
        };
        break;
      }

      case 'send_command': {
        const { sessionId, command } = params;
        let session = mgr.getRpcSession(sessionId);

        if (!session || !session.isAlive()) {
          const filePath = await mgr.resolveSessionPath(sessionId);
          if (!filePath) {
            throw new Error('Session not found');
          }
          ({ session } = await mgr.startRpcSession(sessionId, filePath, undefined));

          // Set up event listener for restored session
          const unsubscribe = session.onEvent((event) => {
            emitEvent(sessionId, event);
          });
          sessionListeners.set(sessionId, unsubscribe);
        }

        const cmdResult = await session.send(command);
        result = { success: true, data: cmdResult };
        break;
      }

      case 'get_state': {
        const session = mgr.getRpcSession(params.sessionId);
        if (!session || !session.isAlive()) {
          result = { running: false };
        } else {
          const state = await session.send({ type: 'get_state' });
          result = { running: true, state };
        }
        break;
      }

      case 'rename_session': {
        const filePath = await mgr.resolveSessionPath(params.id);
        if (!filePath) throw new Error('Session not found');
        const { SessionManager } = require('@earendil-works/pi-coding-agent');
        const sm = SessionManager.open(filePath);
        sm.appendSessionInfo(params.name);
        mgr.invalidateSessionListCache();
        result = { ok: true };
        break;
      }

      case 'delete_session': {
        const filePath = await mgr.resolveSessionPath(params.id);
        if (!filePath) throw new Error('Session not found');
        await mgr.getRpcSession(params.id)?.shutdown();
        require('fs').unlinkSync(filePath);
        mgr.invalidateSessionListCache();
        // Clean up listener
        sessionListeners.delete(params.id);
        result = { ok: true };
        break;
      }

      case 'load_models': {
        const cwd = params.cwd || require('os').homedir();
        const data = await mgr.loadModels(cwd);
        result = data;
        break;
      }

      case 'auto_name': {
        const filePath = await mgr.resolveSessionPath(params.id);
        if (!filePath) throw new Error('Session not found');
        const { SessionManager } = require('@earendil-works/pi-coding-agent');
        const sm = SessionManager.open(filePath);
        const entries = sm.getEntries();
        const firstUserMsg = entries.find((e) => e.type === 'message' && e.message?.role === 'user');
        let title = 'New Session';
        if (firstUserMsg) {
          const content = firstUserMsg.message.content;
          title = typeof content === 'string'
            ? content.slice(0, 60)
            : Array.isArray(content)
              ? (content.find((b) => b.type === 'text')?.text ?? 'New Session').slice(0, 60)
              : 'New Session';
        }
        sm.appendSessionInfo(title);
        mgr.invalidateSessionListCache();
        result = { title };
        break;
      }

      default:
        throw new Error(`Unknown method: ${method}`);
    }

    if (id !== undefined) {
      writeResponse({ id, result });
    }
  } catch (error) {
    if (id !== undefined) {
      writeResponse({ id, error: error.message || String(error) });
    }
  }
}

// Read requests from stdin
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  try {
    const req = JSON.parse(line.trim());
    handleRequest(req);
  } catch (e) {
    process.stderr.write(`Parse error: ${e.message}\n`);
  }
});

// Signal readiness
writeResponse({ method: 'ready' });
