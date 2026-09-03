// Files panel — a scoped browser for the current project directory.
// Listing and reading are root-checked server side; this only renders.

import { useCallback, useEffect, useState } from "react";
import {
  ChevronLeft,
  File as FileIcon,
  Folder,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useWorkspace, toolErrorText } from "@/lib/workspace";

interface DirEntry {
  name: string;
  path: string;
  kind: "dir" | "file";
  size: number;
  mtime: number;
}

interface DirListing {
  root: string;
  rootName: string;
  path: string;
  parent: string | null;
  entries: DirEntry[];
  error?: string;
}

interface FilePreview {
  path: string;
  name: string;
  size: number;
  content: string;
  truncated: boolean;
  binary: boolean;
  error?: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export function FilesPanel() {
  const { cwd, cwdName } = useWorkspace();
  const [path, setPath] = useState(".");
  const [listing, setListing] = useState<DirListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<FilePreview | null>(null);

  // A new project root invalidates the current position in the tree.
  useEffect(() => {
    setPath(".");
    setPreview(null);
  }, [cwd]);

  const load = useCallback(
    (target: string) => {
      if (!cwd) return;
      setLoading(true);
      fetch(
        `/api/pi/workspace/tree?root=${encodeURIComponent(cwd)}&path=${encodeURIComponent(target)}`,
      )
        .then((res) => res.json())
        .then((data: DirListing) => setListing(data))
        .catch(() => setListing(null))
        .finally(() => setLoading(false));
    },
    [cwd],
  );

  useEffect(() => {
    load(path);
  }, [load, path]);

  const openFile = (entry: DirEntry) => {
    setPreview(null);
    fetch(
      `/api/pi/workspace/file?root=${encodeURIComponent(cwd)}&path=${encodeURIComponent(entry.path)}`,
    )
      .then((res) => res.json())
      .then((data: FilePreview) => setPreview(data))
      .catch(() => setPreview(null));
  };

  if (!cwd) {
    return <div className="tool-panel-empty">尚未确定项目目录</div>;
  }

  if (preview) {
    return (
      <div className="tool-panel-body">
        <div className="tool-panel-bar">
          <button className="tool-crumb-back" onClick={() => setPreview(null)}>
            <ChevronLeft className="h-3.5 w-3.5" /> 返回
          </button>
          <span className="tool-panel-bar-title" title={preview.path}>
            {preview.name}
          </span>
          <span className="tool-panel-bar-meta">{formatSize(preview.size)}</span>
        </div>
        {preview.error ? (
          <div className="tool-panel-empty">{toolErrorText(preview.error)}</div>
        ) : preview.binary ? (
          <div className="tool-panel-empty">二进制文件，无法预览</div>
        ) : (
          <pre className="tool-file-view">
            {preview.content}
            {preview.truncated ? "\n\n… 已截断（超过 512 KB）" : ""}
          </pre>
        )}
      </div>
    );
  }

  return (
    <div className="tool-panel-body">
      <div className="tool-panel-bar">
        {listing?.parent !== null && listing?.parent !== undefined ? (
          <button
            className="tool-crumb-back"
            onClick={() => setPath(listing.parent || ".")}
          >
            <ChevronLeft className="h-3.5 w-3.5" /> 上级
          </button>
        ) : (
          <Folder className="h-3.5 w-3.5 tool-panel-bar-icon" />
        )}
        <span className="tool-panel-bar-title" title={`${cwd}/${listing?.path ?? ""}`}>
          {listing?.path || cwdName}
        </span>
        <button
          className="tool-icon-btn"
          aria-label="刷新"
          onClick={() => load(path)}
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {listing?.error ? (
        <div className="tool-panel-empty">{toolErrorText(listing.error)}</div>
      ) : listing && listing.entries.length === 0 ? (
        <div className="tool-panel-empty">空目录</div>
      ) : (
        <ul className="tool-file-list">
          {listing?.entries.map((entry) => (
            <li key={entry.path}>
              <button
                className="tool-file-row"
                onClick={() =>
                  entry.kind === "dir" ? setPath(entry.path) : openFile(entry)
                }
                title={entry.path}
              >
                {entry.kind === "dir" ? (
                  <Folder className="h-3.5 w-3.5 tool-file-icon is-dir" />
                ) : (
                  <FileIcon className="h-3.5 w-3.5 tool-file-icon" />
                )}
                <span className="tool-file-name">{entry.name}</span>
                {entry.kind === "file" && (
                  <span className="tool-file-size">{formatSize(entry.size)}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
