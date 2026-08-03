export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return tokens.toString();
}

export const USD_TO_CNY = 7.2;

export function formatCost(cost: number, currency: "USD" | "CNY" = "USD"): string {
  if (currency === "CNY") {
    const cny = cost * USD_TO_CNY;
    if (cny >= 100) return `¥${cny.toFixed(2)}`;
    if (cny >= 1) return `¥${cny.toFixed(3)}`;
    return `¥${cny.toFixed(4)}`;
  }
  if (cost >= 100) return `$${cost.toFixed(2)}`;
  if (cost >= 1) return `$${cost.toFixed(3)}`;
  if (cost >= 0.01) return `¢${(cost * 100).toFixed(1)}`;
  return `$${cost.toFixed(4)}`;
}

export function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function formatDateFull(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}