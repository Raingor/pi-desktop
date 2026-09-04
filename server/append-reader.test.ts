import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { statSync } from "fs";
import { readAppendedLines } from "./append-reader";

// The incremental read behind session-usage polling. The invariant that matters
// is that a JSON row is never split across two calls: the chat window polls a
// file pi is writing to, so a read landing mid-line is the normal case, not an
// edge case.

const dirs: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-append-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

/** Read everything appended since `from`, the way a poller would. */
function readAll(file: string, from: number) {
  return readAppendedLines(file, from, statSync(file).size);
}

describe("readAppendedLines", () => {
  it("reads whole lines and reports a line boundary", () => {
    const file = join(scratch(), "s.jsonl");
    writeFileSync(file, '{"a":1}\n{"a":2}\n');
    const { lines, consumed } = readAll(file, 0);
    expect(lines).toEqual(['{"a":1}', '{"a":2}']);
    expect(consumed).toBe(16);
  });

  it("returns only what arrived since the last offset", () => {
    const file = join(scratch(), "s.jsonl");
    writeFileSync(file, '{"a":1}\n');
    const first = readAll(file, 0);
    appendFileSync(file, '{"a":2}\n{"a":3}\n');
    const second = readAll(file, first.consumed);
    expect(second.lines).toEqual(['{"a":2}', '{"a":3}']);
  });

  it("leaves a partial trailing row unconsumed instead of splitting it", () => {
    // The case that makes this worth having: pi has written half a row.
    const file = join(scratch(), "s.jsonl");
    writeFileSync(file, '{"a":1}\n{"a":2');
    const first = readAll(file, 0);
    expect(first.lines).toEqual(['{"a":1}']);
    expect(first.consumed).toBe(8);

    appendFileSync(file, '}\n');
    const second = readAll(file, first.consumed);
    expect(second.lines).toEqual(['{"a":2}']);
  });

  it("consumes nothing when no newline has arrived at all", () => {
    const file = join(scratch(), "s.jsonl");
    writeFileSync(file, '{"a":1');
    const { lines, consumed } = readAll(file, 0);
    expect(lines).toEqual([]);
    expect(consumed).toBe(0);
  });

  it("reassembles a file fed one byte at a time without losing or splitting a row", () => {
    // Every intermediate offset is a line boundary, so concatenating the reads
    // must reproduce the file exactly regardless of where the reads landed.
    const file = join(scratch(), "s.jsonl");
    const rows = ['{"n":1}', '{"n":2}', '{"n":3}', '{"n":"多字节中文"}'];
    const full = `${rows.join("\n")}\n`;
    writeFileSync(file, "");

    const seen: string[] = [];
    let offset = 0;
    for (const byte of Buffer.from(full, "utf-8")) {
      appendFileSync(file, Buffer.from([byte]));
      const { lines, consumed } = readAll(file, offset);
      seen.push(...lines);
      offset = consumed;
    }
    expect(seen).toEqual(rows);
    expect(offset).toBe(Buffer.byteLength(full));
  });

  it("returns nothing when the file has not grown", () => {
    const file = join(scratch(), "s.jsonl");
    writeFileSync(file, '{"a":1}\n');
    const size = statSync(file).size;
    expect(readAppendedLines(file, size, size)).toEqual({ lines: [], consumed: size });
  });

  it("treats a nonsensical offset as start-over rather than reading garbage", () => {
    const file = join(scratch(), "s.jsonl");
    writeFileSync(file, '{"a":1}\n');
    const size = statSync(file).size;
    for (const bad of [-1, Number.NaN, 1.5]) {
      expect(readAppendedLines(file, bad, size).lines).toEqual(['{"a":1}']);
    }
  });

  it("does not split a multi-byte character across reads", () => {
    // A UTF-8 boundary is not a byte boundary: cutting at an arbitrary byte
    // would corrupt the character. Cutting only at newlines cannot.
    const file = join(scratch(), "s.jsonl");
    writeFileSync(file, '{"t":"中文内容"}\n{"t":"更多内容"}\n');
    const { lines } = readAll(file, 0);
    expect(lines).toEqual(['{"t":"中文内容"}', '{"t":"更多内容"}']);
    expect(lines.every((line) => !line.includes("\uFFFD"))).toBe(true);
  });
});
