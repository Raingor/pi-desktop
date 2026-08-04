// ContentHeader — right content area top bar (Cindy-style, ~46px).
// Rendered for non-chat pages; the chat view owns its own top bar
// (session title + model selector inside ChatPage).
import { useLocation } from "react-router-dom";
import { useTranslation } from "@/lib/i18n";

export function ContentHeader() {
  const { t } = useTranslation();
  const location = useLocation();

  let title = "pi-desktop";
  if (location.pathname === "/") title = t("nav.dashboard");
  else if (location.pathname.startsWith("/sessions")) title = t("nav.sessions");
  else if (location.pathname.startsWith("/memory")) title = t("nav.memory");
  else if (location.pathname.startsWith("/settings")) title = t("nav.settings");

  return (
    <header
      className="flex h-11 shrink-0 items-center px-6"
      style={{ borderBottom: "1px solid var(--card-border)", backgroundColor: "var(--page-bg)" }}
    >
      <h2 className="text-sm font-medium" style={{ color: "var(--page-text)" }}>{title}</h2>
    </header>
  );
}
