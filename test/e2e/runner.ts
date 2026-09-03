// Shared bookkeeping for the two end-to-end harnesses.
//
// The `waitFor` helper here is the fix for the last false failure of the
// previous run. The menu-bar popup fetches its summary over IPC when it is
// shown, and the walk sampled `document.body.innerText` exactly once — catching
// the "加载使用量数据…" placeholder and reporting a broken popup. The popup was
// fine.
//
// A single sample of asynchronous state is never a valid assertion, so this
// module provides the polling form and the harnesses use it for anything that
// arrives over IPC, HTTP or a lazy chunk. `check` remains for state that is
// already settled by construction.

export interface Case {
  name: string;
  ok: boolean;
  detail: string;
}

export class Runner {
  readonly cases: Case[] = [];
  private readonly title: string;

  // Field plus assignment instead of a parameter property, because the sweeps
  // run through `node test/e2e/*.ts` and strip-only TypeScript cannot erase
  // parameter properties.
  constructor(title: string) {
    this.title = title;
    process.stdout.write(`\n── ${title} ${"─".repeat(Math.max(0, 60 - title.length))}\n`);
  }

  /** Record a settled assertion. */
  check(name: string, ok: boolean, detail = ""): boolean {
    this.cases.push({ name, ok, detail });
    const tag = ok ? "PASS" : "FAIL";
    process.stdout.write(`${tag}  ${name.padEnd(46)} ${detail}\n`);
    return ok;
  }

  /**
   * Poll `probe` until it reports success, then record one case.
   *
   * `probe` returns `[ok, detail]`. The recorded detail is whatever the last
   * attempt produced, so a timeout reports the state it actually observed
   * rather than just "timed out" — that difference is what distinguishes "still
   * loading" from "rendered the wrong thing".
   */
  async waitFor(
    name: string,
    probe: () => Promise<[boolean, string]>,
    { timeoutMs = 10_000, intervalMs = 250 }: { timeoutMs?: number; intervalMs?: number } = {},
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const [ok, detail] = await Runner.attempt(probe);
      if (ok) return this.check(name, true, detail);
      if (Date.now() >= deadline) {
        return this.check(name, false, `${detail} (after ${timeoutMs}ms)`);
      }
      await sleep(intervalMs);
    }
  }

  /**
   * One probe attempt, which never throws: a probe that blows up is a failed
   * attempt whose message is the detail. Folding the throw into the return
   * value is what keeps the loop above free of mutable state, so the reported
   * detail cannot drift from the attempt it came from.
   */
  private static async attempt(
    probe: () => Promise<[boolean, string]>,
  ): Promise<[boolean, string]> {
    try {
      return await probe();
    } catch (error) {
      return [false, error instanceof Error ? error.message : String(error)];
    }
  }

  get passed(): number {
    return this.cases.filter((c) => c.ok).length;
  }

  get failed(): number {
    return this.cases.filter((c) => !c.ok).length;
  }

  /** Print the tally. Returns the process exit code to use. */
  report(): number {
    const total = this.cases.length;
    process.stdout.write(`\n${this.title}: ${this.passed}/${total} passed, ${this.failed} failed\n`);
    if (this.failed > 0) {
      process.stdout.write("\nFailures:\n");
      for (const c of this.cases.filter((x) => !x.ok)) {
        process.stdout.write(`  ${c.name}: ${c.detail}\n`);
      }
    }
    return this.failed === 0 ? 0 : 1;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Collapse whitespace so a text assertion is not defeated by layout. */
export function squash(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Truncate for a one-line report column. */
export function clip(text: string, max = 70): string {
  const flat = squash(text);
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}
