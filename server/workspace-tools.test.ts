import { describe, expect, it, afterAll, beforeAll } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  clearFinishedTasks,
  gitReview,
  listDirectory,
  listTasks,
  readTaskOutput,
  readTextFile,
  startTask,
} from "./workspace-tools";

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "pi-desktop-tools-"));
  mkdirSync(join(root, "src"));
  mkdirSync(join(root, "node_modules"));
  writeFileSync(join(root, "src", "app.ts"), "export const x = 1;\n");
  writeFileSync(join(root, "readme.md"), "# hi\n");
  writeFileSync(join(root, "blob.bin"), Buffer.from([0x41, 0x00, 0x42]));
  // A file the panel must never be able to reach from `root`.
  writeFileSync(join(root, "..", "outside-secret.txt"), "do not leak\n");
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(join(root, "..", "outside-secret.txt"), { force: true });
  clearFinishedTasks();
});

describe("listDirectory", () => {
  it("lists directories before files, alphabetically", () => {
    const listing = listDirectory(root);
    expect(listing.error).toBeUndefined();
    expect(listing.entries.map((e) => e.name)).toEqual([
      "src",
      "blob.bin",
      "readme.md",
    ]);
    expect(listing.entries[0]!.kind).toBe("dir");
  });

  it("hides node_modules and dotfiles", () => {
    const names = listDirectory(root).entries.map((e) => e.name);
    expect(names).not.toContain("node_modules");
  });

  it("reports the parent only below the root", () => {
    expect(listDirectory(root).parent).toBeNull();
    expect(listDirectory(root, "src").parent).toBe("");
  });

  it("refuses to escape the root", () => {
    const listing = listDirectory(root, "..");
    expect(listing.error).toBe("path outside project root");
    expect(listing.entries).toEqual([]);
  });

  it("refuses a deep traversal that lands outside", () => {
    expect(listDirectory(root, "src/../../..").error).toBe(
      "path outside project root",
    );
  });
});

describe("readTextFile", () => {
  it("returns text content", () => {
    const file = readTextFile(root, "readme.md");
    expect(file.error).toBeUndefined();
    expect(file.content).toBe("# hi\n");
    expect(file.binary).toBe(false);
  });

  it("flags binary files instead of returning bytes", () => {
    const file = readTextFile(root, "blob.bin");
    expect(file.binary).toBe(true);
    expect(file.content).toBe("");
  });

  it("refuses to read outside the root", () => {
    const file = readTextFile(root, "../outside-secret.txt");
    expect(file.error).toBe("path outside project root");
    expect(file.content).toBe("");
  });

  it("refuses a directory", () => {
    expect(readTextFile(root, "src").error).toBe("not a file");
  });
});

describe("gitReview", () => {
  it("reports a non-repository rather than throwing", () => {
    expect(gitReview(root).error).toBe("not a git repository");
  });

  it("reports a missing directory", () => {
    expect(gitReview(join(root, "nope")).error).toBe("directory not found");
  });
});

describe("background tasks", () => {
  it("rejects an empty command", () => {
    expect(startTask({ command: "   ", cwd: root })).toEqual({
      error: "empty command",
    });
  });

  it("rejects a missing working directory", () => {
    expect(startTask({ command: "echo hi", cwd: join(root, "nope") })).toEqual({
      error: "working directory not found",
    });
  });

  it("captures stdout and a zero exit", async () => {
    const started = startTask({ command: "echo tool-panel-ok", cwd: root });
    expect(started).toHaveProperty("id");
    const { id } = started as { id: string };

    // Poll until the child closes rather than sleeping a fixed amount.
    let out = readTaskOutput(id, 0);
    for (let i = 0; i < 100 && out?.state === "running"; i += 1) {
      await new Promise((r) => setTimeout(r, 50));
      out = readTaskOutput(id, 0);
    }
    expect(out?.state).toBe("exited");
    expect(out?.exitCode).toBe(0);
    expect(out?.output).toContain("tool-panel-ok");
    expect(listTasks().some((t) => t.id === id)).toBe(true);
  });

  it("returns null for an unknown task", () => {
    expect(readTaskOutput("task-does-not-exist")).toBeNull();
  });

  it("resumes from a byte offset without repeating output", async () => {
    const started = startTask({ command: "echo abcdef", cwd: root }) as { id: string };
    let out = readTaskOutput(started.id, 0);
    for (let i = 0; i < 100 && out?.state === "running"; i += 1) {
      await new Promise((r) => setTimeout(r, 50));
      out = readTaskOutput(started.id, 0);
    }
    const consumed = out!.offset + out!.output.length;
    const tail = readTaskOutput(started.id, consumed);
    expect(tail?.output).toBe("");
    expect(tail?.dropped).toBe(false);
  });

  it("clears finished tasks", () => {
    expect(clearFinishedTasks()).toBeGreaterThan(0);
    expect(listTasks().filter((t) => t.state !== "running")).toEqual([]);
  });
});
