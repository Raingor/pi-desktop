import { describe, expect, it } from "vitest";
import { filterCommands, slashQuery, type SlashCommand } from "./SlashMenu";

const cmd = (name: string, source: SlashCommand["source"] = "extension"): SlashCommand => ({
  name,
  description: "",
  source,
});

describe("slashQuery", () => {
  it("returns the token after a leading slash", () => {
    expect(slashQuery("/brow")).toBe("brow");
    expect(slashQuery("/")).toBe("");
  });

  it("treats the fullwidth slash ／ as the same key", () => {
    // Chinese IMEs in fullwidth-punctuation mode emit U+FF0F; the user has no
    // way to know they typed a different codepoint.
    expect(slashQuery("／brow")).toBe("brow");
    expect(slashQuery("／")).toBe("");
    expect(slashQuery("／skill:c")).toBe("skill:c");
  });

  it("returns null when the text does not start with a slash", () => {
    expect(slashQuery("hello")).toBeNull();
    expect(slashQuery(" /brow")).toBeNull();
    expect(slashQuery("")).toBeNull();
  });

  it("stops once arguments begin", () => {
    // The command name is settled at the first space; the menu should close.
    expect(slashQuery("/browser open")).toBeNull();
    expect(slashQuery("/browser ")).toBeNull();
    expect(slashQuery("/skill:pdf-tools extract")).toBeNull();
  });

  it("stops on a newline too", () => {
    expect(slashQuery("/browser\n")).toBeNull();
  });
});

describe("filterCommands", () => {
  const all = [
    cmd("browser"),
    cmd("websearch"),
    cmd("review-loop", "prompt"),
    cmd("skill:frontend-design", "skill"),
    cmd("skill:commit-context", "skill"),
  ];

  it("returns everything for an empty query, order preserved", () => {
    expect(filterCommands(all, "").map((c) => c.name)).toEqual(all.map((c) => c.name));
  });

  it("ranks a prefix match first", () => {
    const hits = filterCommands(all, "b");
    expect(hits[0]!.name).toBe("browser");
  });

  it("matches a substring", () => {
    expect(filterCommands(all, "search").map((c) => c.name)).toEqual(["websearch"]);
  });

  it("matches a subsequence so initials work", () => {
    expect(filterCommands(all, "sfd").map((c) => c.name)).toEqual(["skill:frontend-design"]);
  });

  it("is case insensitive", () => {
    expect(filterCommands(all, "BROW").map((c) => c.name)).toEqual(["browser"]);
  });

  it("finds skills by their bare name, past the skill: prefix", () => {
    expect(filterCommands(all, "commit").map((c) => c.name)).toEqual(["skill:commit-context"]);
  });

  it("returns nothing when no command matches", () => {
    expect(filterCommands(all, "zzz")).toEqual([]);
  });

  it("prefers the shorter path to a match", () => {
    const hits = filterCommands([cmd("skill:review-notes", "skill"), cmd("review-loop", "prompt")], "review");
    expect(hits[0]!.name).toBe("review-loop");
  });
});
