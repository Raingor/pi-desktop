// ChatStatsBar — instrument readout (context / cost / tokens).
// Mono numerals + uppercase mono labels, hairline separators.

interface ChatStatsBarProps {
  contextTokens: number;
  contextLimit: number;
  contextPercent: number;
  cost: number;
  inputTokens: number;
  outputTokens: number;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

function Sep() {
  return <span className="h-3 w-px" style={{ background: "var(--border)" }} />;
}

export function ChatStatsBar({
  contextTokens,
  contextLimit,
  contextPercent,
  cost,
  inputTokens,
  outputTokens,
}: ChatStatsBarProps) {
  const contextColor =
    contextPercent > 90 ? "var(--danger)" :
    contextPercent > 70 ? "var(--warn)" :
    "var(--text-muted)";

  return (
    <div
      className="flex items-center gap-4 px-4 py-2"
      style={{
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-panel)",
        color: "var(--text-muted)",
      }}
    >
      {/* Context */}
      <div className="flex items-center gap-2">
        <span className="label">Context</span>
        <span className="num text-xs" style={{ color: "var(--text)" }}>
          {formatTokens(contextTokens)}<span style={{ color: "var(--text-dim)" }}>/{formatTokens(contextLimit)}</span>
        </span>
        <div className="h-1 w-20 overflow-hidden rounded-full" style={{ background: "var(--border)" }}>
          <div
            className="h-full rounded-full"
            style={{ width: `${Math.min(contextPercent, 100)}%`, background: contextColor, transition: "width 0.3s ease" }}
          />
        </div>
        <span className="num text-xs" style={{ color: contextColor }}>
          {contextPercent.toFixed(0)}%
        </span>
      </div>

      <Sep />

      {/* Cost */}
      <div className="flex items-center gap-2">
        <span className="label">Cost</span>
        <span className="num text-xs" style={{ color: "var(--text)" }}>${cost.toFixed(4)}</span>
      </div>

      <Sep />

      {/* Tokens */}
      <div className="flex items-center gap-2">
        <span className="label">Tokens</span>
        <span className="num text-xs" style={{ color: "var(--text)" }}>{formatTokens(inputTokens)} in</span>
        <span style={{ color: "var(--text-dim)" }}>/</span>
        <span className="num text-xs" style={{ color: "var(--text)" }}>{formatTokens(outputTokens)} out</span>
      </div>
    </div>
  );
}
