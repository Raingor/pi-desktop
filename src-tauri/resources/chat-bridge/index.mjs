/**
 * chat-bridge/index.mjs — long-lived Node.js process bridging Rust ↔ pi SDK.
 *
 * Protocol: newline-delimited JSON (NDJSON) on stdin/stdout.
 *   Rust → Node: {"id":1,"method":"start_session","params":{...}}\n
 *   Node → Rust: {"id":1,"result":{...}}\n
 *   Node → Rust: {"method":"event","params":{"sessionId":"abc","event":{...}}}\n
 *
 * ESM module so the pi SDK (ESM-only, uses import.meta.url for its own
 * resources) is loaded from this app's node_modules. agent-session-manager
 * is a pre-bundled ESM copy of pi-web-switch/server/agent-session-manager.ts.
 */

import { createInterface } from 'readline';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import * as agentSessionManager from './agent-session-manager.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Event listeners per session
const sessionListeners = new Map();

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

function writeResponse(msg) {
  if (msg.method === 'event') {
    const eventType = msg.params?.event?.type ?? 'unknown';
    process.stderr.write(`[bridge-emit] event type=${eventType} session=${msg.params?.sessionId ?? 'unknown'}\n`);
  }
  process.stdout.write(JSON.stringify(msg) + '\n');
}

// Never crash on a closed pipe (e.g. the Rust side shut down): log it instead.
process.stdout.on('error', (err) => {
  if (err.code !== 'EPIPE') {
    process.stderr.write(`chat-bridge stdout error: ${err.message}\n`);
  }
});

async function handleRequest(req) {
  const { id, method, params = {} } = req;

  if (!agentSessionManager && method !== 'list_sessions') {
    if (id !== undefined) {
      writeResponse({ id, error: `pi SDK not available` });
    }
    return;
  }

  try {
    const mgr = agentSessionManager;
    let result;

    process.stderr.write(`[bridge] handling ${method} (id=${id})\n`);

    switch (method) {
      case 'list_sessions': {
        if (mgr) {
          const sessions = await mgr.listAllSessions();
          result = { sessions, runningSessionIds: mgr.getRunningRpcSessionIds() };
        } else {
          result = { sessions: [], runningSessionIds: [] };
        }
        break;
      }

      case 'get_session': {
        if (!mgr) { result = null; break; }
        const data = await mgr.getSessionData(params.id);
        result = data;
        break;
      }

      case 'start_session': {
        const { cwd, options = {} } = params;
        process.stderr.write(`[bridge] start_session: cwd=${cwd}, options=${JSON.stringify(options)}\n`);
        const tempKey = `__new__${Date.now()}-${Math.random().toString(36).slice(2)}`;
        process.stderr.write(`[bridge] start_session: calling startRpcSession...\n`);
        const { session, realSessionId } = await mgr.startRpcSession(tempKey, '', cwd, {
          ...(options.toolNames ? { toolNames: options.toolNames } : {}),
          ...(options.provider && options.modelId ? { initialModel: { provider: options.provider, modelId: options.modelId } } : {}),
          ...(options.thinkingLevel ? { thinkingLevel: options.thinkingLevel } : {}),
        });
        process.stderr.write(`[bridge] start_session: session created, realSessionId=${realSessionId}\n`);

        const unsubscribe = session.onEvent((event) => {
          try {
            const clientEvent = toClientEvent(event);
            if (clientEvent) {
              writeResponse({ method: 'event', params: { sessionId: realSessionId, event: clientEvent } });
            }
          } catch (e) {
            process.stderr.write(`chat-bridge event callback error: ${e.message}\n`);
          }
        });
        sessionListeners.set(realSessionId, unsubscribe);

        process.stderr.write(`[bridge] start_session: calling get_state...\n`);
        const state = await session.send({ type: 'get_state' });
        process.stderr.write(`[bridge] start_session: get_state done\n`);
        result = {
          session_id: realSessionId,
          model: state.model ? { provider: state.model.provider, model_id: state.model.id } : null,
          thinking_level: state.thinkingLevel,
        };
        break;
      }

      case 'send_command': {
        const { sessionId, command } = params;
        process.stderr.write(`[bridge] send_command: sessionId=${sessionId}, command.type=${command?.type}\n`);
        let session = mgr.getRpcSession(sessionId);

        if (!session || !session.isAlive()) {
          const filePath = await mgr.resolveSessionPath(sessionId);
          if (!filePath) throw new Error('Session not found');
          ({ session } = await mgr.startRpcSession(sessionId, filePath, undefined));

          const unsubscribe = session.onEvent((event) => {
            try {
              const clientEvent = toClientEvent(event);
              if (clientEvent) {
                writeResponse({ method: 'event', params: { sessionId, event: clientEvent } });
              }
            } catch (e) {
              process.stderr.write(`chat-bridge event callback error: ${e.message}\n`);
            }
          });
          sessionListeners.set(sessionId, unsubscribe);
        }

        process.stderr.write(`[bridge] send_command: calling session.send...\n`);
        const cmdResult = await session.send(command);
        process.stderr.write(`[bridge] send_command: done, result=${JSON.stringify(cmdResult)?.slice(0, 200)}\n`);
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
        const sm = SessionManager.open(filePath);
        sm.appendSessionInfo(params.name);
        mgr.invalidateSessionListCache();
        result = true;
        break;
      }

      case 'delete_session': {
        const filePath = await mgr.resolveSessionPath(params.id);
        if (!filePath) throw new Error('Session not found');
        await mgr.getRpcSession(params.id)?.shutdown();
        fs.unlinkSync(filePath);
        mgr.invalidateSessionListCache();
        sessionListeners.delete(params.id);
        result = true;
        break;
      }

      case 'load_models': {
        const cwd = params.cwd || os.homedir();
        const data = await mgr.loadModels(cwd);
        result = data;
        break;
      }

      case 'auto_name': {
        const filePath = await mgr.resolveSessionPath(params.id);
        if (!filePath) throw new Error('Session not found');
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
        result = title;
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
const rl = createInterface({ input: process.stdin });
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
