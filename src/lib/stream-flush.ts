/**
 * How often a streaming answer should repaint.
 *
 * Every repaint re-parses the whole growing turn through remark, so the cost
 * rises with the length of the answer. Measured on this codebase's exact
 * markdown pipeline (react-markdown 10 + remark-gfm), one parse costs:
 *
 *   200 chars → 1.1ms    4000 → 9.1ms     12000 → 17.8ms
 *   1000 chars → 2.7ms   25877 → 47.4ms
 *
 * which is roughly `chars / 550` milliseconds. Repainting on every delta event
 * therefore turns a long answer quadratic: streaming one 12000-char turn cost
 * 2661ms of parsing across 300 deltas, with single deltas blocking for 38ms.
 *
 * So the delay is derived from that measurement rather than picked: hold the
 * parse to about a third of each interval, giving the rest of the frame to
 * layout, paint and the deltas still arriving. Text streaming reads as smooth
 * well below 60fps, so the floor is 30 repaints per second — the ceiling only
 * engages on answers long enough that repainting faster would visibly stall
 * the window.
 */

/** Milliseconds one parse takes per character, from the table above. */
const MS_PER_CHAR = 1 / 550;

/** Share of each interval the parse is allowed to occupy. */
const PARSE_BUDGET = 1 / 3;

/** Fastest repaint: 30 per second, smooth for text without being wasteful. */
export const MIN_FLUSH_MS = 33;

/** Slowest repaint, so a very long answer still visibly advances. */
export const MAX_FLUSH_MS = 200;

/**
 * Delay before the next repaint of a streaming answer, given how many
 * characters it currently holds.
 *
 * Non-decreasing in `chars` and always within [MIN_FLUSH_MS, MAX_FLUSH_MS], so
 * a caller can schedule with it unconditionally.
 */
export function flushDelayMs(chars: number): number {
  // A non-finite or negative length is a caller bug, not a reason to stall:
  // fall back to the floor so output keeps moving.
  if (!Number.isFinite(chars) || chars <= 0) return MIN_FLUSH_MS;
  const parseMs = chars * MS_PER_CHAR;
  const needed = parseMs / PARSE_BUDGET;
  return Math.min(MAX_FLUSH_MS, Math.max(MIN_FLUSH_MS, Math.round(needed)));
}
