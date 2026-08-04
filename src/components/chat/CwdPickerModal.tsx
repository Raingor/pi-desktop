// CwdPickerModal — global "New Chat" working-directory picker.
// Shown by the sidebar "New Chat" action (Cindy-style top action).
import { useState, useEffect, useCallback } from "react";
import { useChatUI } from "@/store/chat-ui";
import { Folder } from "lucide-react";

export function CwdPickerModal() {
  const showCwdPicker = useChatUI((s) => s.showCwdPicker);
  const closeCwdPicker = useChatUI((s) => s.closeCwdPicker);
  const confirmCwd = useChatUI((s) => s.confirmCwd);

  const [cwdInput, setCwdInput] = useState("");
  const [cwdError, setCwdError] = useState<string | null>(null);
  const [browsePath, setBrowsePath] = useState("");
  const [browseItems, setBrowseItems] = useState<{ name: string; isDirectory: boolean; path: string }[]>([]);

  const browse = useCallback(async (path: string) => {
    setBrowsePath(path);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<{ path: string; items: { name: string; isDirectory: boolean; path: string }[] }>(
        "fs_list_dir", { path }
      );
      setBrowseItems(result.items ?? []);
    } catch { setBrowseItems([]); }
  }, []);

  // Reset + load home when opened
  useEffect(() => {
    if (!showCwdPicker) return;
    setCwdInput("");
    setCwdError(null);
    const loadHome = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const home = await invoke<string>("system_get_home_dir");
        setCwdInput(home);
        void browse(home);
      } catch { /* ignore */ }
    };
    void loadHome();
  }, [showCwdPicker, browse]);

  const handleConfirmCwd = useCallback(async () => {
    setCwdError(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const validated = await invoke<string>("fs_validate_dir", { path: cwdInput });
      confirmCwd(validated);
    } catch (e) {
      setCwdError(String(e));
    }
  }, [cwdInput, confirmCwd]);

  if (!showCwdPicker) return null;

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.4)" }}
    >
      <div
        className="flex max-h-[80%] w-[560px] flex-col overflow-hidden rounded-xl"
        style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", boxShadow: "0 20px 60px rgba(0,0,0,0.4)" }}
      >
        <div className="px-4 py-3 text-sm font-semibold" style={{ borderBottom: "1px solid var(--border)", color: "var(--text)" }}>
          Select working directory
        </div>
        <div className="border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
          <input
            value={cwdInput}
            onChange={(e) => { setCwdInput(e.target.value); setCwdError(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") void handleConfirmCwd(); if (e.key === "Escape") closeCwdPicker(); }}
            placeholder="/path/to/project"
            className="w-full rounded-lg px-3 py-2 text-xs outline-none"
            style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" }}
          />
          {cwdError && <p className="mt-2 text-xs" style={{ color: "#dc2626" }}>{cwdError}</p>}
        </div>
        <div className="flex-1 overflow-auto py-1">
          <div className="px-4 py-1 font-mono text-xs" style={{ color: "var(--text-dim)", borderBottom: "1px solid var(--border)" }}>
            {browsePath}
          </div>
          <div
            onClick={() => { const p = browsePath.replace(/\/[^/]+\/?$/, "") || "/"; void browse(p); setCwdInput(p); }}
            className="cursor-pointer px-4 py-1.5 text-xs hover:bg-[var(--bg-hover)]"
            style={{ color: "var(--text-muted)" }}
          >
            ../
          </div>
          {browseItems.filter((i) => i.isDirectory).map((item) => (
            <div
              key={item.path}
              onClick={() => { void browse(item.path); setCwdInput(item.path); }}
              className="cursor-pointer px-4 py-1.5 text-xs hover:bg-[var(--bg-hover)]"
              style={{ color: "var(--text)" }}
            >
              <Folder className="mr-1.5 inline h-3 w-3" />
              {item.name}
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 px-4 py-3" style={{ borderTop: "1px solid var(--border)" }}>
          <button
            onClick={closeCwdPicker}
            className="rounded-md px-3 py-1.5 text-xs"
            style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text-muted)" }}
          >
            Cancel
          </button>
          <button
            onClick={() => void handleConfirmCwd()}
            className="rounded-full px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-80"
            style={{ background: "var(--page-text)", color: "var(--page-bg)", border: "none" }}
          >
            Start Chat
          </button>
        </div>
      </div>
    </div>
  );
}
