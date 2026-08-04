import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Settings,
  History,
  Brain,
  Globe,
  MessageCircle,
  CirclePlus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation, LANGUAGES } from "@/lib/i18n";
import { useChatUI } from "@/store/chat-ui";
import { ChatSessionList } from "@/components/chat/ChatSessionList";
import { useState } from "react";

// Navigation — Chat first (primary view, like Cindy's default cc-agent view),
// then Dashboard / Sessions / Memory / Settings.
// Providers/Models/Subagents are tabs inside Settings.
const navItems = [
  { to: "/chat", icon: MessageCircle, key: "nav.chat" },
  { to: "/", icon: LayoutDashboard, key: "nav.dashboard" },
  { to: "/sessions", icon: History, key: "nav.sessions" },
  { to: "/memory", icon: Brain, key: "nav.memory" },
  { to: "/settings", icon: Settings, key: "nav.settings" },
];

// Cindy-style pill row: h-8, rounded-full, 15px icon (strokeWidth 1.8)
const ROW_CLASS =
  "flex h-8 w-full items-center gap-2.5 rounded-full px-3 text-sm font-normal transition-colors hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--sidebar-hover-text)]";

export function Sidebar() {
  const { t, lang, setLang } = useTranslation();
  const [langOpen, setLangOpen] = useState(false);
  const location = useLocation();
  const chatActive = location.pathname.startsWith("/chat");
  const startNewSession = useChatUI((s) => s.startNewSession);

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
        className="flex items-center gap-3 border-b px-4 py-4"
        style={{ borderColor: "var(--sidebar-border)" }}
      >
        <img src="/pi.svg" alt="pi-desktop" className="h-7 w-7 rounded-lg" />
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold" style={{ color: "var(--page-text)" }}>pi-desktop</h1>
          <p className="truncate text-[11px]" style={{ color: "var(--subtle-text)" }}>{t("app.subtitle")}</p>
        </div>
      </div>

      {/* Top action: New Chat (Cindy SidebarTopNav position) */}
      <div className="px-3 pt-3 pb-1">
        <button
          onClick={startNewSession}
          className={cn(ROW_CLASS, "font-medium")}
          style={{ background: "var(--page-text)", color: "var(--page-bg)" }}
        >
          <CirclePlus size={15} strokeWidth={1.8} className="shrink-0" />
          <span className="leading-none">{t("chat.new_session")}</span>
        </button>
      </div>

      {/* Nav (Cindy pill rows, active = inverted capsule) */}
      <nav className="space-y-0.5 px-3 pt-2 pb-1">
        {navItems.map(({ to, icon: Icon, key }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              cn(ROW_CLASS, isActive && "font-medium hover:bg-[var(--sidebar-active-bg)] hover:text-[var(--sidebar-active-text)]")
            }
            style={({ isActive }) => ({
              backgroundColor: isActive ? "var(--sidebar-active-bg)" : "transparent",
              color: isActive ? "var(--sidebar-active-text)" : "var(--sidebar-text)",
            })}
          >
            <Icon size={15} strokeWidth={1.8} className="shrink-0" />
            <span className="leading-none">{t(key)}</span>
          </NavLink>
        ))}
      </nav>

      {/* Session list slot — only in chat view (Cindy cc-agent sidebar slot) */}
      {chatActive && (
        <div
          className="mt-2 flex min-h-0 flex-1 flex-col border-t pt-2"
          style={{ borderColor: "var(--sidebar-border)" }}
        >
          <span
            className="px-4 pb-1 text-[11px] font-semibold uppercase"
            style={{ color: "var(--subtle-text)", letterSpacing: "0.05em" }}
          >
            {t("chat.sessions")}
          </span>
          <ChatSessionList />
        </div>
      )}

      {/* Bottom: language + version (Cindy UserInfoSection position) */}
      <div className="border-t px-3 py-3" style={{ borderColor: "var(--sidebar-border)" }}>
        <button
          onClick={() => setLangOpen(!langOpen)}
          className={cn(ROW_CLASS)}
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
        <p className="mt-2 px-3 text-[11px]" style={{ color: "var(--subtle-text)" }}>{t("app.version")}</p>
      </div>
    </aside>
  );
}
