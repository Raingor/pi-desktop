import { Text } from "@earendil-works/pi-tui";
import { formatUsageSummary, readUsageSummary } from "../src/usage.js";

const ENTRY_TYPE = "pi-usage-summary";

export default function (pi) {
  pi.registerEntryRenderer(ENTRY_TYPE, (entry, _options, theme) => {
    const text = typeof entry.data?.text === "string" ? entry.data.text : "No usage summary available.";
    return new Text(theme.fg(entry.data?.error ? "error" : "accent", text), 0, 0);
  });

  pi.registerCommand("pi-usage", {
    description: "Show local Pi session usage for today and the last 7 days",
    handler: async (_args, ctx) => {
      try {
        const summary = await readUsageSummary();
        const text = formatUsageSummary(summary);
        pi.appendEntry(ENTRY_TYPE, { text });

        if (ctx.mode === "print") process.stdout.write(`${text}\n`);
      } catch (error) {
        const text = `Failed to read Pi usage: ${error instanceof Error ? error.message : String(error)}`;
        pi.appendEntry(ENTRY_TYPE, { text, error: true });
        if (ctx.mode === "print") process.stderr.write(`${text}\n`);
      }
    },
  });
}
