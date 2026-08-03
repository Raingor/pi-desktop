// useAgentSession — core hook for managing pi agent chat sessions.
// Ported and simplified from pi-web's hooks/useAgentSession.ts.
// Handles: session loading, SSE events, message sending, model switching, abort, compact.

import { useState, useCallback, useRef, useEffect, useMemo, useReducer } from "react";
import { Channel } from "@tauri-apps/api/core";
import type {
  AgentMessage,
  AssistantMessage,
  SessionData,
  SessionInfo,
  SessionStatsInfo,
  AttachedImage,
  ChatInputHandle,
  ModelEntry,
  AgentStateResponse,
  NoticeItem,
  AgentPhase,
  QueuedMessages,
  SlashCommandInfo,
  ContextUsage,
  ToolResultMessage,
} from "@/types/chat";
import { chatSendCommand, chatStartSession, chatGetState, chatLoadModels } from "@/lib/tauri";

// ─── Helpers ─────────────────────────────────────────────

export async function sendAgentCommand<T = unknown>(
  sessionId: string,
  command: Record<string, unknown>,
): Promise<T> {
  const result = await chatSendCommand(sessionId, command);
  if (!result.success) {
    throw new Error("Command failed");
  }
  return result.data as T;
}

function normalizeToolCalls(message: AgentMessage): AgentMessage {
  if (message.role !== "assistant") return message;
  const am = message as AssistantMessage;
  let changed = false;
  const content = am.content.map((block) => {
    if (block.type === "toolCall" && (block as any).tool_name && !block.toolName) {
      changed = true;
      const { tool_name, ...rest } = block as any;
      return { ...rest, toolName: tool_name };
    }
    if (block.type === "toolCall" && (block as any).tool_input && !block.input) {
      changed = true;
      const { tool_input, ...rest } = block as any;
      return { ...rest, input: tool_input };
    }
    return block;
  });
  return changed ? { ...am, content } : am;
}

function createNoticeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function extractMessageText(message: Partial<AgentMessage>): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) =>
      block && typeof block === "object"
        && (block as { type?: string }).type === "text"
        && typeof (block as { text?: unknown }).text === "string"
        ? (block as { text: string }).text
        : "")
    .filter(Boolean)
    .join("\n");
}

function imageSignature(block: unknown): string {
  if (!block || typeof block !== "object" || (block as { type?: unknown }).type !== "image") return "";
  const source = (block as { source?: unknown }).source;
  if (source && typeof source === "object") {
    const src = source as { type?: unknown; media_type?: unknown; data?: unknown; url?: unknown };
    return [src.type === "url" ? "url" : "base64", typeof src.media_type === "string" ? src.media_type : "", typeof src.data === "string" ? src.data : "", typeof src.url === "string" ? src.url : ""].join(":");
  }
  const flat = block as { data?: unknown; mimeType?: unknown };
  return ["base64", typeof flat.mimeType === "string" ? flat.mimeType : "", typeof flat.data === "string" ? flat.data : "", ""].join(":");
}

function userMessageKey(message: Partial<AgentMessage>): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return JSON.stringify({ text: content, images: [] });
  if (!Array.isArray(content)) return JSON.stringify({ text: "", images: [] });
  return JSON.stringify({
    text: extractMessageText(message),
    images: content.map(imageSignature).filter(Boolean),
  });
}

// ─── Stream Reducer ──────────────────────────────────────

interface StreamingState {
  isStreaming: boolean;
  streamingMessage: Partial<AgentMessage> | null;
}

type StreamAction =
  | { type: "start" }
  | { type: "update"; message: Partial<AgentMessage> }
  | { type: "end" }
  | { type: "reset" };

function streamReducer(state: StreamingState, action: StreamAction): StreamingState {
  switch (action.type) {
    case "start":
      return { isStreaming: true, streamingMessage: null };
    case "update":
      return { isStreaming: true, streamingMessage: action.message };
    case "end":
    case "reset":
      return { isStreaming: false, streamingMessage: null };
    default:
      return state;
  }
}

// ─── Notice Reducer ──────────────────────────────────────

type NoticeAction =
  | { type: "add"; notice: NoticeItem }
  | { type: "mark_oldest_exiting" }
  | { type: "remove"; id: string };

type NoticeState = { visible: NoticeItem[]; pending: NoticeItem[] };

const MAX_NOTICES = 5;
const NOTICE_VISIBLE_MS = 5000;
const NOTICE_EXIT_ANIMATION_MS = 180;

function markOldestNoticeExiting(notices: NoticeItem[]): NoticeItem[] {
  const index = notices.findIndex((notice) => !notice.exiting);
  if (index === -1) return notices;
  return notices.map((notice, i) => (i === index ? { ...notice, exiting: true } : notice));
}

function fillPendingNotices(visible: NoticeItem[], pending: NoticeItem[]): NoticeState {
  let nextVisible = visible;
  let nextPending = pending;
  while (nextPending.length > 0 && nextVisible.length < MAX_NOTICES) {
    const [next, ...rest] = nextPending;
    if (!next) break;
    nextVisible = [...nextVisible, next];
    nextPending = rest;
  }
  if (nextPending.length > 0 && !nextVisible.some((notice) => notice.exiting)) {
    nextVisible = markOldestNoticeExiting(nextVisible);
  }
  return { visible: nextVisible, pending: nextPending };
}

function noticeReducer(state: NoticeState, action: NoticeAction): NoticeState {
  switch (action.type) {
    case "add": {
      if (state.visible.some((notice) => notice.exiting) || state.visible.length >= MAX_NOTICES) {
        return {
          visible: state.visible.some((notice) => notice.exiting)
            ? state.visible
            : markOldestNoticeExiting(state.visible),
          pending: [...state.pending, action.notice],
        };
      }
      return { ...state, visible: [...state.visible, action.notice] };
    }
    case "mark_oldest_exiting":
      return { ...state, visible: markOldestNoticeExiting(state.visible) };
    case "remove": {
      const visible = state.visible.filter((notice) => notice.id !== action.id);
      return fillPendingNotices(visible, state.pending);
    }
    default:
      return state;
  }
}

// ─── Hook Options ────────────────────────────────────────

export interface UseAgentSessionOptions {
  session: SessionInfo | null;
  newSessionCwd: string | null;
  onAgentEnd?: () => void;
  onSessionCreated?: (session: SessionInfo) => void;
  onSessionForked?: (newSessionId: string) => void;
  modelsRefreshKey?: number;
  chatInputRef?: React.RefObject<ChatInputHandle | null>;
  onSessionStatsPanelOpen?: () => void;
}

export type ThinkingLevelOption = "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

// ─── Main Hook ───────────────────────────────────────────

export function useAgentSession(opts: UseAgentSessionOptions) {
  const {
    session, newSessionCwd, onAgentEnd, onSessionCreated, onSessionForked,
    modelsRefreshKey, onSessionStatsPanelOpen,
  } = opts;

  const isNew = session === null && newSessionCwd !== null;

  const [data, setData] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [entryIds, setEntryIds] = useState<string[]>([]);
  const [streamState, dispatch] = useReducer(streamReducer, { isStreaming: false, streamingMessage: null });
  const [agentRunning, setAgentRunning] = useState(false);
  const [bashRunning, setBashRunning] = useState(false);
  const [pendingBash, setPendingBash] = useState<{ command: string; excludeFromContext: boolean } | null>(null);
  const [modelNames, setModelNames] = useState<Record<string, string>>({});
  const [modelList, setModelList] = useState<ModelEntry[]>([]);
  const [modelError, setModelError] = useState<string | null>(null);
  const [newSessionModel, setNewSessionModel] = useState<{ provider: string; modelId: string } | null>(null);
  const [newSessionDefaultModel, setNewSessionDefaultModel] = useState<{ provider: string; modelId: string } | null>(null);
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevelOption>("auto");
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null);
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const [forkingEntryId, setForkingEntryId] = useState<string | null>(null);
  const [currentModelOverride, setCurrentModelOverride] = useState<{ provider: string; modelId: string } | null>(null);
  const [pendingModel, setPendingModel] = useState<{ provider: string; modelId: string } | null>(null);
  const [isCompacting, setIsCompacting] = useState(false);
  const [compactError, setCompactError] = useState<string | null>(null);
  const [compactResult, setCompactResult] = useState<{ reason: string; tokensBefore: number; estimatedTokensAfter: number } | null>(null);
  const [agentPhase, setAgentPhase] = useState<AgentPhase>(null);
  const [slashCommands, setSlashCommands] = useState<SlashCommandInfo[]>([]);
  const [slashCommandsLoading, setSlashCommandsLoading] = useState(false);
  const [queuedMessages, setQueuedMessages] = useState<QueuedMessages>({ steering: [], followUp: [] });
  const [noticeState, dispatchNotice] = useReducer(noticeReducer, { visible: [], pending: [] });
  const [retryInfo, setRetryInfo] = useState<{ attempt: number; maxAttempts: number; errorMessage?: string } | null>(null);

  const channelRef = useRef<Channel<any> | null>(null);
  const sessionIdRef = useRef<string | null>(session?.id ?? null);
  const agentRunningRef = useRef(false);
  const handleAgentEventRef = useRef<((event: any) => void) | null>(null);
  const initialScrollDoneRef = useRef(false);
  const lastUserMsgRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const ensuringNewSessionRef = useRef<Promise<string | null> | null>(null);
  const newSessionPromotedRef = useRef(false);
  const newSessionModelOverrideRef = useRef<{ provider: string; modelId: string } | null>(null);
  const thinkingLevelOverrideRef = useRef<Exclude<ThinkingLevelOption, "auto"> | null>(null);
  const promptRunIdRef = useRef(0);
  const optimisticUserMessageKeyRef = useRef<string | null>(null);
  const toolPresetRef = useRef<"none" | "default" | "full">("default");
  const [toolPreset, setToolPresetState] = useState<"none" | "default" | "full">("default");

  const currentModel = currentModelOverride ?? data?.context.model ?? pendingModel ?? null;
  const displayModel = isNew ? (newSessionModel ?? newSessionDefaultModel) : currentModel;

  // ─── Session Stats ─────────────────────────────────────

  const sessionStats = useMemo(() => {
    const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
    let cost = 0;
    let userMessages = 0;
    let assistantMessages = 0;
    let toolResults = 0;
    let toolCalls = 0;
    for (const msg of messages) {
      if (msg.role === "user") userMessages += 1;
      if (msg.role === "toolResult") toolResults += 1;
      if (msg.role !== "assistant") continue;
      assistantMessages += 1;
      const u = (msg as AssistantMessage).usage;
      toolCalls += (msg as AssistantMessage).content.filter((c) => c.type === "toolCall").length;
      if (!u) continue;
      tokens.input += u.input ?? 0;
      tokens.output += u.output ?? 0;
      tokens.cacheRead += u.cacheRead ?? 0;
      tokens.cacheWrite += u.cacheWrite ?? 0;
      cost += u.cost?.total ?? 0;
    }
    tokens.total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
    if (tokens.total === 0 && messages.length === 0) return null;
    return {
      sessionFile: data?.filePath || undefined,
      sessionId: sessionIdRef.current ?? session?.id ?? "",
      sessionName: session?.name,
      userMessages,
      assistantMessages,
      toolCalls,
      toolResults,
      totalMessages: messages.length,
      tokens,
      cost,
      ...(contextUsage ? { contextUsage } : {}),
    } satisfies SessionStatsInfo;
  }, [messages, contextUsage, data?.filePath, session?.id, session?.name]);

  // ─── Load Session ──────────────────────────────────────

  const loadSession = useCallback(async (sid: string, showLoading = false) => {
    try {
      if (showLoading) setLoading(true);
      const d = await chatGetSession(sid);
      if (!d) {
        if (showLoading) {
          setData(null);
          setMessages([]);
          setError(null);
        }
        return null;
      }
      if (sessionIdRef.current !== sid) return null;
      setData(d);
      setMessages(d.context.messages);
      setEntryIds(d.context.entryIds ?? []);
      setCurrentModelOverride(null);
      setError(null);
      if (showLoading) setLoading(false);

      // Load agent state if running
      try {
        const agentState = await chatGetState(sid);
        if (sessionIdRef.current !== sid) return null;
        const liveState = agentState.state;
        if (liveState) {
          if (liveState.contextUsage !== undefined) setContextUsage(liveState.contextUsage ?? null);
          if (liveState.systemPrompt !== undefined) setSystemPrompt(liveState.systemPrompt ?? null);
          if (liveState.thinkingLevel !== undefined) setThinkingLevel((liveState.thinkingLevel as ThinkingLevelOption) ?? "auto");
        }
        if (agentState.running && liveState?.isStreaming) {
          agentRunningRef.current = true;
          setAgentRunning(true);
          setAgentPhase({ kind: "waiting_model" });
          dispatch({ type: "start" });
        }
      } catch {
        // ignore state fetch errors
      }
      return null;
    } catch (e) {
      setError(String(e));
      return null;
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  // ─── Load Models ───────────────────────────────────────

  const loadModels = useCallback(async (_signal?: AbortSignal) => {
    const modelCwd = newSessionCwd ?? session?.cwd ?? "";
    console.log("[loadModels] Loading models for cwd:", modelCwd);
    try {
      const d = await chatLoadModels(modelCwd);
      console.log("[loadModels] Response:", { models: d.models, modelList: d.modelList, defaultModel: d.defaultModel, modelError: d.modelError });
      setModelNames(d.models ?? {});
      setModelError(d.modelError ?? null);
      const nextModelList = d.modelList ?? [];
      setModelList(nextModelList);
      if (isNew && !sessionIdRef.current) {
        const match = d.defaultModel
          ? nextModelList.find((m: ModelEntry) => m.id === d.defaultModel?.modelId && m.provider === d.defaultModel?.provider)
          : undefined;
        const display = match ?? nextModelList[0];
        setNewSessionDefaultModel(display ? { provider: display.provider, modelId: display.id } : null);
      }
    } catch (e) {
      console.error("Failed to load models:", e);
    }
  }, [isNew, newSessionCwd, session?.cwd]);

  // ─── Ensure New Session ────────────────────────────────

  const ensureNewSession = useCallback(async (): Promise<string | null> => {
    if (sessionIdRef.current) return sessionIdRef.current;
    if (!isNew || !newSessionCwd) return sessionIdRef.current;
    if (ensuringNewSessionRef.current) return ensuringNewSessionRef.current;

    const promise = (async () => {
      const selectedModel = newSessionModelOverrideRef.current;
      const selectedThinkingLevel = thinkingLevelOverrideRef.current;
      if (selectedModel) setPendingModel(selectedModel);
      const toolNames = toolPresetRef.current === "default"
        ? ["read", "bash", "edit", "write", "grep", "find", "ls"]
        : toolPresetRef.current === "full"
          ? ["read", "bash", "edit", "write", "grep", "find", "ls"]
          : [];
      const result = await chatStartSession(newSessionCwd, {
        toolNames,
        provider: selectedModel?.provider,
        modelId: selectedModel?.modelId,
        thinkingLevel: selectedThinkingLevel ?? undefined,
      });
      const realId = result.sessionId;
      sessionIdRef.current = realId;
      if (result.model) {
        setPendingModel(result.model);
        if (!selectedModel) setNewSessionDefaultModel(result.model);
      }
      if (result.thinkingLevel) {
        setThinkingLevel(result.thinkingLevel);
      }
      return realId;
    })();

    ensuringNewSessionRef.current = promise;
    try {
      return await promise;
    } finally {
      ensuringNewSessionRef.current = null;
    }
  }, [isNew, newSessionCwd]);

  // ─── Promote New Session ───────────────────────────────

  const promoteNewSession = useCallback((messageCount = 0, firstMessage = "(no messages)") => {
    const sid = sessionIdRef.current;
    if (!isNew || !newSessionCwd || !sid || newSessionPromotedRef.current) return;
    newSessionPromotedRef.current = true;
    onSessionCreated?.({
      id: sid,
      path: "",
      cwd: newSessionCwd,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      messageCount,
      firstMessage,
    });
  }, [isNew, newSessionCwd, onSessionCreated]);

  // ─── Event Channel Connection (Tauri Channel replaces EventSource) ──

  const closeEvents = useCallback(() => {
    channelRef.current = null;
    // Channel is dropped when ref is cleared; Rust detects disconnect
  }, []);

  const connectEvents = useCallback(async (sid: string) => {
    closeEvents();
    const channel = new Channel<any>();
    channelRef.current = channel;

    channel.onmessage = (event: any) => {
      if (event.type === "connected") return;
      handleAgentEventRef.current?.(event);
    };

    // Tell Rust to start forwarding events for this session
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("chat_subscribe_events", { sessionId: sid, channel });
  }, [closeEvents]);

  // ─── Agent Event Handler ───────────────────────────────

  const addNotice = useCallback((notice: { id?: string; message: string; type?: "info" | "success" | "warning" | "error" }) => {
    const message = notice.message.trim();
    if (!message) return;
    dispatchNotice({
      type: "add",
      notice: {
        id: notice.id ?? createNoticeId(),
        message,
        type: notice.type ?? "info",
      },
    });
  }, []);

  const handleAgentEvent = useCallback((event: any) => {
    switch (event.type) {
      case "agent_start":
        agentRunningRef.current = true;
        setAgentRunning(true);
        setAgentPhase({ kind: "waiting_model" });
        dispatch({ type: "start" });
        break;

      case "agent_end":
        setAgentPhase(null);
        setRetryInfo(null);
        dispatch({ type: "end" });
        if (sessionIdRef.current) {
          loadSession(sessionIdRef.current);
          chatGetState(sessionIdRef.current)
            .then((d) => {
              if (d.state?.contextUsage !== undefined) setContextUsage(d.state.contextUsage ?? null);
              if (d.state?.systemPrompt !== undefined) setSystemPrompt(d.state.systemPrompt ?? null);
            })
            .catch(() => {});
        }
        break;

      case "agent_settled": {
        const wasRunning = agentRunningRef.current;
        agentRunningRef.current = false;
        if (!wasRunning) break;
        setAgentRunning(false);
        setAgentPhase(null);
        setRetryInfo(null);
        dispatch({ type: "end" });
        setIsCompacting(false);
        if (sessionIdRef.current) {
          loadSession(sessionIdRef.current);
        }
        if (wasRunning) onAgentEnd?.();
        break;
      }

      case "prompt_done": {
        const runId = promptRunIdRef.current;
        const promptWasPending = true;
        promptRunIdRef.current = 0;
        optimisticUserMessageKeyRef.current = null;
        if (!promptWasPending) break;
        const sid = sessionIdRef.current;
        if (sid) loadSession(sid);
        if (!agentRunningRef.current) {
          setAgentRunning(false);
          setAgentPhase(null);
          dispatch({ type: "end" });
        }
        onAgentEnd?.();
        break;
      }

      case "prompt_error":
        addNotice({ type: "error", message: (event.errorMessage as string | undefined) ?? "Command failed" });
        break;

      case "message_start":
      case "message_update": {
        if (!agentRunningRef.current) break;
        const msg = event.message as Partial<AgentMessage> | undefined;
        if (msg?.role === "user") break;
        if (msg) {
          dispatch({ type: "update", message: normalizeToolCalls(msg as AgentMessage) });
        }
        setAgentPhase(null);
        break;
      }

      case "message_end": {
        if (!agentRunningRef.current) break;
        const completed = event.message as AgentMessage | undefined;
        if (completed && completed.role === "user") {
          const delivered = normalizeToolCalls(completed);
          const deliveredKey = userMessageKey(delivered);
          const optimisticKey = optimisticUserMessageKeyRef.current;
          optimisticUserMessageKeyRef.current = null;
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (optimisticKey && last?.role === "user" && userMessageKey(last) === optimisticKey) {
              return optimisticKey === deliveredKey ? prev : [...prev.slice(0, -1), delivered];
            }
            return [...prev, delivered];
          });
        } else if (completed) {
          setMessages((prev) => [...prev, normalizeToolCalls(completed)]);
        }
        dispatch({ type: "reset" });
        setAgentPhase({ kind: "waiting_model" });
        break;
      }

      case "tool_execution_start": {
        const id = event.toolCallId as string;
        const name = event.toolName as string;
        setAgentPhase((prev) => {
          const tools = prev?.kind === "running_tools" ? [...prev.tools] : [];
          if (!tools.some((t) => t.id === id)) tools.push({ id, name });
          return { kind: "running_tools", tools };
        });
        break;
      }

      case "tool_execution_end": {
        const id = event.toolCallId as string;
        setAgentPhase((prev) => {
          if (prev?.kind !== "running_tools") return prev;
          const tools = prev.tools.filter((t) => t.id !== id);
          if (tools.length === 0) return { kind: "waiting_model" };
          return { kind: "running_tools", tools };
        });
        break;
      }

      case "queue_update":
        setQueuedMessages({
          steering: [...((event.steering as string[] | undefined) ?? [])],
          followUp: [...((event.followUp as string[] | undefined) ?? [])],
        });
        break;

      case "auto_retry_start":
        setRetryInfo({ attempt: event.attempt as number, maxAttempts: event.maxAttempts as number, errorMessage: event.errorMessage as string | undefined });
        break;

      case "auto_retry_end":
        setRetryInfo(null);
        break;

      case "auto_compaction_start":
      case "compaction_start":
        setIsCompacting(true);
        setCompactError(null);
        setCompactResult(null);
        break;

      case "auto_compaction_end":
      case "compaction_end":
        setIsCompacting(false);
        if (event.errorMessage) {
          setCompactError(event.errorMessage as string);
          setCompactResult(null);
        } else if (!event.aborted) {
          if (event.result) {
            setCompactResult({
              reason: (event.reason as string | undefined) ?? "auto",
              tokensBefore: (event.result as any).tokensBefore ?? 0,
              estimatedTokensAfter: (event.result as any).estimatedTokensAfter ?? 0,
            });
          }
          if (sessionIdRef.current) loadSession(sessionIdRef.current);
        }
        break;
    }
  }, [addNotice, loadSession, onAgentEnd]);

  handleAgentEventRef.current = handleAgentEvent;

  // ─── Send Message ──────────────────────────────────────

  const handleSend = useCallback(async (message: string, images?: AttachedImage[]) => {
    const trimmedMessage = message.trim();
    if (!trimmedMessage && !images?.length) return;
    if (agentRunningRef.current) return;

    const isBashCommand = !images?.length && trimmedMessage.startsWith("!");
    if (isBashCommand) {
      const isExcluded = trimmedMessage.startsWith("!!");
      const bashCmd = (isExcluded ? trimmedMessage.slice(2) : trimmedMessage.slice(1)).trim();
      if (!bashCmd) return;
      // Execute bash command
      try {
        const sid = sessionIdRef.current ?? await ensureNewSession();
        if (!sid) return;
        setBashRunning(true);
        setPendingBash({ command: bashCmd, excludeFromContext: isExcluded });
        await sendAgentCommand(sid, { type: "bash", command: bashCmd, excludeFromContext: isExcluded });
        await loadSession(sid);
        promoteNewSession(1, trimmedMessage);
      } catch (e) {
        addNotice({ type: "error", message: e instanceof Error ? e.message : String(e) });
      } finally {
        setPendingBash(null);
        setBashRunning(false);
      }
      return;
    }

    const promptRunId = promptRunIdRef.current + 1;
    const imageBlocks = images?.map((img) => ({ type: "image" as const, source: { type: "base64" as const, media_type: img.mimeType, data: img.data } }));
    const userMsg: AgentMessage = {
      role: "user",
      content: imageBlocks?.length
        ? [...(message.trim() ? [{ type: "text" as const, text: message }] : []), ...imageBlocks]
        : message,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    optimisticUserMessageKeyRef.current = userMessageKey(userMsg);
    promptRunIdRef.current = promptRunId;
    agentRunningRef.current = true;
    setAgentRunning(true);
    setAgentPhase({ kind: "waiting_model" });
    dispatch({ type: "start" });

    const piImages = images?.map((img) => ({ type: "image" as const, data: img.data, mimeType: img.mimeType }));

    try {
      if (isNew && newSessionCwd) {
        const selectedModel = newSessionModel;
        const sid = await ensureNewSession();
        if (sid) {
          if (selectedModel) {
            setPendingModel(selectedModel);
            await sendAgentCommand(sid, { type: "set_model", provider: selectedModel.provider, modelId: selectedModel.modelId });
          }
          connectEvents(sid);
          await sendAgentCommand(sid, {
            type: "prompt",
            message,
            ...(piImages?.length ? { images: piImages } : {}),
          });
          promoteNewSession(1, message);
        }
      } else if (session) {
        connectEvents(session.id);
        await sendAgentCommand(session.id, {
          type: "prompt",
          message,
          ...(piImages?.length ? { images: piImages } : {}),
        });
      }
    } catch (e) {
      console.error("Failed to send message:", e);
      addNotice({ type: "error", message: e instanceof Error ? e.message : String(e) });
      const optimisticKey = optimisticUserMessageKeyRef.current;
      if (optimisticKey) {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          return last?.role === "user" && userMessageKey(last) === optimisticKey ? prev.slice(0, -1) : prev;
        });
      }
      optimisticUserMessageKeyRef.current = null;
      agentRunningRef.current = false;
      setAgentRunning(false);
      setAgentPhase(null);
      dispatch({ type: "end" });
      closeEvents();
      if (message) opts.chatInputRef?.current?.insertIfEmpty(message);
    }
  }, [isNew, newSessionCwd, newSessionModel, session, ensureNewSession, connectEvents, promoteNewSession, addNotice, closeEvents, loadSession, opts.chatInputRef]);

  // ─── Abort ─────────────────────────────────────────────

  const handleAbort = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "abort" });
    } catch (e) {
      console.error("Failed to abort:", e);
    }
  }, []);

  // ─── Fork ──────────────────────────────────────────────

  const handleFork = useCallback(async (entryId: string) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    setForkingEntryId(entryId);
    try {
      const result = await sendAgentCommand<{ cancelled?: boolean; newSessionId?: string }>(sid, {
        type: "fork",
        entryId,
      });
      if (!result?.cancelled && result?.newSessionId) {
        onSessionForked?.(result.newSessionId);
      }
    } catch (e) {
      console.error("Fork failed:", e);
    } finally {
      setForkingEntryId(null);
    }
  }, [onSessionForked]);

  // ─── Model Change ──────────────────────────────────────

  const handleModelChange = useCallback(async (provider: string, modelId: string) => {
    if (isNew) {
      const selectedModel = { provider, modelId };
      newSessionModelOverrideRef.current = selectedModel;
      setNewSessionModel(selectedModel);
      setPendingModel(selectedModel);
      const sid = sessionIdRef.current ?? await ensuringNewSessionRef.current;
      if (!sid) return;
      try {
        await sendAgentCommand(sid, { type: "set_model", provider, modelId });
      } catch (e) {
        console.error("Failed to set model:", e);
      }
      return;
    }
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "set_model", provider, modelId });
      setCurrentModelOverride({ provider, modelId });
    } catch (e) {
      console.error("Failed to set model:", e);
    }
  }, [isNew]);

  // ─── Compact ───────────────────────────────────────────

  const handleCompact = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid || isCompacting) return;
    setIsCompacting(true);
    setCompactError(null);
    setCompactResult(null);
    try {
      const result = await sendAgentCommand<any>(sid, { type: "compact" });
      if (result) {
        setCompactResult({
          reason: "manual",
          tokensBefore: result.tokensBefore ?? 0,
          estimatedTokensAfter: result.estimatedTokensAfter ?? 0,
        });
      }
      await loadSession(sid, true);
    } catch (e) {
      setCompactError(e instanceof Error ? e.message : String(e));
      setCompactResult(null);
    } finally {
      setIsCompacting(false);
    }
  }, [isCompacting, loadSession]);

  // ─── Steering & Follow-up ──────────────────────────────

  const handleSteer = useCallback(async (message: string, images?: AttachedImage[]) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    const piImages = images?.map((img) => ({ type: "image" as const, data: img.data, mimeType: img.mimeType }));
    try {
      await sendAgentCommand(sid, { type: "steer", message, ...(piImages?.length ? { images: piImages } : {}) });
    } catch (e) {
      console.error("Failed to steer:", e);
    }
  }, []);

  const handleFollowUp = useCallback(async (message: string, images?: AttachedImage[]) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    const piImages = images?.map((img) => ({ type: "image" as const, data: img.data, mimeType: img.mimeType }));
    try {
      await sendAgentCommand(sid, { type: "follow_up", message, ...(piImages?.length ? { images: piImages } : {}) });
    } catch (e) {
      console.error("Failed to follow up:", e);
    }
  }, []);

  // ─── Recall Queue ──────────────────────────────────────

  const handleRecallQueue = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      const result = await sendAgentCommand<{ steering?: string[]; followUp?: string[] }>(sid, { type: "clear_queue" });
      setQueuedMessages({ steering: [], followUp: [] });
      const texts = [...(result?.steering ?? []), ...(result?.followUp ?? [])];
      if (texts.length > 0) {
        opts.chatInputRef?.current?.prependText(texts.join("\n\n"));
      }
    } catch (e) {
      console.error("Failed to recall queued messages:", e);
      addNotice({ type: "error", message: "Failed to recall queued messages" });
    }
  }, [opts.chatInputRef, addNotice]);

  // ─── Thinking Level ────────────────────────────────────

  const handleThinkingLevelChange = useCallback(async (level: ThinkingLevelOption) => {
    setThinkingLevel(level);
    if (isNew && !sessionIdRef.current) {
      thinkingLevelOverrideRef.current = level === "auto" ? null : level;
    }
    if (level === "auto") return;
    const sid = sessionIdRef.current ?? await ensuringNewSessionRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "set_thinking_level", level });
    } catch (e) {
      console.error("Failed to set thinking level:", e);
    }
  }, [isNew]);

  // ─── Tool Preset ───────────────────────────────────────

  const handleToolPresetChange = useCallback(async (preset: "none" | "default" | "full") => {
    const toolNames = preset === "default" || preset === "full"
      ? ["read", "bash", "edit", "write", "grep", "find", "ls"]
      : [];
    setToolPresetState(preset);
    toolPresetRef.current = preset;
    const sid = sessionIdRef.current ?? await ensuringNewSessionRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "set_tools", toolNames });
    } catch (e) {
      console.error("Failed to set tools:", e);
    }
  }, []);

  // ─── Slash Commands ────────────────────────────────────

  const loadSlashCommands = useCallback(async () => {
    const sid = sessionIdRef.current ?? await ensureNewSession();
    if (!sid) {
      setSlashCommands([]);
      return [];
    }
    setSlashCommandsLoading(true);
    try {
      const data = await sendAgentCommand<{ commands?: SlashCommandInfo[] }>(sid, { type: "get_commands" });
      const commands = data?.commands ?? [];
      setSlashCommands(commands);
      return commands;
    } catch {
      setSlashCommands([]);
      return [];
    } finally {
      setSlashCommandsLoading(false);
    }
  }, [ensureNewSession]);

  // ─── Built-in Slash Commands ───────────────────────────

  const handleBuiltinSlashCommand = useCallback(async (text: string): Promise<{ handled: boolean; message?: string; error?: string }> => {
    if (!text.startsWith("/")) return { handled: false };
    const match = text.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
    if (!match) return { handled: false };
    const [, commandName, rawArgs = ""] = match;
    const args = rawArgs.trim();
    const sid = sessionIdRef.current ?? await ensureNewSession();
    if (!sid) return { handled: true, error: "No active session" };

    try {
      switch (commandName) {
        case "compact": {
          if (isCompacting) return { handled: true, error: "Already compacting" };
          setIsCompacting(true);
          setCompactError(null);
          setCompactResult(null);
          const result = await sendAgentCommand<any>(sid, { type: "compact", ...(args ? { customInstructions: args } : {}) });
          if (result) {
            setCompactResult({ reason: "manual", tokensBefore: result.tokensBefore ?? 0, estimatedTokensAfter: result.estimatedTokensAfter ?? 0 });
          }
          await loadSession(sid, true);
          return { handled: true, message: "Compacted context" };
        }
        case "name": {
          if (!args) return { handled: true, error: "Usage: /name <name>" };
          await sendAgentCommand(sid, { type: "set_session_name", name: args });
          await loadSession(sid);
          return { handled: true, message: `Session renamed to ${args}` };
        }
        case "copy": {
          const data = await sendAgentCommand<{ text?: string }>(sid, { type: "get_last_assistant_text" });
          const textToCopy = data?.text ?? "";
          if (!textToCopy) return { handled: true, error: "No assistant message to copy" };
          await navigator.clipboard.writeText(textToCopy);
          return { handled: true, message: "Copied last assistant message" };
        }
        default:
          return { handled: false };
      }
    } catch (e) {
      return { handled: true, error: e instanceof Error ? e.message : String(e) };
    } finally {
      if (commandName === "compact") setIsCompacting(false);
    }
  }, [ensureNewSession, isCompacting, loadSession]);

  // ─── Abort Compaction ──────────────────────────────────

  const handleAbortCompaction = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "abort_compaction" });
    } catch (e) {
      console.error("Failed to abort compaction:", e);
    }
  }, []);

  // ─── Navigate ──────────────────────────────────────────

  const handleNavigate = useCallback(async (entryId: string) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    sendAgentCommand(sid, { type: "navigate_tree", targetId: entryId }).catch(() => {});
    // Load context for the branch (via Node bridge)
    try {
      const cmdResult = await sendAgentCommand<{ messages: AgentMessage[]; entryIds: string[] }>(sid, {
        type: "get_context",
        leafId: entryId,
      });
      setMessages(cmdResult.messages);
      setEntryIds(cmdResult.entryIds ?? []);
    } catch (e) {
      console.error("Failed to load context:", e);
    }
  }, []);

  // ─── Effects ───────────────────────────────────────────

  // Load session when session.id changes
  useEffect(() => {
    if (session) {
      sessionIdRef.current = session.id;
      loadSession(session.id, true).then(() => {
        if (agentRunningRef.current) {
          connectEvents(session.id);
        }
      });
    } else {
      // Clear session data when no session is selected
      sessionIdRef.current = null;
      setData(null);
      setMessages([]);
      setEntryIds([]);
      setError(null);
    }
    return () => {
      closeEvents();
    };
  }, [session?.id, loadSession, connectEvents, closeEvents]);

  // Load models - also reload when session changes to ensure we get the correct models for the session's cwd
  useEffect(() => {
    const controller = new AbortController();
    loadModels(controller.signal);
    return () => controller.abort();
  }, [loadModels, modelsRefreshKey, session?.id]);

  // Notice auto-dismiss
  useEffect(() => {
    if (noticeState.visible.length === 0) return;
    const exiting = noticeState.visible.find((notice) => notice.exiting);
    if (exiting) {
      const t = setTimeout(() => dispatchNotice({ type: "remove", id: exiting.id }), NOTICE_EXIT_ANIMATION_MS);
      return () => clearTimeout(t);
    }
    const oldest = noticeState.visible[0];
    if (!oldest) return;
    const t = setTimeout(() => dispatchNotice({ type: "mark_oldest_exiting" }), NOTICE_VISIBLE_MS);
    return () => clearTimeout(t);
  }, [noticeState.visible]);

  // Compact result auto-dismiss
  useEffect(() => {
    if (!compactResult) return;
    const t = setTimeout(() => setCompactResult(null), 6000);
    return () => clearTimeout(t);
  }, [compactResult]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (messages.length > 0 && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: agentRunning ? "smooth" : "auto" });
    }
  }, [messages.length, agentRunning]);

  return {
    // State
    data, loading, error, messages, entryIds, streamState,
    agentRunning, modelNames, modelList, modelError,
    newSessionModel, toolPreset, thinkingLevel,
    retryInfo, contextUsage, systemPrompt, forkingEntryId,
    isCompacting, compactError, compactResult, currentModel, displayModel, sessionStats,
    slashCommands, slashCommandsLoading, queuedMessages,
    notices: noticeState.visible,
    agentPhase,
    isNew,
    bashRunning, pendingBash,
    // Refs
    sessionIdRef, messagesEndRef, scrollContainerRef, lastUserMsgRef,
    // Actions
    handleSend, handleAbort, handleFork, handleNavigate, handleModelChange,
    handleCompact, handleSteer, handleFollowUp, handleAbortCompaction,
    handleRecallQueue, handleBuiltinSlashCommand,
    handleToolPresetChange, handleThinkingLevelChange, loadSlashCommands,
    addNotice,
    // Derived
    isAutoModelSelection: isNew && newSessionModel === null,
  };
}
