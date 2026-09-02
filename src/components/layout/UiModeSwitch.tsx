import { MessageSquare, LayoutDashboard } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";
import { useUiMode, type UiMode } from "@/lib/ui-mode";

const OPTIONS: { mode: UiMode; icon: typeof MessageSquare; labelKey: string }[] =
  [
    { mode: "basic", icon: LayoutDashboard, labelKey: "mode.basic" },
    { mode: "chat", icon: MessageSquare, labelKey: "mode.chat" },
  ];

/** Two-way switch between the original dashboard layout and the chat shell. */
export function UiModeSwitch() {
  const { t } = useTranslation();
  const { mode, setMode } = useUiMode();

  return (
    <div className="ui-mode-switch" role="group" aria-label={t("mode.label")}>
      {OPTIONS.map(({ mode: option, icon: Icon, labelKey }) => (
        <button
          key={option}
          type="button"
          aria-pressed={mode === option}
          onClick={() => setMode(option)}
          className={cn(mode === option && "is-active")}
        >
          <Icon className="h-3.5 w-3.5" />
          <span>{t(labelKey)}</span>
        </button>
      ))}
    </div>
  );
}
