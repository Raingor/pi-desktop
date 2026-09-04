// The "compact session" control inside the usage panel.
//
// Compaction asks pi to summarize older turns so the context window frees up.
// It calls the model once, so it is billed and can take minutes on a large
// session — hence the confirmation step and the disabled state while it runs.

import { useState } from "react";
import { Loader2, Shrink } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { formatTokens } from "@/lib/utils";

interface CompactResponse {
  success: boolean;
  error?: string;
  tokensBefore?: number;
  estimatedTokensAfter?: number;
  usage?: { cost?: { total?: number } };
}

/** pi's own refusal for a session with nothing worth summarizing. */
const TOO_SMALL = "Nothing to compact (session too small)";

export function CompactButton({
  sessionId,
  onCompacted,
}: {
  sessionId: string;
  /** Called after a successful run so the panel can re-read usage. */
  onCompacted: () => void;
}) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string; cost?: string } | null>(null);

  const run = () => {
    setConfirming(false);
    setRunning(true);
    setResult(null);
    fetch("/api/pi/session-compact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, instructions: instructions.trim() || undefined }),
    })
      .then((res) => res.json() as Promise<CompactResponse>)
      .then((data) => {
        if (data.success) {
          setResult({
            ok: true,
            text: t(
              "chat.usage_compact_done",
              formatTokens(data.tokensBefore ?? 0),
              formatTokens(data.estimatedTokensAfter ?? 0),
            ),
            cost:
              typeof data.usage?.cost?.total === "number"
                ? t("chat.usage_compact_cost", data.usage.cost.total.toFixed(4))
                : undefined,
          });
          setInstructions("");
          onCompacted();
        } else {
          setResult({
            ok: false,
            text:
              data.error === TOO_SMALL
                ? t("chat.usage_compact_too_small")
                : t("chat.usage_compact_failed", data.error ?? ""),
          });
        }
      })
      .catch((error: unknown) =>
        setResult({
          ok: false,
          text: t(
            "chat.usage_compact_failed",
            error instanceof Error ? error.message : "request failed",
          ),
        }),
      )
      .finally(() => setRunning(false));
  };

  if (running) {
    return (
      <div className="codex-usage-compact">
        <button type="button" className="codex-compact-btn" disabled>
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t("chat.usage_compact_running")}
        </button>
        <small>{t("chat.usage_compact_hint")}</small>
      </div>
    );
  }

  if (confirming) {
    return (
      <div className="codex-usage-compact is-confirming">
        <p>{t("chat.usage_compact_confirm")}</p>
        <input
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
          placeholder={t("chat.usage_compact_instructions")}
          maxLength={200}
        />
        <div className="codex-compact-actions">
          <button type="button" onClick={() => setConfirming(false)}>
            {t("chat.usage_compact_cancel")}
          </button>
          <button type="button" className="is-primary" onClick={run}>
            {t("chat.usage_compact_start")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="codex-usage-compact">
      <button
        type="button"
        className="codex-compact-btn"
        onClick={() => {
          setResult(null);
          setConfirming(true);
        }}
        title={t("chat.usage_compact_hint")}
      >
        <Shrink className="h-3.5 w-3.5" />
        {t("chat.usage_compact")}
      </button>
      {result && (
        <small className={result.ok ? "is-ok" : "is-fail"}>
          {result.text}
          {result.cost ? ` · ${result.cost}` : ""}
        </small>
      )}
    </div>
  );
}
