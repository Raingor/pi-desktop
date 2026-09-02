import { useState } from "react";
import { HelpCircle, Send } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useTranslation } from "@/lib/i18n";

// Telegram group invite link. Clicking opens the Telegram app (or web) join
// confirmation — Telegram has no API to add users to a group without their
// consent, so an invite link is the compliant "one-click join" path.
const TELEGRAM_GROUP_URL = "https://t.me/+ODpy7_7NlOE4NzA1";

/**
 * Floating help button (bottom-right) that opens a usage guide covering the
 * whole app plus a per-module how-to. All copy is i18n-keyed so it tracks the
 * active locale.
 */

// Module sections shown in the guide. Order mirrors the sidebar navigation.
const SECTIONS: { titleKey: string; descKey: string; stepKeys: string[] }[] = [
  { titleKey: "help.dashboard_title", descKey: "help.dashboard_desc", stepKeys: ["help.dashboard_s1", "help.dashboard_s2"] },
  { titleKey: "help.sessions_title", descKey: "help.sessions_desc", stepKeys: ["help.sessions_s1", "help.sessions_s2", "help.sessions_s3"] },
  { titleKey: "help.memory_title", descKey: "help.memory_desc", stepKeys: ["help.memory_s1", "help.memory_s2", "help.memory_s3"] },
  { titleKey: "help.providers_title", descKey: "help.providers_desc", stepKeys: ["help.providers_s1", "help.providers_s2", "help.providers_s3"] },
  { titleKey: "help.subagents_title", descKey: "help.subagents_desc", stepKeys: ["help.subagents_s1", "help.subagents_s2"] },
  { titleKey: "help.settings_title", descKey: "help.settings_desc", stepKeys: ["help.settings_s1", "help.settings_s2"] },
  { titleKey: "help.speedtest_title", descKey: "help.speedtest_desc", stepKeys: ["help.speedtest_s1", "help.speedtest_s2", "help.speedtest_s3"] },
];

export function HelpButton() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="help-fab"
        aria-label={t("help.button")}
        title={t("help.button")}
      >
        <HelpCircle className="h-5 w-5" />
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title={t("help.title")} size="xl">
        <div className="space-y-6">
          {/* Project overview */}
          <section>
            <h3 className="text-sm font-semibold" style={{ color: "var(--page-text)" }}>{t("help.overview_title")}</h3>
            <p className="mt-1.5 text-sm leading-relaxed" style={{ color: "var(--muted-text)" }}>{t("help.overview_desc")}</p>
          </section>

          {/* Per-module guide */}
          <section className="space-y-4">
            <h3 className="text-sm font-semibold" style={{ color: "var(--page-text)" }}>{t("help.modules_title")}</h3>
            {SECTIONS.map((s) => (
              <div
                key={s.titleKey}
                className="rounded-lg border px-4 py-3"
                style={{ borderColor: "var(--card-border)", backgroundColor: "var(--card-bg)" }}
              >
                <h4 className="text-sm font-semibold" style={{ color: "var(--page-text)" }}>{t(s.titleKey)}</h4>
                <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--muted-text)" }}>{t(s.descKey)}</p>
                {s.stepKeys.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {s.stepKeys.map((k) => (
                      <li key={k} className="flex gap-2 text-xs leading-relaxed" style={{ color: "var(--subtle-text)" }}>
                        <span style={{ color: "var(--signal-cyan, #38bdf8)" }}>›</span>
                        <span>{t(k)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </section>
          {/* Contact / join group */}
          <section
            className="rounded-lg border px-4 py-3"
            style={{ borderColor: "color-mix(in srgb, var(--signal-cyan) 30%, var(--card-border))", backgroundColor: "var(--card-bg)" }}
          >
            <h3 className="text-sm font-semibold" style={{ color: "var(--page-text)" }}>{t("help.contact_title")}</h3>
            <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--muted-text)" }}>{t("help.contact_desc")}</p>
            <a
              href={TELEGRAM_GROUP_URL}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors"
              style={{ backgroundColor: "#229ED9" }}
            >
              <Send className="h-4 w-4" />
              {t("help.contact_join")}
            </a>
          </section>
        </div>
      </Modal>
    </>
  );
}
