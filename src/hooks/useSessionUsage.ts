import { useEffect, useState } from "react";

interface SessionUsage {
  sessionId: string;
  model: string;
  provider: string;
  contextWindowRatio: number; // 0-100 percent
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cacheHitRatio: number; // 0-100 percent
  requestCount: number;
  cost: number;
}

interface UseSessionUsageReturn {
  usage: SessionUsage | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Hook to fetch session usage statistics from the API.
 * Usage data is aggregated from the session's JSONL file,
 * showing model, provider, context window ratio, token counts, and cost.
 *
 * @param sessionId - The session ID to fetch usage for
 * @returns usage state and refresh function
 */
export function useSessionUsage(sessionId?: string): UseSessionUsageReturn {
  const [usage, setUsage] = useState<SessionUsage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    if (!sessionId) {
      setUsage(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/pi/session-usage?session=${sessionId}`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json() as SessionUsage;
      setUsage(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setUsage(null);
    } finally {
      setLoading(false);
    }
  };

  // Initial load if sessionId is provided
  useEffect(() => {
    if (sessionId) {
      refresh();
    }
  }, [sessionId]);

  return { usage, loading, error, refresh };
}

export default useSessionUsage;