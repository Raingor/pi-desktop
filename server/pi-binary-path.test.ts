import { describe, expect, it } from "vitest";
import { spawnSync } from "child_process";
import { existsSync, readdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { resolvePiBinary, withPiNodePath } from "./pi-reader";

// A packaged GUI app inherits the system PATH — /usr/bin:/bin and little else.
// These tests run the discovery under exactly that environment, because a
// normal dev-shell PATH masks the failure they guard against: pi's shebang is
// `#!/usr/bin/env node`, and without the pi-node bin directory on PATH every
// probe of pi dies with status 127 (`env: node: No such file or directory`)
// before pi's own code runs.

const GUI_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";

describe("withPiNodePath", () => {
  it("adds the pi-node bin directories to a bare PATH", () => {
    const value = withPiNodePath();
    const root = join(homedir(), ".local", "share", "pi-node");
    if (!existsSync(root)) return; // pi-node not installed; nothing to assert
    for (const entry of readdirSync(root)) {
      expect(value).toContain(join(root, entry, "bin"));
    }
    expect(value).toContain("/usr/bin");
  });
});

describe("resolvePiBinary under a GUI PATH", () => {
  it("finds pi even when node is not on PATH", () => {
    const original = process.env.PATH;
    process.env.PATH = GUI_PATH;
    try {
      const found = resolvePiBinary();
      if (existsSync(join(homedir(), ".local", "share", "pi-node"))) {
        expect(found).not.toBeNull();
        expect(found!.version).toMatch(/\d/);
      }
      // The old failure mode, kept as a regression record: probing pi with the
      // bare system PATH exits 127 with `env: node: No such file or directory`.
      if (found) {
        const probe = spawnSync(found.bin, ["--version"], {
          encoding: "utf8",
          timeout: 15000,
          env: { PATH: GUI_PATH },
        });
        expect(probe.status).toBe(127);
        expect(probe.stderr).toContain("env: node");
      }
    } finally {
      process.env.PATH = original;
    }
  });
});
