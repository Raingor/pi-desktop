import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Settings,
  History,
  Brain,
  Globe,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation, LANGUAGES } from "@/lib/i18n";
import { useState } from "react";

// 4 nav items only: Dashboard, Sessions, Memory, Settings
// Providers/Models/Subagents are now tabs inside Settings
const navItems = [
  { to: "/", icon: LayoutDashboard, key: "nav.dashboard" },
  { to: "/sessions", icon: History, key: "nav.sessions" },
  { to: "/memory", icon: Brain, key: "nav.memory" },
  { to: "/settings", icon: Settings, key: "nav.settings" },
];

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

      {/* Navigation — 4 items */}
      <nav className="flex-1 space-y-1 px-3 py-4">
        {navItems.map(({ to, icon: Icon, key }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              )
            }
            style={({ isActive }) => ({
              backgroundColor: isActive ? "var(--sidebar-active-bg)" : "transparent",
              color: isActive ? "var(--sidebar-active-text)" : "var(--sidebar-text)",
            })}
          >
            <Icon className="h-4 w-4" />
            {t(key)}
          </NavLink>
        ))}
      </nav>

      {/* Language Switcher */}
      <div className="border-t px-3 py-3" style={{ borderColor: "var(--sidebar-border)" }}>
        <button
          onClick={() => setLangOpen(!langOpen)}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
          style={{ color: "var(--sidebar-text)" }}
        >
          <Globe className="h-4 w-4" />
          <span className="flex-1 text-left">{LANGUAGES.find((l) => l.code === lang)?.nativeLabel || "English"}</span>
        </button>
        {langOpen && (
          <div className="mt-1 space-y-0.5 px-1">
            {LANGUAGES.map((l) => (
              <button
                key={l.code}
                onClick={() => { setLang(l.code); setLangOpen(false); }}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                  lang === l.code ? "bg-blue-600/10 text-blue-400" : ""
                )}
                style={{
                  color: lang === l.code ? "var(--sidebar-active-text)" : "var(--sidebar-text)",
                  backgroundColor: lang === l.code ? "var(--sidebar-active-bg)" : "transparent",
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
