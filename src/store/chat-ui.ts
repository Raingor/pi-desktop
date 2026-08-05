// chat-ui store — shared chat state between the sidebar session list
// and the chat view (Cindy-style layout: session list lives in the
// global sidebar, chat area renders messages only).
import { create } from "zustand";
import type { SessionInfo, SessionStatsInfo, ContextUsage } from "@/types/chat";
import { chatListSessions, chatDeleteSession } from "@/lib/tauri";

interface ChatUIState {
  sessions: SessionInfo[];
  /** Current working directory — the session list only shows sessions
   *  under this directory (set when a working dir is picked). */
  activeCwd: string | null;
  selectedSession: SessionInfo | null;
  newSessionCwd: string | null;
  loading: boolean;
  refreshKey: number;
  collapsedGroups: Set<string>;
  sessionStats: SessionStatsInfo | null;
  contextUsage: ContextUsage | null;
  showCwdPicker: boolean;

  loadSessions: () => Promise<void>;
  refresh: () => void;
  selectSession: (s: SessionInfo | null) => void;
  startNewSession: () => void;
  /** Open the working-directory picker: native dialog when available,
   *  in-app modal as fallback. Used by the New Chat action and by
   *  "change directory" before a new session has started. */
  pickCwd: () => Promise<void>;
  closeCwdPicker: () => void;
  confirmCwd: (cwd: string) => void;
  deleteSession: (id: string) => Promise<void>;
  toggleGroup: (path: string) => void;
  setSessionStats: (s: SessionStatsInfo | null) => void;
  setContextUsage: (u: ContextUsage | null) => void;
  markSessionCreated: (s: SessionInfo) => void;
}

export const useChatUI = create<ChatUIState>((set, get) => ({
  sessions: [],
  activeCwd: null,
  selectedSession: null,
  newSessionCwd: null,
  loading: false,
  refreshKey: 0,
  collapsedGroups: new Set(),
  sessionStats: null,
  contextUsage: null,
  showCwdPicker: false,

  loadSessions: async () => {
    const cwd = get().activeCwd;
    // Don't import the whole session list up front — only load sessions
    // once a working directory has been picked, and only keep sessions
    // that belong to that directory.
    if (!cwd) {
      set({ sessions: [], loading: false });
      return;
    }
    set({ loading: true });
    try {
      const data = await chatListSessions();
      const norm = (p?: string) => (p ?? "").replace(/\/+$/, "") || "/";
      const cwdNorm = norm(cwd);
      const filtered = data.sessions.filter(
        (s) => norm(s.projectRoot) === cwdNorm || norm(s.cwd) === cwdNorm
      );
      set({ sessions: filtered, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  refresh: () => {
    set((st) => ({ refreshKey: st.refreshKey + 1 }));
    void get().loadSessions();
  },

  selectSession: (s) => {
    set({
      selectedSession: s,
      newSessionCwd: null,
      sessionStats: null,
      contextUsage: null,
    });
  },

  startNewSession: () => set({ showCwdPicker: true }),

  pickCwd: async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select working directory",
      });
      if (selected) {
        get().confirmCwd(typeof selected === "string" ? selected : String(selected));
      }
    } catch {
      get().startNewSession();
    }
  },

  closeCwdPicker: () => set({ showCwdPicker: false }),

  confirmCwd: (cwd) => {
    set({
      activeCwd: cwd,
      selectedSession: null,
      newSessionCwd: cwd,
      showCwdPicker: false,
      sessionStats: null,
      contextUsage: null,
    });
    void get().loadSessions();
  },

  deleteSession: async (id) => {
    try {
      await chatDeleteSession(id);
      if (get().selectedSession?.id === id) set({ selectedSession: null });
      get().refresh();
    } catch { /* ignore */ }
  },

  toggleGroup: (path) => {
    set((st) => {
      const next = new Set(st.collapsedGroups);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return { collapsedGroups: next };
    });
  },

  setSessionStats: (s) => set({ sessionStats: s }),
  setContextUsage: (u) => set({ contextUsage: u }),

  markSessionCreated: (s) => {
    set({ selectedSession: s, newSessionCwd: null });
    get().refresh();
  },
}));
