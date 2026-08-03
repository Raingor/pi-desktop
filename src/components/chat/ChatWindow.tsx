// ChatWindow — main chat area with messages and input.
// Ported and simplified from pi-web's components/ChatWindow.tsx.

import { useCallback, useRef, useEffect, type ReactNode } from "react";
import type { AgentMessage, AssistantMessage, SessionInfo, SessionTreeNode } from "@/types/chat";
import { MessageView } from "./MessageView";
import { ChatInput } from "./ChatInput";
import type { ChatInputHandle } from "@/types/chat";
import { useAgentSession, type ThinkingLevelOption } from "@/hooks/useAgentSession";
import type { SessionStatsInfo, AgentPhase, NoticeItem } from "@/types/chat";
import { useTranslation } from "@/lib/i18n";

interface Props {
  session: SessionInfo | null;
  newSessionCwd: string | null;
  onAgentEnd?: () => void;
  onSessionCreated?: (session: SessionInfo) => void;
  onSessionForked?: (newSessionId: string) => void;
  modelsRefreshKey?: number;
  chatInputRef?: React.RefObject<ChatInputHandle | null>;
  onSessionStatsChange?: (stats: SessionStatsInfo | null) => void;
  onContextUsageChange?: (usage: { percent: number | null; contextWindow: number; tokens: number | null } | null) => void;
}

function phaseLabel(phase: AgentPhase, t: (key: string, ...args: string[]) => string): string | null {
  if (phase?.kind === "running_tools") {
    const names = phase.tools.map((t) => t.name);
    if (names.length === 0) return t("chat.running_tool");
    if (names.length === 1) return t("chat.running_tool") + " " + names[0] + "...";
    if (names.length <= 3) return t("chat.running_tool") + " " + names.join(", ") + "...";
    return t("chat.running_tool") + " " + names.slice(0, 2).join(", ") + " +" + (names.length - 2) + "...";
  }
  if (phase?.kind === "waiting_model") return t("chat.thinking");
  if (phase?.kind === "running_command") return t("chat.running_command");
  return null;
}

export function ChatWindow({
  session,
  newSessionCwd,
  onAgentEnd,
  onSessionCreated,
  onSessionForked,
  modelsRefreshKey,
  chatInputRef,
  onSessionStatsChange,
  onContextUsageChange,
}: Props) {
  const { t } = useTranslation();
  const {
    loading, error, messages, entryIds, streamState,
    agentRunning, bashRunning, pendingBash,
    modelNames, modelList, modelError,
    newSessionModel, toolPreset, thinkingLevel,
    retryInfo, contextUsage, forkingEntryId,
    isCompacting, compactError, compactResult,
    displayModel, sessionStats,
    slashCommands, slashCommandsLoading, queuedMessages,
    notices,
    agentPhase,
    isNew,
    sessionIdRef, messagesEndRef, scrollContainerRef,
    handleSend, handleAbort, handleFork, handleModelChange,
    handleCompact, handleSteer, handleFollowUp, handleAbortCompaction,
    handleRecallQueue, handleBuiltinSlashCommand,
    handleToolPresetChange, handleThinkingLevelChange, loadSlashCommands,
    isAutoModelSelection,
  } = useAgentSession({
    session, newSessionCwd, onAgentEnd, onSessionCreated, onSessionForked,
    modelsRefreshKey, chatInputRef,
  });

  // Push stats up to parent - use useEffect to avoid setState during render
  useEffect(() => {
    onSessionStatsChange?.(sessionStats);
  }, [sessionStats, onSessionStatsChange]);

  // Push context usage up to parent - use useEffect to avoid setState during render
  useEffect(() => {
    onContextUsageChange?.(contextUsage);
  }, [contextUsage, onContextUsageChange]);

  // ─── Tool results map ─────────────────────────────────

  const toolResultsMap = new Map<string, any>();
  for (const msg of messages) {
    if (msg.role === "toolResult") {
      toolResultsMap.set((msg as any).toolCallId, msg);
    }
  }

  // ─── Input History ────────────────────────────────────

  const inputHistory: string[] = [];
  const seen = new Set<string>();
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || msg.role !== "user") continue;
    const text = typeof msg.content === "string"
      ? msg.content
      : Array.isArray(msg.content)
        ? msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n")
        : "";
    if (!text || seen.has(text)) continue;
    seen.add(text);
    inputHistory.push(text);
    if (inputHistory.length >= 50) break;
  }
  inputHistory.reverse();

  // ─── Render ────────────────────────────────────────────

  const isEmptyNew = isNew && messages.length === 0 && !streamState.isStreaming && !agentRunning;

  if (loading) {
    return (
      <div style={{ display: "flex", height: "100%", alignItems: "center", justifyContent: "center", color: "var(--text-muted)" }}>
        {t("chat.loading_session")}
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: "flex", height: "100%", alignItems: "center", justifyContent: "center", color: "#dc2626" }}>
        {error}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Notices */}
      {notices.length > 0 && (
        <div style={{
          position: "absolute",
          top: 12,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 40,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 6,
        }}>
          {notices.map((notice) => {
            const color = notice.type === "error" ? "#dc2626"
              : notice.type === "warning" ? "#d97706"
              : notice.type === "success" ? "#10b981"
              : "var(--accent)";
            return (
              <div key={notice.id} style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 14px",
                borderRadius: 10,
                background: "var(--bg-panel)",
                border: "1px solid var(--border)",
                fontSize: 13,
                color: "var(--text-muted)",
                boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                opacity: notice.exiting ? 0.5 : 1,
                transition: "opacity 0.18s",
              }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0 }} />
                <span>{notice.message}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Messages area */}
      {isEmptyNew ? (
        <div style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px 16px",
        }}>
          <div style={{ width: "100%", maxWidth: 760 }}>
            <div style={{
              display: "flex",
              alignItems: "baseline",
              gap: 10,
              marginBottom: 24,
            }}>
              <span style={{ fontSize: 32, fontWeight: 700, color: "var(--accent)" }}>π</span>
              <span style={{ fontSize: 24, fontWeight: 700, color: "var(--text)" }}>Pi Chat</span>
            </div>
            <ChatInput
              ref={chatInputRef}
              onSend={handleSend}
              onAbort={handleAbort}
              isStreaming={agentRunning}
              model={displayModel}
              isAutoModelSelection={isAutoModelSelection}
              modelNames={modelNames}
              modelList={modelList}
              modelError={modelError}
              onModelChange={handleModelChange}
              onCompact={handleCompact}
              isCompacting={isCompacting}
              compactError={compactError}
              toolPreset={toolPreset}
              onToolPresetChange={handleToolPresetChange}
              thinkingLevel={thinkingLevel}
              onThinkingLevelChange={handleThinkingLevelChange}
              retryInfo={retryInfo}
              queuedMessages={queuedMessages}
              onRecallQueue={handleRecallQueue}
              slashCommands={slashCommands}
              slashCommandsLoading={slashCommandsLoading}
              onLoadSlashCommands={loadSlashCommands}
              onBuiltinCommand={handleBuiltinSlashCommand}
              inputHistory={inputHistory}
              draftKey={session?.id ?? (newSessionCwd ? `new:${newSessionCwd}` : undefined)}
              cwd={session?.cwd ?? newSessionCwd ?? undefined}
            />
          </div>
        </div>
      ) : (
        <>
          <div
            ref={scrollContainerRef}
            style={{
              flex: 1,
              overflowY: "auto",
              overflowX: "hidden",
              padding: "16px 16px 0 16px",
            }}
          >
            <div style={{ maxWidth: 820, margin: "0 auto" }}>
              {messages.map((msg, idx) => {
                const entryId = entryIds[idx];
                const isLastUser = idx === messages.length - 1 && msg.role === "user";
                return (
                  <MessageView
                    key={`msg-${idx}-${entryId ?? idx}`}
                    message={msg}
                    isStreaming={streamState.isStreaming && idx === messages.length - 1}
                    modelNames={modelNames}
                    cwd={session?.cwd ?? newSessionCwd ?? undefined}
                    entryId={entryId}
                    onFork={agentRunning || isNew || (idx === 0 && msg.role === "user") ? undefined : handleFork}
                    forking={forkingEntryId === entryId}
                    showTimestamp={true}
                    sessionId={session?.id ?? sessionIdRef.current ?? undefined}
                  />
                );
              })}

              {/* Streaming message */}
              {streamState.isStreaming && streamState.streamingMessage && (
                <MessageView
                  message={streamState.streamingMessage as AgentMessage}
                  isStreaming
                  modelNames={modelNames}
                  cwd={session?.cwd ?? newSessionCwd ?? undefined}
                />
              )}

              {/* Agent phase indicator */}
              {agentRunning && !streamState.streamingMessage && agentPhase && (
                <div style={{ padding: "8px 0", fontSize: 13, color: "var(--text-muted)" }}>
                  <span style={{ animation: "pulse 1.5s infinite" }}>{phaseLabel(agentPhase, t)}</span>
                </div>
              )}

              {bashRunning && !pendingBash && (
                <div style={{ padding: "8px 0", fontSize: 13, color: "var(--text-muted)" }}>
                  <span style={{ animation: "pulse 1.5s infinite" }}>{t("chat.running_command")}</span>
                </div>
              )}

              {pendingBash && (
                <MessageView
                  message={{
                    role: "bashExecution",
                    command: pendingBash.command,
                    output: "",
                    excludeFromContext: pendingBash.excludeFromContext,
                  } as any}
                  sessionId={session?.id ?? sessionIdRef.current ?? undefined}
                />
              )}

              {agentRunning && (
                <div style={{ height: scrollContainerRef.current?.clientHeight ? scrollContainerRef.current.clientHeight * 0.6 : "60vh" }} />
              )}

              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Input area */}
          <div>
            <ChatInput
              ref={chatInputRef}
              onSend={handleSend}
              onAbort={handleAbort}
              onSteer={agentRunning ? handleSteer : undefined}
              onFollowUp={agentRunning ? handleFollowUp : undefined}
              isStreaming={agentRunning || bashRunning}
              model={displayModel}
              isAutoModelSelection={isAutoModelSelection}
              modelNames={modelNames}
              modelList={modelList}
              modelError={modelError}
              onModelChange={handleModelChange}
              onCompact={handleCompact}
              isCompacting={isCompacting}
              compactError={compactError}
              onAbortCompaction={handleAbortCompaction}
              toolPreset={toolPreset}
              onToolPresetChange={handleToolPresetChange}
              thinkingLevel={thinkingLevel}
              onThinkingLevelChange={handleThinkingLevelChange}
              retryInfo={retryInfo}
              queuedMessages={queuedMessages}
              onRecallQueue={handleRecallQueue}
              slashCommands={slashCommands}
              slashCommandsLoading={slashCommandsLoading}
              onLoadSlashCommands={loadSlashCommands}
              onBuiltinCommand={handleBuiltinSlashCommand}
              inputHistory={inputHistory}
              draftKey={session?.id ?? (newSessionCwd ? `new:${newSessionCwd}` : undefined)}
              cwd={session?.cwd ?? newSessionCwd ?? undefined}
            />
          </div>
        </>
      )}
    </div>
  );
}
