import { describe, expect, it } from "vitest";
import { existsSync, statSync } from "fs";
import { homedir } from "os";
import { resolveDefaultChatCwd } from "./pi-reader";

// The default working directory for a prompt with no explicit project. A GUI
// launch inherits cwd "/", so this must never fall through to process.cwd().
describe("resolveDefaultChatCwd", () => {
  it("returns the home directory", () => {
    expect(resolveDefaultChatCwd()).toBe(homedir());
  });

  it("returns an existing directory", () => {
    const cwd = resolveDefaultChatCwd();
    expect(existsSync(cwd)).toBe(true);
    expect(statSync(cwd).isDirectory()).toBe(true);
  });

  it("never returns the filesystem root", () => {
    expect(resolveDefaultChatCwd()).not.toBe("/");
  });

  it("does not depend on the process cwd", () => {
    const before = resolveDefaultChatCwd();
    const original = process.cwd();
    try {
      process.chdir("/tmp");
      expect(resolveDefaultChatCwd()).toBe(before);
    } finally {
      process.chdir(original);
    }
  });
});
