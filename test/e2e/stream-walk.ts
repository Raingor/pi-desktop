// Streaming walk: one real chat turn against the packaged app.
//
// This exists because neither other harness sends a prompt. `ui-walk` opens
// existing conversations and asserts their history; `api-sweep` never touches
// the renderer. So the delta path — the buffer in src/lib/stream-buffer.ts, the
// memoised markdown, the follow-the-bottom scrolling — had no end-to-end cover
// at all, and its failure modes are quiet: a dropped tail looks like a short
// answer, and a broken coalescer just feels sluggish.
//
// It found a real one on its first successful run. Every run step renders
// `<details open>`, Chromium fires `toggle` on mount, and the handler read
// `event.currentTarget` inside a `setState` updater — which React runs later,
// after it has nulled the field. Idle, React evaluates the updater eagerly and
// the bug hides; mid-stream there is always an update pending, so it threw and
// unmounted the chat page. 116 UI assertions and 61 API assertions all passed
// while the app could not hold a conversation. test/guards/deferred-state.ts now
// blocks that spelling repo-wide, and this walk covers the wiring it broke.
//
// Not part of `npm run verify`: it spends a real model call, needs network and
// credentials, and takes as long as the model takes. Run it by hand against a
// packaged build — `npm run test:stream` — after touching anything on the
// streaming path.

import { CdpSession } from "./cdp.ts";
import { Runner, clip, sleep } from "./runner.ts";

const CDP_PORT = Number(process.env.PI_E2E_CDP_PORT ?? 9222);

// Long on purpose: coalescing is only observable across a few hundred
// characters, and one sentence would pass a meaningless test.
const PROMPT =
  process.env.PI_E2E_PROMPT ??
  "请用约 600 字、分三段，解释 Unicode 码点与 UTF-8、UTF-16 之间的关系，并说明为什么换行符不会出现在 UTF-8 的多字节序列内部。";

/** Below this, the answer is too short to say anything about batching. */
const MEASURABLE_CHARS = 200;

/** One repaint per token would be ~1–3 for Chinese; the buffer targets tens. */
const MIN_CHARS_PER_REPAINT = 5;

const run = new Runner(`Streaming walk · CDP ${CDP_PORT}`);

interface Report {
  samples: [number, number][];
  text: string;
}

async function main() {
  const targets = await CdpSession.targets(CDP_PORT);
  const target = targets.find(
    (t) => t.type === "page" && t.url.startsWith("http://127.0.0.1:") && !t.url.includes("popup"),
  );
  if (!target) throw new Error("no renderer target on the debugging port");
  const page = await CdpSession.attach(target);

  // Leave any settings page so the composer is on screen.
  await page.eval(`(() => {
    const back = document.querySelector(".settings-page-back");
    if (back) back.click();
    return true;
  })()`);
  await run.waitFor("composer is on screen", async () => {
    const found = await page.eval<number>(
      `document.querySelectorAll(".codex-composer textarea").length`,
    );
    return [found === 1, `${found} × .codex-composer textarea`];
  });

  // Sample the answer every time the DOM changes. A MutationObserver counts
  // actual DOM writes, which is the quantity the coalescing changed — polling
  // would measure the sampler instead.
  //
  // The answer bubble is the one *without* `is-user`: the render only tags user
  // turns, so there is no `.assistant` class to match on. Bubbles present before
  // the run are excluded by count, so a previous answer already on screen cannot
  // be mistaken for this turn's first delta.
  const installed = await page.eval<string>(`(() => {
    const root = document.querySelector(".codex-messages");
    if (!root) return "no-root";
    const answers = () => document.querySelectorAll(".codex-message:not(.is-user) .codex-message-content");
    window.__probe = { samples: [], start: 0, base: answers().length };
    const read = () => {
      const nodes = answers();
      if (nodes.length <= window.__probe.base) return 0;
      const last = nodes[nodes.length - 1];
      return last ? (last.textContent || "").length : 0;
    };
    const observer = new MutationObserver(() => {
      if (!window.__probe.start) return;
      window.__probe.samples.push([performance.now() - window.__probe.start, read()]);
    });
    observer.observe(root, { subtree: true, childList: true, characterData: true });
    window.__probeStop = () => observer.disconnect();
    window.__probeRead = read;
    return "watching";
  })()`);
  run.check("observer attached to the message list", installed === "watching", installed);

  // Set the value through the prototype setter so React's onChange sees it, then
  // send with the same Enter the composer listens for.
  const typed = await page.eval<string>(`(() => {
    const box = document.querySelector(".codex-composer textarea");
    if (!box) return "no-textarea";
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(box, ${JSON.stringify(PROMPT)});
    box.dispatchEvent(new Event("input", { bubbles: true }));
    window.__probe.start = performance.now();
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    return "sent";
  })()`);
  run.check("prompt submitted", typed === "sent", typed === "sent" ? clip(PROMPT, 46) : typed);

  // The stop button is enabled only while a run is in flight, so watch it come
  // up and then go back down. Latching on the rise first is what makes this
  // correct: "not running" is also true before the run has started, and testing
  // only for that would end the walk with an empty answer.
  const isRunning = () =>
    page.eval<boolean>(`Boolean(document.querySelector(".codex-stop:not([disabled])"))`);

  await run.waitFor(
    "run starts",
    async () => {
      const running = await isRunning();
      return [running, running ? "stop button enabled" : "stop button still disabled"];
    },
    { timeoutMs: 30_000 },
  );

  // Generous: the wall time here is the model's, not the app's.
  await run.waitFor(
    "run finishes",
    async () => {
      const running = await isRunning();
      const chars = await page.eval<number>(`window.__probeRead?.() ?? 0`);
      return [!running, `${chars} chars on screen`];
    },
    { timeoutMs: 240_000, intervalMs: 500 },
  );

  // The last flush is scheduled on a timer, so it lands just after the stream
  // closes. Waiting here is what makes the dropped-tail check below meaningful.
  await sleep(1000);

  const report = await page.eval<Report>(`(() => {
    window.__probeStop?.();
    const nodes = document.querySelectorAll(".codex-message:not(.is-user) .codex-message-content");
    const last = nodes[nodes.length - 1];
    return { samples: window.__probe.samples, text: last ? (last.textContent || "") : "" };
  })()`);

  // Only strictly-growing samples are repaints of the stream: the rest are the
  // surrounding UI (run steps, usage panel) re-rendering, and a zero-length
  // sample is the empty bubble being created rather than a character appearing.
  let seen = 0;
  const growth = report.samples.filter(([, length]) => {
    if (length <= seen) return false;
    seen = length;
    return true;
  });
  const chars = report.text.length;
  const perRepaint = chars / Math.max(growth.length, 1);

  run.check("answer arrives", chars > 0, `${chars} chars`);

  run.check(
    "answer is long enough to measure",
    chars >= MEASURABLE_CHARS,
    `${chars} chars (need ${MEASURABLE_CHARS})`,
  );

  if (chars >= MEASURABLE_CHARS) {
    run.check(
      "deltas are coalesced, not committed one by one",
      perRepaint >= MIN_CHARS_PER_REPAINT,
      `${growth.length} repaints · ${perRepaint.toFixed(1)} chars each`,
    );
  }

  // The buffer holds the tail until its timer fires. If the final flush is lost
  // — the failure mode that silently truncates an answer — the DOM ends up
  // shorter than the last thing the observer saw.
  const lastSample = growth.length > 0 ? growth[growth.length - 1]![1] : 0;
  run.check(
    "no characters left in the buffer",
    chars >= lastSample,
    `final ${chars} vs last sample ${lastSample}`,
  );

  const gaps = growth.slice(1).map((s, i) => s[0] - growth[i]![0]);
  if (gaps.length > 0) {
    const sorted = [...gaps].sort((a, b) => a - b);
    // Reported, not asserted: these gaps include the model's own pauses, so a
    // threshold here would fail for reasons that have nothing to do with the UI.
    process.stdout.write(
      `      first char after ${growth[0]![0].toFixed(0)}ms · ` +
        `gaps min ${sorted[0]!.toFixed(0)}ms · ` +
        `median ${sorted[Math.floor(sorted.length / 2)]!.toFixed(0)}ms · ` +
        `max ${sorted[sorted.length - 1]!.toFixed(0)}ms\n`,
    );
  }
  process.stdout.write(`      tail: ${clip(report.text.slice(-70))}\n`);

  const problems = page.drainProblems();
  run.check(
    "no console errors or failed requests",
    problems.length === 0,
    problems.length === 0 ? "clean" : problems.map((p) => p.text).join(" | "),
  );

  page.close();
  process.exit(run.report());
}

main().catch((error) => {
  process.stderr.write(
    `streaming walk failed: ${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exit(1);
});
