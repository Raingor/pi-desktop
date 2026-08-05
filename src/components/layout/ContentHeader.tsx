// ContentHeader — right content area top bar (Cindy-style, ~46px).
// The chat view is the main view and owns its own top bar; this is only
// rendered for the settings page.
import { useTranslation } from "@/lib/i18n";

export function ContentHeader() {
  const { t } = useTranslation();

  return (
    <header
      className="flex h-11 shrink-0 items-center px-6"
      style={{ borderBottom: "1px solid var(--card-border)", backgroundColor: "var(--page-bg)" }}
    >
      <h2 className="text-sm font-medium" style={{ color: "var(--page-text)" }}>{t("settings.title")}</h2>
    </header>
  );
}
