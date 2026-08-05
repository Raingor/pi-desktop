import { useNavigate } from "react-router-dom";
import { Globe, CirclePlus, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation, LANGUAGES } from "@/lib/i18n";
import { useChatUI } from "@/store/chat-ui";
import { ChatSessionList } from "@/components/chat/ChatSessionList";
import { useCallback, useState } from "react";

// Cindy-style pill row: h-8, rounded-full, 15px icon (strokeWidth 1.8)
const ROW_CLASS =
  "flex h-8 w-full items-center gap-2.5 rounded-full px-3 text-sm font-normal transition-colors hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--sidebar-hover-text)]";

export function Sidebar() {
  const { t, lang, setLang } = useTranslation();
  const [langOpen, setLangOpen] = useState(false);
  const navigate = useNavigate();
  const startNewSession = useChatUI((s) => s.startNewSession);
  const confirmCwd = useChatUI((s) => s.confirmCwd);

  // Prefer the native OS folder picker (Tauri dialog plugin); fall back
  // to the in-app modal when unavailable (e.g. running in a browser).
  const handleNewChat = useCallback(async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select working directory",
      });
      if (selected) {
        confirmCwd(typeof selected === "string" ? selected : String(selected));
      }
    } catch {
      startNewSession();
    }
  }, [confirmCwd, startNewSession]);

  return (
    <aside
      className="flex h-screen w-64 flex-col border-r"
      style={{
        backgroundColor: "var(--sidebar-bg)",
        borderColor: "var(--sidebar-border)",
      }}
    >
      {/* Top: brand row */}
      <div
        className="rise flex items-center gap-3 border-b px-4 py-4"
        style={{ borderColor: "var(--sidebar-border)" }}
      >
        <img src="/pi.svg" alt="pi-desktop" className="h-8 w-8 rounded-[10px]" />
        <div className="min-w-0">
          <h1 className="truncate text-[15px] font-semibold tracking-tight" style={{ color: "var(--page-text)" }}>pi-desktop</h1>
          <p className="mono truncate text-[10px] uppercase" style={{ color: "var(--subtle-text)", letterSpacing: "0.14em" }}>{t("app.subtitle")}</p>
        </div>
      </div>

      {/* Top action: New Chat */}
      <div className="rise px-3 pt-3 pb-1" style={{ ["--d" as string]: "40ms" }}>
        <button
          onClick={() => void handleNewChat()}
          className={cn(ROW_CLASS, "font-medium")}
          style={{ background: "var(--page-text)", color: "var(--page-bg)" }}
        >
          <CirclePlus size={15} strokeWidth={1.8} className="shrink-0" />
          <span className="leading-none">{t("chat.new_session")}</span>
        </button>
      </div>

      {/* Session list slot (Cindy cc-agent sidebar slot) */}
      <div
        className="mt-2 flex min-h-0 flex-1 flex-col border-t pt-2"
        style={{ borderColor: "var(--sidebar-border)" }}
      >
        <span className="label px-4 pb-1.5">{t("chat.sessions")}</span>
        <ChatSessionList />
      </div>

      {/* Bottom: settings + language + version (Cindy UserInfoSection position) */}
      <div className="border-t px-3 py-3" style={{ borderColor: "var(--sidebar-border)" }}>
        <button
          onClick={() => navigate("/settings")}
          className={cn(ROW_CLASS)}
          style={{ color: "var(--sidebar-text)" }}
        >
          <Settings size={15} strokeWidth={1.8} className="shrink-0" />
          <span className="flex-1 text-left leading-none">{t("nav.settings")}</span>
        </button>
        <button
          onClick={() => setLangOpen(!langOpen)}
          className={cn(ROW_CLASS, "mt-0.5")}
          style={{ color: "var(--sidebar-text)" }}
        >
          <Globe size={15} strokeWidth={1.8} className="shrink-0" />
          <span className="flex-1 text-left leading-none">{LANGUAGES.find((l) => l.code === lang)?.nativeLabel || "English"}</span>
        </button>
        {langOpen && (
          <div className="mt-1 space-y-0.5 px-1">
            {LANGUAGES.map((l) => (
              <button
                key={l.code}
                onClick={() => { setLang(l.code); setLangOpen(false); }}
                className="flex w-full items-center gap-2.5 rounded-full px-3 py-1.5 text-xs transition-colors hover:bg-[var(--sidebar-hover-bg)]"
                style={{
                  color: lang === l.code ? "var(--sidebar-active-text)" : "var(--sidebar-text)",
                  backgroundColor: lang === l.code ? "var(--sidebar-active-bg)" : "transparent",
                  fontWeight: lang === l.code ? 500 : 400,
                }}
              >
                {l.nativeLabel}
              </button>
            ))}
          </div>
        )}
        <p className="num mt-2 px-3 text-[10px]" style={{ color: "var(--subtle-text)" }}>{t("app.version")}</p>
      </div>
    </aside>
  );
}
