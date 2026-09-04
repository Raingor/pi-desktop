import { openSync, readSync, closeSync } from "fs";

/** Bytes read as whole lines, and how far into the file they account for. */
export interface AppendedLines {
  /** Complete lines found in `[from, size)`, in file order. */
  lines: string[];
  /**
   * Byte offset just past the last consumed newline.
   *
   * Always a line boundary, so passing it back as `from` on the next call
   * cannot split a JSON row across two reads. A trailing partial line leaves
   * its bytes unconsumed rather than being returned half-formed.
   */
  consumed: number;
}

/**
 * Read the whole lines appended to a file between two byte offsets.
 *
 * This exists so a reader that polls a growing append-only file pays for what
 * arrived rather than for the file's size. The chat window polls session usage
 * every 4 seconds for the length of a run, which is exactly when the file is
 * growing: re-reading a 4.3MB session cost ~16ms per poll and rose with every
 * turn, while reading only the tail is bounded by the size of the append.
 *
 * The caller supplies `size` (rather than this function calling stat itself)
 * because the caller must compare it against the previous `consumed` anyway to
 * notice a file that was rewritten instead of appended to — taking it as a
 * parameter keeps that decision, and the stat behind it, in one place.
 */
export function readAppendedLines(filePath: string, from: number, size: number): AppendedLines {
  // A negative or non-integer offset is a caller bug; treating it as "start
  // over" is safe because a full re-read produces the same totals as an
  // incremental one, only slower.
  const start = Number.isSafeInteger(from) && from > 0 ? from : 0;
  if (size <= start) return { lines: [], consumed: start };

  const fd = openSync(filePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(size - start);
    const read = readSync(fd, buffer, 0, buffer.length, start);
    const filled = buffer.subarray(0, read);
    const lastNewline = filled.lastIndexOf(0x0a);
    // Nothing but a partial row so far: consume nothing and let it arrive
    // complete on a later call.
    if (lastNewline < 0) return { lines: [], consumed: start };
    return {
      lines: filled.subarray(0, lastNewline).toString("utf-8").split("\n"),
      consumed: start + lastNewline + 1,
    };
  } finally {
    closeSync(fd);
  }
}
