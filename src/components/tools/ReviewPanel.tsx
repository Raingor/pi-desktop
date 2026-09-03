// Review panel — git working-tree changes for the current project, with a
// coloured unified diff per file. Read-only: nothing here stages or commits.

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, GitBranch, Loader2, RefreshCw } from "lucide-react";
import { useWorkspace } from "@/lib/workspace";

interface GitFileChange {
  path: string;
  status: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
}

interface GitReview {
  repo: string | null;
  branch: string;
  ahead: number;
  behind: number;
  files: GitFileChange[];
  error?: string;
}

interface GitDiff {
  path: string;
  diff: string;
  untracked: boolean;
  error?: string;
}

/** Human label for a porcelain status pair. */
function statusLabel(code: string): string {
  if (code === "??") return "新增";
  const map: Record<string, string> = {
    M: "修改",
    A: "新增",
    D: "删除",
    R: "重命名",
    C: "复制",
    U: "冲突",
  };
  const staged = code[0] && code[0] !== " " && code[0] !== "?" ? map[code[0]] : "";
  const unstaged = code[1] && code[1] !== " " && code[1] !== "?" ? map[code[1]] : "";
  if (staged && unstaged) return `已暂存${staged} · ${unstaged}`;
  if (staged) return `已暂存${staged}`;
  return unstaged || code.trim();
}

function diffLineClass(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---")) return "is-meta";
  if (line.startsWith("@@")) return "is-hunk";
  if (line.startsWith("+")) return "is-add";
  if (line.startsWith("-")) return "is-del";
  if (line.startsWith("diff ") || line.startsWith("index ")) return "is-meta";
  return "";
}

export function ReviewPanel() {
  const { cwd, cwdName } = useWorkspace();
  const [review, setReview] = useState<GitReview | null>(null);
  const [loading, setLoading] = useState(false);
  const [openFile, setOpenFile] = useState<GitFileChange | null>(null);
  const [diff, setDiff] = useState<GitDiff | null>(null);

  const load = useCallback(() => {
    if (!cwd) return;
    setLoading(true);
    fetch(`/api/pi/workspace/review?cwd=${encodeURIComponent(cwd)}`)
      .then((res) => res.json())
      .then((data: GitReview) => setReview(data))
      .catch(() => setReview(null))
      .finally(() => setLoading(false));
  }, [cwd]);

  useEffect(() => {
    setOpenFile(null);
    setDiff(null);
    load();
  }, [load]);

  useEffect(() => {
    if (!openFile || !cwd) return;
    setDiff(null);
    fetch(
      `/api/pi/workspace/diff?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(openFile.path)}&staged=${openFile.staged && !openFile.unstaged ? "1" : "0"}`,
    )
      .then((res) => res.json())
      .then((data: GitDiff) => setDiff(data))
      .catch(() => setDiff(null));
  }, [openFile, cwd]);

  if (!cwd) return <div className="tool-panel-empty">尚未确定项目目录</div>;

  if (openFile) {
    return (
      <div className="tool-panel-body">
        <div className="tool-panel-bar">
          <button className="tool-crumb-back" onClick={() => setOpenFile(null)}>
            <ChevronLeft className="h-3.5 w-3.5" /> 返回
          </button>
          <span className="tool-panel-bar-title" title={openFile.path}>
            {openFile.path.split("/").pop()}
          </span>
          <span className="tool-panel-bar-meta">{statusLabel(openFile.status)}</span>
        </div>
        {!diff ? (
          <div className="tool-panel-empty">
            <Loader2 className="h-4 w-4 animate-spin" /> 正在读取差异…
          </div>
        ) : diff.error ? (
          <div className="tool-panel-empty">{diff.error}</div>
        ) : (
          <pre className="tool-diff-view">
            {diff.diff.split("\n").map((line, i) => (
              <span key={i} className={`tool-diff-line ${diffLineClass(line)}`}>
                {line || " "}
              </span>
            ))}
          </pre>
        )}
      </div>
    );
  }

  return (
    <div className="tool-panel-body">
      <div className="tool-panel-bar">
        <GitBranch className="h-3.5 w-3.5 tool-panel-bar-icon" />
        <span className="tool-panel-bar-title" title={review?.repo ?? cwd}>
          {review?.branch || cwdName}
        </span>
        {review && (review.ahead > 0 || review.behind > 0) && (
          <span className="tool-panel-bar-meta">
            {review.ahead > 0 && `↑${review.ahead}`}
            {review.behind > 0 && ` ↓${review.behind}`}
          </span>
        )}
        <button className="tool-icon-btn" aria-label="刷新" onClick={load}>
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {review?.error ? (
        <div className="tool-panel-empty">{review.error}</div>
      ) : review && review.files.length === 0 ? (
        <div className="tool-panel-empty">工作区干净，没有待审查的改动</div>
      ) : (
        <ul className="tool-file-list">
          {review?.files.map((file) => (
            <li key={file.path}>
              <button
                className="tool-file-row"
                onClick={() => setOpenFile(file)}
                title={file.path}
              >
                <span
                  className={`tool-review-flag ${
                    file.untracked ? "is-new" : file.staged ? "is-staged" : "is-dirty"
                  }`}
                >
                  {file.status.trim() || "M"}
                </span>
                <span className="tool-file-name">{file.path}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
