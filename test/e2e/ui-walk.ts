// UI walk over the packaged app, driven through the DevTools protocol.
//
// Run it against a packaged app that was started with a debugging port:
//
//   env -u ELECTRON_RUN_AS_NODE \
//     ./release/mac-arm64/pi-desktop.app/Contents/MacOS/pi-desktop \
//     --remote-debugging-port=9222 &
//   npm run test:ui
//
// (`env -u ELECTRON_RUN_AS_NODE` matters: with that variable set — and this
// shell sets it — Electron runs as plain Node and never opens a window.)
//
// Every assertion about content that arrives asynchronously goes through
// `Runner.waitFor`. That is the fix for the last false failure of the previous
// run: the menu-bar popup loads its summary over IPC, the walk sampled the DOM
// once, caught the "加载使用量数据…" placeholder, and reported a broken popup
// that was in fact fine. There is no single-frame read of async state anywhere
// below — where a frame is settled by construction, `check` is used and the
// reason is stated.
//
// Two more habits from the same run are enforced here rather than remembered:
//   · Controls are located by accessible name through `locators.ts`, and every
//     click asserts on the returned "clicked" / "not-found". Icon-only tabs
//     have no text, which is how six tab clicks previously all hit tab one.
//   · Visible copy comes from the shipped dictionaries via `label(key)`. Where
//     a label is a plain literal in a component (the tool-panel tabs, the
//     settings sections), the walk enumerates the live names and drives each by
//     the name it actually has, so a rename cannot silently pass.
//
// The walk restores what it changes: the tool panel's open state and active
// tab, the selected language, and the route it started on. It runs against the
// developer's real app, so it clicks nothing destructive — no deletes, no
// config writes, no model calls.

import { CdpSession, type Target } from "./cdp.ts";
import { label } from "./labels.ts";
import { accessibleNamesExpression, clickExpression } from "./locators.ts";
import { Runner, clip, sleep, squash } from "./runner.ts";

const CDP_PORT = Number(process.env.PI_E2E_CDP_PORT ?? 9222);
const TOKEN = `pi-e2e-${Date.now().toString(36)}`;

const run = new Runner(`UI walk · CDP ${CDP_PORT}`);

// ─── Page expressions ───────────────────────────────────
// Small enough to read at a glance; `locators.ts` owns anything with logic in
// it. textContent rather than innerText throughout: innerText depends on
// layout, and the popup window is hidden while this runs.

const $count = (selector: string) => `document.querySelectorAll(${JSON.stringify(selector)}).length`;
const $exists = (selector: string) => `Boolean(document.querySelector(${JSON.stringify(selector)}))`;
const $text = (selector: string) =>
  `((document.querySelector(${JSON.stringify(selector)}) || {}).textContent || "")`;

/** Click the nth match. For controls whose identity is position, not a label. */
const $clickNth = (selector: string, n: number) => `(() => {
  const node = document.querySelectorAll(${JSON.stringify(selector)})[${n}];
  if (!node) return "not-found";
  node.click();
  return "clicked";
})()`;

/**
 * The accessible name of the active tool-panel tab, or "".
 *
 * `aria-current` is what the component sets, so this asks the same question an
 * assistive layer would. Unlike counting tabs it distinguishes "the sixth tab
 * is selected" from "a sixth tab exists", which is the distinction the previous
 * walk was missing.
 */
const $currentToolTab =
  `((document.querySelector('.tool-panel-tab[aria-current="true"]') || {}).getAttribute?.("aria-label")) || ""`;

/**
 * Type into a controlled React input and submit with Enter.
 *
 * Assigning `.value` is invisible to React: it tracks the previous value on the
 * DOM node and skips the change event when the two agree. Going through the
 * prototype setter defeats that tracker, and the events have to bubble because
 * React 19 listens on the root container rather than on the element.
 */
const $typeAndEnter = (selector: string, value: string) => `(() => {
  const input = document.querySelector(${JSON.stringify(selector)});
  if (!input) return "no-input";
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(input, ${JSON.stringify(value)});
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  return "submitted";
})()`;

// ─── Shared steps ───────────────────────────────────────

/** Click by accessible name and fail the step unless something was clicked. */
async function click(page: CdpSession, name: string, selector: string, query: string): Promise<boolean> {
  const result = await page.eval<string>(clickExpression(selector, query));
  return run.check(name, result === "clicked", `${query} → ${result}`);
}

/** Wait until a selector matches, reporting the count that was there instead. */
function waitForSelector(
  page: CdpSession,
  name: string,
  selector: string,
  { timeoutMs = 10_000 }: { timeoutMs?: number } = {},
): Promise<boolean> {
  return run.waitFor(
    name,
    async () => {
      const n = await page.eval<number>($count(selector));
      return [n > 0, `${n} × ${selector}`];
    },
    { timeoutMs },
  );
}

/** Record the page problems collected since the last drain. */
function drain(page: CdpSession, phase: string): boolean {
  const problems = page.drainProblems();
  return run.check(
    `${phase}: no console errors or failed requests`,
    problems.length === 0,
    problems.length === 0 ? "clean" : problems.map((p) => `[${p.kind}] ${clip(p.text, 90)}`).join(" | "),
  );
}

// ─── Chat ───────────────────────────────────────────────

async function walkChat(page: CdpSession) {
  // Normalise the route: a previous run may have left the window on /settings.
  if (await page.eval<boolean>($exists(".settings-page"))) {
    await click(page, "leave settings before the chat walk", ".settings-page-back", "返回对话");
  }
  await waitForSelector(page, "chat page renders", ".codex-chat", { timeoutMs: 20_000 });

  // Settled by construction: the shell and the composer ship in the same commit
  // as the chat page, so if .codex-chat is up these are too.
  run.check("sidebar present", await page.eval<boolean>($exists(".codex-sidebar")));
  run.check("composer present", await page.eval<boolean>($exists(".codex-composer")));

  const projects = await page.eval<number>($count(".codex-project-group"));
  const conversations = await page.eval<number>($count(".codex-conversation"));
  run.check(
    "project conversations listed",
    projects > 0 && conversations > 0,
    `${projects} projects · ${conversations} conversations`,
  );

  if (conversations > 0) {
    // Position is the honest identity for a history list, so this one clicks by
    // index. The assertion is on what arrives, not on the click.
    const clicked = await page.eval<string>($clickNth(".codex-conversation", 0));
    run.check("open the first conversation", clicked === "clicked", clicked);

    // History is fetched, so this is exactly the shape of assertion that has to
    // poll. Either turns render or the session is genuinely empty; a page still
    // showing the loader when the timeout expires reports that instead.
    await run.waitFor(
      "conversation history renders",
      async () => {
        const turns = await page.eval<number>($count(".codex-message-content"));
        if (turns > 0) return [true, `${turns} turns`];
        if (await page.eval<boolean>($exists(".codex-empty"))) return [true, "empty session placeholder"];
        const error = squash(await page.eval<string>($text(".codex-history-error")));
        return [false, error || "still loading"];
      },
      { timeoutMs: 20_000 },
    );
  }

  drain(page, "chat");
}

// ─── Tool panel ─────────────────────────────────────────

async function walkToolPanel(page: CdpSession): Promise<() => Promise<void>> {
  const wasOpen = await page.eval<boolean>($exists(".tool-panel"));
  if (!wasOpen) {
    await click(page, "open the tool panel", ".tools-toggle", "显示工具面板");
    await waitForSelector(page, "tool panel opens", ".tool-panel");
  }

  const originalTab = squash(await page.eval<string>($currentToolTab));

  // The tabs are icon-only, so their names come off the DOM and each one is
  // then driven by the name it actually has. Six tabs plus the close button.
  const names = (await page.eval<string[]>(accessibleNamesExpression(".tool-panel-tabs button"))) ?? [];
  run.check("tool panel exposes 7 named controls", names.length === 7, names.join(" / "));
  run.check(
    "every tab has an accessible name",
    names.length > 0 && names.every((n) => n.trim().length > 0),
    `${names.filter((n) => !n.trim()).length} unnamed`,
  );

  const tabs = names.slice(0, 6);
  for (const name of tabs) {
    await click(page, `tool tab: ${name}`, ".tool-panel-tabs button", name);
    // The click's return value only proves that a node was clicked. This proves
    // the *right* one is now current — the assertion the old walk lacked, which
    // is why six clicks that all landed on tab one all passed.
    await run.waitFor(
      `tool tab ${name} becomes current`,
      async () => {
        const current = squash(await page.eval<string>($currentToolTab));
        const filled = await page.eval<number>($count(".tool-panel-stage > *"));
        return [current === name && filled > 0, `current=${current || "none"} · ${filled} stage children`];
      },
      { timeoutMs: 8_000 },
    );
  }

  // The terminal is the panel the previous run "verified" against a DOM that
  // did not contain it, so it gets a real end-to-end: keystrokes in, a child
  // process out.
  const terminalName = tabs[5] ?? "终端";
  await click(page, "select the terminal tab", ".tool-panel-tabs button", terminalName);
  await waitForSelector(page, "terminal view present", ".tool-terminal-view");
  await waitForSelector(page, "terminal input present", ".tool-terminal-input input");

  const submitted = await page.eval<string>($typeAndEnter(".tool-terminal-input input", `printf ${TOKEN}`));
  run.check("submit a command to the terminal", submitted === "submitted", submitted);
  await run.waitFor(
    "terminal streams the command output back",
    async () => {
      const view = squash(await page.eval<string>($text(".tool-terminal-view")));
      return [view.includes(TOKEN), view ? clip(view, 60) : "no output yet"];
    },
    { timeoutMs: 25_000 },
  );

  drain(page, "tool panel");

  // Restore: same tab, same open state as before the walk.
  return async () => {
    if (originalTab && originalTab !== terminalName) {
      await page.eval(clickExpression(".tool-panel-tabs button", originalTab));
    }
    if (!wasOpen) {
      await page.eval(clickExpression(".tool-panel-tabs button", "隐藏工具面板"));
    }
  };
}

// ─── Language ───────────────────────────────────────────

async function walkLanguage(page: CdpSession) {
  // The trigger's own label is the active language's native name, so there is
  // nothing stable to match on: it is opened by position. The assertions that
  // matter are on the menu it reveals and on the copy that follows.
  const opened = await page.eval<string>($clickNth(".codex-language > button", 0));
  run.check("open the language menu", opened === "clicked", opened);

  const options = (await page.eval<string[]>(accessibleNamesExpression(".language-menu .language-option"))) ?? [];
  run.check("four languages offered", options.length === 4, options.join(" / "));

  const japanese = options.find((name) => name.includes("日本語"));
  if (japanese) {
    await click(page, "switch to Japanese", ".language-menu .language-option", japanese);
    // React re-renders synchronously, but the assertion still polls — and what
    // it compares against comes from the ja dictionary, so a key missing there
    // fails here instead of quietly passing on the English fallback.
    await run.waitFor(
      "shell copy follows the selected language",
      async () => {
        const now = squash(await page.eval<string>($text(".codex-settings-link")));
        return [now === label("nav.settings", "ja"), `${now} (want ${label("nav.settings", "ja")})`];
      },
      { timeoutMs: 5_000 },
    );

    const reopened = await page.eval<string>($clickNth(".codex-language > button", 0));
    run.check("reopen the language menu", reopened === "clicked", reopened);
    await click(page, "switch back to Simplified Chinese", ".language-menu .language-option", "简体中文");
    await run.waitFor(
      "language restored",
      async () => {
        const now = squash(await page.eval<string>($text(".codex-settings-link")));
        return [now === label("nav.settings", "zh-CN"), now];
      },
      { timeoutMs: 5_000 },
    );
  }

  drain(page, "language");
}

// ─── Settings workspace ─────────────────────────────────

/**
 * What proves each settings section actually mounted.
 *
 * Positional, matching the `sections` array in SettingsWorkspace: the nav
 * labels are component literals and are read off the DOM, while these markers
 * are either a class the page owns or copy resolved from the dictionaries.
 * Nothing here is a transcribed string.
 */
const SECTION_MARKERS: { probe: (page: CdpSession) => Promise<[boolean, string]> }[] = [
  {
    // 通用 — SettingsPage, whose own six sub-tabs are walked separately.
    probe: async (page) => {
      const heading = squash(await page.eval<string>($text(".settings-page-inner h1")));
      const subTabs = await page.eval<number>($count(".settings-page-inner nav button"));
      return [heading.includes(label("settings.title")) && subTabs === 6, `${heading} · ${subTabs} sub-tabs`];
    },
  },
  {
    // 概览与使用统计 — the dashboard's four stat cards.
    probe: async (page) => {
      const cards = await page.eval<number>($count(".dashboard-stat-card"));
      return [cards >= 4, `${cards} stat cards`];
    },
  },
  {
    // 提供商与模型 — the heaviest chunk in the app.
    probe: async (page) => {
      const ok = await page.eval<boolean>($exists(".providers-page"));
      return [ok, ok ? "providers page" : "no .providers-page"];
    },
  },
  {
    // 子代理 — its three tabs, by dictionary key.
    probe: async (page) => {
      const body = squash(await page.eval<string>($text(".settings-page-inner")));
      const want = ["subagents.tab_agents", "subagents.tab_chains", "subagents.tab_history"].map((k) => label(k));
      const missing = want.filter((w) => !body.includes(w));
      return [missing.length === 0, missing.length ? `missing ${missing.join(", ")}` : want.join(" / ")];
    },
  },
  {
    // 模型测速 — heading only; running a test would spend real tokens.
    probe: async (page) => {
      const body = squash(await page.eval<string>($text(".settings-page-inner")));
      return [body.includes(label("speed_test.title")), clip(body, 50)];
    },
  },
  {
    // 会话管理 — both tab labels, by dictionary key.
    probe: async (page) => {
      const body = squash(await page.eval<string>($text(".settings-page-inner")));
      const want = [label("sessions.tab_sessions"), label("sessions.tab_trash")];
      const missing = want.filter((w) => !body.includes(w));
      return [missing.length === 0, missing.length ? `missing ${missing.join(", ")}` : want.join(" / ")];
    },
  },
  {
    // 记忆
    probe: async (page) => {
      const ok = await page.eval<boolean>($exists(".memory-page"));
      return [ok, ok ? "memory page" : "no .memory-page"];
    },
  },
];

async function walkSettings(page: CdpSession): Promise<string[]> {
  await click(page, "open the settings workspace", ".codex-settings-link", label("nav.settings"));
  await waitForSelector(page, "settings workspace renders", ".settings-page-nav", { timeoutMs: 15_000 });

  const names = (await page.eval<string[]>(accessibleNamesExpression(".settings-page-nav nav button"))) ?? [];
  run.check("seven settings sections", names.length === SECTION_MARKERS.length, names.join(" / "));

  for (let i = 0; i < names.length; i++) {
    const name = names[i]!;
    const marker = SECTION_MARKERS[i];
    await click(page, `settings section: ${name}`, ".settings-page-nav nav button", name);
    if (!marker) continue;
    // Each section is a lazy chunk fetched from the local server, so the only
    // valid form of this assertion is the polling one: the Suspense fallback
    // has to clear *and* the page's own marker has to appear.
    await run.waitFor(
      `settings section ${name} mounts`,
      async () => {
        if (await page.eval<boolean>($exists(".settings-page-loading"))) return [false, "still loading the chunk"];
        return marker.probe(page);
      },
      { timeoutMs: 20_000 },
    );
    drain(page, `settings/${name}`);
  }

  return names;
}

/**
 * The text of whatever SettingsPage renders below its tab strip.
 *
 * The general subtree of the DOM answers "where is the panel" itself, via the
 * sibling combinator, rather than being told what the panel looks like. The
 * first version of this counted `.settings-page-inner section`, which holds for
 * the four sub-tabs built out of the `Card` helper and is false for Skills and
 * 命令 — those render a bare `div.skills-page`. Two healthy tabs were reported
 * broken. That is failure class 4 wearing a different hat: an assertion that
 * describes markup the app never had.
 */
const $panelText = `(() => {
  const nodes = document.querySelectorAll(".settings-page-inner nav ~ *");
  return Array.from(nodes).map((node) => node.textContent || "").join(" ");
})()`;

/** The six sub-tabs of the 通用 section. Labels are literals, so enumerate. */
async function walkGeneralSubTabs(page: CdpSession, sectionName: string) {
  await click(page, "reselect the general section", ".settings-page-nav nav button", sectionName);
  await waitForSelector(page, "general section ready", ".settings-page-inner nav button");

  const tabs = (await page.eval<string[]>(accessibleNamesExpression(".settings-page-inner nav button"))) ?? [];
  run.check("six general sub-tabs", tabs.length === 6, tabs.join(" / "));

  // Each panel must be non-empty *and* different from the one before it. Those
  // two conditions together are what a shape assertion was reaching for: a
  // blank tab fails the first, and a click that does not switch fails the
  // second. Neither transcribes anything about the markup or the copy — the
  // three pages here hardcode their Chinese, so there is no dictionary key to
  // resolve and nothing safe to hardcode in its place.
  let previous = "";
  for (const tab of tabs) {
    await click(page, `general sub-tab: ${tab}`, ".settings-page-inner nav button", tab);
    let latest = previous;
    await run.waitFor(
      `general sub-tab ${tab} renders its own panel`,
      async () => {
        const text = squash(await page.eval<string>($panelText));
        latest = text;
        if (text.length === 0) return [false, "empty panel"];
        if (text === previous) return [false, "panel unchanged from the previous tab"];
        return [true, `${text.length} chars · ${clip(text, 34)}`];
      },
      { timeoutMs: 10_000 },
    );
    previous = latest;
    drain(page, `settings/general/${tab}`);
  }
}

// ─── Dashboard ──────────────────────────────────────────

/**
 * Rows currently in the request log, with the empty state read as zero.
 *
 * The table is paged, so this is the visible count rather than the total. That
 * is still sound for a monotonic comparison — a constant page cap cannot make a
 * wider range show fewer rows — and the numbers reach the report either way.
 */
async function logRows(page: CdpSession): Promise<number> {
  const body = squash(await page.eval<string>($text(".data-console tbody")));
  if (body.includes(label("dashboard.no_data"))) return 0;
  return page.eval<number>($count(".data-console tbody tr"));
}

/** True once the dashboard is not mid-fetch: `refreshing` dims the wrapper. */
async function dashboardSettled(page: CdpSession): Promise<boolean> {
  const busy = await page.eval<number>(
    $count(".settings-page-inner .transition-opacity.opacity-60, .settings-page-inner .animate-spin"),
  );
  const cards = await page.eval<number>($count(".dashboard-stat-card"));
  return busy === 0 && cards >= 4;
}

async function walkDashboard(page: CdpSession, sectionName: string) {
  await click(page, "reselect the overview section", ".settings-page-nav nav button", sectionName);
  await waitForSelector(page, "dashboard ready", ".dashboard-stat-card", { timeoutMs: 20_000 });

  // Stat card titles come from the dictionary, so a renamed key fails here.
  const body = squash(await page.eval<string>($text(".settings-page-inner")));
  for (const key of ["dashboard.total_tokens", "dashboard.total_requests", "dashboard.total_cost"]) {
    run.check(`stat card: ${key}`, body.includes(label(key)), label(key));
  }

  // The three ranges, re-bucketing the same records. A wider window cannot
  // contain fewer requests, which is the invariant the timezone change had to
  // preserve.
  const counts: number[] = [];
  for (const key of ["dashboard.range.today", "dashboard.range.7d", "dashboard.range.30d"]) {
    const name = label(key);
    // Any button in the settings body is a candidate: the range strip has no
    // class of its own, and inventing a structural selector for it would be one
    // more thing to drift. The three names are unique on the page.
    await click(page, `range: ${name}`, ".settings-page-inner button", name);
    // A brief pause before polling. `refreshing` is set synchronously with the
    // click, but a fetch that resolves inside one poll interval would otherwise
    // let the *previous* range's rows answer the question.
    await sleep(150);
    await run.waitFor(
      `range ${name} finishes loading`,
      async () => {
        const settled = await dashboardSettled(page);
        return [settled, settled ? "settled" : "fetch in flight"];
      },
      { timeoutMs: 20_000 },
    );
    const rows = await logRows(page);
    counts.push(rows);
    run.check(`range ${name} reports data`, rows >= 0, `${rows} log rows`);
  }
  const [today = 0, week = 0, month = 0] = counts;
  run.check(
    "wider ranges never report fewer requests",
    week >= today && month >= week,
    `today ${today} ≤ 7d ${week} ≤ 30d ${month}`,
  );

  // The three breakdown tabs, each verified by its table's first header — a
  // different dictionary key per tab, so a click that fails to switch tabs
  // cannot pass.
  const tabHeaders: [string, string][] = [
    ["dashboard.request_log", "dashboard.time"],
    ["dashboard.provider_stats", "dashboard.provider"],
    ["dashboard.model_stats", "dashboard.model"],
  ];
  for (const [tabKey, headerKey] of tabHeaders) {
    const name = label(tabKey);
    await click(page, `breakdown tab: ${name}`, ".data-console button", name);
    await run.waitFor(
      `breakdown tab ${name} shows its own table`,
      async () => {
        const first = squash(await page.eval<string>($text(".data-console thead th")));
        return [first.includes(label(headerKey)), `${first || "no header"} (want ${label(headerKey)})`];
      },
      { timeoutMs: 8_000 },
    );
  }

  drain(page, "dashboard");
}

// ─── Sessions ───────────────────────────────────────────

async function walkSessions(page: CdpSession, sectionName: string) {
  await click(page, "reselect the sessions section", ".settings-page-nav nav button", sectionName);
  await run.waitFor(
    "session list loads",
    async () => {
      if (await page.eval<boolean>($exists(".settings-page-loading"))) return [false, "loading the chunk"];
      const body = squash(await page.eval<string>($text(".settings-page-inner")));
      return [body.includes(label("sessions.tab_sessions")), clip(body, 50)];
    },
    { timeoutMs: 20_000 },
  );

  await click(page, "open the trash tab", ".settings-page-inner button", label("sessions.tab_trash"));
  // The trash tab renders its description unconditionally and then either the
  // empty state or a list, so the description is the switch and the rest is
  // data — asserting on both keeps a stuck tab from passing.
  await run.waitFor(
    "trash tab renders",
    async () => {
      const body = squash(await page.eval<string>($text(".settings-page-inner")));
      if (!body.includes(label("sessions.trash_desc"))) return [false, "still on the session tab"];
      const empty = body.includes(label("sessions.trash_empty"));
      return [true, empty ? "trash empty" : "trash has entries"];
    },
    { timeoutMs: 10_000 },
  );
  await click(page, "return to the session tab", ".settings-page-inner button", label("sessions.tab_sessions"));

  drain(page, "sessions");
}

// ─── Menu-bar popup ─────────────────────────────────────

async function walkPopup(target: Target) {
  const popup = await CdpSession.attach(target);
  try {
    // The whole reason `waitFor` exists. The summary is an IPC round trip that
    // scans ~150MB of session files; the main process warms a cache at startup,
    // but a cold read still takes seconds. A single sample here is what
    // previously "found" a broken popup.
    await run.waitFor(
      "popup replaces its loading placeholder with data",
      async () => {
        const body = squash(await popup.eval<string>('document.body.textContent || ""'));
        if (!body) return [false, "empty document"];
        if (body.includes("加载使用量数据")) return [false, "still loading the summary"];
        if (body.includes("⚠️")) return [false, clip(body, 70)];
        const stats = await popup.eval<number>($count(".stat-value"));
        const providers = await popup.eval<number>($count(".provider-list"));
        return [stats >= 2 && providers === 1, `${stats} stat values · ${providers} provider list`];
      },
      { timeoutMs: 45_000, intervalMs: 500 },
    );
    drain(popup, "popup");
  } finally {
    popup.close();
  }
}

// ─── Main ───────────────────────────────────────────────

async function main() {
  const targets = await CdpSession.targets(CDP_PORT);
  const pages = targets.filter((t) => t.type === "page");
  const mainTarget = pages.find((t) => t.url.startsWith("http://127.0.0.1:") && !t.url.includes("popup"));
  const popupTarget = pages.find((t) => t.url.includes("popup"));

  run.check(
    "main window is debuggable",
    Boolean(mainTarget),
    mainTarget ? mainTarget.url : pages.map((t) => t.url).join(" | ") || "no page targets",
  );
  if (!mainTarget) {
    process.stderr.write(
      "\nNo renderer target. Start the packaged app with --remote-debugging-port and clear ELECTRON_RUN_AS_NODE.\n",
    );
    process.exit(run.report() || 1);
  }

  const page = await CdpSession.attach(mainTarget);
  try {
    await walkChat(page);
    const restoreToolPanel = await walkToolPanel(page);
    await restoreToolPanel();
    await walkLanguage(page);

    const sections = await walkSettings(page);
    if (sections[0]) await walkGeneralSubTabs(page, sections[0]);
    if (sections[1]) await walkDashboard(page, sections[1]);
    if (sections[5]) await walkSessions(page, sections[5]);

    // Leave the app where the user left it.
    await click(page, "return to the chat page", ".settings-page-back", "返回对话");
    await waitForSelector(page, "chat page restored", ".codex-chat", { timeoutMs: 15_000 });
  } finally {
    page.close();
  }

  run.check("popup window is debuggable", Boolean(popupTarget), popupTarget ? popupTarget.url : "no popup target");
  if (popupTarget) await walkPopup(popupTarget);

  process.exit(run.report());
}

main().catch((error) => {
  process.stderr.write(`\nwalk aborted: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
