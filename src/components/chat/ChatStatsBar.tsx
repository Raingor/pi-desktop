// ChatStatsBar — context/cost/tokens stats bar (per reference image)

interface ChatStatsBarProps {
  contextTokens: number;
  contextLimit: number;
  contextPercent: number;
  cost: number;
  inputTokens: number;
  outputTokens: number;
}

export function ChatStatsBar({
  contextTokens,
  contextLimit,
  contextPercent,
  cost,
  inputTokens,
  outputTokens,
}: ChatStatsBarProps) {
  const formatTokens = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return n.toLocaleString();
  };

  const contextColor =
    contextPercent > 90 ? '#ef4444' :
    contextPercent > 70 ? '#eab308' :
    '#3b82f6';

  return (
    <div
      className="flex items-center gap-4 px-4 py-2 text-xs"
      style={{
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-panel)',
        color: 'var(--text-muted)',
      }}
    >
      {/* Context usage with progress bar */}
      <div className="flex items-center gap-2">
        <span>Context:</span>
        <span style={{ fontFamily: 'var(--font-mono, monospace)', color: 'var(--text)' }}>
          {formatTokens(contextTokens)}/{formatTokens(contextLimit)}
        </span>
        <div
          className="h-1.5 w-20 rounded-full"
          style={{ background: 'var(--border)' }}
        >
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${Math.min(contextPercent, 100)}%`,
              background: contextColor,
            }}
          />
        </div>
        <span style={{ color: contextColor }}>
          ({contextPercent.toFixed(0)}%)
        </span>
      </div>

      <span style={{ color: 'var(--border)' }}>|</span>

      {/* Cost */}
      <span>Cost: <span style={{ color: 'var(--text)' }}>${cost.toFixed(4)}</span></span>

      <span style={{ color: 'var(--border)' }}>|</span>

      {/* Tokens */}
      <span>
        Tokens: <span style={{ color: 'var(--text)' }}>{formatTokens(inputTokens)} in</span>
        {' / '}
        <span style={{ color: 'var(--text)' }}>{formatTokens(outputTokens)} out</span>
      </span>
    </div>
  );
}
