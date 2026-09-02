import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Settings,
  History,
  Brain,
  Plug,
  Users,
  Globe,
  ChevronDown,
  X,
  Orbit,
  Gauge,
  Send,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation, LANGUAGES } from "@/lib/i18n";
import { useState } from "react";
import { ChangelogButton } from "@/components/help/ChangelogButton";
import { UiModeSwitch } from "./UiModeSwitch";

// Telegram group invite link (same as the help dialog).
const TELEGRAM_GROUP_URL = "https://t.me/+ODpy7_7NlOE4NzA1";

const navItems = [
  { to: "/", icon: LayoutDashboard, key: "nav.dashboard", code: "01" },
  { to: "/sessions", icon: History, key: "nav.sessions", code: "02" },
  { to: "/memory", icon: Brain, key: "nav.memory", code: "03" },
  { to: "/providers", icon: Plug, key: "nav.providers_models", code: "04" },
  { to: "/subagents", icon: Users, key: "nav.subagents", code: "05" },
  { to: "/settings", icon: Settings, key: "nav.settings", code: "06" },
  { to: "/speed-test", icon: Gauge, key: "nav.speed_test", code: "07" },
];

interface SidebarProps {
  mobileOpen?: boolean;
  onClose?: () => void;
}

export function BasicSidebar({ mobileOpen = false, onClose }: SidebarProps) {
  const { t, lang, setLang } = useTranslation();
  const [langOpen, setLangOpen] = useState(false);

  return (
    <aside className={cn("command-sidebar", mobileOpen && "is-open")}>
      <div className="sidebar-edge" aria-hidden="true" />

      <div className="brand-block">
        <div className="brand-mark">
          <img src="/pi.svg" alt="pi-switch" />
          <span className="brand-orbit" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <div className="brand-name">pi-switch</div>
          <div className="brand-subtitle">{t("app.subtitle")}</div>
        </div>
        <button className="sidebar-close" aria-label="Close navigation" onClick={onClose}>
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="sidebar-system-label">
        <span>CONTROL MATRIX</span>
        <span className="sidebar-label-line" />
      </div>

      <nav className="command-nav">
        {navItems.map(({ to, icon: Icon, key, code }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            onClick={onClose}
            className={({ isActive }) => cn("command-nav-item", isActive && "is-active")}
          >
            <span className="nav-code">{code}</span>
            <span className="nav-icon"><Icon className="h-4 w-4" /></span>
            <span className="nav-label">{t(key)}</span>
            <span className="nav-signal" aria-hidden="true" />
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer">
        <UiModeSwitch />
        <a
          href={TELEGRAM_GROUP_URL}
          target="_blank"
          rel="noreferrer"
          className="sidebar-telegram"
        >
          <Send className="h-4 w-4" />
          <span>{t("help.contact_join")}</span>
        </a>

        <div className="node-status">
          <div className="node-status-icon"><Orbit className="h-4 w-4" /></div>
          <div>
            <span className="node-status-label">LOCAL NODE</span>
            <span className="node-status-value"><i /> SYSTEM ONLINE</span>
          </div>
        </div>

        <div className="language-panel">
          <button onClick={() => setLangOpen(!langOpen)} className="language-trigger">
            <Globe className="h-4 w-4" />
            <span>{LANGUAGES.find((l) => l.code === lang)?.nativeLabel || "English"}</span>
            <ChevronDown className={cn("ml-auto h-3.5 w-3.5 transition-transform", langOpen && "rotate-180")} />
          </button>
          {langOpen && (
            <div className="language-menu">
              {LANGUAGES.map((l) => (
                <button
                  key={l.code}
                  onClick={() => { setLang(l.code); setLangOpen(false); }}
                  className={cn("language-option", lang === l.code && "is-selected")}
                >
                  <span>{l.nativeLabel}</span>
                  {lang === l.code && <i />}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="version-strip">
          <span>{t("app.version")}</span>
          <ChangelogButton />
        </div>
      </div>
    </aside>
  );
}
