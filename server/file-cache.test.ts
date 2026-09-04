import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, statSync, utimesSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createFileCache } from "./file-cache";

// The cache behind the session list. What has to hold is the invalidation, so
// each case drives a real file and counts how many times the parse ran: a cache
// that never re-parses is indistinguishable from a correct one until the file
// changes underneath it.

const dirs: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-file-cache-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

/** A cache whose parse is the file's own contents, plus a call counter. */
function counting() {
  const calls: string[] = [];
  const cache = createFileCache((filePath) => {
    calls.push(filePath);
    const text = statSync(filePath).size.toString();
    return { text };
  });
  return { cache, calls };
}

/** Force a file's mtime, so a test never depends on clock resolution. */
function setMtime(file: string, seconds: number) {
  utimesSync(file, seconds, seconds);
}

describe("createFileCache", () => {
  it("parses once and reuses the result while the file is untouched", () => {
    const file = join(scratch(), "a.jsonl");
    writeFileSync(file, "one\n");
    const { cache, calls } = counting();

    const first = cache.get(file);
    const second = cache.get(file);
    const third = cache.get(file);

    expect(calls).toHaveLength(1);
    // The same object, not an equal one: callers pass these straight through,
    // so a fresh copy per call would defeat the point.
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it("re-parses after an append", () => {
    const file = join(scratch(), "a.jsonl");
    writeFileSync(file, "one\n");
    const { cache, calls } = counting();

    expect(cache.get(file)?.text).toBe("4");
    appendFileSync(file, "two\n");
    expect(cache.get(file)?.text).toBe("8");
    expect(calls).toHaveLength(2);
  });

  it("re-parses an in-place rewrite that kept the same size", () => {
    // Why size alone is not enough. A rename writes the session file back at a
    // different length in practice, but nothing guarantees that, and a cache
    // that trusts size would serve the old title forever.
    const file = join(scratch(), "a.jsonl");
    writeFileSync(file, "one\n");
    const { cache, calls } = counting();
    cache.get(file);

    writeFileSync(file, "ONE\n");
    setMtime(file, 1_600_000_000);
    cache.get(file);

    expect(calls).toHaveLength(2);
  });

  it("re-parses a size change even when the mtime is unchanged", () => {
    // Why mtime alone is not enough either: two writes can land inside one
    // timestamp tick, and a file restored from a backup keeps its old mtime.
    const file = join(scratch(), "a.jsonl");
    writeFileSync(file, "one\n");
    setMtime(file, 1_600_000_000);
    const { cache, calls } = counting();
    cache.get(file);

    appendFileSync(file, "two\n");
    setMtime(file, 1_600_000_000);
    cache.get(file);

    expect(calls).toHaveLength(2);
  });

  it("returns null for a file that is gone and stops remembering it", () => {
    const dir = scratch();
    const file = join(dir, "a.jsonl");
    writeFileSync(file, "one\n");
    const { cache } = counting();
    cache.get(file);
    expect(cache.size).toBe(1);

    rmSync(file);

    expect(cache.get(file)).toBeNull();
    expect(cache.size).toBe(0);
  });

  it("does not cache a parse that produced nothing, and retries it", () => {
    const file = join(scratch(), "a.jsonl");
    writeFileSync(file, "one\n");
    let attempts = 0;
    // A truncated file mid-write parses to nothing; the next call must not be
    // told the file is permanently unusable.
    const cache = createFileCache<{ ok: true }>(() => {
      attempts++;
      return attempts < 3 ? null : { ok: true };
    });

    expect(cache.get(file)).toBeNull();
    expect(cache.get(file)).toBeNull();
    expect(cache.get(file)).toEqual({ ok: true });
    expect(attempts).toBe(3);
    expect(cache.size).toBe(1);
  });

  it("keeps entries for different files apart", () => {
    const dir = scratch();
    const a = join(dir, "a.jsonl");
    const b = join(dir, "bb.jsonl");
    writeFileSync(a, "one\n");
    writeFileSync(b, "one\ntwo\n");
    const { cache, calls } = counting();

    expect(cache.get(a)?.text).toBe("4");
    expect(cache.get(b)?.text).toBe("8");
    expect(cache.get(a)?.text).toBe("4");
    expect(calls).toHaveLength(2);
    expect(cache.size).toBe(2);
  });

  it("prunes the paths a scan no longer saw", () => {
    const dir = scratch();
    const a = join(dir, "a.jsonl");
    const b = join(dir, "b.jsonl");
    writeFileSync(a, "one\n");
    writeFileSync(b, "one\n");
    const { cache } = counting();
    cache.get(a);
    cache.get(b);

    cache.prune(new Set([a]));

    expect(cache.size).toBe(1);
    // Pruning is bookkeeping, not invalidation: what survived is still cached.
    const { calls } = counting();
    expect(cache.get(a)).not.toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("empties on prune with nothing to keep, and on clear", () => {
    const dir = scratch();
    const a = join(dir, "a.jsonl");
    writeFileSync(a, "one\n");

    const { cache } = counting();
    cache.get(a);
    cache.prune(new Set());
    expect(cache.size).toBe(0);

    cache.get(a);
    expect(cache.size).toBe(1);
    cache.clear();
    expect(cache.size).toBe(0);
  });
});
