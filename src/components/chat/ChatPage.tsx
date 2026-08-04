// ChatPage — chat view (Cindy-style: the session list lives in the
// global sidebar, so this page only renders the conversation).
// Layout: top bar (session title + model) + stats bar + messages + input.

import { useRef } from "react";
import { ChatWindow } from "@/components/chat/ChatWindow";
import { ChatStatsBar } from "@/components/chat/ChatStatsBar";
import { ModelSelector } from "@/components/chat/ModelSelector";
import type { ChatInputHandle } from "@/types/chat";
import { useChatUI } from "@/store/chat-ui";
import { useTranslation } from "@/lib/i18n";

export function ChatPage() {
  const { t } = useTranslation();
  const selectedSession = useChatUI((s) => s.selectedSession);
  const newSessionCwd = useChatUI((s) => s.newSessionCwd);
  const sessionStats = useChatUI((s) => s.sessionStats);
  const contextUsage = useChatUI((s) => s.contextUsage);
  const selectSession = useChatUI((s) => s.selectSession);
  const setSessionStats = useChatUI((s) => s.setSessionStats);
  const setContextUsage = useChatUI((s) => s.setContextUsage);
  const refresh = useChatUI((s) => s.refresh);
  const chatInputRef = useRef<ChatInputHandle | null>(null);

  const showChat = selectedSession !== null || newSessionCwd !== null;

  // Compute stats for the stats bar
  const statsTokens = sessionStats?.tokens ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  const contextLimit = contextUsage?.contextWindow ?? 0;
  const contextPercent = contextUsage?.percent ?? 0;
  const contextTokens = contextLimit * (contextPercent / 100);

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {showChat ? (
        <>
          {/* Top bar: session name + model selector */}
          <div
            className="flex flex-shrink-0 items-center gap-3 px-4 py-2"
            style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-panel)" }}
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium" style={{ color: "var(--text)" }}>
                {selectedSession?.name || newSessionCwd?.split("/").pop() || "New Chat"}
              </div>
              <div className="truncate text-xs" style={{ color: "var(--text-dim)" }}>
                {selectedSession?.cwd || ""}
              </div>
            </div>
            <ModelSelector
              models={[]}
              currentModel={null}
              onChange={() => {}}
            />
          </div>

          {/* Stats bar */}
          {sessionStats && (
            <ChatStatsBar
              contextTokens={contextTokens}
              contextLimit={contextLimit}
              contextPercent={contextPercent}
              cost={sessionStats.cost}
              inputTokens={statsTokens.input}
              outputTokens={statsTokens.output}
            />
          )}

          {/* Chat messages */}
          <div className="relative flex-1 overflow-hidden">
            <ChatWindow
              session={selectedSession}
              newSessionCwd={newSessionCwd}
              onAgentEnd={refresh}
              onSessionCreated={(s) => selectSession(s)}
              chatInputRef={chatInputRef}
              onSessionStatsChange={setSessionStats}
              onContextUsageChange={setContextUsage}
            />
          </div>
        </>
      ) : (
        /* Empty state */
        <div className="flex h-full flex-col items-center justify-center p-6" style={{ color: "var(--text-muted)" }}>
          <div className="mb-4 text-5xl opacity-20">π</div>
          <div className="mb-2 text-lg font-semibold" style={{ color: "var(--text)" }}>
            Select a session
          </div>
          <div className="max-w-sm text-center text-sm" style={{ opacity: 0.7 }}>
            {t("chat.welcome_desc")}
          </div>
        </div>
      )}
    </div>
  );
}
