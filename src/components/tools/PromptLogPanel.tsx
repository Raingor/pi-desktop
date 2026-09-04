// Prompt log tool panel — every prompt sent in the conversation on screen.
//
// Fed from WorkspaceContext by the chat page rather than fetched here: the
// panel then shows exactly what the chat pane shows, in the same order, with
// no possibility of drift. Newest first; the in-flight prompt is badged.

import { ScrollText } from "lucide-react";
import { useWorkspace } from "@/lib/workspace";

export function PromptLogPanel() {
  const { promptLog, chatRunning } = useWorkspace();

  return (
    <div className="tool-panel-body">
      <div className="tool-panel-bar">
        <span className="tool-panel-bar-title">发送记录</span>
        <span className="tool-panel-bar-meta">
          {chatRunning ? "运行中" : promptLog.length > 0 ? `${promptLog.length} 条` : "本会话"}
        </span>
      </div>
      {promptLog.length === 0 ? (
        <div className="tool-panel-empty">
          还没有发送记录。在本会话输入框里提交提示词后会出现在这里。
        </div>
      ) : (
        <div className="tool-prompt-log">
          {promptLog.map((entry, index) => (
            <div key={entry.id ?? index} className="tool-prompt-log-item">
              <span className="tool-prompt-log-time">
                {entry.time}
                {index === 0 && chatRunning && (
                  <em className="tool-prompt-log-live">运行中</em>
                )}
              </span>
              <span className="tool-prompt-log-text" title={entry.text}>
                {entry.text}
              </span>
            </div>
          ))}
        </div>
      )}
      <p className="tool-prompt-log-hint">
        <ScrollText className="h-3 w-3" />
        记录跟随当前打开的会话，最多显示最近 8 条。
      </p>
    </div>
  );
}
