// Parse results remembered against the identity of the file they came from.
//
// Several readers in this project turn a whole file into a small summary — a
// session header costs a full JSONL read to produce a dozen fields. Those files
// only ever grow by appending, and an append changes both the size and the
// mtime, so a file whose size and mtime both match what was cached has content
// that matches too and the parse can be skipped for the price of one stat.
//
// This lives in its own module because the interesting part is the
// invalidation, and the readers that need it resolve their paths under a
// hardcoded ~/.pi that a test cannot redirect. Here the paths are arguments, so
// the rules below are pinned by server/file-cache.test.ts against real files.

import { statSync } from "fs";

export interface FileCache<T> {
  /** Cached value for `filePath`, re-parsing only if the file changed. */
  get(filePath: string): T | null;
  /** Forget every path outside `keep` — call after a directory scan. */
  prune(keep: Set<string>): void;
  /** Forget everything, for callers that cannot prove what changed. */
  clear(): void;
  /** How many paths are remembered; for tests and diagnostics. */
  readonly size: number;
}

/**
 * A cache of `parse` results, invalidated by the file's own mtime and size.
 *
 * `parse` returning null is treated as "no value", not as a value worth
 * remembering: a file that failed to parse is retried on the next call rather
 * than being written off for the life of the process.
 */
export function createFileCache<T>(
  parse: (filePath: string) => T | null,
): FileCache<T> {
  const entries = new Map<string, { mtimeMs: number; size: number; value: T }>();

  return {
    get(filePath: string): T | null {
      let stats: { mtimeMs: number; size: number };
      try {
        stats = statSync(filePath);
      } catch {
        // Gone since it was listed — a concurrent delete, trash or rename.
        entries.delete(filePath);
        return null;
      }

      const cached = entries.get(filePath);
      // Both fields have to match, because either one alone has a blind spot:
      // size misses an in-place rewrite of the same length, and mtime misses
      // two writes landing inside a single millisecond.
      if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
        return cached.value;
      }

      const value = parse(filePath);
      if (value === null) {
        entries.delete(filePath);
        return null;
      }
      entries.set(filePath, { mtimeMs: stats.mtimeMs, size: stats.size, value });
      return value;
    },

    prune(keep: Set<string>): void {
      // Without this the map grows for the life of the process as files are
      // trashed and created; the scan that produced `keep` already knows which
      // paths still exist, so no extra stat is needed to find the dead ones.
      for (const path of entries.keys()) {
        if (!keep.has(path)) entries.delete(path);
      }
    },

    clear(): void {
      entries.clear();
    },

    get size(): number {
      return entries.size;
    },
  };
}
