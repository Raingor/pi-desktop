import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { findDeferredEventReads, maskLiterals } from "./deferred-state.ts";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe("maskLiterals", () => {
  it("keeps the text the same length so line numbers stay usable", () => {
    const source = 'const a = "x";\nconst b = 1;\n';
    expect(maskLiterals(source)).toHaveLength(source.length);
    expect(maskLiterals(source).split("\n")).toHaveLength(source.split("\n").length);
  });

  it("hides string and comment contents but not surrounding code", () => {
    const masked = maskLiterals('call("currentTarget"); // currentTarget\nreal;');
    expect(masked).not.toContain("currentTarget");
    expect(masked).toContain("call(");
    expect(masked).toContain("real;");
  });

  it("does not end a string at an escaped quote", () => {
    // Getting this wrong flips the parser's idea of what is code for the rest of
    // the file, which would silently disable the whole sweep.
    const masked = maskLiterals('const a = "he said \\"currentTarget\\"";\nsetX((p) => e.currentTarget.open);');
    expect(masked).toContain("setX((p) =>");
    expect(masked.slice(masked.indexOf("setX"))).toContain("currentTarget");
  });

  it("hides a template body but keeps its interpolated expressions", () => {
    const masked = maskLiterals("`text currentTarget ${setX((p) => e.currentTarget.open)}`");
    // The literal words are gone; the code inside `${…}` survives.
    expect(masked.indexOf("currentTarget")).toBeGreaterThan(masked.indexOf("${"));
    expect(masked).toContain("setX((p) =>");
  });

  it("handles a template nested inside an interpolation", () => {
    const masked = maskLiterals("`a ${ `b ${ 1 } c` } d`;\ncode;");
    expect(masked).toContain("code;");
    expect(masked).not.toContain("a ");
    expect(masked).not.toContain("b ");
  });

  it("does not mistake a brace inside an interpolation for the end of it", () => {
    const masked = maskLiterals("`${ ({ k: 1 }) } tail`;\ncode;");
    expect(masked).toContain("k: 1");
    expect(masked).not.toContain("tail");
    expect(masked).toContain("code;");
  });

  it("leaves an unterminated literal without hanging", () => {
    expect(maskLiterals('const a = "oops').length).toBe('const a = "oops'.length);
    expect(maskLiterals("const a = `oops").length).toBe("const a = `oops".length);
    expect(maskLiterals("/* oops").length).toBe("/* oops".length);
  });
});

describe("findDeferredEventReads", () => {
  it("flags a currentTarget read inside a state updater", () => {
    const found = findDeferredEventReads(
      "onToggle={(event) => setOpen((previous) => ({ ...previous, [i]: event.currentTarget.open }))}",
    );
    expect(found).toHaveLength(1);
    expect(found[0]!.snippet).toContain("currentTarget");
  });

  it("reports the line the setter is on", () => {
    const found = findDeferredEventReads(
      ["a;", "b;", "setOpen((p) => e.currentTarget.open);"].join("\n"),
    );
    expect(found[0]!.line).toBe(3);
  });

  it("allows the safe spelling: read in the handler, pass the value", () => {
    // This is what the fix looks like, and it must not be reported or the guard
    // would block its own remedy.
    expect(
      findDeferredEventReads(
        "onToggle={(event) => { const isOpen = event.currentTarget.open; setOpen((p) => ({ ...p, [i]: isOpen })); }}",
      ),
    ).toEqual([]);
  });

  it("allows a direct value argument that happens to read currentTarget", () => {
    expect(
      findDeferredEventReads("onInput={(e) => setUiZoom(Number(e.currentTarget.value))}"),
    ).toEqual([]);
  });

  it("ignores an updater that does not touch the event", () => {
    expect(findDeferredEventReads("setCount((previous) => previous + 1);")).toEqual([]);
  });

  it("ignores the words when they only appear in a string or a comment", () => {
    expect(
      findDeferredEventReads(
        'setNote((p) => "setX((q) => e.currentTarget.open)"); // setY((q) => e.currentTarget.open)',
      ),
    ).toEqual([]);
  });

  it("finds every occurrence, not just the first", () => {
    const found = findDeferredEventReads(
      ["setA((p) => e.currentTarget.open);", "setB((p) => e.currentTarget.value);"].join("\n"),
    );
    expect(found.map((f) => f.line)).toEqual([1, 2]);
  });

  it("does not stop at a nested closing paren inside the argument list", () => {
    expect(
      findDeferredEventReads("setOpen((p) => ({ ...p, k: fn(e.currentTarget.open) }));"),
    ).toHaveLength(1);
  });

  it("skips a setter whose call never closes", () => {
    expect(findDeferredEventReads("setOpen((p) => e.currentTarget.open")).toEqual([]);
  });
});

describe("the tracked sources", () => {
  it("never read event.currentTarget inside a state updater", () => {
    const offenders: string[] = [];
    for (const dir of ["src", "electron", "server", "test"]) {
      for (const file of sourceFiles(join(REPO_ROOT, dir))) {
        for (const hit of findDeferredEventReads(readFileSync(file, "utf8"))) {
          offenders.push(`${file.slice(REPO_ROOT.length + 1)}:${hit.line}  ${hit.snippet}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
