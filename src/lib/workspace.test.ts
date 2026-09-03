import { describe, expect, it } from "vitest";
import { resolveWorkspaceCwd } from "./workspace";

const HOME = "/Users/someone";
const PROJECT = "/Users/someone/wwwroot/mp-blogs";
const OTHER = "/Users/someone/wwwroot/cc-videos";

describe("resolveWorkspaceCwd", () => {
  // The bug this function exists for: the sidebar opens a conversation with
  // ?session=<id> and never fills the project picker, so a panel keyed off the
  // picker alone stayed on the home directory for every project.
  it("follows the opened session's own directory", () => {
    expect(
      resolveWorkspaceCwd({
        sessionPending: true,
        sessionCwd: PROJECT,
        projectPath: "",
        defaultCwd: HOME,
      }),
    ).toBe(PROJECT);
  });

  it("prefers the session directory over a stale picker value", () => {
    expect(
      resolveWorkspaceCwd({
        sessionPending: true,
        sessionCwd: PROJECT,
        projectPath: OTHER,
        defaultCwd: HOME,
      }),
    ).toBe(PROJECT);
  });

  it("uses the picked project for a new chat that has no session yet", () => {
    expect(
      resolveWorkspaceCwd({ sessionPending: false, projectPath: PROJECT, defaultCwd: HOME }),
    ).toBe(PROJECT);
  });

  it("falls back to the server default with nothing else chosen", () => {
    expect(resolveWorkspaceCwd({ sessionPending: false, defaultCwd: HOME })).toBe(HOME);
  });

  it("holds the current directory while an opened session's cwd is in flight", () => {
    // "" tells the provider to keep what it has, so switching conversations
    // does not flash the home directory before session-info lands.
    expect(resolveWorkspaceCwd({ sessionPending: true, defaultCwd: HOME })).toBe("");
  });

  it("ignores whitespace-only values", () => {
    expect(
      resolveWorkspaceCwd({
        sessionPending: true,
        sessionCwd: "   ",
        projectPath: "  ",
        defaultCwd: HOME,
      }),
    ).toBe("");
  });

  it("returns empty when nothing is known at all", () => {
    expect(resolveWorkspaceCwd({})).toBe("");
  });

  it("survives a session whose file recorded no cwd", () => {
    // Such a session cannot say where it ran; the default is the honest answer
    // once the fetch has resolved.
    expect(
      resolveWorkspaceCwd({ sessionPending: false, sessionCwd: undefined, defaultCwd: HOME }),
    ).toBe(HOME);
  });
});
