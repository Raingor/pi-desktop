// SubAgent panel — a live view of subagent runs so a long fan-out can be
// watched while the conversation continues. Polls while the panel is visible.

import { useCallback, useState } from "react";
import {
  CheckCircle2,
  Loader2,
  RefreshCw,
  Users,
  XCircle,
} from "lucide-react";
import { usePolling } from "@/hooks/usePolling";
import type { SubagentsData } from "@/types";

const POLL_MS = 4000;

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return `${Math.max(1, Math.round(diff / 1000))} 秒前`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} 小时前`;
  return new Date(ts).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function formatDuration(ms?: number): string {
  if (!ms) return "";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
}

/** A run is "live" when it has not reported a terminal status yet. */
function isRunning(status: string): boolean {
  const s = status.toLowerCase();
  return s === "running" || s === "active" || s === "started" || s === "pending";
}

export function SubagentPanel() {
  const [data, setData] = useState<SubagentsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((quiet = false) => {
    if (!quiet) setLoading(true);
    fetch("/api/pi/subagents")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((payload: SubagentsData) => {
        setData(payload);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "读取失败"))
      .finally(() => setLoading(false));
  }, []);

  usePolling(() => load(true), POLL_MS);

  const runs = data?.runHistory ?? [];
  const live = runs.filter((r) => isRunning(r.status));

  return (
    <div className="tool-panel-body">
      <div className="tool-panel-bar">
        <Users className="h-3.5 w-3.5 tool-panel-bar-icon" />
        <span className="tool-panel-bar-title">
          {data ? `${data.agents.length} 个代理` : "子代理"}
        </span>
        <span className="tool-panel-bar-meta">
          {live.length > 0 ? `${live.length} 运行中` : `${runs.length} 条记录`}
        </span>
        <button className="tool-icon-btn" aria-label="刷新" onClick={() => load()}>
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {error ? (
        <div className="tool-panel-empty">{error}</div>
      ) : runs.length === 0 && !loading ? (
        <div className="tool-panel-empty">还没有子代理运行记录</div>
      ) : (
        <ul className="tool-run-list">
          {runs.slice(0, 60).map((run, i) => (
            <li key={`${run.agent}-${run.ts}-${i}`} className="tool-run-row">
              <span className="tool-run-icon">
                {isRunning(run.status) ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin is-running" />
                ) : run.exit === 0 || run.status.toLowerCase() === "ok" ? (
                  <CheckCircle2 className="h-3.5 w-3.5 is-ok" />
                ) : (
                  <XCircle className="h-3.5 w-3.5 is-fail" />
                )}
              </span>
              <span className="tool-run-main">
                <span className="tool-run-agent">{run.agent}</span>
                <span className="tool-run-meta">
                  {relativeTime(run.ts)}
                  {run.duration ? ` · ${formatDuration(run.duration)}` : ""}
                  {run.status && !isRunning(run.status) ? ` · ${run.status}` : ""}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {data && data.agents.length > 0 && (
        <div className="tool-panel-footnote">
          可用代理：{data.agents.slice(0, 8).map((a) => a.name).join("、")}
          {data.agents.length > 8 ? ` 等 ${data.agents.length} 个` : ""}
        </div>
      )}
    </div>
  );
}
