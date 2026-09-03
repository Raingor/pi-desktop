// Background tasks panel — every command started from the terminal panel plus
// the pi chat runs the server currently has in flight. Both can be stopped.

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  CircleStop,
  Loader2,
  MessageSquare,
  RefreshCw,
  Trash2,
  XCircle,
} from "lucide-react";

const POLL_MS = 2000;

export interface TaskSummary {
  id: string;
  command: string;
  cwd: string;
  label: string;
  startedAt: number;
  endedAt: number | null;
  state: "running" | "exited" | "failed" | "killed";
  exitCode: number | null;
  outputBytes: number;
}

function elapsed(task: TaskSummary): string {
  const ms = (task.endedAt ?? Date.now()) - task.startedAt;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
}

const STATE_LABEL: Record<TaskSummary["state"], string> = {
  running: "运行中",
  exited: "已完成",
  failed: "失败",
  killed: "已终止",
};

export function TasksPanel({ onOpenTask }: { onOpenTask: (id: string) => void }) {
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [chats, setChats] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback((quiet = false) => {
    if (!quiet) setLoading(true);
    Promise.all([
      fetch("/api/pi/workspace/tasks").then((r) => r.json()).catch(() => ({ tasks: [] })),
      fetch("/api/pi/chat/active").then((r) => r.json()).catch(() => ({ sessionIds: [] })),
    ])
      .then(([taskData, chatData]) => {
        setTasks(taskData.tasks ?? []);
        setChats(chatData.sessionIds ?? []);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const id = window.setInterval(() => load(true), POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const post = (path: string, body: unknown) =>
    fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(() => load(true));

  const running = tasks.filter((t) => t.state === "running").length;
  const finished = tasks.length - running;

  return (
    <div className="tool-panel-body">
      <div className="tool-panel-bar">
        <span className="tool-panel-bar-title">后台任务</span>
        <span className="tool-panel-bar-meta">
          {running + chats.length > 0 ? `${running + chats.length} 运行中` : "空闲"}
        </span>
        {finished > 0 && (
          <button
            className="tool-icon-btn"
            aria-label="清除已结束"
            title="清除已结束的任务"
            onClick={() => post("/api/pi/workspace/tasks-clear", {})}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
        <button className="tool-icon-btn" aria-label="刷新" onClick={() => load()}>
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {tasks.length === 0 && chats.length === 0 && !loading ? (
        <div className="tool-panel-empty">没有后台任务。在终端面板执行命令后会出现在这里。</div>
      ) : (
        <ul className="tool-task-list">
          {chats.map((sessionId) => (
            <li key={`chat-${sessionId}`} className="tool-task-row">
              <MessageSquare className="h-3.5 w-3.5 tool-task-icon is-running" />
              <span className="tool-task-main">
                <span className="tool-task-cmd">pi 对话运行中</span>
                <span className="tool-task-meta" title={sessionId}>
                  会话 {sessionId.slice(0, 8)}
                </span>
              </span>
              <button
                className="tool-icon-btn"
                aria-label="停止"
                title="停止这次对话"
                onClick={() => post("/api/pi/chat/stop", { sessionId })}
              >
                <CircleStop className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}

          {tasks.map((task) => (
            <li key={task.id} className="tool-task-row">
              {task.state === "running" ? (
                <Loader2 className="h-3.5 w-3.5 tool-task-icon is-running animate-spin" />
              ) : task.state === "exited" ? (
                <CheckCircle2 className="h-3.5 w-3.5 tool-task-icon is-ok" />
              ) : (
                <XCircle className="h-3.5 w-3.5 tool-task-icon is-fail" />
              )}
              <button
                className="tool-task-main is-clickable"
                onClick={() => onOpenTask(task.id)}
                title={`${task.command}\n${task.cwd}`}
              >
                <span className="tool-task-cmd">{task.command}</span>
                <span className="tool-task-meta">
                  {STATE_LABEL[task.state]} · {elapsed(task)}
                  {task.exitCode !== null && task.state !== "exited"
                    ? ` · code ${task.exitCode}`
                    : ""}
                </span>
              </button>
              {task.state === "running" && (
                <button
                  className="tool-icon-btn"
                  aria-label="终止"
                  title="终止任务"
                  onClick={() => post("/api/pi/workspace/task-stop", { id: task.id })}
                >
                  <CircleStop className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
