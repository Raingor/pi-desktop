// Terminal panel — runs shell commands in the project directory and streams
// their output back by polling the task's byte offset.
//
// This is a command runner, not a terminal emulator: without a PTY the child
// sees a pipe, so interactive programs (vim, top, prompts that need a tty) will
// not work. That is a deliberate tradeoff — a PTY means a native module, and
// the packaged app deliberately ships no node_modules. "在系统终端打开" covers
// the interactive cases.

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleStop, CornerDownLeft, ExternalLink, Loader2, Trash2 } from "lucide-react";
import { useWorkspace } from "@/lib/workspace";
import type { TaskSummary } from "./TasksPanel";

const POLL_MS = 500;
const HISTORY_KEY = "pi-desktop:terminal-history";
const MAX_HISTORY = 40;

interface TaskOutput extends TaskSummary {
  offset: number;
  output: string;
  dropped: boolean;
}

function loadHistory(): string[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function TerminalPanel({
  attachTaskId,
  onAttached,
}: {
  attachTaskId: string | null;
  onAttached: () => void;
}) {
  const { cwd, cwdName } = useWorkspace();
  const [command, setCommand] = useState("");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [task, setTask] = useState<TaskSummary | null>(null);
  const [output, setOutput] = useState("");
  const [starting, setStarting] = useState(false);
  const [history, setHistory] = useState<string[]>(loadHistory);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const outputRef = useRef<HTMLPreElement | null>(null);
  const consumedRef = useRef(0);

  // Opening a task from the tasks panel attaches this panel to it.
  useEffect(() => {
    if (!attachTaskId) return;
    setTaskId(attachTaskId);
    setOutput("");
    consumedRef.current = 0;
    onAttached();
  }, [attachTaskId, onAttached]);

  // Poll the attached task for new bytes. Stops once the task is finished and
  // its tail has been drained.
  useEffect(() => {
    if (!taskId) return;
    let cancelled = false;
    let timer = 0;

    const tick = () => {
      fetch(`/api/pi/workspace/task-output?id=${encodeURIComponent(taskId)}&since=${consumedRef.current}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data: TaskOutput | null) => {
          if (cancelled || !data) return;
          setTask(data);
          if (data.output) {
            consumedRef.current = data.offset + data.output.length;
            setOutput((prev) => (data.dropped ? `…（早期输出已丢弃）\n${data.output}` : prev + data.output));
          }
          if (data.state === "running") timer = window.setTimeout(tick, POLL_MS);
        })
        .catch(() => {
          /* leave the last known output on screen */
        });
    };

    tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [taskId]);

  // Follow the tail as output arrives.
  useEffect(() => {
    const el = outputRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [output]);

  const pushHistory = useCallback((entry: string) => {
    setHistory((prev) => {
      const next = [entry, ...prev.filter((x) => x !== entry)].slice(0, MAX_HISTORY);
      try {
        window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      } catch {
        /* private mode — history is best-effort */
      }
      return next;
    });
  }, []);

  const running = task?.state === "running";

  const submit = () => {
    const text = command.trim();
    if (!text) return;

    // While a task runs, Enter feeds the child's stdin instead of starting a
    // second command — that is the closest thing to a prompt this panel has.
    if (running && taskId) {
      fetch("/api/pi/workspace/task-input", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: taskId, data: `${text}\n` }),
      }).catch(() => {});
      setOutput((prev) => `${prev}${text}\n`);
      setCommand("");
      return;
    }

    setStarting(true);
    setOutput("");
    consumedRef.current = 0;
    fetch("/api/pi/workspace/task-run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: text, cwd }),
    })
      .then((res) => res.json())
      .then((data: { id?: string; error?: string }) => {
        if (data.id) {
          setTaskId(data.id);
          pushHistory(text);
          setCommand("");
          setHistoryIndex(-1);
        } else {
          setOutput(`无法执行：${data.error ?? "未知错误"}\n`);
        }
      })
      .catch((e: unknown) => setOutput(`无法执行：${e instanceof Error ? e.message : "请求失败"}\n`))
      .finally(() => setStarting(false));
  };

  const stop = () => {
    if (!taskId) return;
    fetch("/api/pi/workspace/task-stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: taskId }),
    }).catch(() => {});
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
      return;
    }
    // Ctrl-C maps to SIGTERM on the running child.
    if (event.key === "c" && event.ctrlKey && running) {
      event.preventDefault();
      stop();
      return;
    }
    if (event.key === "ArrowUp" && history.length > 0) {
      event.preventDefault();
      const next = Math.min(historyIndex + 1, history.length - 1);
      setHistoryIndex(next);
      setCommand(history[next] ?? "");
      return;
    }
    if (event.key === "ArrowDown" && historyIndex >= 0) {
      event.preventDefault();
      const next = historyIndex - 1;
      setHistoryIndex(next);
      setCommand(next < 0 ? "" : history[next] ?? "");
    }
  };

  return (
    <div className="tool-panel-body">
      <div className="tool-panel-bar">
        <span className="tool-panel-bar-title" title={cwd}>
          {cwdName || "终端"}
        </span>
        {task && (
          <span className="tool-panel-bar-meta">
            {running ? "运行中" : task.state === "exited" ? "已完成" : `退出 ${task.exitCode ?? ""}`}
          </span>
        )}
        {running && (
          <button className="tool-icon-btn" aria-label="终止" title="终止（Ctrl+C）" onClick={stop}>
            <CircleStop className="h-3.5 w-3.5" />
          </button>
        )}
        {output && !running && (
          <button
            className="tool-icon-btn"
            aria-label="清屏"
            onClick={() => {
              setOutput("");
              setTaskId(null);
              setTask(null);
              consumedRef.current = 0;
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          className="tool-icon-btn"
          aria-label="在系统终端打开"
          title="在系统终端打开（支持交互式程序）"
          onClick={() => window.piAPI?.openTerminal?.(cwd)}
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
      </div>

      <pre ref={outputRef} className="tool-terminal-view">
        {output || (
          <span className="tool-terminal-hint">
            在下方输入命令，回车执行。命令在 {cwdName || "项目目录"} 下运行。{"\n"}
            没有 TTY：交互式程序（vim、top）请用右上角"在系统终端打开"。
          </span>
        )}
      </pre>

      <div className="tool-terminal-input">
        <span className="tool-terminal-prompt">{running ? "»" : "$"}</span>
        <input
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={running ? "发送到运行中的进程…" : "npm test"}
          spellCheck={false}
          autoComplete="off"
        />
        <button
          className="tool-icon-btn"
          aria-label="执行"
          onClick={submit}
          disabled={starting || !command.trim()}
        >
          {starting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <CornerDownLeft className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
    </div>
  );
}
