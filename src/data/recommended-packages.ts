// Recommended pi extension packages, surfaced in Settings for one-click install.
// Seeded from the maintainer's own setup. `descKey` points to an i18n string.
export interface RecommendedPackage {
  id: string; // exact value written to settings.packages, e.g. "npm:pi-hermes-memory"
  name: string; // short display name
  descKey: string;
}

export const RECOMMENDED_PACKAGES: RecommendedPackage[] = [
  { id: "npm:pi-hermes-memory", name: "pi-hermes-memory", descKey: "pkg.hermes_memory" },
  { id: "npm:context-mode", name: "context-mode", descKey: "pkg.context_mode" },
  { id: "npm:pi-subagents", name: "pi-subagents", descKey: "pkg.subagents" },
  { id: "npm:pi-web-access", name: "pi-web-access", descKey: "pkg.web_access" },
  { id: "npm:pi-smart-fetch", name: "pi-smart-fetch", descKey: "pkg.smart_fetch" },
  { id: "npm:pi-rtk-optimizer", name: "pi-rtk-optimizer", descKey: "pkg.rtk_optimizer" },
  { id: "npm:pi-puppeteer", name: "pi-puppeteer", descKey: "pkg.puppeteer" },
  { id: "npm:pi-intercom", name: "pi-intercom", descKey: "pkg.intercom" },
  { id: "npm:pi-prompt-template-model", name: "pi-prompt-template-model", descKey: "pkg.prompt_template" },
  { id: "npm:@pi-unipi/notify", name: "@pi-unipi/notify", descKey: "pkg.notify" },
];
