import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Settings,
  History,
  Brain,
  Globe,
  MessageCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation, LANGUAGES } from "@/lib/i18n";
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

  return (
    <aside
      className="flex h-screen w-64 flex-col border-r"
      style={{
        backgroundColor: "var(--sidebar-bg)",
        borderColor: "var(--sidebar-border)",
      }}
    >
      {/* Logo */}
      <div
        className="flex items-center gap-3 border-b px-6 py-5"
        style={{ borderColor: "var(--sidebar-border)" }}
      >
        <img src="/pi.svg" alt="pi-desktop" className="h-9 w-9 rounded-lg" />
        <div>
          <h1 className="text-base font-semibold" style={{ color: "var(--page-text)" }}>pi-desktop</h1>
          <p className="text-xs" style={{ color: "var(--subtle-text)" }}>{t("app.subtitle")}</p>
        </div>
      </div>

      {/* Navigation — pill rows, active = inverted capsule */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
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

      {/* Language Switcher */}
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
      </div>

      {/* Version */}
      <div
        className="border-t px-6 py-3"
        style={{ borderColor: "var(--sidebar-border)" }}
      >
        <p className="text-xs" style={{ color: "var(--subtle-text)" }}>{t("app.version")}</p>
      </div>
    </aside>
  );
}
