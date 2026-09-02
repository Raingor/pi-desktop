import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PI_DESKTOP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Matches server.port in vite.config.ts
const DEFAULT_PORT = 5179;

let serverProcess: ChildProcess | null = null;

function getPackageManager(): "npm" | "pnpm" | "yarn" {
  if (existsSync(join(PI_DESKTOP_DIR, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(PI_DESKTOP_DIR, "yarn.lock"))) return "yarn";
  return "npm";
}

export default function (pi: ExtensionAPI) {
  // /pi-switch start|stop|status [port] — launch or stop the pi-desktop dashboard
  pi.registerCommand("pi-switch", {
    description: "Start or stop the pi-desktop dashboard: /pi-switch start|stop|status [port]",
    handler: async (args: string, ctx: ExtensionContext) => {
      const [action = "status", portArg] = args.trim().split(/\s+/);
      const port = Number(portArg) || DEFAULT_PORT;
      const base = `http://localhost:${port}`;
      const say = (text: string, kind: "info" | "warning" | "error" = "info") => {
        if (ctx.hasUI) ctx.ui.notify(text, kind);
        else process.stdout.write(`${text}\n`);
      };

      if (action === "status") {
        if (serverProcess && !serverProcess.killed) {
          say(`pi-desktop dashboard is running at ${base}`);
        } else {
          serverProcess = null;
          say(`pi-desktop dashboard is not running. Use /pi-switch start to launch it.`, "warning");
        }
        return;
      }

      if (action === "stop") {
        if (serverProcess && !serverProcess.killed) {
          serverProcess.kill();
          serverProcess = null;
          say("pi-desktop dashboard stopped.");
        } else {
          serverProcess = null;
          say("pi-desktop dashboard is not running.", "warning");
        }
        return;
      }

      if (action === "start") {
        if (serverProcess && !serverProcess.killed) {
          say(`pi-desktop dashboard is already running at ${base}`, "warning");
          return;
        }

        const pm = getPackageManager();
        const cmd = pm === "npm" ? "npx" : pm;

        serverProcess = spawn(cmd, ["vite", "--host", "--port", String(port)], {
          cwd: PI_DESKTOP_DIR,
          stdio: "ignore",
          detached: true,
        });
        serverProcess.unref();

        await new Promise((resolve_) => setTimeout(resolve_, 2000));

        say(`pi-desktop dashboard started!\nDashboard: ${base}\nUse /pi-switch stop to stop the server.`);
        return;
      }

      say(`Unknown action "${action}". Usage: /pi-switch start|stop|status [port]`, "error");
    },
  });
}
