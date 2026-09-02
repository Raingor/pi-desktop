import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useTranslation } from "@/lib/i18n";
import { CHANGELOG } from "@/data/changelog";

/**
 * "What's new" changelog dialog. Trigger lives in the sidebar footer (version
 * strip). Entries come from src/data/changelog.ts with i18n item keys.
 */
export function ChangelogButton() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="changelog-trigger"
        title={t("changelog.title")}
      >
        <Sparkles className="h-3.5 w-3.5" />
        <span>{t("changelog.button")}</span>
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title={t("changelog.title")} size="lg">
        <div className="space-y-5">
          {CHANGELOG.map((entry) => (
            <div key={entry.version}>
              <div className="flex items-baseline gap-2">
                <span
                  className="rounded-md px-2 py-0.5 text-xs font-semibold"
                  style={{ backgroundColor: "color-mix(in srgb, var(--signal-cyan) 16%, transparent)", color: "var(--signal-cyan, #38bdf8)" }}
                >
                  v{entry.version}
                </span>
                <span className="text-xs" style={{ color: "var(--subtle-text)" }}>{entry.date}</span>
              </div>
              <ul className="mt-2 space-y-1.5">
                {entry.itemKeys.map((k) => (
                  <li key={k} className="flex gap-2 text-sm leading-relaxed" style={{ color: "var(--muted-text)" }}>
                    <span style={{ color: "var(--signal-cyan, #38bdf8)" }}>›</span>
                    <span>{t(k)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Modal>
    </>
  );
}
